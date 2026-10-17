set check_function_bodies=false;
CREATE OR REPLACE FUNCTION cloudent_private.read_x_account(p_account uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 select auth.uid() is not null and public.cloudent_x_read_access(auth.uid(),p_account)
$$;


ALTER FUNCTION cloudent_private.read_x_account(p_account uuid) OWNER TO postgres;
revoke all on function cloudent_private.read_x_account(p_account uuid) from public,anon,authenticated; grant execute on function cloudent_private.read_x_account(p_account uuid) to service_role;
CREATE OR REPLACE FUNCTION public.apply_auto_schedule_adjustments(p_adjustments jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  r jsonb;
  n integer := 0;
  temp_base timestamptz := now() + interval '180 days';
begin
  if jsonb_typeof(p_adjustments) <> 'array' then
    raise exception 'adjustments_must_be_array';
  end if;

  for r in select value from jsonb_array_elements(p_adjustments)
  loop
    update public.schedules
    set scheduled_at = temp_base + (n * interval '1 minute'),
        updated_at = now()
    where id = (r->>'id')::uuid
      and status in ('scheduled','queued')
      and instagram_media_id is null;
    n := n + 1;
  end loop;

  n := 0;
  for r in select value from jsonb_array_elements(p_adjustments)
  loop
    update public.schedules
    set scheduled_at = (r->>'scheduled_at')::timestamptz,
        smart_mode = 'auto',
        smart_strategy = case
          when smart_strategy_locked then smart_strategy
          when coalesce(r->>'smart_strategy','') in ('tested','test') then r->>'smart_strategy'
          else smart_strategy
        end,
        last_auto_adjusted_at = now(),
        auto_adjust_count = auto_adjust_count + 1,
        updated_at = now()
    where id = (r->>'id')::uuid
      and status in ('scheduled','queued')
      and instagram_media_id is null;

    update public.job_queue
    set run_at = (r->>'scheduled_at')::timestamptz,
        updated_at = now()
    where schedule_id = (r->>'id')::uuid
      and job_type='publish_reel'
      and status='pending';

    n := n + 1;
  end loop;

  return n;
end;
$$;


ALTER FUNCTION public.apply_auto_schedule_adjustments(p_adjustments jsonb) OWNER TO postgres;
revoke all on function public.apply_auto_schedule_adjustments(p_adjustments jsonb) from public,anon,authenticated; grant execute on function public.apply_auto_schedule_adjustments(p_adjustments jsonb) to service_role;
CREATE OR REPLACE FUNCTION public.assign_instagram_caption_on_video_schedule() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.platform='instagram'
     and new.status='scheduled'
     and (tg_op='INSERT' or old.status is distinct from 'scheduled') then
    new.caption := public.pick_instagram_calendar_caption();
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.assign_instagram_caption_on_video_schedule() OWNER TO postgres;
revoke all on function public.assign_instagram_caption_on_video_schedule() from public,anon,authenticated; grant execute on function public.assign_instagram_caption_on_video_schedule() to service_role;
CREATE OR REPLACE FUNCTION public.auto_hide_completed_trial_reel() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  cfg jsonb;
begin
  if new.metrics_completed_at is not null
     and old.metrics_completed_at is distinct from new.metrics_completed_at
     and new.hidden_at is null then
    select value into cfg from public.app_settings where key='trial_scheduler';
    if coalesce((cfg->>'auto_hide_completed')::boolean,true) then
      new.hidden_at:=now();
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.auto_hide_completed_trial_reel() OWNER TO postgres;
revoke all on function public.auto_hide_completed_trial_reel() from public,anon,authenticated; grant execute on function public.auto_hide_completed_trial_reel() to service_role;
CREATE OR REPLACE FUNCTION public.bind_calendar_pretrial_account() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare account_id uuid;
begin
  if new.trial_kind<>'prepost' or new.linked_schedule_id is null then return new; end if;
  select s.platform_account_id into account_id from public.schedules s where s.id=new.linked_schedule_id;
  if account_id is null then raise exception 'pretrial_schedule_account_required' using errcode='23514'; end if;
  if tg_op='UPDATE' and old.status in ('published','processing','container_created') then
    if old.meta->>'platform_account_id' is not null and old.meta->>'platform_account_id'<>account_id::text then
      raise exception 'pretrial_account_mismatch' using errcode='23514';
    end if;
  end if;
  new.meta:=coalesce(new.meta,'{}'::jsonb)||jsonb_build_object('platform_account_id',account_id);
  return new;
end $$;


ALTER FUNCTION public.bind_calendar_pretrial_account() OWNER TO postgres;
revoke all on function public.bind_calendar_pretrial_account() from public,anon,authenticated; grant execute on function public.bind_calendar_pretrial_account() to service_role;
CREATE OR REPLACE FUNCTION public.bind_job_to_schedule_account() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare s public.schedules%rowtype;
begin
  if new.schedule_id is null then return new; end if;
  select * into s from public.schedules where id=new.schedule_id;
  if not found then raise exception 'schedule_not_found' using errcode='23503'; end if;
  if new.platform_account_id is not null and new.platform_account_id is distinct from s.platform_account_id then
    raise exception 'job_schedule_account_mismatch' using errcode='23514';
  end if;
  new.platform_account_id:=s.platform_account_id;
  new.platform:=s.platform;
  return new;
end $$;


ALTER FUNCTION public.bind_job_to_schedule_account() OWNER TO postgres;
revoke all on function public.bind_job_to_schedule_account() from public,anon,authenticated; grant execute on function public.bind_job_to_schedule_account() to service_role;
CREATE OR REPLACE FUNCTION public.bind_x_post_account() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare a public.platform_accounts;
begin
 if new.platform_account_id is null then raise exception 'platform_account_id_required'; end if;
 select * into a from public.platform_accounts where id=new.platform_account_id and platform='x';
 if not found or not public.cloudent_x_access(new.user_id,a.id) then raise exception 'x_account_access_denied'; end if;
 if tg_op='UPDATE' and (new.platform_account_id<>old.platform_account_id or new.user_id<>old.user_id) then raise exception 'x_job_binding_immutable'; end if;
 new.workspace_id:=a.workspace_id;
 return new;
end $$;


ALTER FUNCTION public.bind_x_post_account() OWNER TO postgres;
revoke all on function public.bind_x_post_account() from public,anon,authenticated; grant execute on function public.bind_x_post_account() to service_role;
CREATE OR REPLACE FUNCTION public.block_cloudent_video_in_supabase_storage() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_mime text := lower(coalesce(new.metadata->>'mimetype', new.metadata->>'contentType', ''));
  v_name text := lower(coalesce(new.name,''));
begin
  if new.bucket_id in ('videos','production') and (
    v_mime like 'video/%'
    or v_name ~ '\.(mp4|mov|webm|mkv|avi|m4v)$'
  ) then
    raise exception using
      errcode='P0001',
      message='backblaze_required',
      detail='Video objects are not allowed in Supabase Storage for CloudentFlow; use Backblaze B2.';
  end if;
  return new;
end;
$_$;


ALTER FUNCTION public.block_cloudent_video_in_supabase_storage() OWNER TO postgres;
revoke all on function public.block_cloudent_video_in_supabase_storage() from public,anon,authenticated; grant execute on function public.block_cloudent_video_in_supabase_storage() to service_role;
CREATE OR REPLACE FUNCTION public.claim_cloudent_invite() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_role text;
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_uid;

  if v_email is null then
    return null;
  end if;

  select i.role into v_role
  from public.member_invites i
  where i.email = v_email
    and i.enabled = true
    and (i.claimed_by is null or i.claimed_by = v_uid)
  limit 1;

  if v_role is null then
    return null;
  end if;

  insert into public.app_members(user_id, role, enabled, updated_at)
  values (v_uid, v_role, true, now())
  on conflict (user_id) do update
  set role=excluded.role, enabled=true, updated_at=now();

  update public.member_invites
  set claimed_by=v_uid,
      claimed_at=coalesce(claimed_at, now()),
      updated_at=now()
  where email=v_email;

  return v_role;
end;
$$;


ALTER FUNCTION public.claim_cloudent_invite() OWNER TO postgres;
revoke all on function public.claim_cloudent_invite() from public,anon,authenticated; grant execute on function public.claim_cloudent_invite() to service_role;
CREATE OR REPLACE FUNCTION public.claim_due_media_clean_jobs(p_worker text, p_limit integer DEFAULT 2) RETURNS TABLE(entity_type text, entity_id uuid, owner_user_id uuid, source_path text, storage_provider text, file_name text, attempts integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  take_each integer := greatest(1,least(coalesce(p_limit,2),4));
begin
  return query
  with candidates as (
    select v.id
    from public.videos v
    where (
      v.media_clean_status='pending'
      or (v.media_clean_status='processing' and v.updated_at < now()-interval '10 minutes')
    )
      and coalesce(v.storage_provider,'supabase')='r2'
      and v.media_clean_attempts < 3
      and v.media_clean_next_attempt_at <= now()
      and coalesce(v.original_storage_path,v.storage_path) ~ '^[0-9a-fA-F-]{36}/'
    order by v.media_clean_next_attempt_at,v.created_at
    for update skip locked
    limit take_each
  ),
  claimed as (
    update public.videos v
    set media_clean_status='processing',
        media_clean_attempts=v.media_clean_attempts+1,
        media_clean_error=null,
        updated_at=now()
    from candidates c
    where v.id=c.id
    returning v.*
  )
  select
    'video'::text,
    c.id,
    split_part(coalesce(c.original_storage_path,c.storage_path),'/',1)::uuid,
    coalesce(c.original_storage_path,c.storage_path),
    coalesce(c.storage_provider,'supabase'),
    c.file_name,
    c.media_clean_attempts
  from claimed c;

  return query
  with candidates as (
    select r.id
    from public.reel_test_publications r
    where r.trial_kind='overnight'
      and (
        r.media_clean_status='pending'
        or (r.media_clean_status='processing' and r.updated_at < now()-interval '10 minutes')
      )
      and coalesce(r.storage_provider,'supabase')='r2'
      and r.media_clean_attempts < 3
      and r.media_clean_next_attempt_at <= now()
    order by r.media_clean_next_attempt_at,r.created_at
    for update skip locked
    limit take_each
  ),
  claimed as (
    update public.reel_test_publications r
    set media_clean_status='processing',
        media_clean_attempts=r.media_clean_attempts+1,
        media_clean_error=null,
        updated_at=now()
    from candidates c
    where r.id=c.id
    returning r.*
  )
  select
    'trial'::text,
    c.id,
    c.user_id,
    coalesce(c.original_storage_path,c.storage_path),
    coalesce(c.storage_provider,'supabase'),
    coalesce(c.file_name,'Trial Reel'),
    c.media_clean_attempts
  from claimed c;
end;
$$;


ALTER FUNCTION public.claim_due_media_clean_jobs(p_worker text, p_limit integer) OWNER TO postgres;
revoke all on function public.claim_due_media_clean_jobs(p_worker text, p_limit integer) from public,anon,authenticated; grant execute on function public.claim_due_media_clean_jobs(p_worker text, p_limit integer) to service_role;

set check_function_bodies=true;
