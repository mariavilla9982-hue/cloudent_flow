create or replace function public.cancel_waiting_pipeline_motion(p_id uuid,p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path=public
as $fn$
declare p public.production_jobs; f public.face_swap_jobs; at_time timestamptz:=clock_timestamp();
begin
  -- Use the exact same serialization boundary as both provider claim functions.
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
  select * into f from public.face_swap_jobs where id=p_id and user_id=p_user_id for update;
  select * into p from public.production_jobs where id=p_id and user_id=p_user_id for update;
  if p.id is null or f.id is null or f.production_job_id is distinct from p.id
    or coalesce(p.meta->>'workflow_key','')<>'motion_control'
    or coalesce(p.meta->>'image_pipeline_version','')<>'2'
    or coalesce(f.meta->>'pipeline_version','')<>'2'
    or coalesce(f.meta->>'stage','')<>'control_motion'
  then return jsonb_build_object('ok',false,'reason','not_found','status',404);end if;
  if p.status='cancelled' and f.status='cancelled' and p.runninghub_task_id is null and f.runninghub_task_id is null
  then return jsonb_build_object('ok',true,'cancelled',true,'already_cancelled',true);end if;
  if p.status<>'motion_waiting' or f.status<>'waiting'
    or p.runninghub_task_id is not null or f.runninghub_task_id is not null
    or p.locked_at is not null or p.locked_by is not null or f.locked_at is not null or f.locked_by is not null
    or p.result_video_id is not null or p.result_storage_path is not null
    or coalesce(p.meta->>'pipeline_dispatch_uncertain','false')='true'
    or nullif(p.meta->>'pipeline_dispatch_intent','') is not null
    or coalesce(p.meta->>'motion_preview_available','false')='true'
    or p.meta->'motion_preview_file' is not null and p.meta->'motion_preview_file'<>'null'::jsonb
    or coalesce(f.meta->>'dispatch_uncertain','false')='true'
    or nullif(f.meta->>'dispatch_intent','') is not null
  then return jsonb_build_object('ok',false,'reason','dispatch_in_progress','status',409);end if;
  update public.production_jobs set status='cancelled',last_error=null,updated_at=at_time,
    meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('cancelled_at',at_time,'cancelled_by_user',p_user_id)
    where id=p.id and user_id=p_user_id;
  update public.face_swap_jobs set status='cancelled',last_error=null,updated_at=at_time,
    meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('cancelled_at',at_time,'cancelled_by_user',p_user_id,'pipeline_status','CONTROL_MOTION_CANCELLED')
    where id=f.id and user_id=p_user_id;
  return jsonb_build_object('ok',true,'cancelled',true,'stage','control_motion','inputs_preserved',true);
end;$fn$;
revoke all on function public.cancel_waiting_pipeline_motion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_waiting_pipeline_motion(uuid,uuid) to service_role;
