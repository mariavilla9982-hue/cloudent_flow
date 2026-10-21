-- Retain the existing cron name and minute interval; replace its narrow pipeline-only wake conditions.
-- SQL metadata checks only while idle. Native workers retain storage, provider-capacity and claim guards.
-- Never reset attempts, existing task IDs, future holds or terminal jobs here.
select cron.schedule('cloudent-image-pipeline','* * * * *',$wake$
select net.http_post(
  url:='https://iubzjfidmxfjvvonusos.supabase.co/functions/v1/cloudent-production-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-cloudent-worker-secret',public.get_cloudent_worker_secret()),
  body:='{}'::jsonb,timeout_milliseconds:=120000
)
where exists (
  select 1 from public.face_swap_jobs
  where meta @> '{"pipeline_version":2}'::jsonb
    and hidden_at is null and status in ('waiting','uploading','queued','running')
)
or exists (
  select 1 from public.production_jobs
  where status in ('queued','running') and runninghub_task_id is not null
);

select net.http_post(
  url:='https://iubzjfidmxfjvvonusos.supabase.co/functions/v1/cloudent-motion-control-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-cloudent-worker-secret',public.get_cloudent_worker_secret()),
  body:='{}'::jsonb,timeout_milliseconds:=120000
)
where exists (
  select 1 from public.production_jobs
  where status='motion_waiting'
    and meta @> '{"workflow_key":"motion_control"}'::jsonb
    and runninghub_task_id is null and result_video_id is null
    and attempt_count<max_attempts and next_attempt_at<=now()
    and hidden_at is null
);$wake$);
