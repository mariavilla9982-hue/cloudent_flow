set check_function_bodies=false;
CREATE OR REPLACE FUNCTION public.normalize_motion_provider_queue_timing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare s text; same_task boolean:=false; k text;
begin
  if coalesce(new.meta->>'workflow_key','')<>'motion_control' then return new; end if;
  new.meta:=coalesce(new.meta,'{}'::jsonb);
  if tg_op='UPDATE' then same_task:=new.runninghub_task_id is not distinct from old.runninghub_task_id; end if;
  if not same_task then
    new.started_at:=null;
    new.meta:=new.meta-array['provider_status','provider_status_checked_at','provider_status_task_id','provider_status_source','provider_queue_waiting','provider_run_started_at','provider_run_started_task_id','provider_status_error'];
  elsif tg_op='UPDATE' and old.meta->>'provider_status_checked_at' is not null and (new.meta->>'provider_status_checked_at' is null or nullif(old.meta->>'provider_status_checked_at','')::timestamptz>nullif(new.meta->>'provider_status_checked_at','')::timestamptz) then
    foreach k in array array['provider_status','provider_status_checked_at','provider_status_task_id','provider_status_source','provider_queue_waiting','provider_run_started_at','provider_run_started_task_id','provider_status_error'] loop
      new.meta:=jsonb_set(new.meta,array[k],coalesce(old.meta->k,'null'::jsonb),true);
    end loop;
  end if;
  if new.status in ('ready','failed','cancelled','canceled') then return new; end if;
  if new.runninghub_task_id is null then
    new.started_at:=null;
    if new.status='waiting' then new.status:='motion_waiting'; end if;
    return new;
  end if;
  s:=case when new.meta->>'provider_status_task_id'=new.runninghub_task_id then new.meta->>'provider_status' else null end;
  if s='QUEUED' then
    new.status:='queued';new.progress:=38;new.started_at:=null;
    new.meta:=new.meta||jsonb_build_object('provider_queue_waiting',true);
  elsif s='RUNNING' then
    new.status:='running';new.meta:=new.meta||jsonb_build_object('provider_queue_waiting',false);
    if tg_op='UPDATE' and same_task and old.status='running' and old.started_at is not null then new.started_at:=old.started_at;
    else new.started_at:=nullif(new.meta->>'provider_run_started_at','')::timestamptz; end if;
  elsif s in ('FAILED','CANCELLED','CANCELED') then
    new.status:=case when new.result_video_id is not null then 'ready' else 'failed' end;
  elsif s is null then
    new.status:='queued';new.progress:=38;new.started_at:=null;
  end if;
  return new;
end; $$;


ALTER FUNCTION public.normalize_motion_provider_queue_timing() OWNER TO postgres;
revoke all on function public.normalize_motion_provider_queue_timing() from public,anon,authenticated; grant execute on function public.normalize_motion_provider_queue_timing() to service_role;
CREATE OR REPLACE FUNCTION public.normalize_motion_queue_timer_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


ALTER FUNCTION public.normalize_motion_queue_timer_state() OWNER TO postgres;
revoke all on function public.normalize_motion_queue_timer_state() from public,anon,authenticated; grant execute on function public.normalize_motion_queue_timer_state() to service_role;
CREATE OR REPLACE FUNCTION public.normalize_production_queue_maxed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.status = 'failed'
     and new.runninghub_task_id is null
     and coalesce(new.last_error,'') ilike '%TASK_QUEUE_MAXED%' then
    new.status := case when coalesce(new.meta->>'workflow_key','')='motion_control' then 'motion_waiting' else 'waiting' end;
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


