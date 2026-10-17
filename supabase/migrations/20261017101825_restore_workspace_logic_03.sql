set check_function_bodies=false;
CREATE OR REPLACE FUNCTION public.claim_face_swap_jobs(p_worker text, p_limit integer DEFAULT 1) RETURNS SETOF public.face_swap_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_active integer := 0;
  v_available integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);

  select
    (select count(*) from public.production_jobs where status in ('uploading','queued','running'))
    +
    (select count(*) from public.face_swap_jobs where status in ('uploading','queued','running'))
  into v_active;

  v_available := greatest(0, greatest(1,p_limit) - v_active);

  return query
  with picked as (
    select id
    from public.face_swap_jobs
    where status='waiting'
      and next_attempt_at <= now()
      and attempt_count < max_attempts
      and (locked_at is null or locked_at < now() - interval '15 minutes')
    order by (coalesce(meta->>'manual_run','false')='true') desc, created_at
    for update skip locked
    limit v_available
  )
  update public.face_swap_jobs j
  set status='uploading',
      locked_at=now(),
      locked_by=p_worker,
      attempt_count=j.attempt_count+1,
      started_at=coalesce(j.started_at,now()),
      progress=greatest(j.progress,5),
      meta=coalesce(j.meta,'{}'::jsonb)-'manual_run',
      updated_at=now()
  from picked
  where j.id=picked.id
  returning j.*;
end;
$$;


ALTER FUNCTION public.claim_face_swap_jobs(p_worker text, p_limit integer) OWNER TO postgres;
revoke all on function public.claim_face_swap_jobs(p_worker text, p_limit integer) from public,anon,authenticated; grant execute on function public.claim_face_swap_jobs(p_worker text, p_limit integer) to service_role;
CREATE OR REPLACE FUNCTION public.claim_motion_control_jobs(p_worker text, p_limit integer DEFAULT 1) RETURNS SETOF public.production_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with picked as (
    select j.id
    from public.production_jobs j
    where j.status = 'motion_waiting'
      and j.runninghub_task_id is null
      and j.attempt_count < j.max_attempts
      and j.meta @> '{"workflow_key":"motion_control"}'::jsonb
      and j.next_attempt_at <= now()
    order by case when coalesce((j.meta->>'manual_run')::boolean,false) then 0 else 1 end,
             j.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,1),10))
  ), updated as (
    update public.production_jobs j
       set status='uploading',
           progress=5,
           attempt_count=j.attempt_count+1,
           locked_at=now(),
           locked_by=p_worker,
           started_at=null,
           last_error=null,
           updated_at=now()
      from picked p
     where j.id=p.id
     returning j.*
  )
  select * from updated;
end;
$$;


ALTER FUNCTION public.claim_motion_control_jobs(p_worker text, p_limit integer) OWNER TO postgres;
revoke all on function public.claim_motion_control_jobs(p_worker text, p_limit integer) from public,anon,authenticated; grant execute on function public.claim_motion_control_jobs(p_worker text, p_limit integer) to service_role;
CREATE OR REPLACE FUNCTION public.claim_motion_control_supabase_jobs(p_worker text, p_limit integer DEFAULT 1) RETURNS SETOF public.production_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with picked as (
    select j.id
    from public.production_jobs j
    where j.status='motion_waiting'
      and j.storage_provider='supabase'
      and j.runninghub_task_id is null
      and j.attempt_count < j.max_attempts
      and j.meta @> '{"workflow_key":"motion_control"}'::jsonb
      and j.next_attempt_at <= now()
    order by case when coalesce((j.meta->>'manual_run')::boolean,false) then 0 else 1 end,
             j.created_at asc
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,1),10))
  ), updated as (
    update public.production_jobs j
       set status='uploading',progress=5,attempt_count=j.attempt_count+1,
           locked_at=now(),locked_by=p_worker,started_at=null,last_error=null,updated_at=now()
      from picked p
     where j.id=p.id
     returning j.*
  )
  select * from updated;
end;
$$;


ALTER FUNCTION public.claim_motion_control_supabase_jobs(p_worker text, p_limit integer) OWNER TO postgres;
revoke all on function public.claim_motion_control_supabase_jobs(p_worker text, p_limit integer) from public,anon,authenticated; grant execute on function public.claim_motion_control_supabase_jobs(p_worker text, p_limit integer) to service_role;
CREATE OR REPLACE FUNCTION public.claim_production_jobs(p_worker text, p_limit integer DEFAULT 1) RETURNS SETOF public.production_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_active integer := 0;
  v_available integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);

  select
    (select count(*) from public.production_jobs where status in ('uploading','queued','running'))
    +
    (select count(*) from public.face_swap_jobs where status in ('uploading','queued','running'))
  into v_active;

  v_available := greatest(0, greatest(1,p_limit) - v_active);

  return query
  with picked as (
    select id
    from public.production_jobs
    where status='waiting'
      and coalesce(meta->>'workflow_key','') <> 'motion_control'
      and next_attempt_at <= now()
      and attempt_count < max_attempts
      and (locked_at is null or locked_at < now() - interval '15 minutes')
    order by (coalesce(meta->>'manual_run','false')='true') desc, created_at
    for update skip locked
    limit v_available
  )
  update public.production_jobs j
  set status='uploading',
      locked_at=now(),
      locked_by=p_worker,
      attempt_count=j.attempt_count+1,
      started_at=coalesce(j.started_at,now()),
      progress=greatest(j.progress,5),
      meta=coalesce(j.meta,'{}'::jsonb)-'manual_run',
      updated_at=now()
  from picked
  where j.id=picked.id
  returning j.*;
