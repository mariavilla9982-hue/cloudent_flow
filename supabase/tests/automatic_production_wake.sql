begin;
create temporary table production_jobs(status text,meta jsonb default '{}',hidden_at timestamptz,runninghub_task_id text,result_video_id uuid,attempt_count int default 0,max_attempts int default 1,next_attempt_at timestamptz default now());
create temporary table face_swap_jobs(status text,meta jsonb default '{}',hidden_at timestamptz);

truncate pg_temp.production_jobs,pg_temp.face_swap_jobs;

do $test$ begin
 if (select exists(select 1 where exists (
  select 1 from pg_temp.face_swap_jobs
  where meta @> '{"pipeline_version":2}'::jsonb
    and hidden_at is null and status in ('waiting','uploading','queued','running')
)
or exists (
  select 1 from pg_temp.production_jobs
  where status in ('queued','running') and runninghub_task_id is not null
))) is distinct from false then raise exception 'production: idle'; end if;
 if (select exists(select 1 where exists (
  select 1 from pg_temp.production_jobs
  where status='motion_waiting'
    and meta @> '{"workflow_key":"motion_control"}'::jsonb
    and runninghub_task_id is null and result_video_id is null
    and attempt_count<max_attempts and next_attempt_at<=now()
    and hidden_at is null
))) is distinct from false then raise exception 'motion: idle'; end if;
end $test$;

truncate pg_temp.production_jobs,pg_temp.face_swap_jobs;
insert into production_jobs(status,meta) values ('motion_waiting','{"workflow_key":"motion_control","manual_run":true}');
do $test$ begin
 if (select exists(select 1 where exists (
  select 1 from pg_temp.face_swap_jobs
  where meta @> '{"pipeline_version":2}'::jsonb
    and hidden_at is null and status in ('waiting','uploading','queued','running')
)
or exists (
  select 1 from pg_temp.production_jobs
  where status in ('queued','running') and runninghub_task_id is not null
))) is distinct from false then raise exception 'production: direct Motion queued overnight'; end if;
 if (select exists(select 1 where exists (
  select 1 from pg_temp.production_jobs
  where status='motion_waiting'
    and meta @> '{"workflow_key":"motion_control"}'::jsonb
    and runninghub_task_id is null and result_video_id is null
    and attempt_count<max_attempts and next_attempt_at<=now()
    and hidden_at is null
))) is distinct from true then raise exception 'motion: direct Motion queued overnight'; end if;
end $test$;

truncate pg_temp.production_jobs,pg_temp.face_swap_jobs;
insert into production_jobs(status,meta,runninghub_task_id) values ('running','{"workflow_key":"motion_control"}','existing-task');
do $test$ begin
 if (select exists(select 1 where exists (
  select 1 from pg_temp.face_swap_jobs
  where meta @> '{"pipeline_version":2}'::jsonb
    and hidden_at is null and status in ('waiting','uploading','queued','running')
)
or exists (
  select 1 from pg_temp.production_jobs
  where status in ('queued','running') and runninghub_task_id is not null
))) is distinct from true then raise exception 'production: existing Motion task monitored without any Face jobs'; end if;
 if (select exists(select 1 where exists (
  select 1 from pg_temp.production_jobs
  where status='motion_waiting'
    and meta @> '{"workflow_key":"motion_control"}'::jsonb
    and runninghub_task_id is null and result_video_id is null
    and attempt_count<max_attempts and next_attempt_at<=now()
    and hidden_at is null
))) is distinct from false then raise exception 'motion: existing Motion task monitored without any Face jobs'; end if;
end $test$;

