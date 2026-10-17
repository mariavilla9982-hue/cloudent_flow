set check_function_bodies=false;
CREATE OR REPLACE FUNCTION public.finalize_motion_control_after_provider_stop() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
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
$_$;


ALTER FUNCTION public.finalize_motion_control_after_provider_stop() OWNER TO postgres;
revoke all on function public.finalize_motion_control_after_provider_stop() from public,anon,authenticated; grant execute on function public.finalize_motion_control_after_provider_stop() to service_role;
CREATE OR REPLACE FUNCTION public.generate_cloudent_patch_notifications(p_now timestamp with time zone DEFAULT now()) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare u record; w record; day date:=(p_now at time zone 'America/Sao_Paulo')::date;
 start_at timestamptz; end_at timestamptz; accounts jsonb; total integer; detail text; added integer:=0; n integer; issue text;
begin
 start_at:=day::timestamp at time zone 'America/Sao_Paulo';
 end_at:=(day+1)::timestamp at time zone 'America/Sao_Paulo';
 for u in select user_id,role from app_members where enabled loop
 if (p_now at time zone 'America/Sao_Paulo')::time >= time '06:00' then
 with counts as (
 select a.id,a.platform,a.account_label,
 (select count(*) from schedules s where a.platform='instagram' and s.platform_account_id=a.id and s.scheduled_at>=start_at and s.scheduled_at<end_at and s.status<>'cancelled') +
 (select count(*) from reel_test_publications t where a.platform='instagram' and t.user_id=u.user_id and t.linked_schedule_id is null
 and t.scheduled_at>=start_at and t.scheduled_at<end_at and t.status<>'cancelled'
 and coalesce(t.meta->>'platform_account_id',t.meta->>'account_id')=a.id::text) +
 (select count(*) from x_drive_posts x where a.platform='x' and x.platform_account_id=a.id and x.user_id=u.user_id
 and x.scheduled_at>=start_at and x.scheduled_at<end_at and x.status<>'cancelled') as posts
 from platform_accounts a where a.enabled and notification_account_owner(a.id)=u.user_id
 union all
 select null::uuid,'instagram','Reels teste (sem conta definida)',count(*) from reel_test_publications t
 where t.user_id=u.user_id and t.linked_schedule_id is null and t.scheduled_at>=start_at and t.scheduled_at<end_at
 and t.status<>'cancelled' and coalesce(t.meta->>'platform_account_id',t.meta->>'account_id') is null having count(*)>0
 ) select coalesce(jsonb_agg(jsonb_build_object('account_id',id,'platform',platform,'account',account_label,'posts',posts) order by platform,account_label),'[]'),
 coalesce(sum(posts),0)::integer,string_agg('@'||account_label||': '||posts,' · ' order by platform,account_label) into accounts,total,detail from counts;
 insert into system_notifications(user_id,severity,category,title,body,source_ref,dedupe_key,meta)
 values(u.user_id,'info','daily_summary','Programação de hoje: '||total||' posts',
 to_char(day,'DD/MM')||' · '||coalesce(detail,'Nenhum post com horário marcado para hoje.'),day::text,
 'daily-summary:'||u.user_id||':'||day,jsonb_build_object('date',day,'timezone','America/Sao_Paulo','total',total,'accounts',accounts,'generated_at',p_now))
 on conflict(dedupe_key) do nothing;
 get diagnostics n=row_count; added:=added+n;
 end if;
 if u.role='admin' then
 for w in select r.* from worker_runtime r join (values
 ('instagram_publish','cloudentflow-publish-worker',5),('trial_reels','cloudentflow-publish-worker',5),('automation','cloudentflow-automation-worker',15),
 ('followers','cloudentflow-follower-worker',15),('media_cleaner','cloudentflow-media-cleaner-worker',5),
 ('production','cloudentflow-production-worker',5),('x_drive_publisher','cloudentflow-x-drive-publisher',5),
 ('notifications','cloudentflow-notification-worker',5)
 ) cfg(worker,job,minutes) on r.worker_name=cfg.worker
 join cron.job j on j.jobname=cfg.job and j.active
 where nullif(r.last_error,'') is not null or r.last_heartbeat is null or r.last_heartbeat<p_now-make_interval(mins=>cfg.minutes)
 loop
 issue:=case when nullif(w.last_error,'') is not null then left(w.last_error,650) else 'Sem sinal de funcionamento no intervalo esperado.' end;
 insert into system_notifications(user_id,severity,category,title,body,source_ref,dedupe_key,meta)
 values(u.user_id,'error','worker_error','Falha detectada no CloudentFlow',w.worker_name||': '||issue,w.worker_name,
 'worker-error:'||u.user_id||':'||w.worker_name||':'||day||':'||md5(issue),jsonb_build_object('worker',w.worker_name,'heartbeat',w.last_heartbeat))
 on conflict(dedupe_key) do nothing;
 get diagnostics n=row_count; added:=added+n;
 end loop;
 end if;
 end loop;
 return added;
end $$;