end;
$$;


ALTER FUNCTION public.claim_production_jobs(p_worker text, p_limit integer) OWNER TO postgres;
revoke all on function public.claim_production_jobs(p_worker text, p_limit integer) from public,anon,authenticated; grant execute on function public.claim_production_jobs(p_worker text, p_limit integer) to service_role;
CREATE OR REPLACE FUNCTION public.claim_story_monitor_accounts(p_limit integer DEFAULT 10) RETURNS TABLE(account_id uuid, external_account_id text, account_label text, auth_mode text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
 insert into instagram_story_monitor(account_id)
 select id from platform_accounts where enabled and platform='instagram'
 and notification_account_owner(id) is not null on conflict do nothing;
 return query with picked as (
 select m.account_id from instagram_story_monitor m join platform_accounts a on a.id=m.account_id
 where a.enabled and a.platform='instagram' and m.next_check_at<=now()
 and notification_account_owner(a.id) is not null
 order by m.next_check_at for update of m skip locked limit greatest(1,least(p_limit,10))
 ), claimed as (
 update instagram_story_monitor m set next_check_at=now()+interval '15 minutes',updated_at=now()
 from picked p where m.account_id=p.account_id returning m.account_id
 ) select a.id,a.external_account_id,a.account_label,coalesce(a.config->>'auth_mode','instagram_login')
 from claimed c join platform_accounts a on a.id=c.account_id;
end $$;


ALTER FUNCTION public.claim_story_monitor_accounts(p_limit integer) OWNER TO postgres;
revoke all on function public.claim_story_monitor_accounts(p_limit integer) from public,anon,authenticated; grant execute on function public.claim_story_monitor_accounts(p_limit integer) to service_role;
CREATE OR REPLACE FUNCTION public.claim_x_account_post(p_account uuid, p_worker text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION public.claim_x_account_post(p_account uuid, p_worker text) OWNER TO postgres;
revoke all on function public.claim_x_account_post(p_account uuid, p_worker text) from public,anon,authenticated; grant execute on function public.claim_x_account_post(p_account uuid, p_worker text) to service_role;
CREATE OR REPLACE FUNCTION public.claim_x_upload_post(p_user_id uuid, p_worker_id text) RETURNS jsonb
    LANGUAGE sql
    SET search_path TO 'public', 'pg_temp'
    AS $$ select null::jsonb $$;


ALTER FUNCTION public.claim_x_upload_post(p_user_id uuid, p_worker_id text) OWNER TO postgres;
revoke all on function public.claim_x_upload_post(p_user_id uuid, p_worker_id text) from public,anon,authenticated; grant execute on function public.claim_x_upload_post(p_user_id uuid, p_worker_id text) to service_role;
CREATE OR REPLACE FUNCTION public.cleanup_calendar_pretrial_before_schedule_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  delete from public.reel_test_publications
  where linked_schedule_id=old.id
    and trial_kind='prepost'
    and status<>'published';

  update public.reel_test_publications
  set linked_schedule_id=null,
      meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('linked_schedule_deleted',true),
      updated_at=now()
  where linked_schedule_id=old.id
    and trial_kind='prepost'
    and status='published';

  return old;
end;
$$;


ALTER FUNCTION public.cleanup_calendar_pretrial_before_schedule_delete() OWNER TO postgres;
revoke all on function public.cleanup_calendar_pretrial_before_schedule_delete() from public,anon,authenticated; grant execute on function public.cleanup_calendar_pretrial_before_schedule_delete() to service_role;
CREATE OR REPLACE FUNCTION public.clear_instagram_web_session() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
declare
  sid uuid;
begin
  select id into sid from vault.secrets where name='instagram_web_session_cookie' limit 1;
  if sid is not null then
    delete from vault.secrets where id=sid;
  end if;
end
$$;


ALTER FUNCTION public.clear_instagram_web_session() OWNER TO postgres;
revoke all on function public.clear_instagram_web_session() from public,anon,authenticated; grant execute on function public.clear_instagram_web_session() to service_role;
CREATE OR REPLACE FUNCTION public.clear_instagram_web_session(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
declare
  sid uuid;
  secret_name text := 'instagram_web_session_cookie_' || p_user_id::text;
begin
  select id into sid from vault.secrets where name=secret_name limit 1;
  if sid is not null then
    delete from vault.secrets where id=sid;
  end if;
end
$$;


ALTER FUNCTION public.clear_instagram_web_session(p_user_id uuid) OWNER TO postgres;
revoke all on function public.clear_instagram_web_session(p_user_id uuid) from public,anon,authenticated; grant execute on function public.clear_instagram_web_session(p_user_id uuid) to service_role;

set check_function_bodies=true;
