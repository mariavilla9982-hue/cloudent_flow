create or replace function cloudent_private.track_runninghub_task() returns trigger
language plpgsql security definer set search_path='' as $$
declare r jsonb:=to_jsonb(new); item record;
begin
  for item in
    select r->>'task_id' as task, 'GENJUTSU V3'::text as module
      where tg_table_name='genjutsu_v3_jobs'
    union all select r->>'runninghub_task_id',
      case when tg_table_name='face_swap_jobs' then case when r->'meta'->>'stage'='upscale' or r->'meta'->>'upscale_task_id'=r->>'runninghub_task_id' then 'Upscale' else 'Face Swap' end
           when r->'meta'->>'workflow_key'='genjutsu' then 'GENJUTSU legado'
           when r->'meta'->>'workflow_key'='motion_control' then 'Motion Control' else 'Produção' end
      where tg_table_name in ('face_swap_jobs','production_jobs')
    union all select r->'meta'->>'face_swap_task_id','Face Swap' where tg_table_name='face_swap_jobs'
    union all select r->'meta'->>'upscale_task_id','Upscale' where tg_table_name='face_swap_jobs'
  loop
    if item.task ~ '^[0-9]+$' then
      insert into public.runninghub_charges(task_id,user_id,job_id,module,started_at)
      values(item.task,(r->>'user_id')::uuid,(r->>'id')::uuid,item.module,
        coalesce((r->>'started_at')::timestamptz,now()))
      on conflict(task_id) do nothing;
    end if;
  end loop;
  return new;
end $$;

update public.runninghub_charges c set module='Upscale' from public.face_swap_jobs f where c.job_id=f.id and c.task_id=f.meta->>'upscale_task_id' and c.module='Face Swap';