ALTER FUNCTION public.generate_cloudent_patch_notifications(p_now timestamp with time zone) OWNER TO postgres;
revoke all on function public.generate_cloudent_patch_notifications(p_now timestamp with time zone) from public,anon,authenticated; grant execute on function public.generate_cloudent_patch_notifications(p_now timestamp with time zone) to service_role;
CREATE OR REPLACE FUNCTION public.get_cloudent_orphan_storage_paths(p_limit integer DEFAULT 100) RETURNS TABLE(name text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select o.name
  from storage.objects o
  where o.bucket_id='videos'
    and o.name like '%/production-results/%'
    and o.created_at < now() - interval '30 minutes'
    and not exists (select 1 from public.production_jobs p where p.result_storage_path=o.name)
    and not exists (select 1 from public.videos v where v.storage_path=o.name or v.original_storage_path=o.name)
  order by o.created_at asc
  limit greatest(1,least(coalesce(p_limit,100),200));
$$;


ALTER FUNCTION public.get_cloudent_orphan_storage_paths(p_limit integer) OWNER TO postgres;
revoke all on function public.get_cloudent_orphan_storage_paths(p_limit integer) from public,anon,authenticated; grant execute on function public.get_cloudent_orphan_storage_paths(p_limit integer) to service_role;
CREATE OR REPLACE FUNCTION public.get_cloudent_r2_config() RETURNS TABLE(account_id text, access_key_id text, secret_access_key text, bucket text, endpoint text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
  select
    max(decrypted_secret) filter (where name='cloudent_r2_account_id') as account_id,
    max(decrypted_secret) filter (where name='cloudent_r2_access_key_id') as access_key_id,
    max(decrypted_secret) filter (where name='cloudent_r2_secret_access_key') as secret_access_key,
    max(decrypted_secret) filter (where name='cloudent_r2_bucket') as bucket,
    max(decrypted_secret) filter (where name='cloudent_r2_endpoint') as endpoint
  from vault.decrypted_secrets
  where name in (
    'cloudent_r2_account_id',
    'cloudent_r2_access_key_id',
    'cloudent_r2_secret_access_key',
    'cloudent_r2_bucket',
    'cloudent_r2_endpoint'
  );
$$;


ALTER FUNCTION public.get_cloudent_r2_config() OWNER TO postgres;
revoke all on function public.get_cloudent_r2_config() from public,anon,authenticated; grant execute on function public.get_cloudent_r2_config() to service_role;
CREATE OR REPLACE FUNCTION public.get_cloudent_system_usage() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'storage', 'pg_catalog'
    AS $$
  with bucket_usage as (
    select
      bucket_id,
      count(*)::bigint as objects,
      coalesce(sum(coalesce((metadata->>'size')::bigint,0)),0)::bigint as bytes
    from storage.objects
    group by bucket_id
  ),
  table_usage as (
    select * from (values
      ('schedules', pg_total_relation_size('public.schedules'::regclass)),
      ('videos', pg_total_relation_size('public.videos'::regclass)),
      ('metrics_snapshots', pg_total_relation_size('public.metrics_snapshots'::regclass)),
      ('instagram_media', pg_total_relation_size('public.instagram_media'::regclass)),
      ('smart_samples', pg_total_relation_size('public.smart_samples'::regclass)),
      ('production_jobs', pg_total_relation_size('public.production_jobs'::regclass)),
      ('job_queue', pg_total_relation_size('public.job_queue'::regclass)),
      ('activity_logs', pg_total_relation_size('public.activity_logs'::regclass))
    ) as t(name, bytes)
  )
  select jsonb_build_object(
    'checked_at', now(),
    'database_bytes', pg_database_size(current_database()),
    'storage_bytes', coalesce((select sum(bytes) from bucket_usage),0),
    'storage_objects', coalesce((select sum(objects) from bucket_usage),0),
    'buckets', coalesce((
      select jsonb_object_agg(bucket_id, jsonb_build_object('bytes',bytes,'objects',objects))
      from bucket_usage
    ), '{}'::jsonb),
    'tables', coalesce((
      select jsonb_object_agg(name, bytes) from table_usage
    ), '{}'::jsonb),
    'counts', jsonb_build_object(
      'videos', (select count(*) from public.videos),
      'schedules', (select count(*) from public.schedules),
      'metrics_snapshots', (select count(*) from public.metrics_snapshots),
      'instagram_media', (select count(*) from public.instagram_media),
      'smart_samples', (select count(*) from public.smart_samples),
      'production_jobs', (select count(*) from public.production_jobs),
      'production_visible', (select count(*) from public.production_jobs where hidden_at is null),
      'queue_pending', (select count(*) from public.job_queue where status='pending'),
      'queue_running', (select count(*) from public.job_queue where status='running'),
      'queue_failed', (select count(*) from public.job_queue where status='failed'),
      'future_schedules', (select count(*) from public.schedules where status in ('scheduled','queued','processing'))
    )
  );
$$;


ALTER FUNCTION public.get_cloudent_system_usage() OWNER TO postgres;
revoke all on function public.get_cloudent_system_usage() from public,anon,authenticated; grant execute on function public.get_cloudent_system_usage() to service_role;
CREATE OR REPLACE FUNCTION public.get_cloudent_vapid_private_key() RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name='cloudent_vapid_private_key'
  order by created_at desc
  limit 1;
$$;


ALTER FUNCTION public.get_cloudent_vapid_private_key() OWNER TO postgres;
revoke all on function public.get_cloudent_vapid_private_key() from public,anon,authenticated; grant execute on function public.get_cloudent_vapid_private_key() to service_role;

set check_function_bodies=true;
