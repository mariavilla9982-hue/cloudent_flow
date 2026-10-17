-- Incremental completion of existing X Studio data model; no Instagram changes.
alter table public.member_invites add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
create table if not exists public.x_invite_account_access(
 email text not null references public.member_invites(email) on delete cascade,
 workspace_id uuid not null references public.workspaces(id),
 platform_account_id uuid not null references public.platform_accounts(id),
 primary key(email,platform_account_id)
);
alter table public.x_invite_account_access enable row level security;
revoke all on public.x_invite_account_access from public,anon,authenticated;
grant all on public.x_invite_account_access to service_role;
alter table public.x_drive_posts alter column platform_account_id set not null;
alter table public.x_drive_posts alter column workspace_id set not null;
alter table public.x_drive_posts add column if not exists video_storage_path text generated always as (meta->>'storage_path') stored;
alter table public.x_drive_posts add column if not exists caption text generated always as (post_text) stored;
alter table public.x_drive_posts add column if not exists external_post_id text generated always as (x_post_id) stored;

create or replace function public.cloudent_x_access(p_user uuid,p_account uuid) returns boolean
language sql stable set search_path='' as $$
select exists(select 1 from public.app_members m join public.platform_accounts a on a.workspace_id=m.workspace_id
 where m.user_id=p_user and m.enabled and m.role in ('admin','x_user') and a.id=p_account and a.platform='x'
 and (m.role='admin' or exists(select 1 from public.x_account_access g where g.user_id=p_user and g.platform_account_id=a.id and g.workspace_id=m.workspace_id)))
$$;

create or replace function public.cloudent_x_read_access(p_user uuid,p_account uuid) returns boolean
language sql stable set search_path='' as $$ select public.cloudent_x_access(p_user,p_account) $$;

create or replace function public.configure_x_invite(p_actor uuid,p_email text,p_hash text,p_accounts uuid[]) returns void
language plpgsql set search_path=public,pg_temp as $$
declare w uuid; old_w uuid;
begin
 select workspace_id into w from public.app_members where user_id=p_actor and role='admin' and enabled;
 if w is null then raise exception 'forbidden'; end if;
 if exists(select 1 from auth.users u join public.app_members m on m.user_id=u.id where lower(u.email)=p_email and (m.role<>'x_user' or m.workspace_id<>w)) then raise exception 'invite_role_conflict';end if;
 if exists(select 1 from unnest(p_accounts) id where not exists(select 1 from public.platform_accounts a where a.id=id and a.workspace_id=w and a.platform='x')) then raise exception 'forbidden_account';end if;
 select workspace_id into old_w from public.member_invites where email=p_email for update;
 if old_w is not null and old_w<>w then raise exception 'forbidden';end if;
 insert into public.member_invites(email,role,enabled,workspace_id,invited_by,signup_token_hash,signup_token_expires_at)
 values(p_email,'x_user',true,w,p_actor,p_hash,now()+interval '24 hours')
 on conflict(email) do update set role='x_user',enabled=true,workspace_id=w,invited_by=p_actor,claimed_by=null,claimed_at=null,auth_user_id=null,signup_token_hash=p_hash,signup_token_expires_at=now()+interval '24 hours',updated_at=now();
 delete from public.x_invite_account_access where email=p_email;
 insert into public.x_invite_account_access select p_email,w,id from unnest(p_accounts) id on conflict do nothing;
end $$;

create or replace function public.update_x_invite_access(p_actor uuid,p_email text,p_enabled boolean,p_accounts uuid[]) returns void
language plpgsql set search_path=public,pg_temp as $$
declare w uuid;
begin
 select workspace_id into w from public.app_members where user_id=p_actor and role='admin' and enabled;
 if w is null then raise exception 'forbidden';end if;
 perform 1 from public.member_invites where email=p_email and workspace_id=w and role='x_user' and claimed_by is null for update;
 if not found then raise exception 'invite_not_found';end if;
 if exists(select 1 from unnest(p_accounts) id where not exists(select 1 from public.platform_accounts a where a.id=id and a.workspace_id=w and a.platform='x')) then raise exception 'forbidden_account';end if;
 update public.member_invites set enabled=p_enabled,signup_token_hash=case when p_enabled then signup_token_hash else null end,updated_at=now() where email=p_email;
 delete from public.x_invite_account_access where email=p_email;
 if p_enabled then insert into public.x_invite_account_access select p_email,w,id from unnest(p_accounts) id on conflict do nothing;end if;
