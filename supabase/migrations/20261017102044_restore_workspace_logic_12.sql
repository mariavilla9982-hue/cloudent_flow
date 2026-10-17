set check_function_bodies=false;
CREATE OR REPLACE FUNCTION public.sync_calendar_pretrial_from_schedule() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  cfg jsonb;
  enabled boolean;
  lead_minutes integer;
  v public.videos%rowtype;
  owner_text text;
  owner_id uuid;
  trial_at timestamptz;
begin
  -- Repeated status/queue updates must not reset Trial retries or permanent failures.
  if tg_op='UPDATE' and new.status in ('scheduled','queued')
    and new.scheduled_at is not distinct from old.scheduled_at
    and new.video_id is not distinct from old.video_id
    and new.platform is not distinct from old.platform then
    return new;
  end if;

  select value into cfg from public.app_settings where key='calendar_pretrial';
  enabled:=coalesce((cfg->>'enabled')::boolean,true);
  lead_minutes:=case
    when coalesce(new.smart_mode,'')='bulk_1m' then 1
    else greatest(1,least(120,coalesce((cfg->>'lead_minutes')::integer,20)))
  end;

  if coalesce(new.platform,'instagram')<>'instagram' then return new; end if;

  if not enabled then
    update public.reel_test_publications
    set status='failed',next_attempt_at=null,last_error='Pré-Trial automático desativado.',updated_at=now()
    where linked_schedule_id=new.id and trial_kind='prepost' and status<>'published';
    return new;
  end if;

  -- Normal publish has started. Do not reset or kill a Trial that is already
  -- creating/processing its Meta container; let the Trial worker finish.
  if new.status='processing' and new.instagram_media_id is null then
    return new;
  end if;

  -- Once the normal reel is truly published, any still-pending pretrial is stale.
  if new.instagram_media_id is not null or new.status='published' then
    update public.reel_test_publications
    set status='failed',next_attempt_at=null,locked_at=null,locked_by=null,
        last_error='Reel normal já publicado; Pré-Trial pendente encerrado.',
        updated_at=now()
    where linked_schedule_id=new.id
      and trial_kind='prepost'
      and status not in ('published','processing','container_created');
    return new;
  end if;

  if new.status not in ('scheduled','queued') then
    update public.reel_test_publications
    set status='failed',next_attempt_at=null,locked_at=null,locked_by=null,
        last_error='Agendamento normal não está mais ativo.',
        updated_at=now()
    where linked_schedule_id=new.id
      and trial_kind='prepost'
      and status<>'published';
    return new;
  end if;

  select * into v from public.videos where id=new.video_id;
  if not found then return new; end if;
  owner_text:=substring(coalesce(v.original_storage_path,v.storage_path) from '^([0-9a-fA-F-]{36})/');
  if owner_text is null then return new; end if;
  owner_id:=owner_text::uuid;
  trial_at:=new.scheduled_at-make_interval(mins=>lead_minutes);

  insert into public.reel_test_publications(
    user_id,storage_path,original_storage_path,storage_provider,file_name,caption,share_to_feed,is_trial,status,scheduled_at,next_attempt_at,
    graduation_strategy,attempt_count,max_attempts,published_as_trial,metrics_stage,meta,slot_index,auto_time,hidden_at,
    media_clean_status,media_clean_report,media_cleaned_at,media_clean_error,trial_kind,linked_schedule_id,source_video_id,shared_storage
  )
  values(
    owner_id,v.storage_path,v.original_storage_path,coalesce(v.storage_provider,'supabase'),v.file_name,coalesce(v.caption,''),false,true,'scheduled',trial_at,trial_at,
    coalesce(cfg->>'graduation_strategy','manual'),0,8,false,0,
    jsonb_build_object('source',case when new.smart_mode='bulk_1m' then 'bulk_publish_1m' else 'calendar_pretrial' end,
      'trial_kind','prepost','true_trial_requested',true,'linked_schedule_id',new.id,'source_video_id',new.video_id,
      'lead_minutes',lead_minutes,'normal_scheduled_at',new.scheduled_at,'bulk_1m',new.smart_mode='bulk_1m'),
    null,false,null,v.media_clean_status,v.media_clean_report,v.media_cleaned_at,v.media_clean_error,
    'prepost',new.id,new.video_id,true
  )
  on conflict(linked_schedule_id) where trial_kind='prepost' and linked_schedule_id is not null
  do update set
    storage_path=excluded.storage_path,
    original_storage_path=excluded.original_storage_path,
    storage_provider=excluded.storage_provider,
    file_name=excluded.file_name,
    caption=excluded.caption,
    scheduled_at=case when public.reel_test_publications.status='published' then public.reel_test_publications.scheduled_at else excluded.scheduled_at end,
    next_attempt_at=case when public.reel_test_publications.status='published' then null else excluded.next_attempt_at end,
    status=case when public.reel_test_publications.status='published' then 'published' else 'scheduled' end,
    container_id=case when public.reel_test_publications.status='published' then public.reel_test_publications.container_id else null end,
    attempt_count=case when public.reel_test_publications.status='published' then public.reel_test_publications.attempt_count else 0 end,
    last_error=case when public.reel_test_publications.status='published' then public.reel_test_publications.last_error else null end,
    locked_at=null,
    locked_by=null,
    media_clean_status=excluded.media_clean_status,
    media_clean_report=excluded.media_clean_report,
    media_cleaned_at=excluded.media_cleaned_at,
    media_clean_error=excluded.media_clean_error,
    source_video_id=excluded.source_video_id,
    shared_storage=true,
    meta=case when public.reel_test_publications.status='published' then public.reel_test_publications.meta else excluded.meta end,
    updated_at=now();
  return new;
