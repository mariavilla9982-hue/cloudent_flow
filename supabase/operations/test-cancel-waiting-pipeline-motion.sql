begin;
create temp table production_jobs(id uuid primary key,user_id uuid,status text,meta jsonb,runninghub_task_id text,locked_at timestamptz,locked_by text,result_video_id uuid,result_storage_path text,last_error text,updated_at timestamptz,original_storage_path text,frame_storage_path text);
create temp table face_swap_jobs(id uuid primary key,user_id uuid,production_job_id uuid,status text,meta jsonb,runninghub_task_id text,locked_at timestamptz,locked_by text,last_error text,updated_at timestamptz,result_storage_path text);
create or replace function pg_temp.cancel_waiting_pipeline_motion(p_id uuid,p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path=public
as $fn$
declare p pg_temp.production_jobs; f pg_temp.face_swap_jobs; at_time timestamptz:=clock_timestamp();
begin
  -- Use the exact same serialization boundary as both provider claim functions.
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
  select * into f from pg_temp.face_swap_jobs where id=p_id and user_id=p_user_id for update;
  select * into p from pg_temp.production_jobs where id=p_id and user_id=p_user_id for update;
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
  update pg_temp.production_jobs set status='cancelled',last_error=null,updated_at=at_time,
    meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('cancelled_at',at_time,'cancelled_by_user',p_user_id)
    where id=p.id and user_id=p_user_id;
  update pg_temp.face_swap_jobs set status='cancelled',last_error=null,updated_at=at_time,
    meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('cancelled_at',at_time,'cancelled_by_user',p_user_id,'pipeline_status','CONTROL_MOTION_CANCELLED')
    where id=f.id and user_id=p_user_id;
  return jsonb_build_object('ok',true,'cancelled',true,'stage','control_motion','inputs_preserved',true);
end;$fn$;

do $test$
declare item text; uid uuid:='00000000-0000-4000-8000-000000000001'; fixture_id uuid; answer jsonb; tests integer:=0;
begin
foreach item in array array['valid','other_owner','task','lease','uncertain','intent','result','face_lease','wrong_stage','missing_link','already_cancelled','cancelled_task']
loop
 fixture_id:=md5(item)::uuid;
 insert into pg_temp.production_jobs values(fixture_id,uid,'motion_waiting','{"workflow_key":"motion_control","image_pipeline_version":2}',null,null,null,null,null,null,now(),'original-video','upscaled-frame');
 insert into pg_temp.face_swap_jobs values(fixture_id,uid,fixture_id,'waiting','{"pipeline_version":2,"stage":"control_motion","upscale_result":{"path":"upscaled-frame"}}',null,null,null,null,now(),'upscaled-frame');
 if item='task' then update pg_temp.production_jobs set runninghub_task_id='existing-task' where production_jobs.id=fixture_id;end if;
 if item='lease' then update pg_temp.production_jobs set locked_at=now(),locked_by='worker' where production_jobs.id=fixture_id;end if;
 if item='uncertain' then update pg_temp.production_jobs set meta=meta||'{"pipeline_dispatch_uncertain":true}' where production_jobs.id=fixture_id;end if;
 if item='intent' then update pg_temp.production_jobs set meta=meta||'{"pipeline_dispatch_intent":"sent"}' where production_jobs.id=fixture_id;end if;
 if item='result' then update pg_temp.production_jobs set result_video_id=md5('result')::uuid where production_jobs.id=fixture_id;end if;
 if item='face_lease' then update pg_temp.face_swap_jobs set locked_at=now(),locked_by='worker' where face_swap_jobs.id=fixture_id;end if;
 if item='wrong_stage' then update pg_temp.face_swap_jobs set meta=meta||'{"stage":"upscale"}' where face_swap_jobs.id=fixture_id;end if;
 if item='missing_link' then update pg_temp.face_swap_jobs set production_job_id=null where face_swap_jobs.id=fixture_id;end if;
 if item in ('already_cancelled','cancelled_task') then
 update pg_temp.production_jobs set status='cancelled',runninghub_task_id=case when item='cancelled_task' then 'external-task' else null end where production_jobs.id=fixture_id;
 update pg_temp.face_swap_jobs set status='cancelled' where face_swap_jobs.id=fixture_id;end if;
 answer:=pg_temp.cancel_waiting_pipeline_motion(fixture_id,case when item='other_owner' then md5('other')::uuid else uid end);
 if item in ('valid','already_cancelled') then
   if answer->>'ok'<>'true' then raise exception 'Expected cancel: % %',item,answer;end if;
   if exists(select 1 from pg_temp.production_jobs p join pg_temp.face_swap_jobs f using(id) where p.id=fixture_id and (p.status<>'cancelled' or f.status<>'cancelled' or p.original_storage_path<>'original-video' or p.frame_storage_path<>'upscaled-frame' or f.result_storage_path<>'upscaled-frame')) then raise exception 'Lost preservation %',item;end if;
   if pg_temp.cancel_waiting_pipeline_motion(fixture_id,uid)->>'already_cancelled'<>'true' then raise exception 'Not idempotent';end if;
 else if answer->>'ok'<>'false' then raise exception 'Unsafe cancel: % %',item,answer;end if;
 end if;
 tests:=tests+1;
end loop;
raise notice 'PASS % cancellation scenarios, preserved inputs and idempotency',tests;
end;$test$;
select count(*) as fixtures, count(*) filter(where status='motion_waiting') as untouched_pending from pg_temp.production_jobs;
rollback;