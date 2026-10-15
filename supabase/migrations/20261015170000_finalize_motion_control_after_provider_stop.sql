create or replace function public.finalize_motion_control_after_provider_stop()
returns trigger
language plpgsql
as $$
declare
  cancel_accepted boolean;
  cancel_not_found boolean;
  terminal_label text;
begin
  if coalesce(new.meta->>'workflow_key','') <> 'motion_control' then
    return new;
  end if;

  if coalesce(new.meta->>'motion_preview_available','false') <> 'true'
     or new.result_video_id is null
     or new.result_storage_path is null
     or new.meta->>'motion_preview_verified_at' is null
     or coalesce(new.meta->>'motion_preview_sha256','') !~ '^[a-f0-9]{64}$' then
    return new;
  end if;

  cancel_accepted := coalesce(new.meta->>'provider_cancel_accepted','false') = 'true';
  cancel_not_found := coalesce(new.meta->>'provider_cancel_error','') ilike '%807%'
                      or coalesce(new.meta->>'provider_cancel_error','') ilike '%APIKEY_TASK_NOT_FOUND%';

  if not cancel_accepted and not cancel_not_found then
    return new;
  end if;

  terminal_label := case when cancel_not_found then 'NOT_FOUND' else 'CANCEL_ACCEPTED' end;

  new.status := 'ready';
  new.progress := 100;
  new.completed_at := coalesce(new.completed_at, now());
  new.last_error := null;
  new.locked_at := null;
  new.locked_by := null;
  new.updated_at := now();
  new.meta := jsonb_set(coalesce(new.meta,'{}'::jsonb), '{provider_task_pending}', 'false'::jsonb, true);
  new.meta := jsonb_set(new.meta, '{provider_terminal_status}', to_jsonb(terminal_label), true);
  new.meta := jsonb_set(new.meta, '{provider_cancel_finalized_at}', to_jsonb(now()::text), true);
  if cancel_not_found then
    new.meta := jsonb_set(new.meta, '{provider_cancel_error}', 'null'::jsonb, true);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_finalize_motion_control_after_provider_stop on public.production_jobs;
create trigger trg_finalize_motion_control_after_provider_stop
before update of status, progress, meta, last_error, completed_at, result_video_id, result_storage_path
on public.production_jobs
for each row
execute function public.finalize_motion_control_after_provider_stop();