truncate pg_temp.production_jobs,pg_temp.face_swap_jobs;
insert into production_jobs(status,meta,runninghub_task_id) values ('queued','{"workflow_key":"motion_control"}','existing-task');
do $test$ begin
 if (select exists(select 1 where exists (
  select 1 from pg_temp.face_swap_jobs
  where meta @> '{"pipeline_version":2}'::jsonb
    and hidden_at is null and status in ('waiting','uploading','queued','running')
)
or exists (
  select 1 from pg_temp.production_jobs
  where status in ('queued','running') and runninghub_task_id is not null
))) is distinct from true then raise exception 'production: provider queued task monitored'; end if;
 if (select exists(select 1 where exists (
  select 1 from pg_temp.production_jobs
  where status='motion_waiting'
    and meta @> '{"workflow_key":"motion_control"}'::jsonb
    and runninghub_task_id is null and result_video_id is null
    and attempt_count<max_attempts and next_attempt_at<=now()
    and hidden_at is null
))) is distinct from false then raise exception 'motion: provider queued task monitored'; end if;
end $test$;

truncate pg_temp.production_jobs,pg_temp.face_swap_jobs;
insert into production_jobs(status,meta,next_attempt_at) values ('motion_waiting','{"workflow_key":"motion_control"}',now()+interval '1 day');
do $test$ begin
 if (select exists(select 1 where exists (
  select 1 from pg_temp.face_swap_jobs
  where meta @> '{"pipeline_version":2}'::jsonb
    and hidden_at is null and status in ('waiting','uploading','queued','running')
)
or exists (
  select 1 from pg_temp.production_jobs
  where status in ('queued','running') and runninghub_task_id is not null
))) is distinct from false then raise exception 'production: future held recovery'; end if;
 if (select exists(select 1 where exists (
  select 1 from pg_temp.production_jobs
  where status='motion_waiting'
    and meta @> '{"workflow_key":"motion_control"}'::jsonb
    and runninghub_task_id is null and result_video_id is null
    and attempt_count<max_attempts and next_attempt_at<=now()
    and hidden_at is null
))) is distinct from false then raise exception 'motion: future held recovery'; end if;
end $test$;

truncate pg_temp.production_jobs,pg_temp.face_swap_jobs;
insert into production_jobs(status,meta) values ('failed','{"workflow_key":"motion_control"}');
do $test$ begin
 if (select exists(select 1 where exists (
  select 1 from pg_temp.face_swap_jobs
  where meta @> '{"pipeline_version":2}'::jsonb
    and hidden_at is null and status in ('waiting','uploading','queued','running')
)
or exists (
  select 1 from pg_temp.production_jobs
  where status in ('queued','running') and runninghub_task_id is not null
))) is distinct from false then raise exception 'production: failed generation never rearmed'; end if;
 if (select exists(select 1 where exists (
  select 1 from pg_temp.production_jobs
  where status='motion_waiting'
    and meta @> '{"workflow_key":"motion_control"}'::jsonb
    and runninghub_task_id is null and result_video_id is null
    and attempt_count<max_attempts and next_attempt_at<=now()
    and hidden_at is null
))) is distinct from false then raise exception 'motion: failed generation never rearmed'; end if;
end $test$;

truncate pg_temp.production_jobs,pg_temp.face_swap_jobs;
insert into production_jobs(status,meta,attempt_count) values ('motion_waiting','{"workflow_key":"motion_control"}',1);
do $test$ begin
 if (select exists(select 1 where exists (
  select 1 from pg_temp.face_swap_jobs
  where meta @> '{"pipeline_version":2}'::jsonb
    and hidden_at is null and status in ('waiting','uploading','queued','running')
)
or exists (
  select 1 from pg_temp.production_jobs
  where status in ('queued','running') and runninghub_task_id is not null
))) is distinct from false then raise exception 'production: exhausted attempt'; end if;
 if (select exists(select 1 where exists (
  select 1 from pg_temp.production_jobs
  where status='motion_waiting'
    and meta @> '{"workflow_key":"motion_control"}'::jsonb
    and runninghub_task_id is null and result_video_id is null
    and attempt_count<max_attempts and next_attempt_at<=now()
    and hidden_at is null
))) is distinct from false then raise exception 'motion: exhausted attempt'; end if;
end $test$;

