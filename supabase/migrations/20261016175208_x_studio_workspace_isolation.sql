-- Incremental rollout. Existing media, schedules and tokens are never rewritten.
create schema if not exists cloudent_private;
revoke all on schema cloudent_private from public, anon, authenticated;
create table if not exists cloudent_private.x_rollout_backup(key text primary key, payload jsonb not null, created_at timestamptz default now());
insert into cloudent_private.x_rollout_backup(key,payload)
select '20261016_functions',jsonb_agg(jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid),'acl',proacl))
from pg_proc where pronamespace='public'::regnamespace and prokind='f'
on conflict do nothing;
insert into cloudent_private.x_rollout_backup(key,payload)
select '20261016_policies',coalesce(jsonb_agg(to_jsonb(p)),'[]') from pg_policies p where schemaname='public' on conflict do nothing;

create table public.workspaces(id uuid primary key default gen_random_uuid(),slug text unique not null,owner_user_id uuid not null references auth.users(id),created_at timestamptz not null default now());
insert into public.workspaces(slug,owner_user_id) select 'cloudentflow',user_id from public.app_members where enabled and role='admin' order by created_at limit 1;
alter table public.app_members add column workspace_id uuid references public.workspaces(id);
update public.app_members set workspace_id=(select id from public.workspaces where slug='cloudentflow');
alter table public.app_members drop constraint app_members_role_check;
alter table public.app_members add constraint app_members_role_check check(role in ('admin','member','x_user'));
alter table public.member_invites add column workspace_id uuid references public.workspaces(id);
update public.member_invites set workspace_id=(select id from public.workspaces where slug='cloudentflow');
alter table public.member_invites drop constraint member_invites_role_check;
alter table public.member_invites add constraint member_invites_role_check check(role in ('admin','member','x_user'));
alter table public.platform_accounts add column workspace_id uuid references public.workspaces(id);
alter table public.platform_accounts add column owner_user_id uuid references auth.users(id);
update public.platform_accounts a set workspace_id=w.id,owner_user_id=coalesce((a.config->>'owner_user_id')::uuid,w.owner_user_id) from public.workspaces w where w.slug='cloudentflow';
create index platform_accounts_workspace_owner on public.platform_accounts(workspace_id,owner_user_id,platform);

create table public.x_account_access(workspace_id uuid not null references public.workspaces(id),user_id uuid not null references auth.users(id),platform_account_id uuid not null references public.platform_accounts(id),created_at timestamptz default now(),primary key(user_id,platform_account_id));
create or replace function public.cloudent_x_access(p_user uuid,p_account uuid) returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from public.app_members m join public.platform_accounts a on a.workspace_id=m.workspace_id
 where m.user_id=p_user and m.enabled and m.role in ('admin','x_user') and a.id=p_account and a.platform='x'
 and (m.role='admin' or a.owner_user_id=p_user or exists(select 1 from public.x_account_access g where g.user_id=p_user and g.platform_account_id=a.id and g.workspace_id=m.workspace_id)))
