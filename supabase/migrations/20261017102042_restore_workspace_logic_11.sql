set check_function_bodies=false;
CREATE OR REPLACE FUNCTION public.release_motion_storage_claim(p_job_id uuid, p_worker text) RETURNS void
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
 update public.production_jobs set status='motion_waiting',attempt_count=greatest(0,attempt_count-1),progress=0,started_at=null,
 locked_at=null,locked_by=null,last_error=null,next_attempt_at=now()+interval '1 minute',updated_at=now()
 where id=p_job_id and locked_by=p_worker and runninghub_task_id is null and meta->>'workflow_key'='motion_control';
$$;


ALTER FUNCTION public.release_motion_storage_claim(p_job_id uuid, p_worker text) OWNER TO postgres;
revoke all on function public.release_motion_storage_claim(p_job_id uuid, p_worker text) from public,anon,authenticated; grant execute on function public.release_motion_storage_claim(p_job_id uuid, p_worker text) to service_role;
CREATE OR REPLACE FUNCTION public.release_stale_x_drive_posts() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare n integer;
begin
 update public.x_drive_posts set status=case when coalesce((meta->>'publish_request_started')::boolean,false) then 'failed' else 'queued' end,
 meta=meta||jsonb_build_object('publish_uncertain',coalesce((meta->>'publish_request_started')::boolean,false)),
 locked_at=null,locked_by=null,last_error=case when coalesce((meta->>'publish_request_started')::boolean,false) then 'Envio interrompido após iniciar a publicação. Confira a conta X antes de repetir.' else 'worker_interrupted' end,updated_at=now()
 where status='processing' and locked_at<now()-interval '15 minutes' and x_post_id is null;
 get diagnostics n=row_count;return n;
end $$;


