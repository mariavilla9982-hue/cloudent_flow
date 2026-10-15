-- Keep Motion queue-full refusals in the queue consumed by the Motion worker.
-- No provider task exists in this path; existing IDs are expressly excluded.
CREATE OR REPLACE FUNCTION public.normalize_production_queue_maxed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.status = 'failed'
     and new.runninghub_task_id is null
     and coalesce(new.last_error,'') ilike '%TASK_QUEUE_MAXED%' then
    new.status := case when coalesce(new.meta->>'workflow_key','')='motion_control' then 'motion_waiting' else 'waiting' end;
    new.progress := 0;
    new.attempt_count := greatest(0, coalesce(new.attempt_count,0) - 1);
    new.started_at := null;
    new.completed_at := null;
    new.locked_at := null;
    new.locked_by := null;
    new.next_attempt_at := now() + interval '20 seconds';
    new.updated_at := now();
    new.meta := jsonb_set(coalesce(new.meta,'{}'::jsonb), '{provider_queue_waiting}', 'true'::jsonb, true);
  end if;
  return new;
end;
$function$
;
update public.production_jobs
set status='motion_waiting',progress=0,started_at=null,locked_at=null,locked_by=null,
    next_attempt_at=least(next_attempt_at,now()),updated_at=now()
where meta->>'workflow_key'='motion_control'
  and status='waiting' and runninghub_task_id is null
  and result_video_id is null
  and coalesce(last_error,'') ilike '%TASK_QUEUE_MAXED%';