ALTER FUNCTION public.normalize_production_queue_maxed() OWNER TO postgres;
revoke all on function public.normalize_production_queue_maxed() from public,anon,authenticated; grant execute on function public.normalize_production_queue_maxed() to service_role;
CREATE OR REPLACE FUNCTION public.notification_account_owner(p_account uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
 select m.user_id from platform_accounts a join app_members m on m.enabled and (
  (a.config->>'owner_user_id'=m.user_id::text) or
  (nullif(a.config->>'owner_user_id','') is null and m.role='admin' and
   (select count(*) from app_members where enabled and role='admin')=1)
 ) where a.id=p_account limit 1
$$;


ALTER FUNCTION public.notification_account_owner(p_account uuid) OWNER TO postgres;
revoke all on function public.notification_account_owner(p_account uuid) from public,anon,authenticated; grant execute on function public.notification_account_owner(p_account uuid) to service_role;
CREATE OR REPLACE FUNCTION public.pick_instagram_calendar_caption() RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  captions text[];
begin
  select array(
    select jsonb_array_elements_text(value->'captions')
  )
  into captions
  from public.app_settings
  where key='instagram_calendar_captions';

  if captions is null or cardinality(captions)=0 then
    captions := array[
      'Presente nos storyes 🎁',
      'Vem dar uma espiadinha nos storyes👀',
      'Completo nos storyes🔥',
      'Vem ver o que eu postei no storyes💦',
      'Tudo nos storyes❤️'
    ];
  end if;

  return captions[1 + floor(random() * cardinality(captions))::int];
end;
$$;


ALTER FUNCTION public.pick_instagram_calendar_caption() OWNER TO postgres;
revoke all on function public.pick_instagram_calendar_caption() from public,anon,authenticated; grant execute on function public.pick_instagram_calendar_caption() to service_role;
CREATE OR REPLACE FUNCTION public.queue_legacy_video_for_media_cleaner() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.video_id is not null
     and coalesce(new.platform,'instagram')='instagram'
     and coalesce((select (value->>'enabled')::boolean from public.app_settings where key='media_cleaner'),true)
  then
    update public.videos
    set media_clean_status='pending',
        media_clean_attempts=0,
        media_clean_next_attempt_at=now(),
        media_clean_error=null,
        updated_at=now()
    where id=new.video_id
      and media_clean_status='legacy';
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.queue_legacy_video_for_media_cleaner() OWNER TO postgres;
revoke all on function public.queue_legacy_video_for_media_cleaner() from public,anon,authenticated; grant execute on function public.queue_legacy_video_for_media_cleaner() to service_role;
CREATE OR REPLACE FUNCTION public.record_cloudent_media_access(p_user_id uuid, p_kind text, p_estimated_bytes bigint DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare d date:=current_date; r public.media_access_daily%rowtype; b bigint:=greatest(0,least(coalesce(p_estimated_bytes,0),524288000));
begin
 insert into public.media_access_daily(user_id,day,video_preview_requests,trial_preview_requests,thumbnail_requests,estimated_bytes,last_access_at)
 values(p_user_id,d,
   case when p_kind in ('video_preview','production_preview') then 1 else 0 end,
   case when p_kind='trial_preview' then 1 else 0 end,
   case when p_kind='thumbnail' then 1 else 0 end,
   case when p_kind='thumbnail' then least(b,250000) else b end,now())
 on conflict(user_id,day) do update set
   video_preview_requests=media_access_daily.video_preview_requests+excluded.video_preview_requests,
   trial_preview_requests=media_access_daily.trial_preview_requests+excluded.trial_preview_requests,
   thumbnail_requests=media_access_daily.thumbnail_requests+excluded.thumbnail_requests,
   estimated_bytes=media_access_daily.estimated_bytes+excluded.estimated_bytes,
   last_access_at=now()
 returning * into r;
 return jsonb_build_object('day',r.day,'estimated_bytes',r.estimated_bytes);
end $$;


ALTER FUNCTION public.record_cloudent_media_access(p_user_id uuid, p_kind text, p_estimated_bytes bigint) OWNER TO postgres;
revoke all on function public.record_cloudent_media_access(p_user_id uuid, p_kind text, p_estimated_bytes bigint) from public,anon,authenticated; grant execute on function public.record_cloudent_media_access(p_user_id uuid, p_kind text, p_estimated_bytes bigint) to service_role;
CREATE OR REPLACE FUNCTION public.record_story_monitor_result(p_account uuid, p_count integer, p_error text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare m instagram_story_monitor; u uuid; label text; episode timestamptz;
begin
 select * into m from instagram_story_monitor where account_id=p_account for update;
 if not found then return; end if;
 u:=notification_account_owner(p_account);
 select account_label into label from platform_accounts where id=p_account;
 if p_error is not null or p_count is null or p_count<0 then
 update instagram_story_monitor set status='unknown',active_count=null,checked_at=now(),
 last_error=left(coalesce(p_error,'Resposta inválida ao consultar Stories'),700),updated_at=now() where account_id=p_account;
 if u is not null then
 insert into system_notifications(user_id,severity,category,title,body,source_ref,dedupe_key,meta)
 values(u,'error','stories_access','Não foi possível verificar os Stories',
 '@'||coalesce(label,'Instagram')||': '||left(coalesce(p_error,'Resposta inválida'),500),p_account::text,
 'stories-access:'||p_account||':'||to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD'),jsonb_build_object('account_id',p_account))
 on conflict(dedupe_key) do nothing;
 end if;
 return;
 end if;
 episode:=case when p_count=0 then coalesce(m.empty_since,clock_timestamp()) else null end;
 update instagram_story_monitor set status=case when p_count=0 then 'empty' else 'active' end,
 last_known_status=case when p_count=0 then 'empty' else 'active' end,active_count=p_count,
 empty_since=episode,checked_at=now(),last_error=null,updated_at=now() where account_id=p_account;
 if p_count=0 and m.last_known_status<>'empty' and u is not null then
 insert into system_notifications(user_id,severity,category,title,body,source_ref,dedupe_key,meta)
 values(u,'warn','stories_empty','Conta sem Stories ativos','@'||coalesce(label,'Instagram')||' está sem Stories ativos. Hora de publicar um novo Story.',
 p_account::text,'stories-empty:'||p_account||':'||episode::text,jsonb_build_object('account_id',p_account,'empty_since',episode))
 on conflict(dedupe_key) do nothing;
 end if;
end $$;


ALTER FUNCTION public.record_story_monitor_result(p_account uuid, p_count integer, p_error text) OWNER TO postgres;
revoke all on function public.record_story_monitor_result(p_account uuid, p_count integer, p_error text) from public,anon,authenticated; grant execute on function public.record_story_monitor_result(p_account uuid, p_count integer, p_error text) to service_role;

set check_function_bodies=true;
