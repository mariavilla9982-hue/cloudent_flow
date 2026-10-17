set check_function_bodies=false;
CREATE OR REPLACE FUNCTION public.get_cloudent_worker_secret() RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name='cloudent_worker_secret'
  order by created_at desc
  limit 1
$$;


ALTER FUNCTION public.get_cloudent_worker_secret() OWNER TO postgres;
revoke all on function public.get_cloudent_worker_secret() from public,anon,authenticated; grant execute on function public.get_cloudent_worker_secret() to service_role;
CREATE OR REPLACE FUNCTION public.get_instagram_page_token() RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'instagram_page_access_token'
  limit 1
$$;


ALTER FUNCTION public.get_instagram_page_token() OWNER TO postgres;
revoke all on function public.get_instagram_page_token() from public,anon,authenticated; grant execute on function public.get_instagram_page_token() to service_role;
CREATE OR REPLACE FUNCTION public.get_instagram_page_token_for_account(p_account_id uuid) RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'vault', 'extensions'
    AS $$
  select ds.decrypted_secret
  from vault.decrypted_secrets ds
  where ds.name='instagram_page_token_' || p_account_id::text
  order by ds.created_at desc
  limit 1
$$;


ALTER FUNCTION public.get_instagram_page_token_for_account(p_account_id uuid) OWNER TO postgres;
revoke all on function public.get_instagram_page_token_for_account(p_account_id uuid) from public,anon,authenticated; grant execute on function public.get_instagram_page_token_for_account(p_account_id uuid) to service_role;
CREATE OR REPLACE FUNCTION public.get_instagram_web_session() RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name='instagram_web_session_cookie'
  limit 1
$$;


ALTER FUNCTION public.get_instagram_web_session() OWNER TO postgres;
revoke all on function public.get_instagram_web_session() from public,anon,authenticated; grant execute on function public.get_instagram_web_session() to service_role;
CREATE OR REPLACE FUNCTION public.get_instagram_web_session(p_user_id uuid) RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name='instagram_web_session_cookie_' || p_user_id::text
  limit 1
$$;


ALTER FUNCTION public.get_instagram_web_session(p_user_id uuid) OWNER TO postgres;
revoke all on function public.get_instagram_web_session(p_user_id uuid) from public,anon,authenticated; grant execute on function public.get_instagram_web_session(p_user_id uuid) to service_role;
CREATE OR REPLACE FUNCTION public.get_recent_schedule_metrics(p_schedule_ids uuid[], p_limit integer DEFAULT 6) RETURNS SETOF public.metrics_snapshots
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select m.*
  from public.metrics_snapshots m
  join (
    select id
    from (
      select id,
             row_number() over (
               partition by schedule_id
               order by collected_at desc
             ) as rn
      from public.metrics_snapshots
      where schedule_id = any(p_schedule_ids)
    ) ranked
    where rn <= greatest(1, least(coalesce(p_limit,6), 12))
  ) picked using (id)
  order by m.schedule_id, m.collected_at desc;
$$;


ALTER FUNCTION public.get_recent_schedule_metrics(p_schedule_ids uuid[], p_limit integer) OWNER TO postgres;
revoke all on function public.get_recent_schedule_metrics(p_schedule_ids uuid[], p_limit integer) from public,anon,authenticated; grant execute on function public.get_recent_schedule_metrics(p_schedule_ids uuid[], p_limit integer) to service_role;
CREATE OR REPLACE FUNCTION public.get_runninghub_api_key() RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name='runninghub_api_key'
  order by created_at desc
  limit 1
$$;


