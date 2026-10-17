set check_function_bodies=false;
CREATE OR REPLACE FUNCTION public.cloudent_hot_storage_usage() RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'storage'
    AS $$ select coalesce(sum(coalesce((metadata->>'size')::bigint,0)),0)::bigint from storage.objects where bucket_id in ('videos','production'); $$;


ALTER FUNCTION public.cloudent_hot_storage_usage() OWNER TO postgres;
revoke all on function public.cloudent_hot_storage_usage() from public,anon,authenticated; grant execute on function public.cloudent_hot_storage_usage() to service_role;
CREATE OR REPLACE FUNCTION public.cloudent_rate_limit(p_user uuid, p_bucket text, p_limit integer DEFAULT 60) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$declare n int; w timestamptz:=date_trunc('minute',now());begin insert into cloudent_private.rate_limits values(p_user,p_bucket,w,1) on conflict(user_id,bucket,window_start) do update set requests=rate_limits.requests+1 returning requests into n; delete from cloudent_private.rate_limits where window_start<now()-interval '1 day'; return n<=least(120,greatest(1,p_limit));end $$;


ALTER FUNCTION public.cloudent_rate_limit(p_user uuid, p_bucket text, p_limit integer) OWNER TO postgres;
revoke all on function public.cloudent_rate_limit(p_user uuid, p_bucket text, p_limit integer) from public,anon,authenticated; grant execute on function public.cloudent_rate_limit(p_user uuid, p_bucket text, p_limit integer) to service_role;
CREATE OR REPLACE FUNCTION public.complete_x_upload_post(p_id uuid, p_worker_id text, p_account_id uuid, p_text text, p_media_id text, p_post_id text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare p public.x_drive_posts;
begin
 update public.x_drive_posts set status='published',post_text=p_text,x_media_id=p_media_id,x_post_id=p_post_id,published_at=now(),locked_at=null,locked_by=null,last_error=null,
 reply_status=case when nullif(reply_text,'') is not null then 'pending' else 'none' end,
 meta=meta||'{"publish_uncertain":false}'::jsonb,updated_at=now()
 where id=p_id and platform_account_id=p_account_id and status='processing' and locked_by=p_worker_id and x_post_id is null returning * into p;
 if not found then raise exception 'publication_claim_lost'; end if;
 update public.x_account_configs set next_publish_at=case when p.scheduled_at is null then now()+make_interval(mins=>interval_minutes) else next_publish_at end,last_worker_at=now(),last_error=null,updated_at=now() where platform_account_id=p_account_id;
end $$;


ALTER FUNCTION public.complete_x_upload_post(p_id uuid, p_worker_id text, p_account_id uuid, p_text text, p_media_id text, p_post_id text) OWNER TO postgres;
revoke all on function public.complete_x_upload_post(p_id uuid, p_worker_id text, p_account_id uuid, p_text text, p_media_id text, p_post_id text) from public,anon,authenticated; grant execute on function public.complete_x_upload_post(p_id uuid, p_worker_id text, p_account_id uuid, p_text text, p_media_id text, p_post_id text) to service_role;
CREATE OR REPLACE FUNCTION public.current_cloudent_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select role from public.app_members where user_id = auth.uid() and enabled = true limit 1;
$$;


ALTER FUNCTION public.current_cloudent_role() OWNER TO postgres;
revoke all on function public.current_cloudent_role() from public,anon,authenticated; grant execute on function public.current_cloudent_role() to service_role;
CREATE OR REPLACE FUNCTION public.enforce_backblaze_new_media() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if coalesce(new.storage_provider, 'supabase') <> 'r2' then
    raise exception using
      errcode = 'P0001',
      message = 'backblaze_required',
      detail = 'CloudentFlow large media must be stored in Backblaze B2; Supabase Storage fallback is disabled.';
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.enforce_backblaze_new_media() OWNER TO postgres;
revoke all on function public.enforce_backblaze_new_media() from public,anon,authenticated; grant execute on function public.enforce_backblaze_new_media() to service_role;
CREATE OR REPLACE FUNCTION public.enforce_calendar_account_binding() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if new.platform = 'instagram' then
    if new.platform_account_id is null then
      raise exception 'instagram_account_required' using errcode='23514';
    end if;
    if tg_op='UPDATE' and old.platform_account_id is distinct from new.platform_account_id then
      raise exception 'schedule_account_immutable' using errcode='23514';
    end if;
    if tg_op='INSERT' then
      if not exists(select 1 from public.platform_accounts a where a.id=new.platform_account_id and a.platform='instagram' and a.enabled) then
        raise exception 'instagram_account_unavailable' using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end $$;


ALTER FUNCTION public.enforce_calendar_account_binding() OWNER TO postgres;
revoke all on function public.enforce_calendar_account_binding() from public,anon,authenticated; grant execute on function public.enforce_calendar_account_binding() to service_role;
CREATE OR REPLACE FUNCTION public.enforce_instagram_account_limit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.platform = 'instagram' and new.enabled then
    if (
      select count(*)
      from public.platform_accounts pa
      where pa.platform = 'instagram'
        and pa.enabled
        and pa.id <> new.id
        and not (
          pa.external_account_id is not distinct from new.external_account_id
        )
    ) >= 3 then
      raise exception 'instagram account limit reached (3)';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.enforce_instagram_account_limit() OWNER TO postgres;
revoke all on function public.enforce_instagram_account_limit() from public,anon,authenticated; grant execute on function public.enforce_instagram_account_limit() to service_role;

set check_function_bodies=true;
