-- Globally serialize new RunningHub dispatches across Face Swap, Motion and GENJUTSU V3.
-- Existing running provider tasks remain attached; no job is cancelled.
BEGIN;
CREATE OR REPLACE FUNCTION public.claim_face_swap_jobs(p_worker text, p_limit integer DEFAULT 1)
 RETURNS SETOF face_swap_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_active integer := 0;
  v_available integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);

  select
    (select count(*) from public.production_jobs where status in ('uploading','queued','running'))
    +
    (select count(*) from public.face_swap_jobs where status in ('uploading','queued','running'))+
    (select count(*) from public.genjutsu_v3_jobs where status in ('dispatching','running'))
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
$function$


CREATE OR REPLACE FUNCTION public.claim_genjutsu_v3_job(p_lease uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare job public.genjutsu_v3_jobs;
begin
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
  perform pg_advisory_xact_lock(hashtextextended('cloudent-genjutsu-v3',0));
  update public.genjutsu_v3_jobs set status='review',
    error='Envio sem confirmação. Confira a tarefa no RunningHub antes de repetir.',
    updated_at=now(),lease_id=null,lease_until=null
  where status='dispatching' and lease_until<=now();
  if exists(select 1 from public.genjutsu_v3_jobs where status='dispatching') then return null; end if;
  select * into job from public.genjutsu_v3_jobs where status='running' order by created_at limit 1 for update;
  if found and job.lease_until>now() then return null; end if;
  if not found then
    if exists(select 1 from public.genjutsu_v3_jobs where status='review') then return null; end if;
    -- A queued GENJUTSU may only start when the other RunningHub pipelines are idle.
    if exists(select 1 from public.production_jobs where status in ('uploading','queued','running'))
       or exists(select 1 from public.face_swap_jobs where status in ('uploading','queued','running')) then
      return null;
    end if;
    select * into job from public.genjutsu_v3_jobs where status='queued' order by created_at limit 1 for update;
  end if;
  if job.id is null then return null; end if;
  update public.genjutsu_v3_jobs set
    status=case when job.status='queued' then 'dispatching' else 'running' end,
    lease_id=p_lease,lease_until=now()+interval '5 minutes',updated_at=now()
  where id=job.id returning * into job;
  return to_jsonb(job);
end $function$


CREATE OR REPLACE FUNCTION public.claim_production_jobs(p_worker text, p_limit integer DEFAULT 1)
 RETURNS SETOF production_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_active integer := 0;
  v_available integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);

  select
    (select count(*) from public.production_jobs where status in ('uploading','queued','running'))
    +
    (select count(*) from public.face_swap_jobs where status in ('uploading','queued','running'))+
    (select count(*) from public.genjutsu_v3_jobs where status in ('dispatching','running'))
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
$function$


CREATE OR REPLACE FUNCTION public.lease_image_pipeline(p_id uuid, p_worker text, p_limit integer DEFAULT 1)
 RETURNS SETOF face_swap_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare j public.face_swap_jobs; n integer;
begin
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
  select * into j from public.face_swap_jobs where id=p_id for update;
  if j.id is null or j.meta->>'pipeline_version'<>'2' or j.hidden_at is not null
    or j.status not in ('waiting','uploading','queued','running')
    or (j.locked_at is not null and j.locked_at>now()-interval '10 minutes') then return; end if;
  if j.meta->'video_workflow'->>'key'='genjutsu' and not public.genjutsu_image_eligible(j.id,j.created_at) then return; end if;
  if j.status='waiting' and j.meta->>'stage' in ('face_swap','upscale') then
    if exists (
      select 1 from public.face_swap_jobs pending
      where pending.meta @> '{"pipeline_version":2}'::jsonb and pending.hidden_at is null and pending.status='waiting'
        and (coalesce(pending.meta->'video_workflow'->>'key','')<>'genjutsu' or public.genjutsu_image_eligible(pending.id,pending.created_at))
        and ((j.meta->>'stage'='upscale' and pending.meta->>'stage'='face_swap')
          or (pending.meta->>'stage'=j.meta->>'stage' and (pending.created_at,pending.id)<(j.created_at,j.id)))
    ) then return; end if;
  end if;
  if j.status='waiting' and j.meta->>'stage'<>'control_motion' then
    select (select count(*) from public.face_swap_jobs where status in ('uploading','queued','running'))+
    (select count(*) from public.genjutsu_v3_jobs where status in ('dispatching','running'))+
           (select count(*) from public.production_jobs where status in ('uploading','queued','running')) into n;
    if n>=greatest(1,least(p_limit,10)) then return; end if;
  end if;
  return query update public.face_swap_jobs set locked_by=p_worker,locked_at=now(),
    status=case when j.status='waiting' and j.meta->>'stage'<>'control_motion' then 'uploading' else j.status end,
    updated_at=now() where id=p_id returning *;
end $function$

COMMIT;
