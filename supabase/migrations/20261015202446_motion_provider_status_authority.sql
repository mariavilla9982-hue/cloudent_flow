-- One atomic provider observation writer. No task submission or retry side effects.
create or replace function public.sync_motion_task_status(
  p_job_id uuid,p_task_id text,p_status text,p_source text,p_checked_at timestamptz,p_error text default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare j public.production_jobs; m jsonb; s text:=upper(p_status); began timestamptz; checked timestamptz;
begin
  select * into j from public.production_jobs where id=p_job_id for update;
  if not found or coalesce(j.meta->>'workflow_key','')<>'motion_control'
     or j.runninghub_task_id is distinct from p_task_id
     or j.status not in ('queued','running','uploading','waiting','motion_waiting') then return null; end if;
  m:=coalesce(j.meta,'{}'::jsonb);
  checked:=nullif(m->>'provider_status_checked_at','')::timestamptz;
  if checked is not null and checked>p_checked_at then return to_jsonb(j); end if;
  m:=m||jsonb_build_object('provider_status_checked_at',p_checked_at,'provider_status_source',p_source,'provider_status_task_id',p_task_id);
  if s not in ('QUEUED','RUNNING','SUCCESS','FAILED','CANCELLED','CANCELED') then
    m:=m||jsonb_build_object('provider_status_error',coalesce(p_error,'Status RunningHub indisponível'));
    update public.production_jobs set meta=m,updated_at=now() where id=j.id returning * into j;
    return to_jsonb(j);
  end if;
  m:=m||jsonb_build_object('provider_status',s,'provider_status_error',null,'provider_queue_waiting',s='QUEUED');
  if s='QUEUED' then
    m:=m||jsonb_build_object('provider_task_pending',true,'provider_terminal_status',null,'provider_queue_since',coalesce(m->>'provider_queue_since',p_checked_at::text));
    update public.production_jobs set status='queued',progress=38,started_at=null,meta=m,last_error=null,updated_at=now() where id=j.id returning * into j;
  elsif s='RUNNING' then
    if j.status='running' and j.started_at is not null then began:=j.started_at;
    elsif m->>'provider_run_started_task_id'=p_task_id then began:=nullif(m->>'provider_run_started_at','')::timestamptz;
    end if;
    began:=coalesce(began,p_checked_at);
    m:=m||jsonb_build_object('provider_task_pending',true,'provider_terminal_status',null,'provider_run_started_at',began,'provider_run_started_task_id',p_task_id);
    update public.production_jobs set status='running',progress=greatest(62,j.progress),started_at=began,meta=m,last_error=null,updated_at=now() where id=j.id returning * into j;
  elsif s='SUCCESS' then
    m:=m||jsonb_build_object('provider_terminal_status',s,'provider_task_pending',false);
    update public.production_jobs set meta=m,last_error=null,updated_at=now() where id=j.id returning * into j;
  else
    m:=m||jsonb_build_object('provider_terminal_status',s,'provider_task_pending',false);
    update public.production_jobs set status=case when j.result_video_id is not null then 'ready' else 'failed' end,
      progress=case when j.result_video_id is not null then 100 else j.progress end,
      completed_at=now(),meta=m,last_error=case when j.result_video_id is not null then null else coalesce(p_error,'RunningHub encerrou a task como '||s) end,
      locked_at=null,locked_by=null,updated_at=now() where id=j.id returning * into j;
  end if;
  return to_jsonb(j);
end; $$;
revoke all on function public.sync_motion_task_status(uuid,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.sync_motion_task_status(uuid,text,text,text,timestamptz,text) to service_role;

-- Replace the two competing timer triggers with one guard. Local status is not evidence.
drop trigger if exists trg_motion_provider_queue_timing on public.production_jobs;
drop trigger if exists trg_normalize_motion_queue_timer_state on public.production_jobs;
create or replace function public.normalize_motion_provider_queue_timing() returns trigger language plpgsql as $$
declare s text; same_task boolean:=false; k text;
begin
  if coalesce(new.meta->>'workflow_key','')<>'motion_control' then return new; end if;
  new.meta:=coalesce(new.meta,'{}'::jsonb);
  if tg_op='UPDATE' then same_task:=new.runninghub_task_id is not distinct from old.runninghub_task_id; end if;
  if not same_task then
    new.started_at:=null;
    new.meta:=new.meta-array['provider_status','provider_status_checked_at','provider_status_task_id','provider_status_source','provider_queue_waiting','provider_run_started_at','provider_run_started_task_id','provider_status_error'];
  elsif tg_op='UPDATE' and old.meta->>'provider_status_checked_at' is not null and (new.meta->>'provider_status_checked_at' is null or nullif(old.meta->>'provider_status_checked_at','')::timestamptz>nullif(new.meta->>'provider_status_checked_at','')::timestamptz) then
    foreach k in array array['provider_status','provider_status_checked_at','provider_status_task_id','provider_status_source','provider_queue_waiting','provider_run_started_at','provider_run_started_task_id','provider_status_error'] loop
      new.meta:=jsonb_set(new.meta,array[k],coalesce(old.meta->k,'null'::jsonb),true);
    end loop;
  end if;
  if new.status in ('ready','failed','cancelled','canceled') then return new; end if;
  if new.runninghub_task_id is null then
    new.started_at:=null;
    if new.status='waiting' then new.status:='motion_waiting'; end if;
    return new;
  end if;
  s:=case when new.meta->>'provider_status_task_id'=new.runninghub_task_id then new.meta->>'provider_status' else null end;
  if s='QUEUED' then
    new.status:='queued';new.progress:=38;new.started_at:=null;
    new.meta:=new.meta||jsonb_build_object('provider_queue_waiting',true);
  elsif s='RUNNING' then
    new.status:='running';new.meta:=new.meta||jsonb_build_object('provider_queue_waiting',false);
    if tg_op='UPDATE' and same_task and old.status='running' and old.started_at is not null then new.started_at:=old.started_at;
    else new.started_at:=nullif(new.meta->>'provider_run_started_at','')::timestamptz; end if;
  elsif s in ('FAILED','CANCELLED','CANCELED') then
    new.status:=case when new.result_video_id is not null then 'ready' else 'failed' end;
  elsif s is null then
    new.status:='queued';new.progress:=38;new.started_at:=null;
  end if;
  return new;
end; $$;
create trigger trg_motion_provider_queue_timing before insert or update on public.production_jobs for each row execute function public.normalize_motion_provider_queue_timing();

CREATE OR REPLACE FUNCTION public.claim_motion_control_jobs(p_worker text, p_limit integer DEFAULT 1)
 RETURNS SETOF production_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

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
$function$
;