ALTER FUNCTION public.get_runninghub_api_key() OWNER TO postgres;
revoke all on function public.get_runninghub_api_key() from public,anon,authenticated; grant execute on function public.get_runninghub_api_key() to service_role;
CREATE OR REPLACE FUNCTION public.has_instagram_page_token_for_account(p_account_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'vault', 'extensions'
    AS $$
  select exists(
    select 1 from vault.decrypted_secrets ds
    where ds.name='instagram_page_token_' || p_account_id::text
      and coalesce(ds.decrypted_secret,'') <> ''
  )
$$;


ALTER FUNCTION public.has_instagram_page_token_for_account(p_account_id uuid) OWNER TO postgres;
revoke all on function public.has_instagram_page_token_for_account(p_account_id uuid) from public,anon,authenticated; grant execute on function public.has_instagram_page_token_for_account(p_account_id uuid) to service_role;
CREATE OR REPLACE FUNCTION public.has_runninghub_api_key() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
  select exists(select 1 from vault.secrets where name='runninghub_api_key')
$$;


ALTER FUNCTION public.has_runninghub_api_key() OWNER TO postgres;
revoke all on function public.has_runninghub_api_key() from public,anon,authenticated; grant execute on function public.has_runninghub_api_key() to service_role;
CREATE OR REPLACE FUNCTION public.is_cloudent_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(public.current_cloudent_role() = 'admin', false);
$$;


ALTER FUNCTION public.is_cloudent_admin() OWNER TO postgres;
revoke all on function public.is_cloudent_admin() from public,anon,authenticated; grant execute on function public.is_cloudent_admin() to service_role;
CREATE OR REPLACE FUNCTION public.is_instagram_calendar_caption(p_caption text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select coalesce(exists(
    select 1
    from public.app_settings s
    cross join lateral jsonb_array_elements_text(s.value->'captions') x(caption)
    where s.key='instagram_calendar_captions'
      and x.caption=p_caption
  ), false);
$$;


ALTER FUNCTION public.is_instagram_calendar_caption(p_caption text) OWNER TO postgres;
revoke all on function public.is_instagram_calendar_caption(p_caption text) from public,anon,authenticated; grant execute on function public.is_instagram_calendar_caption(p_caption text) to service_role;
CREATE OR REPLACE FUNCTION public.limit_x_warmup_accounts() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if (
    select count(*)
    from public.x_warmup_accounts
    where user_id=new.user_id
  ) >= 5 then
    raise exception 'x_warmup_account_limit';
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.limit_x_warmup_accounts() OWNER TO postgres;
revoke all on function public.limit_x_warmup_accounts() from public,anon,authenticated; grant execute on function public.limit_x_warmup_accounts() to service_role;
CREATE OR REPLACE FUNCTION public.motion_storage_block(p_reason text, p_error text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
 update public.motion_storage_health set phase='blocked',reason=p_reason,last_error=left(p_error,240),checked_at=now(),
 next_probe_at=now()+interval '5 minutes',probe_owner=null,probe_until=null,updated_at=now() where id=true;
 perform public.motion_storage_notify('blocked','Armazenamento do Motion protegido','O armazenamento principal bloqueou leituras. A fila foi preservada e a retomada será automática.');
end; $$;


ALTER FUNCTION public.motion_storage_block(p_reason text, p_error text) OWNER TO postgres;
revoke all on function public.motion_storage_block(p_reason text, p_error text) from public,anon,authenticated; grant execute on function public.motion_storage_block(p_reason text, p_error text) to service_role;
CREATE OR REPLACE FUNCTION public.motion_storage_claim_probe(p_owner text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare s public.motion_storage_health; today date:=(now() at time zone 'UTC')::date;
begin
 select * into s from public.motion_storage_health where id=true for update;
 if s.counter_day<>today then
  update public.motion_storage_health set counter_day=today,managed_reads=0,
   phase=case when reason='preventive_budget' then 'unknown' else phase end,
   next_probe_at=case when reason='preventive_budget' then now() else next_probe_at end,
   reason=case when reason='preventive_budget' then null else reason end where id=true returning * into s;
 end if;
 if s.next_probe_at>now() or s.probe_until>now() then
  return to_jsonb(s)||jsonb_build_object('should_probe',false,'allow_primary',s.phase='healthy' and s.next_probe_at>now());
 end if;
 update public.motion_storage_health set probe_owner=p_owner,probe_until=now()+interval '45 seconds',updated_at=now() where id=true returning * into s;
 return to_jsonb(s)||jsonb_build_object('should_probe',true,'allow_primary',false);
end; $$;


ALTER FUNCTION public.motion_storage_claim_probe(p_owner text) OWNER TO postgres;
revoke all on function public.motion_storage_claim_probe(p_owner text) from public,anon,authenticated; grant execute on function public.motion_storage_claim_probe(p_owner text) to service_role;
CREATE OR REPLACE FUNCTION public.motion_storage_commit(p_job_id uuid, p_result_path text, p_result_bytes bigint) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare r public.motion_storage_reservations; actual bigint;
begin
 select * into r from public.motion_storage_reservations where job_id=p_job_id for update;
 if not found or p_result_bytes<1 or p_result_bytes>41943040 or p_result_path not like r.user_id||'/production-results/%' then raise exception 'Resultado fora da reserva.';end if;
 select coalesce(sum((metadata->>'size')::bigint),0) into actual from storage.objects where bucket_id='production' and name like r.input_prefix||'%';
 update public.motion_storage_reservations set state='committed',result_path=p_result_path,allocated_bytes=actual+p_result_bytes,updated_at=now() where job_id=p_job_id;
end; $$;


ALTER FUNCTION public.motion_storage_commit(p_job_id uuid, p_result_path text, p_result_bytes bigint) OWNER TO postgres;
revoke all on function public.motion_storage_commit(p_job_id uuid, p_result_path text, p_result_bytes bigint) from public,anon,authenticated; grant execute on function public.motion_storage_commit(p_job_id uuid, p_result_path text, p_result_bytes bigint) to service_role;

set check_function_bodies=true;
