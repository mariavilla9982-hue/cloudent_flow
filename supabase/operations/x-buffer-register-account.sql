begin;

create or replace function public.x_buffer_register_account(
  p_id uuid, p_owner uuid, p_username text, p_x_user_id text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  owner_workspace uuid;
begin
  if p_id is null or coalesce(p_username, '') !~ '^[a-zA-Z0-9_]{1,15}$'
     or coalesce(p_x_user_id, '') !~ '^[0-9]+$' then
    raise exception 'buffer_account_invalid';
  end if;
  select workspace_id into owner_workspace
    from public.app_members
   where user_id = p_owner and enabled and role in ('admin', 'x_user');
  if owner_workspace is null then
    raise exception 'buffer_account_owner_not_authorized';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('x-buffer:' || p_x_user_id, 0));
  if exists (
    select 1 from public.platform_accounts
     where platform = 'x' and external_account_id = p_x_user_id and id <> p_id
  ) then
    raise exception 'buffer_account_already_registered';
  end if;

  insert into public.platform_accounts
    (id, platform, workspace_id, owner_user_id, external_account_id, account_label, enabled, config)
  values
    (p_id, 'x', owner_workspace, p_owner, p_x_user_id, p_username, true,
      jsonb_build_object('status', 'connected', 'username', p_username, 'publish_provider', 'buffer'))
  on conflict (id) do nothing;

  if not exists (
    select 1 from public.platform_accounts
     where id = p_id and platform = 'x' and workspace_id = owner_workspace
       and owner_user_id = p_owner and external_account_id = p_x_user_id
       and enabled and config->>'publish_provider' = 'buffer'
  ) then
    raise exception 'buffer_account_conflict';
  end if;

  insert into public.x_account_access (workspace_id, user_id, platform_account_id)
  values (owner_workspace, p_owner, p_id)
  on conflict (user_id, platform_account_id) do nothing;

  insert into public.x_account_configs (platform_account_id, workspace_id, user_id, daily_slots)
  values (p_id, owner_workspace, p_owner, array['08:00','10:00','12:00','14:00','17:00','20:00'])
  on conflict (platform_account_id) do nothing;

  return p_id;
end;
$$;

revoke all on function public.x_buffer_register_account(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.x_buffer_register_account(uuid, uuid, text, text) to service_role;

commit;
