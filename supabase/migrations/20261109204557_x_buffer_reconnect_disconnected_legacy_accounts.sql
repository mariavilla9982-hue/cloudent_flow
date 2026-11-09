CREATE OR REPLACE FUNCTION public.x_buffer_connect_own_account(p_owner uuid, p_username text, p_x_user_id text, p_channel_id text, p_cipher text, p_iv text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  owner_workspace uuid;
  account_id uuid;
begin
  if coalesce(p_username, '') !~ '^[a-zA-Z0-9_]{1,15}$'
     or coalesce(p_x_user_id, '') !~ '^[0-9]+$'
     or coalesce(p_channel_id, '') = '' or coalesce(p_cipher, '') = '' or coalesce(p_iv, '') = '' then
    raise exception 'buffer_account_invalid';
  end if;
  select workspace_id into owner_workspace
    from public.app_members
   where user_id = p_owner and enabled and role in ('admin', 'x_user');
  if owner_workspace is null then
    raise exception 'buffer_account_owner_not_authorized';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('x-buffer:' || p_x_user_id, 0));
  select id into account_id
    from public.platform_accounts
   where platform = 'x' and external_account_id = p_x_user_id;
  if account_id is null then
    account_id := public.x_buffer_register_account(gen_random_uuid(), p_owner, p_username, p_x_user_id);
  end if;

  update public.platform_accounts
     set enabled = true, account_label = p_username, updated_at = now(),
         config = (config - array['accessTokenCipher','accessTokenIv','refreshTokenCipher','refreshTokenIv'])
           || jsonb_build_object('status', 'connected', 'username', p_username, 'publish_provider', 'buffer',
           'buffer_channel_id', p_channel_id, 'buffer_key_cipher', p_cipher, 'buffer_key_iv', p_iv)
   where id = account_id and workspace_id = owner_workspace and owner_user_id = p_owner
     and (config->>'publish_provider' = 'buffer'
       or (not enabled and config->>'status' = 'disconnected'
         and coalesce(config->>'publish_provider', 'x') = 'x'));
  if not found then
    raise exception 'buffer_account_conflict';
  end if;
  insert into public.x_account_access (workspace_id, user_id, platform_account_id)
  values (owner_workspace, p_owner, account_id)
  on conflict (user_id, platform_account_id) do nothing;

  return account_id;
end;
$function$;