truncate pg_temp.production_jobs,pg_temp.face_swap_jobs;
insert into production_jobs(status,meta,runninghub_task_id) values ('motion_waiting','{"workflow_key":"motion_control"}','existing-task');
do $test$ begin
 if (select exists(select 1 where exists (
  select 1 from pg_temp.face_swap_jobs
  where meta @> '{"pipeline_version":2}'::jsonb
    and hidden_at is null and status in ('waiting','uploading','queued','running')
)
or exists (
  select 1 from pg_temp.production_jobs
  where status in ('queued','running') and runninghub_task_id is not null
))) is distinct from false then raise exception 'production: existing task not dispatched again'; end if;
 if (select exists(select 1 where exists (
  select 1 from pg_temp.production_jobs
  where status='motion_waiting'
    and meta @> '{"workflow_key":"motion_control"}'::jsonb
    and runninghub_task_id is null and result_video_id is null
    and attempt_count<max_attempts and next_attempt_at<=now()
    and hidden_at is null
))) is distinct from false then raise exception 'motion: existing task not dispatched again'; end if;
end $test$;

truncate pg_temp.production_jobs,pg_temp.face_swap_jobs;
insert into production_jobs(status,meta,hidden_at) values ('motion_waiting','{"workflow_key":"motion_control"}',now());
do $test$ begin
 if (select exists(select 1 where exists (
  select 1 from pg_temp.face_swap_jobs
  where meta @> '{"pipeline_version":2}'::jsonb
    and hidden_at is null and status in ('waiting','uploading','queued','running')
)
or exists (
  select 1 from pg_temp.production_jobs
  where status in ('queued','running') and runninghub_task_id is not null
))) is distinct from false then raise exception 'production: hidden waiting job'; end if;
 if (select exists(select 1 where exists (
  select 1 from pg_temp.production_jobs
  where status='motion_waiting'
    and meta @> '{"workflow_key":"motion_control"}'::jsonb
    and runninghub_task_id is null and result_video_id is null
    and attempt_count<max_attempts and next_attempt_at<=now()
    and hidden_at is null
))) is distinct from false then raise exception 'motion: hidden waiting job'; end if;
end $test$;

truncate pg_temp.production_jobs,pg_temp.face_swap_jobs;
insert into face_swap_jobs(status,meta) values ('waiting','{"pipeline_version":2,"stage":"upscale"}');
do $test$ begin
 if (select exists(select 1 where exists (
  select 1 from pg_temp.face_swap_jobs
  where meta @> '{"pipeline_version":2}'::jsonb
    and hidden_at is null and status in ('waiting','uploading','queued','running')
)
or exists (
  select 1 from pg_temp.production_jobs
  where status in ('queued','running') and runninghub_task_id is not null
))) is distinct from true then raise exception 'production: fast pipeline retains wake'; end if;
 if (select exists(select 1 where exists (
  select 1 from pg_temp.production_jobs
  where status='motion_waiting'
    and meta @> '{"workflow_key":"motion_control"}'::jsonb
    and runninghub_task_id is null and result_video_id is null
    and attempt_count<max_attempts and next_attempt_at<=now()
    and hidden_at is null
))) is distinct from false then raise exception 'motion: fast pipeline retains wake'; end if;
end $test$;

truncate pg_temp.production_jobs,pg_temp.face_swap_jobs;
insert into production_jobs(status,meta) values ('motion_waiting','{"workflow_key":"motion_control","image_pipeline_version":2}');
do $test$ begin
 if (select exists(select 1 where exists (
  select 1 from pg_temp.face_swap_jobs
  where meta @> '{"pipeline_version":2}'::jsonb
    and hidden_at is null and status in ('waiting','uploading','queued','running')
)
or exists (
  select 1 from pg_temp.production_jobs
  where status in ('queued','running') and runninghub_task_id is not null
))) is distinct from false then raise exception 'production: chained Motion retains wake'; end if;
 if (select exists(select 1 where exists (
  select 1 from pg_temp.production_jobs
  where status='motion_waiting'
    and meta @> '{"workflow_key":"motion_control"}'::jsonb
    and runninghub_task_id is null and result_video_id is null
    and attempt_count<max_attempts and next_attempt_at<=now()
    and hidden_at is null
))) is distinct from true then raise exception 'motion: chained Motion retains wake'; end if;
end $test$;

select '11 wake scenarios passed' as result;
rollback;
