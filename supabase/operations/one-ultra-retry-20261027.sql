-- Explicit user approval: one Ultra 84GB attempt, only if this exact 48GB task fails.
-- No workflow, media, calendar, credentials or running task are modified.
with target as (
  select * from public.production_jobs
  where id='8ab39831-6662-4d7d-88d0-8698edfdb32c'
    and status='failed'
    and runninghub_task_id='2115252978189692929'
    and result_video_id is null and result_storage_path is null
    and locked_at is null and locked_by is null
    and meta->>'workflow_key'='motion_control'
    and meta->>'workflow_id'='2110721194974982146'
    and meta->>'provider_status_task_id'=runninghub_task_id
    and (meta->>'provider_status'='FAILED' or meta->>'provider_terminal_status'='FAILED')
    and coalesce(meta->>'pipeline_dispatch_uncertain','false')='false'
    and meta->>'pipeline_dispatch_intent' is null
    and meta->>'execution_ultra_once' is null
  for update skip locked
)
update public.production_jobs j
set status='motion_waiting',progress=0,attempt_count=0,max_attempts=1,
    runninghub_task_id=null,started_at=null,completed_at=null,last_error=null,
    locked_at=null,locked_by=null,next_attempt_at=now(),updated_at=now(),
    meta=target.meta || jsonb_build_object(
      'manual_run',true,'previous_motion_task_id',target.runninghub_task_id,
      'provider_status','UNKNOWN','provider_status_task_id',null,'provider_terminal_status',null,
      'provider_task_pending',false,'provider_queue_waiting',true,
      'pipeline_dispatch_intent',null,'pipeline_dispatch_uncertain',false,
      'execution_instance_type','ultra','execution_instance_authorized',true,
      'execution_ultra_once',jsonb_build_object(
        'approval_id','APPROVAL_UUID','job_id',j.id,'workflow_id','2110721194974982146',
        'source_task_id',target.runninghub_task_id,'source_error',target.last_error,
        'state','pending','authorized_at',now(),'authorization','explicit_user_20261027'
      ))
from target
where j.id=target.id and j.updated_at=target.updated_at
returning j.id,j.status,j.meta->'execution_ultra_once' as authorization;
