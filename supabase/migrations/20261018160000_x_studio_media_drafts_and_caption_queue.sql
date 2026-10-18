set lock_timeout='2s';
set statement_timeout='8s';
alter table public.x_account_configs add column if not exists queue_mode text not null default 'daily_slots' check(queue_mode in ('daily_slots','interval'));
alter table public.x_account_configs add column if not exists metrics_snapshot jsonb not null default '{}'::jsonb;
create table public.x_caption_queue (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),workspace_id uuid not null references public.workspaces(id),platform_account_id uuid not null references public.platform_accounts(id),
 caption text not null check(length(caption) between 1 and 1000),status text not null default 'pending' check(status in ('pending','reserved','used','removed')),
 post_id uuid references public.x_drive_posts(id) on delete set null,created_at timestamptz not null default now(),used_at timestamptz
);
create index x_caption_pending on public.x_caption_queue(platform_account_id,user_id,created_at) where status='pending';
alter table public.x_caption_queue enable row level security;
revoke all on public.x_caption_queue from public,anon,authenticated;
grant all on public.x_caption_queue to service_role;
create policy x_caption_service on public.x_caption_queue for all to service_role using(true) with check(true);
create or replace function public.x_next_daily_slot(p_slots text[],p_after timestamptz) returns timestamptz language sql stable set search_path=public,pg_temp as $$
 select min(((p_after at time zone 'America/Sao_Paulo')::date+d.n+s.t::time) at time zone 'America/Sao_Paulo')
 from generate_series(0,2) d(n) cross join unnest(p_slots) s(t)
 where s.t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and (((p_after at time zone 'America/Sao_Paulo')::date+d.n+s.t::time) at time zone 'America/Sao_Paulo')>p_after;
$$;
revoke all on function public.x_next_daily_slot(text[],timestamptz) from public,anon,authenticated;
grant execute on function public.x_next_daily_slot(text[],timestamptz) to service_role;
CREATE OR REPLACE FUNCTION public.claim_x_account_post(p_account uuid, p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c public.x_account_configs; p public.x_drive_posts; caption_row public.x_caption_queue;
begin
 perform pg_advisory_xact_lock(hashtextextended('x-account:'||p_account::text,0));
 select * into c from public.x_account_configs where platform_account_id=p_account for update;
 if not found or not c.enabled then return null; end if;
 if not exists(select 1 from public.platform_accounts where id=p_account and enabled and config->>'status'='connected') then return null; end if;
 if c.queue_mode='daily_slots' and c.next_publish_at is null then
 update public.x_account_configs set next_publish_at=public.x_next_daily_slot(c.daily_slots,now()-interval '1 minute') where platform_account_id=p_account returning * into c;
 end if;
 if exists(select 1 from public.x_drive_posts where platform_account_id=p_account and status='processing') then return null; end if;
 select * into p from public.x_drive_posts where platform_account_id=p_account and status='queued' and x_post_id is null
 and not coalesce((meta->>'publish_uncertain')::boolean,false) and attempts<max_attempts
 and (nullif(btrim(post_text),'') is not null or exists(select 1 from public.x_caption_queue q where q.platform_account_id=p_account and q.user_id=x_drive_posts.user_id and q.status='pending'))
 and public.cloudent_x_access(user_id,p_account) and next_attempt_at<=now()
 and (scheduled_at<=now() or (scheduled_at is null and coalesce(c.next_publish_at,now())<=now()))
 order by scheduled_at nulls last,created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 if nullif(btrim(p.post_text),'') is null then
 select * into caption_row from public.x_caption_queue where platform_account_id=p_account and user_id=p.user_id and status='pending' order by created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 update public.x_caption_queue set status='reserved',post_id=p.id where id=caption_row.id;
 update public.x_drive_posts set post_text=caption_row.caption,meta=meta||jsonb_build_object('caption_queue_id',caption_row.id) where id=p.id;
 end if;
 update public.x_drive_posts set status='processing',attempts=attempts+1,locked_at=now(),locked_by=p_worker,last_error=null,updated_at=now() where id=p.id returning * into p;
 return to_jsonb(p);
end $function$;
CREATE OR REPLACE FUNCTION public.complete_x_upload_post(p_id uuid, p_worker_id text, p_account_id uuid, p_text text, p_media_id text, p_post_id text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare p public.x_drive_posts;
begin
 update public.x_drive_posts set status='published',post_text=p_text,x_media_id=p_media_id,x_post_id=p_post_id,published_at=now(),locked_at=null,locked_by=null,last_error=null,
 reply_status=case when nullif(reply_text,'') is not null then 'pending' else 'none' end,
 meta=meta||'{"publish_uncertain":false}'::jsonb,updated_at=now()
 where id=p_id and platform_account_id=p_account_id and status='processing' and locked_by=p_worker_id and x_post_id is null returning * into p;
 if not found then raise exception 'publication_claim_lost'; end if;
 update public.x_caption_queue set status='used',used_at=now() where post_id=p.id and status='reserved';
 update public.x_account_configs set next_publish_at=case when p.scheduled_at is null then case when queue_mode='daily_slots' then public.x_next_daily_slot(daily_slots,now()) else now()+make_interval(mins=>interval_minutes) end else next_publish_at end,last_worker_at=now(),last_error=null,updated_at=now() where platform_account_id=p_account_id;
end $function$;
