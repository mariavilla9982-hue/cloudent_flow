create or replace function public.cloudent_x_read_access(p_user uuid,p_account uuid)
returns boolean
language sql
stable
security invoker
set search_path=public,pg_temp
as $$
 select exists(
   select 1
   from public.app_members m
   join public.platform_accounts a on a.workspace_id=m.workspace_id
   where m.user_id=p_user
     and m.enabled
     and m.role in ('admin','x_user')
     and a.id=p_account
     and a.platform='x'
     and (
       m.role='admin'
       or a.owner_user_id=p_user
       or exists(
         select 1 from public.x_account_access g
         where g.user_id=p_user
           and g.platform_account_id=a.id
           and g.workspace_id=m.workspace_id
       )
     )
 );
$$;

create or replace function public.cloudent_x_access(p_user uuid,p_account uuid)
returns boolean
language sql
stable
security invoker
set search_path=public,pg_temp
as $$
 select exists(
   select 1
   from public.app_members m
   join public.platform_accounts a on a.workspace_id=m.workspace_id
   where m.user_id=p_user
     and m.enabled
     and m.role in ('admin','x_user')
     and a.id=p_account
     and a.platform='x'
     and (
       a.owner_user_id=p_user
       or exists(
         select 1 from public.x_account_access g
         where g.user_id=p_user
           and g.platform_account_id=a.id
           and g.workspace_id=m.workspace_id
           and m.role='x_user'
       )
     )
 );
$$;

revoke all on function public.cloudent_x_read_access(uuid,uuid) from public,anon,authenticated;
revoke all on function public.cloudent_x_access(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cloudent_x_read_access(uuid,uuid) to service_role;
grant execute on function public.cloudent_x_access(uuid,uuid) to service_role;

create or replace function cloudent_private.read_x_account(p_account uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
 select auth.uid() is not null and public.cloudent_x_read_access(auth.uid(),p_account)
$$;
revoke all on function cloudent_private.read_x_account(uuid) from public,anon;
grant usage on schema cloudent_private to authenticated;
grant execute on function cloudent_private.read_x_account(uuid) to authenticated;
