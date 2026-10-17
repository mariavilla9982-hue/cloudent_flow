-- Dedicated X-only cloud wake-up. Credentials remain inside Vault/SQL execution.
select cron.schedule('cloudent-x-studio-publisher','* * * * *',$job$
 select net.http_post(
  url:='https://iubzjfidmxfjvvonusos.supabase.co/functions/v1/cloudent-x-publish-worker?action=worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-cloudent-worker-secret',public.get_cloudent_worker_secret()),
  body:='{}'::jsonb,timeout_milliseconds:=10000
 );
$job$);