end;
$$;


ALTER FUNCTION public.sync_calendar_pretrial_from_schedule() OWNER TO postgres;
revoke all on function public.sync_calendar_pretrial_from_schedule() from public,anon,authenticated; grant execute on function public.sync_calendar_pretrial_from_schedule() to service_role;
CREATE OR REPLACE FUNCTION public.sync_calendar_pretrial_from_video() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.reel_test_publications
  set storage_path=new.storage_path,
      original_storage_path=new.original_storage_path,
      storage_provider=coalesce(new.storage_provider,'supabase'),
      file_name=new.file_name,
      caption=coalesce(new.caption,''),
      media_clean_status=new.media_clean_status,
      media_clean_report=new.media_clean_report,
      media_cleaned_at=new.media_cleaned_at,
      media_clean_error=new.media_clean_error,
      updated_at=now()
  where source_video_id=new.id
    and trial_kind='prepost'
    and status<>'published';
  return new;
end;
$$;


ALTER FUNCTION public.sync_calendar_pretrial_from_video() OWNER TO postgres;
revoke all on function public.sync_calendar_pretrial_from_video() from public,anon,authenticated; grant execute on function public.sync_calendar_pretrial_from_video() to service_role;
CREATE OR REPLACE FUNCTION public.sync_motion_task_status(p_job_id uuid, p_task_id text, p_status text, p_source text, p_checked_at timestamp with time zone, p_error text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare j public.production_jobs; m jsonb; s text:=upper(p_status); began timestamptz; checked timestamptz;
begin
  select * into j from public.production_jobs where id=p_job_id for update;
  if not found or coalesce(j.meta->>'workflow_key','')<>'motion_control'
     or j.runninghub_task_id is distinct from p_task_id
     or j.status not in ('queued','running','uploading','waiting','motion_waiting') then return null; end if;
  m:=coalesce(j.meta,'{}'::jsonb);
  checked:=nullif(m->>'provider_status_checked_at','')::timestamptz;
  if checked is not null and checked>p_checked_at then return to_jsonb(j); end if;
  m:=m||jsonb_build_object('provider_status_checked_at',p_checked_at,'provider_status_source',p_source,'provider_status_task_id',p_task_id);
  if s not in ('QUEUED','RUNNING','SUCCESS','FAILED','CANCELLED','CANCELED') then
    m:=m||jsonb_build_object('provider_status_error',coalesce(p_error,'Status RunningHub indisponível'));
    update public.production_jobs set meta=m,updated_at=now() where id=j.id returning * into j;
    return to_jsonb(j);
  end if;
  m:=m||jsonb_build_object('provider_status',s,'provider_status_error',null,'provider_queue_waiting',s='QUEUED');
  if s='QUEUED' then
    m:=m||jsonb_build_object('provider_task_pending',true,'provider_terminal_status',null,'provider_queue_since',coalesce(m->>'provider_queue_since',p_checked_at::text));
    update public.production_jobs set status='queued',progress=38,started_at=null,meta=m,last_error=null,updated_at=now() where id=j.id returning * into j;
  elsif s='RUNNING' then
    if j.status='running' and j.started_at is not null then began:=j.started_at;
    elsif m->>'provider_run_started_task_id'=p_task_id then began:=nullif(m->>'provider_run_started_at','')::timestamptz;
    end if;
    began:=coalesce(began,p_checked_at);
    m:=m||jsonb_build_object('provider_task_pending',true,'provider_terminal_status',null,'provider_run_started_at',began,'provider_run_started_task_id',p_task_id);
    update public.production_jobs set status='running',progress=greatest(62,j.progress),started_at=began,meta=m,last_error=null,updated_at=now() where id=j.id returning * into j;
  elsif s='SUCCESS' then
    m:=m||jsonb_build_object('provider_terminal_status',s,'provider_task_pending',false);
    update public.production_jobs set meta=m,last_error=null,updated_at=now() where id=j.id returning * into j;
  else
    m:=m||jsonb_build_object('provider_terminal_status',s,'provider_task_pending',false);
    update public.production_jobs set status=case when j.result_video_id is not null then 'ready' else 'failed' end,
      progress=case when j.result_video_id is not null then 100 else j.progress end,
      completed_at=now(),meta=m,last_error=case when j.result_video_id is not null then null else coalesce(p_error,'RunningHub encerrou a task como '||s) end,
      locked_at=null,locked_by=null,updated_at=now() where id=j.id returning * into j;
  end if;
  return to_jsonb(j);
end; $$;


ALTER FUNCTION public.sync_motion_task_status(p_job_id uuid, p_task_id text, p_status text, p_source text, p_checked_at timestamp with time zone, p_error text) OWNER TO postgres;
revoke all on function public.sync_motion_task_status(p_job_id uuid, p_task_id text, p_status text, p_source text, p_checked_at timestamp with time zone, p_error text) from public,anon,authenticated; grant execute on function public.sync_motion_task_status(p_job_id uuid, p_task_id text, p_status text, p_source text, p_checked_at timestamp with time zone, p_error text) to service_role;
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end
$$;


ALTER FUNCTION public.touch_updated_at() OWNER TO postgres;
revoke all on function public.touch_updated_at() from public,anon,authenticated; grant execute on function public.touch_updated_at() to service_role;

set check_function_bodies=true;
