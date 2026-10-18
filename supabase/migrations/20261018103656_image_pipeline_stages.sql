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
      and coalesce(meta->>'pipeline_version','') <> '2'
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

create or replace function public.lease_image_pipeline(p_id uuid,p_worker text,p_limit integer default 1)
returns setof public.face_swap_jobs language plpgsql security invoker set search_path=public as $$
declare j public.face_swap_jobs; n integer;
begin
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
  select * into j from public.face_swap_jobs where id=p_id for update;
  if j.id is null or j.meta->>'pipeline_version'<>'2' or j.hidden_at is not null
     or j.status not in ('waiting','uploading','queued','running')
     or (j.locked_at is not null and j.locked_at>now()-interval '10 minutes') then return; end if;
  if j.status='waiting' and j.meta->>'stage'<>'control_motion' then
    select (select count(*) from public.face_swap_jobs where status in ('uploading','queued','running'))+
           (select count(*) from public.production_jobs where status in ('uploading','queued','running')) into n;
    if n>=greatest(1,least(p_limit,10)) then return; end if;
  end if;
  return query update public.face_swap_jobs set locked_by=p_worker,locked_at=now(),
    status=case when j.status='waiting' and j.meta->>'stage'<>'control_motion' then 'uploading' else j.status end,
    updated_at=now() where id=p_id returning *;
end $$;
revoke all on function public.lease_image_pipeline(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.lease_image_pipeline(uuid,text,integer) to service_role;
CREATE OR REPLACE FUNCTION public.claim_motion_control_jobs(p_worker text, p_limit integer DEFAULT 1) RETURNS SETOF public.production_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_active integer; v_limit integer;
begin
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
  select (select count(*) from public.production_jobs where status in ('uploading','queued','running'))+
         (select count(*) from public.face_swap_jobs where status in ('uploading','queued','running')) into v_active;
  select greatest(1,least(10,coalesce((config->>'concurrency')::integer,1))) into v_limit from public.integrations where provider='runninghub';
  v_limit:=least(greatest(0,p_limit),greatest(0,coalesce(v_limit,1)-v_active));
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
    limit v_limit
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

-- Wake only the new pipeline. No historical job is rearmed.
select cron.schedule('cloudent-image-pipeline','* * * * *',$job$
 select net.http_post(
   url:='https://iubzjfidmxfjvvonusos.supabase.co/functions/v1/cloudent-production-worker',
   headers:=jsonb_build_object('Content-Type','application/json','x-cloudent-worker-secret',public.get_cloudent_worker_secret()),
   body:='{"image_pipeline":true}'::jsonb,timeout_milliseconds:=120000
 ) where exists(select 1 from public.face_swap_jobs where meta @> '{"pipeline_version":2}'::jsonb and hidden_at is null and status in ('waiting','uploading','queued','running'));
 select net.http_post(
   url:='https://iubzjfidmxfjvvonusos.supabase.co/functions/v1/cloudent-motion-control-worker',
   headers:=jsonb_build_object('Content-Type','application/json','x-cloudent-worker-secret',public.get_cloudent_worker_secret()),
   body:='{}'::jsonb,timeout_milliseconds:=120000
 ) where exists(select 1 from public.production_jobs where meta @> '{"image_pipeline_version":2}'::jsonb and status='motion_waiting');
$job$);
