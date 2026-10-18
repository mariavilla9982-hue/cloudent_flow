set lock_timeout='2s';
set statement_timeout='8s';
alter table public.schedules add column if not exists trial_video_id uuid;
-- The relationship lives on the existing slot; it never consumes another slot.
create or replace function public.set_calendar_trial_video(p_schedule_id uuid,p_video_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.schedules%rowtype; v public.videos%rowtype; t public.reel_test_publications%rowtype; workspace uuid;
begin
 select workspace_id into workspace from app_members where user_id=p_actor and enabled and role='admin';
 if workspace is null then raise exception 'forbidden'; end if;
 select * into s from schedules where id=p_schedule_id for update;
 if not found or s.platform<>'instagram' or not exists(select 1 from platform_accounts where id=s.platform_account_id and workspace_id=workspace and platform='instagram' and enabled) then raise exception 'schedule_account_unavailable'; end if;
 if s.status not in ('scheduled','queued') or s.scheduled_at<=now() then raise exception 'schedule_already_started'; end if;
 select * into t from reel_test_publications where linked_schedule_id=s.id and trial_kind='prepost' for update;
 if found and (t.status not in ('scheduled','failed','uploaded') or t.container_id is not null or t.instagram_media_id is not null or t.locked_at is not null) then raise exception 'trial_already_started'; end if;
 if p_video_id is not null then
   select * into v from videos where id=p_video_id for share;
   if not found or v.storage_deleted_at is not null or v.storage_provider<>'r2' or v.platform<>'instagram' then raise exception 'trial_video_unavailable'; end if;
   if v.platform_account_id is not null and v.platform_account_id<>s.platform_account_id then raise exception 'trial_video_account_mismatch'; end if;
   if not exists(select 1 from production_jobs where result_video_id=v.id and status='ready' and user_id=p_actor) then raise exception 'ready_production_video_required'; end if;
 end if;
 update schedules set trial_video_id=p_video_id where id=s.id;
 return jsonb_build_object('ok',true,'schedule_id',s.id,'trial_video_id',p_video_id);
end $$;
revoke all on function public.set_calendar_trial_video(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_calendar_trial_video(uuid,uuid,uuid) to service_role;

create or replace function public.claim_calendar_publish_schedule(p_schedule_id uuid,p_worker text)
returns setof public.job_queue language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid;
begin
 select id into sid from schedules where id=p_schedule_id and platform='instagram' and status in ('scheduled','queued','processing','failed') and instagram_media_id is null and scheduled_at<=now() for update skip locked;
 if sid is null then return; end if;
 return query with candidate as (
 select id from job_queue where schedule_id=sid and job_type='publish_reel' and status not in ('done','cancelled') and (locked_at is null or locked_at<now()-interval '10 minutes') order by created_at desc limit 1 for update skip locked
 ) update job_queue j set status='running',locked_at=now(),locked_by=p_worker,updated_at=now() from candidate c where j.id=c.id returning j.*;
end $$;
revoke all on function public.claim_calendar_publish_schedule(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_calendar_publish_schedule(uuid,text) to service_role;
CREATE OR REPLACE FUNCTION public.sync_calendar_pretrial_from_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    and new.platform is not distinct from old.platform
    and new.trial_video_id is not distinct from old.trial_video_id
    and new.platform_account_id is not distinct from old.platform_account_id then
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
    where linked_schedule_id=new.id and trial_kind='prepost' and status not in ('published','processing','container_created','publishing');
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
      and status not in ('published','processing','container_created','publishing');
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

  select * into v from public.videos where id=coalesce(new.trial_video_id,new.video_id);
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
      'trial_kind','prepost','true_trial_requested',true,'linked_schedule_id',new.id,'source_video_id',v.id,'main_video_id',new.video_id,'trial_video_mode',case when new.trial_video_id is null then 'same' else 'separate' end,
      'lead_minutes',lead_minutes,'normal_scheduled_at',new.scheduled_at,'bulk_1m',new.smart_mode='bulk_1m'),
    null,false,null,v.media_clean_status,v.media_clean_report,v.media_cleaned_at,v.media_clean_error,
    'prepost',new.id,v.id,true
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
    updated_at=now()
  where public.reel_test_publications.status in ('scheduled','failed','uploaded')
    and public.reel_test_publications.container_id is null
    and public.reel_test_publications.locked_at is null;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_calendar_pretrial_from_video()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    and status in ('scheduled','failed','uploaded') and container_id is null and locked_at is null;
  return new;
end;
$function$;


drop trigger if exists trg_sync_calendar_pretrial_from_schedule on public.schedules;
create trigger trg_sync_calendar_pretrial_from_schedule after insert or update of scheduled_at,status,video_id,platform,instagram_media_id,trial_video_id,platform_account_id on public.schedules for each row execute function public.sync_calendar_pretrial_from_schedule();
create or replace function public.guard_calendar_trial_video_delete() returns trigger language plpgsql set search_path=public as $$
begin
 if exists(select 1 from schedules where trial_video_id=old.id) then raise exception 'video_is_linked_calendar_trial'; end if;
 return old;
end $$;
create trigger guard_calendar_trial_video_delete before delete on public.videos for each row execute function public.guard_calendar_trial_video_delete();
CREATE OR REPLACE FUNCTION public.claim_due_trial_reels(p_worker text, p_limit integer DEFAULT 3)
 RETURNS TABLE(id uuid, user_id uuid, storage_path text, storage_provider text, file_name text, caption text, scheduled_at timestamp with time zone, status text, container_id text, attempt_count integer, max_attempts integer, graduation_strategy text, meta jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with candidates as (
    select r.id
    from public.reel_test_publications r
    where r.is_trial=true
      and r.hidden_at is null
      and r.status in ('scheduled','processing','container_created')
      and (r.container_id is not null or r.attempt_count < r.max_attempts)
      and (
        coalesce((select (value->>'enabled')::boolean from public.app_settings where key='media_cleaner'),true)=false
        or r.media_clean_status in ('ready','skipped','legacy')
      )
      and coalesce(r.next_attempt_at,r.scheduled_at,r.created_at) <= now()
      and (r.locked_at is null or r.locked_at < now()-interval '10 minutes')
    order by coalesce(r.next_attempt_at,r.scheduled_at,r.created_at) asc
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,3),10))
  ),
  claimed as (
    update public.reel_test_publications r
    set status='processing',
        attempt_count=r.attempt_count+case when r.container_id is null then 1 else 0 end,
        locked_at=now(),
        locked_by=p_worker,
        last_error=null,
        updated_at=now()
    from candidates c
    where r.id=c.id
    returning r.*
  )
  select
    c.id,c.user_id,c.storage_path,coalesce(c.storage_provider,'supabase'),c.file_name,c.caption,c.scheduled_at,c.status,
    c.container_id,c.attempt_count,c.max_attempts,c.graduation_strategy,c.meta
  from claimed c;
end;
$function$;