end $$;

create or replace function public.set_x_user_access(p_actor uuid,p_user uuid,p_enabled boolean,p_accounts uuid[]) returns void
language plpgsql set search_path=public,pg_temp as $$
declare w uuid;
begin
 select workspace_id into w from public.app_members where user_id=p_actor and role='admin' and enabled;
 if w is null or p_actor=p_user then raise exception 'forbidden';end if;
 perform 1 from public.app_members where user_id=p_user and workspace_id=w and role='x_user' for update;
 if not found then raise exception 'member_not_found';end if;
 if p_accounts is not null then
  if exists(select 1 from unnest(p_accounts) id where not exists(select 1 from public.platform_accounts a where a.id=id and a.workspace_id=w and a.platform='x')) then raise exception 'forbidden_account';end if;
  delete from public.x_account_access where user_id=p_user and workspace_id=w;
  insert into public.x_account_access(workspace_id,user_id,platform_account_id) select w,p_user,id from unnest(p_accounts) id on conflict do nothing;
 end if;
 update public.app_members set enabled=coalesce(p_enabled,enabled),updated_at=now() where user_id=p_user;
end $$;

create or replace function public.accept_x_invite(p_user uuid,p_email text,p_hash text default null) returns uuid
language plpgsql set search_path=public,pg_temp as $$
declare i public.member_invites; old_member public.app_members;
begin
 select * into i from public.member_invites where email=p_email and role='x_user' and enabled and claimed_by is null and signup_token_expires_at>now() for update;
 if not found or not exists(select 1 from auth.users where id=p_user and lower(email)=p_email) then raise exception 'invite_not_valid';end if;
 if p_hash is null then
  if i.auth_user_id is distinct from p_user then raise exception 'invite_not_valid';end if;
 elsif i.signup_token_hash is distinct from p_hash then raise exception 'invite_not_valid';end if;
 select * into old_member from public.app_members where user_id=p_user;
 if found and (old_member.role<>'x_user' or old_member.workspace_id<>i.workspace_id) then raise exception 'invite_role_conflict';end if;
 insert into public.app_members(user_id,workspace_id,role,enabled) values(p_user,i.workspace_id,'x_user',true)
 on conflict(user_id) do update set enabled=true,updated_at=now();
 delete from public.x_account_access where user_id=p_user and workspace_id=i.workspace_id;
 insert into public.x_account_access(workspace_id,user_id,platform_account_id) select workspace_id,p_user,platform_account_id from public.x_invite_account_access where email=p_email;
 update public.member_invites set claimed_by=p_user,claimed_at=now(),signup_token_hash=null,signup_token_expires_at=null,updated_at=now() where email=p_email;
 delete from public.x_invite_account_access where email=p_email;
 return i.workspace_id;
end $$;

revoke all on function public.cloudent_x_access(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cloudent_x_access(uuid,uuid) to service_role;
revoke all on function public.configure_x_invite(uuid,text,text,uuid[]) from public,anon,authenticated;
revoke all on function public.update_x_invite_access(uuid,text,boolean,uuid[]) from public,anon,authenticated;
revoke all on function public.set_x_user_access(uuid,uuid,boolean,uuid[]) from public,anon,authenticated;
revoke all on function public.accept_x_invite(uuid,text,text) from public,anon,authenticated;
grant execute on function public.configure_x_invite(uuid,text,text,uuid[]),public.update_x_invite_access(uuid,text,boolean,uuid[]),public.set_x_user_access(uuid,uuid,boolean,uuid[]),public.accept_x_invite(uuid,text,text) to service_role;
