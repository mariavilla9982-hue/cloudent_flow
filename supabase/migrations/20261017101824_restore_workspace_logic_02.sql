set check_function_bodies=false;
CREATE OR REPLACE FUNCTION public.claim_due_metric_jobs(p_worker text, p_limit integer DEFAULT 5) RETURNS TABLE(job_id uuid, schedule_id uuid, run_at timestamp with time zone, attempts integer, max_attempts integer, payload jsonb, instagram_media_id text, published_at timestamp with time zone, scheduled_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with candidates as (
    select j.id
    from public.job_queue j
    join public.schedules s on s.id=j.schedule_id
    where j.job_type='collect_metrics'
      and j.attempts < j.max_attempts
      and s.status='published'
      and s.instagram_media_id is not null
      and (
        (j.status='pending' and j.run_at <= now())
        or
        (j.status='running' and j.locked_at < now()-interval '10 minutes')
      )
    order by j.run_at asc
    for update of j skip locked
    limit greatest(1,least(coalesce(p_limit,5),20))
  ),
  claimed as (
    update public.job_queue j
    set status='running',
        attempts=j.attempts+1,
        locked_at=now(),
        locked_by=p_worker,
        last_error=null,
        updated_at=now()
    from candidates c
    where j.id=c.id
    returning j.*
  )
  select
    c.id,
    c.schedule_id,
    c.run_at,
    c.attempts,
    c.max_attempts,
    c.payload,
    s.instagram_media_id,
    s.published_at,
    s.scheduled_at
  from claimed c
  join public.schedules s on s.id=c.schedule_id;
end;
$$;


ALTER FUNCTION public.claim_due_metric_jobs(p_worker text, p_limit integer) OWNER TO postgres;
revoke all on function public.claim_due_metric_jobs(p_worker text, p_limit integer) from public,anon,authenticated; grant execute on function public.claim_due_metric_jobs(p_worker text, p_limit integer) to service_role;
CREATE OR REPLACE FUNCTION public.claim_due_publish_jobs(p_worker text, p_limit integer DEFAULT 3) RETURNS TABLE(job_id uuid, schedule_id uuid, run_at timestamp with time zone, attempts integer, max_attempts integer, payload jsonb, video_id uuid, storage_path text, storage_provider text, file_name text, caption text, schedule_status text, instagram_media_id text, platform_account_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.job_queue j
  set status='done',locked_at=null,locked_by=null,updated_at=now()
  from public.schedules s
  where j.schedule_id=s.id
    and j.job_type='publish_reel'
    and j.status in ('pending','running')
    and (s.status='published' or s.instagram_media_id is not null);

  update public.job_queue j
  set status='cancelled',locked_at=null,locked_by=null,updated_at=now()
  from public.schedules s
  where j.schedule_id=s.id
    and j.job_type='publish_reel'
    and j.status in ('pending','running')
    and s.status='cancelled';

  return query
  with candidates as (
    select j.id
    from public.job_queue j
    join public.schedules s on s.id=j.schedule_id
    join public.videos v on v.id=s.video_id
    join public.platform_accounts pa on pa.id=s.platform_account_id
    where j.job_type='publish_reel'
      and j.attempts < j.max_attempts
      and s.instagram_media_id is null
      and s.platform_account_id is not null
      and pa.platform='instagram'
      and pa.enabled=true
      and coalesce(v.storage_provider,'supabase')='r2'
      and s.status in ('scheduled','queued','processing','failed')
      and (
        coalesce((select (value->>'enabled')::boolean from public.app_settings where key='media_cleaner'),true)=false
        or v.media_clean_status in ('ready','skipped','legacy')
      )
      and (
        (j.status='pending' and j.run_at <= now())
        or (j.status='running' and j.locked_at < now()-interval '10 minutes')
      )
    order by j.run_at asc
    for update of j skip locked
    limit greatest(1,least(coalesce(p_limit,3),10))
  ),
  claimed as (
    update public.job_queue j
    set status='running',
        attempts=j.attempts+1,
        locked_at=now(),
        locked_by=p_worker,
        last_error=null,
        updated_at=now()
    from candidates c
    where j.id=c.id
    returning j.*
  )
  select
    c.id,c.schedule_id,c.run_at,c.attempts,c.max_attempts,c.payload,
    s.video_id,v.storage_path,coalesce(v.storage_provider,'supabase'),v.file_name,coalesce(v.caption,''),
    s.status,s.instagram_media_id,s.platform_account_id
  from claimed c
  join public.schedules s on s.id=c.schedule_id
  join public.videos v on v.id=s.video_id;
end;
$$;


ALTER FUNCTION public.claim_due_publish_jobs(p_worker text, p_limit integer) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;
revoke all on function public.claim_due_publish_jobs(p_worker text, p_limit integer) from public,anon,authenticated; grant execute on function public.claim_due_publish_jobs(p_worker text, p_limit integer) to service_role;
CREATE OR REPLACE FUNCTION public.claim_due_system_notifications(p_worker text, p_limit integer DEFAULT 20) RETURNS SETOF public.system_notifications
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  update public.system_notifications set status='pending',next_attempt_at=now(),updated_at=now() where status='processing' and updated_at<now()-interval '10 minutes';
  update public.system_notifications set status='failed',last_error='daily_summary_expired',updated_at=now() where status='pending' and category='daily_summary' and (meta->>'date')::date<(now() at time zone 'America/Sao_Paulo')::date;
  return query
  with picked as (
    select n.id
    from public.system_notifications n
    where n.status='pending'
      and n.severity in ('info','warn','error')
      and exists(select 1 from public.app_members m where m.user_id=n.user_id and m.enabled)
      and coalesce((select (value->>'enabled')::boolean from public.app_settings where key='push_notifications'),false)
      and coalesce(n.next_attempt_at,n.created_at) <= now()
      and exists (
        select 1 from public.push_subscriptions s
        where s.user_id=n.user_id and s.enabled=true
      )
    order by n.created_at
    for update of n skip locked
    limit greatest(1,least(coalesce(p_limit,20),50))
  ),
  updated as (
    update public.system_notifications n
    set status='processing',
        push_attempts=n.push_attempts+1,
        updated_at=now(),
        meta=coalesce(n.meta,'{}'::jsonb)||jsonb_build_object('worker_id',p_worker,'claimed_at',now())
    from picked
    where n.id=picked.id
    returning n.*
  )
  select * from updated;
end;
$$;


ALTER FUNCTION public.claim_due_system_notifications(p_worker text, p_limit integer) OWNER TO postgres;
revoke all on function public.claim_due_system_notifications(p_worker text, p_limit integer) from public,anon,authenticated; grant execute on function public.claim_due_system_notifications(p_worker text, p_limit integer) to service_role;
CREATE OR REPLACE FUNCTION public.claim_due_trial_metric_jobs(p_worker text, p_limit integer DEFAULT 5) RETURNS TABLE(id uuid, instagram_media_id text, published_at timestamp with time zone, metrics_stage integer, meta jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with candidates as (
    select r.id
    from public.reel_test_publications r
    where r.status='published'
      and r.instagram_media_id is not null
      and r.next_metric_at is not null
      and r.next_metric_at <= now()
      and r.metrics_stage < 5
      and (r.locked_at is null or r.locked_at < now()-interval '10 minutes')
    order by r.next_metric_at asc
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,5),20))
  ),
  claimed as (
    update public.reel_test_publications r
    set locked_at=now(),
        locked_by=p_worker,
        updated_at=now()
    from candidates c
    where r.id=c.id
    returning r.*
  )
  select c.id,c.instagram_media_id,c.published_at,c.metrics_stage,c.meta
  from claimed c;
