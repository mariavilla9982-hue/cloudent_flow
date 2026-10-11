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
$function$;

-- Stop retries only for failures observed in the API logs; retain the actual cause.
with latest as (
 select distinct on (meta->>'trial_publication_id') meta->>'trial_publication_id' as trial_id,message
 from public.activity_logs where event_type='trial_reel_publish_error'
 order by meta->>'trial_publication_id',created_at desc
), blocked as (
 select trial_id,message,case
 when message ~* 'Error validating access token|session has been invalidated|invalid.*access token|access token.*expired' then 'instagram_reconnect_required'
 when message ~* 'requisito de seguidores|follower.*(requirement|threshold)|not eligible.*trial' then 'trial_not_eligible'
 end as reason from latest
)
update public.reel_test_publications t set status='failed',next_attempt_at=null,locked_at=null,locked_by=null,
 last_error=b.message,meta=coalesce(t.meta,'{}'::jsonb)||jsonb_build_object('failure_reason',b.reason,'retry_blocked',true),updated_at=now()
from blocked b where b.trial_id=t.id::text and b.reason is not null
and t.status in ('scheduled','failed') and t.instagram_media_id is null and t.published_at is null;

