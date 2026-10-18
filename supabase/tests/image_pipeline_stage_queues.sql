begin;
set local lock_timeout='2s';
set local statement_timeout='8s';
do $test$
declare
  f public.face_swap_jobs; p public.production_jobs;
  old_face uuid:=gen_random_uuid(); new_face uuid:=gen_random_uuid(); up uuid:=gen_random_uuid();
  chained uuid:=gen_random_uuid(); standalone uuid:=gen_random_uuid(); n integer;
begin
  select * into f from public.face_swap_jobs where meta @> '{"pipeline_version":2}' limit 1;
  select * into p from public.production_jobs where meta->>'workflow_key'='motion_control' limit 1;
  if f.id is null or p.id is null then raise exception 'test fixture missing'; end if;
  -- Isolate the test inside this transaction only. Every fixture/change is rolled back.
  update public.face_swap_jobs set status='cancelled'
    where meta @> '{"pipeline_version":2}' and status in ('waiting','uploading','queued','running') and meta->>'stage' in ('face_swap','upscale');
  update public.integrations set config=config||'{"concurrency":10}'::jsonb where provider='runninghub';
  for n in 1..3 loop
    insert into public.face_swap_jobs
    select (jsonb_populate_record(null::public.face_swap_jobs,to_jsonb(f)||jsonb_build_object(
      'id',case n when 1 then old_face when 2 then new_face else up end,
      'status','waiting','created_at',case n when 1 then '2000-01-02T00:00:00Z' when 2 then '2000-01-03T00:00:00Z' else '2000-01-01T00:00:00Z' end,
      'runninghub_task_id',null,'production_job_id',null,'hidden_at',null,'locked_at',null,'locked_by',null,
      'meta',jsonb_build_object('pipeline_version',2,'stage',case n when 3 then 'upscale' else 'face_swap' end,'source','face_swap_natural')))).*;
  end loop;
  insert into public.production_jobs
  select (jsonb_populate_record(null::public.production_jobs,to_jsonb(p)||jsonb_build_object(
    'id',chained,'status','motion_waiting','runninghub_task_id',null,'locked_at',null,'locked_by',null,
    'result_video_id',null,'started_at',null,'completed_at',null,'attempt_count',0,'max_attempts',1,
    'next_attempt_at','2000-01-01T00:00:00Z','created_at','2000-01-01T00:00:00Z',
    'meta',jsonb_build_object('workflow_key','motion_control','image_pipeline_version',2,'auto_chained',true)))).*;
  select count(*) into n from public.lease_image_pipeline(up,'queue-test',10);
  if n<>0 then raise exception 'Upscale jumped waiting Face Swap queue'; end if;
  select count(*) into n from public.lease_image_pipeline(new_face,'queue-test',10);
  if n<>0 then raise exception 'FIFO violated inside Face Swap'; end if;
  select count(*) into n from public.lease_image_pipeline(old_face,'queue-test',10);
  if n<>1 then raise exception 'oldest Face Swap not claimed'; end if;
  select count(*) into n from public.lease_image_pipeline(old_face,'duplicate-worker',10);
  if n<>0 then raise exception 'duplicate stage claim'; end if;
  select count(*) into n from public.claim_motion_control_jobs('motion-test',1) where id=chained;
  if n<>0 then raise exception 'chained Motion stole fast-image capacity'; end if;
  -- Standalone Motion remains eligible under its original rules.
  insert into public.production_jobs
  select (jsonb_populate_record(null::public.production_jobs,to_jsonb(p)||jsonb_build_object(
    'id',standalone,'status','motion_waiting','runninghub_task_id',null,'locked_at',null,'locked_by',null,
    'result_video_id',null,'started_at',null,'completed_at',null,'attempt_count',0,'max_attempts',1,
    'next_attempt_at','1999-01-01T00:00:00Z','created_at','1999-01-01T00:00:00Z',
    'meta',jsonb_build_object('workflow_key','motion_control','manual_run',true)))).*;
  select count(*) into n from public.claim_motion_control_jobs('standalone-test',1) where id=standalone;
  if n<>1 then raise exception 'standalone Motion contract changed'; end if;
  update public.production_jobs set status='cancelled' where id=standalone;
  -- Completing Face Swap releases its slot and buffers the image for Upscale.
  update public.face_swap_jobs set status='ready',locked_by=null,locked_at=null where id in (old_face,new_face);
  select count(*) into n from public.lease_image_pipeline(up,'upscale-test',10);
  if n<>1 then raise exception 'Upscale did not advance after Face Swap queue cleared'; end if;
  select count(*) into n from public.claim_motion_control_jobs('motion-test',1) where id=chained;
  if n<>0 then raise exception 'Motion did not wait for active Upscale'; end if;
  update public.face_swap_jobs set status='ready',locked_by=null,locked_at=null where id=up;
  select count(*) into n from public.claim_motion_control_jobs('motion-test',1) where id=chained;
  if n<>1 then raise exception 'Motion did not become eligible after image backlog cleared'; end if;
  if has_function_privilege('authenticated','public.lease_image_pipeline(uuid,text,integer)','EXECUTE')
     or has_function_privilege('anon','public.claim_motion_control_jobs(text,integer)','EXECUTE') then raise exception 'private claim permissions opened'; end if;
end $test$;
rollback;
