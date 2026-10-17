do $$
begin
  perform cron.unschedule('cloudent-calendar-cover-auto-heal');
exception when others then
  null;
end $$;

select cron.schedule(
  'cloudent-calendar-cover-auto-heal',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := 'https://iubzjfidmxfjvvonusos.supabase.co/functions/v1/cloudent-calendar-cover-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cloudent-worker-secret', public.get_cloudent_worker_secret()
    ),
    body := jsonb_build_object(
      'from', (now() - interval '24 hours')::text,
      'limit', 3
    ),
    timeout_milliseconds := 120000
  );
  $job$
);
