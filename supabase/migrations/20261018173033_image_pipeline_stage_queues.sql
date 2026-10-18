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
  if j.status='waiting' and j.meta->>'stage' in ('face_swap','upscale') then
    -- Stage queues are independent buffers. Reserve fast inputs before long Motion runs.
    -- Within a stage, an older waiting item owns the next opportunity.
    if exists (
      select 1 from public.face_swap_jobs pending
      where pending.meta @> '{"pipeline_version":2}'::jsonb
        and pending.hidden_at is null and pending.status='waiting'
        and (
          (j.meta->>'stage'='upscale' and pending.meta->>'stage'='face_swap')
          or (pending.meta->>'stage'=j.meta->>'stage'
              and (pending.created_at,pending.id)<(j.created_at,j.id))
        )
    ) then return; end if;
  end if;
  if j.status='waiting' and j.meta->>'stage'<>'control_motion' then
    select (select count(*) from public.face_swap_jobs where status in ('uploading','queued','running'))+
           (select count(*) from public.production_jobs where status in ('uploading','queued','running')) into n;
    if n>=greatest(1,least(p_limit,10)) then return; end if;
  end if;
  return query update public.face_swap_jobs set locked_by=p_worker,locked_at=now(),
    status=case when j.status='waiting' and j.meta->>'stage'<>'control_motion' then 'uploading' else j.status end,
    updated_at=now() where id=p_id returning *;
end $function$
;
CREATE OR REPLACE FUNCTION public.claim_motion_control_jobs(p_worker text, p_limit integer DEFAULT 1)
 RETURNS SETOF production_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- Only chained pipeline Motion waits for the fast-image backlog.
      -- Standalone Motion keeps its existing contract; existing tasks are untouched.
      and (
        coalesce(j.meta->>'image_pipeline_version','')<>'2'
        or not exists (
          select 1 from public.face_swap_jobs images
          where images.meta @> '{"pipeline_version":2}'::jsonb
            and images.meta->>'stage' in ('face_swap','upscale')
            and images.hidden_at is null
            and images.status in ('waiting','uploading','queued','running')
        )
      )
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
$function$
;
revoke all on function public.lease_image_pipeline(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.lease_image_pipeline(uuid,text,integer) to service_role;
revoke all on function public.claim_motion_control_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.claim_motion_control_jobs(text,integer) to service_role;
