begin;
do $$
declare owner_id uuid; job uuid:=gen_random_uuid(); before_points numeric; after_points numeric;
  day_start timestamptz:=((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
begin
  if has_table_privilege('authenticated','public.runninghub_charges','SELECT')
    or has_function_privilege('anon','public.runninghub_points_summary()','EXECUTE') then
    raise exception 'Billing information must remain service-only';
  end if;
  select user_id into owner_id from public.genjutsu_v3_jobs limit 1;
  select coalesce((t->>'points')::numeric,0) into before_points
  from jsonb_array_elements(public.runninghub_points_summary()->'totals') t
  where t->>'module'='GENJUTSU V3' and t->>'key'='today';
  insert into public.genjutsu_v3_jobs(id,user_id,task_id,status,video_bytes,image_bytes,video_type,image_type,started_at)
  values(job,owner_id,'999999999999900001','draft',1,1,'video/mp4','image/png',day_start);
  update public.runninghub_charges set points=3.125,settled=true where task_id='999999999999900001';
  select (t->>'points')::numeric into after_points
  from jsonb_array_elements(public.runninghub_points_summary()->'totals') t
  where t->>'module'='GENJUTSU V3' and t->>'key'='today';
  if after_points<>before_points+3.125 then raise exception 'Exact charge or midnight boundary failed'; end if;
  -- Same task on a repeated patch cannot create a second charge.
  update public.genjutsu_v3_jobs set task_id='999999999999900001' where id=job;
  if (select count(*) from public.runninghub_charges where task_id='999999999999900001')<>1 then raise exception 'Duplicate charge'; end if;
  -- A retry gets another task and preserves the earlier settled amount.
  update public.genjutsu_v3_jobs set task_id='999999999999900002' where id=job;
  delete from public.genjutsu_v3_jobs where id=job;
  if (select count(*) from public.runninghub_charges where job_id=job)<>2 then raise exception 'Retry/delete lost billing history'; end if;
  if not exists(select 1 from public.runninghub_charges where task_id='999999999999900002' and points is null and not settled) then raise exception 'Pending is not zero'; end if;
  update public.runninghub_charges set started_at=day_start-interval '1 millisecond' where task_id='999999999999900001';
  select coalesce((t->>'points')::numeric,0) into after_points
  from jsonb_array_elements(public.runninghub_points_summary()->'totals') t
  where t->>'module'='GENJUTSU V3' and t->>'key'='today';
  if after_points<>before_points then raise exception 'Brasilia day boundary failed'; end if;
end $$;
rollback;