$$;
revoke all on function public.cloudent_x_access(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cloudent_x_access(uuid,uuid) to service_role;

create table public.x_account_configs(
 platform_account_id uuid primary key references public.platform_accounts(id),workspace_id uuid not null references public.workspaces(id),user_id uuid not null references auth.users(id),enabled boolean not null default false,
 interval_minutes int not null default 120 check(interval_minutes between 5 and 10080),daily_slots text[] not null default array['12:00','18:00'],timezone text not null default 'America/Sao_Paulo',next_publish_at timestamptz,last_worker_at timestamptz,last_error text,updated_at timestamptz not null default now());
insert into public.x_account_configs(platform_account_id,workspace_id,user_id,enabled,interval_minutes,daily_slots,timezone,next_publish_at,last_worker_at,last_error)
select c.platform_account_id,a.workspace_id,c.user_id,c.enabled,c.interval_minutes,c.daily_slots,c.timezone,c.next_publish_at,c.last_worker_at,c.last_error from public.x_publish_configs c join public.platform_accounts a on a.id=c.platform_account_id where a.platform='x';
alter table public.x_drive_posts add column workspace_id uuid references public.workspaces(id);
update public.x_drive_posts p set workspace_id=a.workspace_id from public.platform_accounts a where p.platform_account_id=a.id;
alter table public.x_drive_posts add column reply_text text;
alter table public.x_drive_posts add column reply_status text not null default 'none' check(reply_status in ('none','pending','processing','published','failed','uncertain'));
alter table public.x_drive_posts add column external_reply_id text;
alter table public.x_drive_posts add column reply_error text;
alter table public.x_drive_posts add column reply_attempts int not null default 0;
alter table public.x_drive_posts add column metrics jsonb not null default '{}';
alter table public.x_drive_posts add column metrics_synced_at timestamptz;
alter table public.x_drive_posts drop constraint x_drive_posts_user_id_drive_file_id_key;
alter table public.x_drive_posts add constraint x_drive_posts_source_account_unique unique(user_id,drive_file_id,platform_account_id);
drop index public.x_posts_reserved_slot;
create unique index x_posts_reserved_slot on public.x_drive_posts(platform_account_id,scheduled_at) where scheduled_at is not null and status in ('queued','processing','failed','published');
create index x_posts_account_queue on public.x_drive_posts(platform_account_id,status,next_attempt_at);
create unique index x_posts_external_id_unique on public.x_drive_posts(platform_account_id,x_post_id) where x_post_id is not null;

create or replace function public.bind_x_post_account() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.platform_accounts;
begin
 if new.platform_account_id is null then raise exception 'platform_account_id_required'; end if;
 select * into a from public.platform_accounts where id=new.platform_account_id and platform='x';
 if not found or not public.cloudent_x_access(new.user_id,a.id) then raise exception 'x_account_access_denied'; end if;
 if tg_op='UPDATE' and (new.platform_account_id<>old.platform_account_id or new.user_id<>old.user_id) then raise exception 'x_job_binding_immutable'; end if;
 new.workspace_id:=a.workspace_id;
 return new;
end $$;
create trigger bind_x_post_account before insert or update of platform_account_id,user_id,workspace_id on public.x_drive_posts for each row execute function public.bind_x_post_account();
revoke all on function public.bind_x_post_account() from public,anon,authenticated;

-- Only explicitly authorized, account-bound jobs may be claimed. No account fallback.
create function public.claim_x_account_post(p_account uuid,p_worker text) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.x_account_configs; p public.x_drive_posts;
begin
 perform pg_advisory_xact_lock(hashtextextended('x-account:'||p_account::text,0));
 select * into c from public.x_account_configs where platform_account_id=p_account for update;
 if not found or not c.enabled then return null; end if;
 if not exists(select 1 from public.platform_accounts where id=p_account and enabled and config->>'status'='connected') then return null; end if;
 if exists(select 1 from public.x_drive_posts where platform_account_id=p_account and status='processing') then return null; end if;
 select * into p from public.x_drive_posts where platform_account_id=p_account and status='queued' and x_post_id is null
 and not coalesce((meta->>'publish_uncertain')::boolean,false) and attempts<max_attempts
 and public.cloudent_x_access(user_id,p_account) and next_attempt_at<=now()
 and (scheduled_at<=now() or (scheduled_at is null and coalesce(c.next_publish_at,now())<=now()))
 order by scheduled_at nulls last,created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 update public.x_drive_posts set status='processing',attempts=attempts+1,locked_at=now(),locked_by=p_worker,last_error=null,updated_at=now() where id=p.id returning * into p;
 return to_jsonb(p);
end $$;
create or replace function public.complete_x_upload_post(p_id uuid,p_worker_id text,p_account_id uuid,p_text text,p_media_id text,p_post_id text) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare p public.x_drive_posts;
begin
 update public.x_drive_posts set status='published',post_text=p_text,x_media_id=p_media_id,x_post_id=p_post_id,published_at=now(),locked_at=null,locked_by=null,last_error=null,
 reply_status=case when nullif(reply_text,'') is not null then 'pending' else 'none' end,
 meta=meta||'{"publish_uncertain":false}'::jsonb,updated_at=now()
 where id=p_id and platform_account_id=p_account_id and status='processing' and locked_by=p_worker_id and x_post_id is null returning * into p;
 if not found then raise exception 'publication_claim_lost'; end if;
 update public.x_account_configs set next_publish_at=case when p.scheduled_at is null then now()+make_interval(mins=>interval_minutes) else next_publish_at end,last_worker_at=now(),last_error=null,updated_at=now() where platform_account_id=p_account_id;
end $$;
-- Disable legacy claim to keep old invocations from consuming account-scoped jobs.
create or replace function public.claim_x_upload_post(p_user_id uuid,p_worker_id text) returns jsonb language sql security invoker set search_path=public,pg_temp as $$ select null::jsonb $$;
revoke all on function public.claim_x_account_post(uuid,text),public.complete_x_upload_post(uuid,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_x_account_post(uuid,text),public.complete_x_upload_post(uuid,text,uuid,text,text,text) to service_role;

create table public.x_audit_log(id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id),user_id uuid references auth.users(id),platform_account_id uuid references public.platform_accounts(id),event_type text not null,metadata jsonb not null default '{}',created_at timestamptz not null default now());
create table cloudent_private.rate_limits(user_id uuid not null,bucket text not null,window_start timestamptz not null,requests int not null,primary key(user_id,bucket,window_start));
create function public.cloudent_rate_limit(p_user uuid,p_bucket text,p_limit int default 60) returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$declare n int; w timestamptz:=date_trunc('minute',now());begin insert into cloudent_private.rate_limits values(p_user,p_bucket,w,1) on conflict(user_id,bucket,window_start) do update set requests=rate_limits.requests+1 returning requests into n; delete from cloudent_private.rate_limits where window_start<now()-interval '1 day'; return n<=least(120,greatest(1,p_limit));end $$;
revoke all on function public.cloudent_rate_limit(uuid,text,int) from public,anon,authenticated;
grant execute on function public.cloudent_rate_limit(uuid,text,int) to service_role;

-- Raw platform configs (including encrypted credentials) remain backend-only.
alter table public.workspaces enable row level security;
alter table public.x_account_access enable row level security;
alter table public.x_account_configs enable row level security;
alter table public.x_audit_log enable row level security;
revoke all on public.workspaces,public.x_account_access,public.x_account_configs,public.x_audit_log from anon,authenticated;
grant all on public.workspaces,public.x_account_access,public.x_account_configs,public.x_audit_log to service_role;
grant usage,select on sequence public.x_audit_log_id_seq to service_role;
-- Block direct mutations; the API verifies membership and account authorization.
revoke insert,update,delete on public.x_publish_configs from anon,authenticated;
-- Legacy SECURITY DEFINER RPCs exposed despite RLS must not bypass the new boundary.
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.current_cloudent_role(),public.is_cloudent_admin() to authenticated;
grant execute on all functions in schema public to service_role;
-- The existing Face Swap selector calls this RPC directly. Preserve it for admins.
do $guard$ declare definition text; begin
 select pg_get_functiondef(oid) into definition from pg_proc where oid='public.set_face_swap_character_preset(text)'::regprocedure;
 definition:=replace(definition,E'begin\n',E'begin\n  if not public.is_cloudent_admin() then raise exception ''forbidden''; end if;\n');
 execute definition;
end $guard$;
grant execute on function public.set_face_swap_character_preset(text) to authenticated;

create function cloudent_private.read_x_account(p_account uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.cloudent_x_access(auth.uid(),p_account)
$$;
revoke all on function cloudent_private.read_x_account(uuid) from public,anon;
grant usage on schema cloudent_private to authenticated;
grant execute on function cloudent_private.read_x_account(uuid) to authenticated;
drop policy x_drive_posts_own_select on public.x_drive_posts;
create policy x_posts_authorized_read on public.x_drive_posts for select to authenticated using(cloudent_private.read_x_account(platform_account_id));
create policy x_configs_active_member on public.x_publish_configs as restrictive for select to authenticated using(cloudent_private.read_x_account(platform_account_id));
-- No JWT role claims or user-editable metadata participate in authorization.
grant usage on schema cloudent_private to service_role;
grant all on cloudent_private.rate_limits to service_role;
alter table public.x_drive_posts add column reply_started_at timestamptz;

alter table public.x_account_configs add column last_metrics_at timestamptz;
alter table public.x_account_configs add column metrics_error text;
