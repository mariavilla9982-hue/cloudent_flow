create or replace function public.normalize_production_queue_maxed()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'failed'
     and new.runninghub_task_id is null
     and coalesce(new.last_error,'') ilike '%TASK_QUEUE_MAXED%' then
    new.status := 'waiting';
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
$$;

drop trigger if exists trg_normalize_production_queue_maxed on public.production_jobs;
create trigger trg_normalize_production_queue_maxed
before update on public.production_jobs
for each row
execute function public.normalize_production_queue_maxed();

update public.production_jobs
set status='waiting',
    progress=0,
    attempt_count=greatest(0,coalesce(attempt_count,0)-1),
    started_at=null,
    completed_at=null,
    locked_at=null,
    locked_by=null,
    next_attempt_at=now()+interval '20 seconds',
    updated_at=now(),
    meta=jsonb_set(coalesce(meta,'{}'::jsonb), '{provider_queue_waiting}', 'true'::jsonb, true)
where status='failed'
  and runninghub_task_id is null
  and coalesce(last_error,'') ilike '%TASK_QUEUE_MAXED%';