end;
$$;


ALTER FUNCTION public.claim_due_trial_metric_jobs(p_worker text, p_limit integer) OWNER TO postgres;
revoke all on function public.claim_due_trial_metric_jobs(p_worker text, p_limit integer) from public,anon,authenticated; grant execute on function public.claim_due_trial_metric_jobs(p_worker text, p_limit integer) to service_role;
CREATE OR REPLACE FUNCTION public.claim_due_trial_reels(p_worker text, p_limit integer DEFAULT 3) RETURNS TABLE(id uuid, user_id uuid, storage_path text, storage_provider text, file_name text, caption text, scheduled_at timestamp with time zone, status text, container_id text, attempt_count integer, max_attempts integer, graduation_strategy text, meta jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with candidates as (
    select r.id
    from public.reel_test_publications r
    where r.is_trial=true
      and r.hidden_at is null
      and r.status in ('scheduled','processing','container_created')
      and r.attempt_count < r.max_attempts
      and (
        coalesce((select (value->>'enabled')::boolean from public.app_settings where key='media_cleaner'),true)=false
        or r.media_clean_status in ('ready','skipped','legacy')
      )
      and coalesce(r.next_attempt_at,r.scheduled_at,r.created_at) <= now()
      and (r.locked_at is null or r.locked_at < now()-interval '10 minutes')
    order by coalesce(r.next_attempt_at,r.scheduled_at,r.created_at) asc
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,3),10))
  ),
  claimed as (
    update public.reel_test_publications r
    set status='processing',
        attempt_count=r.attempt_count+1,
        locked_at=now(),
        locked_by=p_worker,
        last_error=null,
        updated_at=now()
    from candidates c
    where r.id=c.id
    returning r.*
  )
  select
    c.id,c.user_id,c.storage_path,coalesce(c.storage_provider,'supabase'),c.file_name,c.caption,c.scheduled_at,c.status,
    c.container_id,c.attempt_count,c.max_attempts,c.graduation_strategy,c.meta
  from claimed c;
end;
$$;


ALTER FUNCTION public.claim_due_trial_reels(p_worker text, p_limit integer) OWNER TO postgres;
revoke all on function public.claim_due_trial_reels(p_worker text, p_limit integer) from public,anon,authenticated; grant execute on function public.claim_due_trial_reels(p_worker text, p_limit integer) to service_role;
CREATE OR REPLACE FUNCTION public.claim_due_x_warmup_actions(p_worker text, p_limit integer DEFAULT 5) RETURNS SETOF public.x_warmup_actions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with picked as (
    select a.id
    from public.x_warmup_actions a
    join public.x_warmup_accounts w on w.id=a.warmup_account_id
    join public.platform_accounts p on p.id=w.platform_account_id
    where a.status='queued'
      and coalesce(a.scheduled_at,now()) <= now()
      and w.status='warming'
      and w.current_day=a.day_number
      and p.platform='x'
      and p.enabled=true
    order by coalesce(a.scheduled_at,a.created_at),a.created_at
    for update of a skip locked
    limit greatest(1,least(coalesce(p_limit,5),20))
  ),
  updated as (
    update public.x_warmup_actions a
    set status='processing',
        attempts=a.attempts+1,
        updated_at=now(),
        meta=coalesce(a.meta,'{}'::jsonb)||jsonb_build_object('worker_id',p_worker,'claimed_at',now())
    from picked
    where a.id=picked.id
    returning a.*
  )
  select * from updated;
end;
$$;


ALTER FUNCTION public.claim_due_x_warmup_actions(p_worker text, p_limit integer) OWNER TO postgres;
revoke all on function public.claim_due_x_warmup_actions(p_worker text, p_limit integer) from public,anon,authenticated; grant execute on function public.claim_due_x_warmup_actions(p_worker text, p_limit integer) to service_role;

set check_function_bodies=true;
