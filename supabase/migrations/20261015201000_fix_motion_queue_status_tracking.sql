create or replace function public.normalize_motion_queue_timer_state()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.meta->>'workflow_key','') <> 'motion_control' then
    return new;
  end if;

  if new.status in ('motion_waiting','waiting','queued') then
    new.started_at := null;
    new.meta := jsonb_set(coalesce(new.meta,'{}'::jsonb), '{provider_queue_waiting}', 'true'::jsonb, true);
    if new.status = 'queued' then
      new.meta := jsonb_set(new.meta, '{provider_status}', to_jsonb('QUEUED'::text), true);
    end if;
  elsif new.status = 'running' and old.status in ('motion_waiting','waiting','queued') then
    new.started_at := now();
    new.meta := jsonb_set(coalesce(new.meta,'{}'::jsonb), '{provider_queue_waiting}', 'false'::jsonb, true);
    new.meta := jsonb_set(new.meta, '{provider_status}', to_jsonb('RUNNING'::text), true);
    new.meta := jsonb_set(new.meta, '{provider_run_started_at}', to_jsonb(now()::text), true);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_motion_queue_timer_state on public.production_jobs;
create trigger trg_normalize_motion_queue_timer_state
before update on public.production_jobs
for each row
execute function public.normalize_motion_queue_timer_state();

do $$
begin
  if exists (select 1 from cron.job where jobname='cloudent-motion-status-worker') then
    perform cron.unschedule((select jobid from cron.job where jobname='cloudent-motion-status-worker' limit 1));
  end if;
end $$;

select cron.schedule(
  'cloudent-motion-status-worker',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://dxrhvudvutmgrmfkmzxo.supabase.co/functions/v1/cloudent-motion-status-worker',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cloudent-worker-secret',
        (select decrypted_secret
         from vault.decrypted_secrets
         where name='cloudent_worker_secret'
         order by created_at desc
         limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $$
);
