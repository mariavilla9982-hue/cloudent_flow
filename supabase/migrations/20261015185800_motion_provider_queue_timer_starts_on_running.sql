create or replace function public.normalize_motion_provider_queue_timing()
returns trigger
language plpgsql
as $$
declare
  is_motion boolean;
  was_waiting boolean := false;
begin
  is_motion := coalesce(new.meta->>'workflow_key','') = 'motion_control';
  if not is_motion then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    was_waiting := coalesce(old.meta->>'provider_queue_waiting','false') = 'true';
  end if;

  if new.status in ('motion_waiting','waiting') and new.runninghub_task_id is null then
    new.started_at := null;
  end if;

  if new.status = 'queued' and new.runninghub_task_id is not null then
    new.started_at := null;
    new.meta := jsonb_set(coalesce(new.meta,'{}'::jsonb), '{provider_queue_waiting}', 'true'::jsonb, true);
    if coalesce(new.meta->>'provider_queue_since','') = '' then
      new.meta := jsonb_set(new.meta, '{provider_queue_since}', to_jsonb(now()::text), true);
    end if;
  elsif new.status = 'running' and new.runninghub_task_id is not null then
    if new.started_at is null
       or tg_op = 'INSERT'
       or (tg_op = 'UPDATE' and (old.status is distinct from 'running' or was_waiting)) then
      new.started_at := now();
      new.meta := jsonb_set(coalesce(new.meta,'{}'::jsonb), '{provider_run_started_at}', to_jsonb(now()::text), true);
    end if;
    new.meta := jsonb_set(coalesce(new.meta,'{}'::jsonb), '{provider_queue_waiting}', 'false'::jsonb, true);
  elsif new.status in ('ready','failed','cancelled','canceled') then
    new.meta := jsonb_set(coalesce(new.meta,'{}'::jsonb), '{provider_queue_waiting}', 'false'::jsonb, true);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_motion_provider_queue_timing on public.production_jobs;
create trigger trg_motion_provider_queue_timing
before insert or update of status, runninghub_task_id, started_at, meta
on public.production_jobs
for each row
execute function public.normalize_motion_provider_queue_timing();