ALTER FUNCTION public.release_stale_x_drive_posts() OWNER TO postgres;
revoke all on function public.release_stale_x_drive_posts() from public,anon,authenticated; grant execute on function public.release_stale_x_drive_posts() to service_role;
CREATE OR REPLACE FUNCTION public.set_cloudent_r2_config(p_account_id text, p_access_key_id text, p_secret_access_key text, p_bucket text, p_endpoint text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
declare
  v_id uuid;
  v_endpoint text;
begin
  if length(trim(coalesce(p_account_id,''))) < 4 then
    raise exception 'r2_account_id_invalid';
  end if;
  if length(trim(coalesce(p_access_key_id,''))) < 8 then
    raise exception 'r2_access_key_id_invalid';
  end if;
  if length(trim(coalesce(p_secret_access_key,''))) < 16 then
    raise exception 'r2_secret_access_key_invalid';
  end if;
  if length(trim(coalesce(p_bucket,''))) < 3 then
    raise exception 'r2_bucket_invalid';
  end if;

  v_endpoint := coalesce(nullif(trim(p_endpoint),''), 'https://' || trim(p_account_id) || '.r2.cloudflarestorage.com');

  select id into v_id from vault.decrypted_secrets where name='cloudent_r2_account_id' limit 1;
  if v_id is null then
    perform vault.create_secret(trim(p_account_id),'cloudent_r2_account_id','CloudentFlow R2 account id');
  else
    perform vault.update_secret(v_id,trim(p_account_id),'cloudent_r2_account_id','CloudentFlow R2 account id');
  end if;

  v_id := null;
  select id into v_id from vault.decrypted_secrets where name='cloudent_r2_access_key_id' limit 1;
  if v_id is null then
    perform vault.create_secret(trim(p_access_key_id),'cloudent_r2_access_key_id','CloudentFlow R2 access key id');
  else
    perform vault.update_secret(v_id,trim(p_access_key_id),'cloudent_r2_access_key_id','CloudentFlow R2 access key id');
  end if;

  v_id := null;
  select id into v_id from vault.decrypted_secrets where name='cloudent_r2_secret_access_key' limit 1;
  if v_id is null then
    perform vault.create_secret(trim(p_secret_access_key),'cloudent_r2_secret_access_key','CloudentFlow R2 secret access key');
  else
    perform vault.update_secret(v_id,trim(p_secret_access_key),'cloudent_r2_secret_access_key','CloudentFlow R2 secret access key');
  end if;

  v_id := null;
  select id into v_id from vault.decrypted_secrets where name='cloudent_r2_bucket' limit 1;
  if v_id is null then
    perform vault.create_secret(trim(p_bucket),'cloudent_r2_bucket','CloudentFlow R2 bucket');
  else
    perform vault.update_secret(v_id,trim(p_bucket),'cloudent_r2_bucket','CloudentFlow R2 bucket');
  end if;

  v_id := null;
  select id into v_id from vault.decrypted_secrets where name='cloudent_r2_endpoint' limit 1;
  if v_id is null then
    perform vault.create_secret(v_endpoint,'cloudent_r2_endpoint','CloudentFlow R2 S3 endpoint');
  else
    perform vault.update_secret(v_id,v_endpoint,'cloudent_r2_endpoint','CloudentFlow R2 S3 endpoint');
  end if;
end;
$$;


ALTER FUNCTION public.set_cloudent_r2_config(p_account_id text, p_access_key_id text, p_secret_access_key text, p_bucket text, p_endpoint text) OWNER TO postgres;
revoke all on function public.set_cloudent_r2_config(p_account_id text, p_access_key_id text, p_secret_access_key text, p_bucket text, p_endpoint text) from public,anon,authenticated; grant execute on function public.set_cloudent_r2_config(p_account_id text, p_access_key_id text, p_secret_access_key text, p_bucket text, p_endpoint text) to service_role;
CREATE OR REPLACE FUNCTION public.set_face_swap_character_preset(p_preset text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_presets jsonb;
  v_character jsonb;
  v_name text := lower(trim(coalesce(p_preset,'')));
begin
  if not public.is_cloudent_admin() then raise exception 'forbidden'; end if;
  if v_uid is null then
    raise exception 'authentication_required';
  end if;
  if v_name not in ('julia','sahry') then
    raise exception 'invalid_character_preset';
  end if;

  select value into v_presets
  from public.app_settings
  where key = 'face_swap_character_presets_' || v_uid::text;

  if v_presets is null or not (v_presets ? v_name) then
    raise exception 'character_preset_not_configured';
  end if;

  v_character := v_presets -> v_name;

  insert into public.app_settings(key,value)
  values('face_swap_character_' || v_uid::text, v_character)
  on conflict (key) do update set value = excluded.value;

  return jsonb_build_object('ok',true,'preset',v_name,'character',v_character);
end;
$$;


ALTER FUNCTION public.set_face_swap_character_preset(p_preset text) OWNER TO postgres;
revoke all on function public.set_face_swap_character_preset(p_preset text) from public,anon,authenticated; grant execute on function public.set_face_swap_character_preset(p_preset text) to service_role;
CREATE OR REPLACE FUNCTION public.set_instagram_page_token(p_token text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
declare
  sid uuid;
begin
  select id into sid from vault.secrets where name = 'instagram_page_access_token' limit 1;
  if sid is null then
    perform vault.create_secret(p_token, 'instagram_page_access_token', 'CloudentFlow Instagram Page Access Token');
  else
    perform vault.update_secret(sid, p_token);
  end if;
end
$$;


ALTER FUNCTION public.set_instagram_page_token(p_token text) OWNER TO postgres;
revoke all on function public.set_instagram_page_token(p_token text) from public,anon,authenticated; grant execute on function public.set_instagram_page_token(p_token text) to service_role;
CREATE OR REPLACE FUNCTION public.set_instagram_page_token_for_account(p_account_id uuid, p_token text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault', 'extensions'
    AS $$
declare
  v_name text := 'instagram_page_token_' || p_account_id::text;
begin
  if p_account_id is null or coalesce(trim(p_token),'') = '' then
    raise exception 'invalid arguments';
  end if;
  if not exists (select 1 from public.platform_accounts where id=p_account_id and platform='instagram') then
    raise exception 'instagram platform account not found';
  end if;
  delete from vault.secrets where name=v_name;
  perform vault.create_secret(p_token, v_name, 'Instagram page token for platform account ' || p_account_id::text);
end;
$$;


ALTER FUNCTION public.set_instagram_page_token_for_account(p_account_id uuid, p_token text) OWNER TO postgres;
revoke all on function public.set_instagram_page_token_for_account(p_account_id uuid, p_token text) from public,anon,authenticated; grant execute on function public.set_instagram_page_token_for_account(p_account_id uuid, p_token text) to service_role;
CREATE OR REPLACE FUNCTION public.set_instagram_web_session(p_cookie text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
declare
  sid uuid;
begin
  if p_cookie is null or length(trim(p_cookie)) < 12 then
    raise exception 'instagram_web_session_invalid';
  end if;
  select id into sid from vault.secrets where name='instagram_web_session_cookie' limit 1;
  if sid is null then
    perform vault.create_secret(trim(p_cookie),'instagram_web_session_cookie','CloudentFlow Instagram browser session');
  else
    perform vault.update_secret(sid,trim(p_cookie));
  end if;
end
$$;


ALTER FUNCTION public.set_instagram_web_session(p_cookie text) OWNER TO postgres;
revoke all on function public.set_instagram_web_session(p_cookie text) from public,anon,authenticated; grant execute on function public.set_instagram_web_session(p_cookie text) to service_role;
CREATE OR REPLACE FUNCTION public.set_instagram_web_session(p_user_id uuid, p_cookie text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
declare
  sid uuid;
  secret_name text := 'instagram_web_session_cookie_' || p_user_id::text;
begin
  if p_user_id is null or p_cookie is null or length(trim(p_cookie)) < 12 then
    raise exception 'instagram_web_session_invalid';
  end if;
  select id into sid from vault.secrets where name=secret_name limit 1;
  if sid is null then
    perform vault.create_secret(trim(p_cookie),secret_name,'CloudentFlow Instagram browser session');
  else
    perform vault.update_secret(sid,trim(p_cookie));
  end if;
end
$$;


ALTER FUNCTION public.set_instagram_web_session(p_user_id uuid, p_cookie text) OWNER TO postgres;
revoke all on function public.set_instagram_web_session(p_user_id uuid, p_cookie text) from public,anon,authenticated; grant execute on function public.set_instagram_web_session(p_user_id uuid, p_cookie text) to service_role;

set check_function_bodies=true;
