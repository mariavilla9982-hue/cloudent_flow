begin;
do $test$
declare template public.production_jobs; j public.production_jobs; id_motion uuid:=gen_random_uuid(); id_standard uuid:=gen_random_uuid(); id_existing uuid:=gen_random_uuid();
begin
select * into template from public.production_jobs where meta->>'workflow_key'='motion_control' limit 1;
if not found then raise exception 'test template missing';end if;
insert into public.production_jobs select (jsonb_populate_record(null::public.production_jobs,to_jsonb(template)||jsonb_build_object('id',id_motion,'status','motion_waiting','runninghub_task_id',null,'result_video_id',null,'result_url',null,'result_storage_path',null,'started_at',null,'completed_at',null,'locked_by',null,'locked_at',null,'attempt_count',0,'last_error',null,'meta',jsonb_build_object('workflow_key','motion_control'),'next_attempt_at','2999-01-01T00:00:00Z'))).*;
update public.production_jobs set status='failed',attempt_count=1,last_error='TASK_QUEUE_MAXED' where id=id_motion;
select * into j from public.production_jobs where id=id_motion;
if j.status<>'motion_waiting' or j.attempt_count<>0 or j.started_at is not null or j.runninghub_task_id is not null or j.meta->>'provider_queue_waiting'<>'true' then raise exception 'Motion full-queue recovery failed';end if;
update public.production_jobs set updated_at=now() where id=id_motion;
select * into j from public.production_jobs where id=id_motion;
if j.status<>'motion_waiting' or j.attempt_count<>0 then raise exception 'Repeat update changed queue/attempt';end if;
insert into public.production_jobs select (jsonb_populate_record(null::public.production_jobs,to_jsonb(j)||jsonb_build_object('id',id_standard,'status','waiting','meta','{}'::jsonb,'last_error',null))).*;
update public.production_jobs set status='failed',attempt_count=1,last_error='TASK_QUEUE_MAXED' where id=id_standard;
select * into j from public.production_jobs where id=id_standard;
if j.status<>'waiting' or j.attempt_count<>0 then raise exception 'Standard behavior changed';end if;
insert into public.production_jobs select (jsonb_populate_record(null::public.production_jobs,to_jsonb(template)||jsonb_build_object('id',id_existing,'status','queued','runninghub_task_id','test-existing-task','result_video_id',null,'result_url',null,'result_storage_path',null,'started_at',null,'completed_at',null,'locked_by',null,'locked_at',null,'attempt_count',1,'last_error',null,'meta',jsonb_build_object('workflow_key','motion_control'),'next_attempt_at','2999-01-01T00:00:00Z'))).*;
update public.production_jobs set status='failed',last_error='TASK_QUEUE_MAXED' where id=id_existing;
select * into j from public.production_jobs where id=id_existing;
if j.status<>'failed' or j.runninghub_task_id<>'test-existing-task' or j.attempt_count<>1 then raise exception 'Existing task requeued';end if;
end $test$;
rollback;