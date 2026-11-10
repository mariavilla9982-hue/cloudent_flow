set local lock_timeout = '2s';

create table public.instagram_scale_links (
  mother_id uuid not null references public.platform_accounts(id),
  child_id uuid primary key references public.platform_accounts(id),
  position smallint not null check (position between 1 and 2),
  sync_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (mother_id, position),
  check (mother_id <> child_id)
);

create table public.instagram_scale_sources (
  schedule_id uuid primary key references public.schedules(id) on delete cascade,
  mother_id uuid not null references public.platform_accounts(id),
  video_id uuid not null references public.videos(id) on delete cascade,
  batch_id uuid,
  batch_position integer,
  batched_at timestamptz,
  created_at timestamptz not null default now(),
  check ((batch_id is null) = (batch_position is null)),
  unique (batch_id, batch_position)
);

create table public.instagram_scale_deliveries (
  source_schedule_id uuid not null references public.instagram_scale_sources(schedule_id) on delete cascade,
  child_id uuid not null references public.instagram_scale_links(child_id),
  batch_id uuid not null,
  position integer not null check (position > 0),
  schedule_id uuid unique references public.schedules(id),
  last_error text,
  primary key (source_schedule_id, child_id),
  unique (child_id, batch_id, position)
);
create index instagram_scale_pending_sources on public.instagram_scale_sources(mother_id, created_at, schedule_id) where batch_id is null;
create index instagram_scale_source_video on public.instagram_scale_sources(video_id);
create index instagram_scale_pending_deliveries on public.instagram_scale_deliveries(child_id, batch_id, position) where schedule_id is null;
alter table public.instagram_scale_links enable row level security;
alter table public.instagram_scale_sources enable row level security;
alter table public.instagram_scale_deliveries enable row level security;
revoke all on public.instagram_scale_links, public.instagram_scale_sources, public.instagram_scale_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.instagram_scale_links, public.instagram_scale_sources, public.instagram_scale_deliveries to service_role;

alter table public.schedules add column instagram_scale_caption text;

-- Only the identified production account is eligible to start the pilot.
insert into public.app_settings(key, value)
select 'instagram_scale_pilot', jsonb_build_object('mother_id', a.id)
from public.platform_accounts a
where a.platform = 'instagram' and lower(a.account_label) = 'jujuhmartinss'
  and a.workspace_id is not null and not exists (
    select 1 from public.platform_accounts other
    where other.id <> a.id and other.platform = 'instagram' and lower(other.account_label) = 'jujuhmartinss'
  )
on conflict (key) do nothing;

create function public.instagram_scale_accounts(p_actor uuid)
returns setof public.platform_accounts
language sql stable set search_path = public, pg_temp as $$
  select a.*
  from app_members m cross join platform_accounts a
  where m.user_id = p_actor and m.enabled and m.role = 'admin' and m.workspace_id is not null
    and a.platform = 'instagram'
    and (a.workspace_id = m.workspace_id or
      (a.workspace_id is null and (a.owner_user_id = p_actor or
        (a.owner_user_id is null and (select count(*) from workspaces) = 1))))
$$;

-- Reuse the official connection and Vault, with account and relationship committed together.
create function public.instagram_scale_connect(
  p_actor uuid, p_external_id text, p_username text, p_config jsonb, p_token text,
  p_reconnect_id uuid, p_mother_id uuid
)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare
  account platform_accounts%rowtype;
  mother platform_accounts%rowtype;
  member_workspace uuid;
  slot smallint;
  policy jsonb;
  account_id uuid;
begin
  select workspace_id into member_workspace from app_members
  where user_id = p_actor and enabled and role = 'admin' for share;
  if member_workspace is null then raise exception 'instagram_scope_denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended('instagram-scale:' || member_workspace, 0));

  select * into account from platform_accounts
  where platform = 'instagram' and external_account_id = p_external_id for update;
  if p_reconnect_id is not null and account.id is distinct from p_reconnect_id then
    raise exception 'reconnect_account_mismatch';
  end if;
  if account.id is not null and not exists (select 1 from instagram_scale_accounts(p_actor) a where a.id = account.id) then
    raise exception 'instagram_scope_denied';
  end if;
  if p_reconnect_id is null and p_mother_id is null and account.id is not null then
    raise exception 'instagram_already_connected';
  end if;

  if p_mother_id is not null then
    select * into mother from instagram_scale_accounts(p_actor)
    where id = p_mother_id and enabled and workspace_id = member_workspace;
    if mother.id is null or not exists (
      select 1 from app_settings where key = 'instagram_scale_pilot' and value->>'mother_id' = mother.id::text
    ) then raise exception 'instagram_mother_unavailable'; end if;
    if account.id = mother.id or exists (select 1 from instagram_scale_links where child_id = account.id or mother_id = account.id) then
      raise exception 'instagram_already_linked';
    end if;
    -- A pilot child is a new connection. Existing calendars keep their integration rules.
    if account.id is not null then raise exception 'instagram_already_connected'; end if;
    select n into slot from generate_series(1, 2) n where not exists (
      select 1 from instagram_scale_links where mother_id = mother.id and position = n
    ) order by n limit 1;
    if slot is null then raise exception 'instagram_daughter_limit'; end if;
    policy := mother.config->'calendar_policy';
    if policy->>'enabled' is distinct from 'true' or policy->>'locked' is distinct from 'true'
      or jsonb_typeof(policy->'times') is distinct from 'array' or jsonb_array_length(policy->'times') = 0 then
      policy := '{"enabled":true,"locked":true,"timezone":"America/Sao_Paulo","times":["07:30","10:00","13:00","16:00","18:30"]}'::jsonb;
    end if;
    p_config := p_config || jsonb_build_object('calendar_policy', policy, 'scale_pilot_child', true);
  end if;

  if account.id is null then
    insert into platform_accounts(platform, external_account_id, account_label, enabled, config, workspace_id, owner_user_id)
    values ('instagram', p_external_id, p_username, true, p_config, member_workspace, p_actor)
    returning id into account_id;
  else
    update platform_accounts set enabled = true, account_label = p_username,
      config = (coalesce(account.config, '{}'::jsonb) - 'disconnected_at' - 'disconnected_by' - 'disconnected_reason') || p_config,
      updated_at = now()
    where id = account.id returning id into account_id;
  end if;

  perform set_instagram_page_token_for_account(account_id, p_token);
  if p_mother_id is not null then
    insert into instagram_scale_links(mother_id, child_id, position) values (p_mother_id, account_id, slot);
  end if;
  return account_id;
end $$;

-- An Instagram account's workspace remains the security boundary. The pilot has two child slots.
create or replace function public.enforce_instagram_account_limit()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.platform = 'instagram' and new.enabled and new.workspace_id is null
    and not exists (select 1 from platform_accounts a where a.id = new.id and a.platform = 'instagram' and a.enabled)
    and (select count(*) from platform_accounts a where a.platform = 'instagram' and a.enabled
      and a.id <> new.id and a.external_account_id is distinct from new.external_account_id) >= 3 then
    raise exception 'instagram account limit reached (3)';
  end if;
  return new;
end $$;

create function public.instagram_scale_capture()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.platform = 'instagram' and new.status in ('scheduled', 'queued')
    and new.video_id is not null
    and exists (select 1 from app_settings where key = 'instagram_scale_pilot' and value->>'mother_id' = new.platform_account_id::text)
    and (select count(*) from instagram_scale_links where mother_id = new.platform_account_id) = 2 then
    insert into instagram_scale_sources(schedule_id, mother_id, video_id)
    values (new.id, new.platform_account_id, new.video_id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger trg_instagram_scale_capture after insert on public.schedules
for each row execute function public.instagram_scale_capture();

create function public.instagram_scale_media_pending(p_video_id uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from instagram_scale_sources src join schedules s on s.id = src.schedule_id
    where src.video_id = p_video_id and (
      (src.batch_id is null and s.status <> 'cancelled') or exists (
        select 1 from instagram_scale_deliveries d
        where d.source_schedule_id = src.schedule_id and d.schedule_id is null
      )
    )
  )
$$;

create function public.instagram_scale_cancel(p_schedule_id uuid, p_actor uuid)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare s schedules%rowtype;
begin
  if not exists (select 1 from instagram_scale_sources where schedule_id = p_schedule_id)
    and not exists (select 1 from schedules slot join instagram_scale_links l on l.child_id=slot.platform_account_id where slot.id=p_schedule_id) then
    return false;
  end if;
  select * into s from schedules where id = p_schedule_id for update;
  if not found or not exists (select 1 from instagram_scale_accounts(p_actor) where id = s.platform_account_id) then
    raise exception 'instagram_scope_denied';
  end if;
  if s.status = 'published' or s.instagram_media_id is not null or exists (
    select 1 from job_queue j where j.schedule_id = s.id and j.job_type = 'publish_reel'
      and (j.locked_at >= now() - interval '10 minutes' or j.payload ? 'publish_started_at')
  ) then raise exception 'instagram_publication_started'; end if;
  update schedules set status = 'cancelled' where id = s.id;
  update job_queue set status = 'cancelled', locked_at = null, locked_by = null
    where schedule_id = s.id and status in ('pending', 'running', 'failed');
  return true;
end $$;

-- Keep the same media row and let the existing retention system see all three schedules.
-- A batch rotates the chronological mother order by each daughter's stable position.
create function public.instagram_scale_distribute()
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  pilot_id uuid;
  batch uuid;
  ids uuid[];
  total integer;
  link record;
  item record;
  start_at timestamptz;
  slot_at timestamptz;
  zone text;
  times jsonb;
  child_schedule uuid;
  placed integer := 0;
  child_placed integer;
begin
  select (value->>'mother_id')::uuid into pilot_id from app_settings where key = 'instagram_scale_pilot';
  if pilot_id is null or not pg_try_advisory_xact_lock(hashtextextended('instagram-scale-distribution:' || pilot_id, 0))
    or (select count(*) from instagram_scale_links where mother_id = pilot_id) <> 2 then
    return jsonb_build_object('placed', 0);
  end if;

  select array_agg(candidate.id order by candidate.scheduled_at, candidate.id) into ids from (
    select one.id, one.scheduled_at from (
      select distinct on (s.video_id) s.id, s.scheduled_at
      from instagram_scale_sources src join schedules s on s.id = src.schedule_id
      where src.mother_id = pilot_id and src.batch_id is null and s.status <> 'cancelled'
        and exists (select 1 from job_queue j where j.schedule_id = s.id and j.job_type = 'publish_reel' and j.status <> 'cancelled')
      order by s.video_id, s.scheduled_at, s.id
    ) one order by one.scheduled_at, one.id limit 60
  ) candidate;
  total := coalesce(cardinality(ids), 0);
  if total >= 3 then
    batch := gen_random_uuid();
    update instagram_scale_sources src set batch_id = batch, batch_position = ranked.n, batched_at = statement_timestamp()
    from unnest(ids) with ordinality ranked(id, n) where src.schedule_id = ranked.id;
    insert into instagram_scale_deliveries(source_schedule_id, child_id, batch_id, position)
    select ranked.id, l.child_id, batch, ((ranked.n - 1 - l.position + total) % total) + 1
    from unnest(ids) with ordinality ranked(id, n)
    cross join instagram_scale_links l where l.mother_id = pilot_id;
  end if;

  for link in
    select l.*, a.config from instagram_scale_links l join platform_accounts a on a.id = l.child_id
    where l.mother_id = pilot_id and l.sync_enabled and a.enabled order by l.position
  loop
    child_placed := 0;
    begin
      -- Serialize insertion with other manual and derived slots through the existing policy trigger.
      zone := coalesce(link.config->'calendar_policy'->>'timezone', 'America/Sao_Paulo');
      times := link.config->'calendar_policy'->'times';
      select greatest(now() + interval '2 minutes', max(s.scheduled_at) + interval '1 minute') into start_at
      from schedules s join instagram_scale_deliveries d on d.schedule_id = s.id
      where d.child_id = link.child_id and s.status <> 'cancelled';

      for item in
        select d.source_schedule_id, src.video_id, v.caption, v.storage_deleted_at, v.storage_provider
        from instagram_scale_deliveries d
        join instagram_scale_sources src on src.schedule_id = d.source_schedule_id
        join videos v on v.id = src.video_id
        join lateral (select min(batched_at) queued_at from instagram_scale_sources where batch_id = d.batch_id) b on true
        where d.child_id = link.child_id and d.schedule_id is null
        order by b.queued_at, d.batch_id, d.position limit 20
      loop
        if item.storage_deleted_at is not null or item.storage_provider <> 'r2' then
          update instagram_scale_deliveries set last_error = 'media_unavailable'
          where child_id = link.child_id and source_schedule_id = item.source_schedule_id and last_error is distinct from 'media_unavailable';
          exit;
        end if;
        select candidate.at into slot_at
        from generate_series(0, 30) as day_offset
        cross join jsonb_array_elements_text(times) as t
        cross join lateral (select (((start_at at time zone zone)::date + day_offset) + t::time) at time zone zone as at) candidate
        where candidate.at >= start_at and not exists (
          select 1 from schedules s where s.platform_account_id = link.child_id and s.scheduled_at = candidate.at and s.status <> 'cancelled'
        ) and (
          select count(*) from schedules s
          where s.platform_account_id=link.child_id and s.status<>'cancelled'
            and s.scheduled_at>=((candidate.at at time zone zone)::date::timestamp at time zone zone)
            and s.scheduled_at<(((candidate.at at time zone zone)::date+1)::timestamp at time zone zone)
        )<jsonb_array_length(times)
        order by candidate.at limit 1;
        if slot_at is null then
          update instagram_scale_deliveries set last_error = 'no_available_slot'
          where child_id = link.child_id and source_schedule_id = item.source_schedule_id and last_error is distinct from 'no_available_slot';
          exit;
        end if;
        insert into schedules(video_id, scheduled_at, status, smart_mode, smart_strategy, smart_strategy_locked,
          platform, platform_account_id, instagram_scale_caption)
        values (item.video_id, slot_at, 'scheduled', 'manual', 'manual', true, 'instagram', link.child_id, coalesce(item.caption, ''))
        returning id into child_schedule;
        insert into job_queue(job_type, schedule_id, platform, platform_account_id, run_at, payload)
        values ('publish_reel', child_schedule, 'instagram', link.child_id, slot_at,
          jsonb_build_object('schedule_id', child_schedule, 'scale_source_schedule_id', item.source_schedule_id));
        update instagram_scale_deliveries set schedule_id = child_schedule, last_error = null
        where child_id = link.child_id and source_schedule_id = item.source_schedule_id;
        start_at := slot_at + interval '1 minute';
        child_placed := child_placed + 1;
      end loop;
      placed := placed + child_placed;
    exception when integrity_constraint_violation or data_exception then
      -- A concurrent manual slot or invalid account policy rolls back only this daughter's reservations.
      update instagram_scale_deliveries set last_error = 'calendar_reservation_failed'
      where child_id = link.child_id and schedule_id is null and last_error is distinct from 'calendar_reservation_failed';
    end;
  end loop;
  return jsonb_build_object('placed', placed, 'batch_id', batch);
end $$;

revoke all on function public.instagram_scale_accounts(uuid),
  public.instagram_scale_connect(uuid,text,text,jsonb,text,uuid,uuid),
  public.instagram_scale_capture(), public.instagram_scale_media_pending(uuid),
  public.instagram_scale_cancel(uuid,uuid), public.instagram_scale_distribute()
  from public, anon, authenticated;
grant execute on function public.instagram_scale_accounts(uuid),
  public.instagram_scale_connect(uuid,text,text,jsonb,text,uuid,uuid),
  public.instagram_scale_capture(), public.instagram_scale_media_pending(uuid),
  public.instagram_scale_cancel(uuid,uuid), public.instagram_scale_distribute() to service_role;

-- A child account receives regular Reels only. Keep the existing Trial trigger body for other accounts.

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
  if exists (select 1 from public.instagram_scale_links where child_id = new.platform_account_id) then
    return new;
  end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_instagram_caption_on_schedule_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.platform='instagram' and new.instagram_scale_caption is null then
    update public.videos
    set caption=public.pick_instagram_calendar_caption(),
        updated_at=now()
    where id=new.video_id
      and not public.is_instagram_calendar_caption(caption);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_calendar_publish_schedule(p_schedule_id uuid, p_worker text)
 RETURNS SETOF job_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare sid uuid; child uuid;
begin
 select id into sid from schedules where id=p_schedule_id and platform='instagram' and status in ('scheduled','queued','processing','failed') and instagram_media_id is null and scheduled_at<=now() for update skip locked;
 if sid is null then return; end if;
 select l.child_id into child from schedules s join instagram_scale_links l on l.child_id=s.platform_account_id where s.id=sid;
 if child is not null then
   -- The claim lock serializes the cap check; row leases survive an interrupted worker.
   if not pg_try_advisory_xact_lock(hashtextextended('instagram-scale-publish',0)) then return; end if;
   if not exists (
     select 1 from platform_accounts a where a.id=child and a.enabled
       and a.config->>'status' is distinct from 'reconnect_required'
       and coalesce((a.config->>'token_expires_at')::timestamptz, 'infinity') > now()
   ) then return; end if;
   if exists (
     select 1 from job_queue where platform_account_id=child and job_type='publish_reel'
       and status='running' and locked_at>=now()-interval '10 minutes'
   ) or 2 <= (
     select count(*) from job_queue j join instagram_scale_links l on l.child_id=j.platform_account_id
     where j.job_type='publish_reel' and j.status='running' and j.locked_at>=now()-interval '10 minutes'
   ) then return; end if;
 end if;
 return query with candidate as (
 select id from job_queue where schedule_id=sid and job_type='publish_reel' and status not in ('done','cancelled') and (
   child is null or (
     run_at<=now() and (attempts<max_attempts or payload ? 'instagram_media_id' or (status='running' and payload ? 'container_id'))
       and not (payload ? 'publish_started_at' and not payload ? 'instagram_media_id' and status='failed')
   )
 ) and (locked_at is null or locked_at<now()-interval '10 minutes') order by created_at desc limit 1 for update skip locked
 ) update job_queue j set status='running',locked_at=now(),locked_by=p_worker,updated_at=now() from candidate c where j.id=c.id returning j.*;
end $function$
;

create function public.instagram_scale_due(p_child uuid)
returns table(id uuid) language sql stable set search_path = public, pg_temp as $$
  select candidate.id from (
    select s.id, j.run_at, j.locked_at from schedules s
    join instagram_scale_links l on l.child_id = s.platform_account_id
    join platform_accounts a on a.id = l.child_id
    join lateral (
      select j.* from job_queue j
      where j.schedule_id = s.id and j.job_type = 'publish_reel' and j.status not in ('done', 'cancelled')
      order by j.created_at desc limit 1
    ) j on true
    where l.child_id = p_child and a.enabled
      and a.config->>'status' is distinct from 'reconnect_required'
      and coalesce((a.config->>'token_expires_at')::timestamptz, 'infinity') > now()
      and s.platform = 'instagram' and s.status in ('scheduled','queued','processing','failed')
      and s.instagram_media_id is null and s.scheduled_at <= now()
      and (j.attempts < j.max_attempts or j.payload ? 'instagram_media_id' or (j.status='running' and j.payload ? 'container_id'))
      and not (j.payload ? 'publish_started_at' and not j.payload ? 'instagram_media_id' and j.status = 'failed')
    order by s.scheduled_at, s.id
    limit 1
  ) candidate where candidate.run_at <= now()
    and (candidate.locked_at is null or candidate.locked_at < now() - interval '10 minutes')

$$;

create function public.instagram_scale_edit_schedule(p_schedule_id uuid, p_actor uuid, p_scheduled_at timestamptz, p_retry boolean)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare s schedules%rowtype; j job_queue%rowtype;
begin
  select * into s from schedules where id = p_schedule_id for update;
  if not found or not exists (select 1 from instagram_scale_links where child_id = s.platform_account_id) then return false; end if;
  if not exists (select 1 from instagram_scale_accounts(p_actor) where id = s.platform_account_id and enabled) then
    raise exception 'instagram_scope_denied';
  end if;
  if s.instagram_media_id is not null or s.status in ('published','cancelled','processing') then
    raise exception 'instagram_publication_started';
  end if;
  select * into j from job_queue where schedule_id = s.id and job_type = 'publish_reel'
    and status not in ('done','cancelled') order by created_at desc limit 1 for update;
  if not found or j.payload ? 'publish_started_at' or (not p_retry and j.payload ? 'container_id')
    or j.locked_at >= now() - interval '10 minutes' then
    raise exception 'instagram_publication_started';
  end if;
  if p_retry then
    if j.status <> 'failed' or s.status <> 'failed' then raise exception 'instagram_retry_requires_failure'; end if;
    update job_queue set status='pending', attempts=0, last_error=null, locked_at=null, locked_by=null,
      run_at=greatest(now(),s.scheduled_at) where id=j.id;
    update schedules set status='scheduled', attempt_count=0, last_error=null where id=s.id;
    delete from app_settings where key='calendar_media_block_'||s.id;
  elsif p_scheduled_at is not null and p_scheduled_at is distinct from s.scheduled_at then
    if s.status not in ('scheduled','queued') or p_scheduled_at <= now() then
      raise exception 'instagram_slot_change_unavailable';
    end if;
    -- A deliberate edit may change the timestamp while retaining the allocated sequence.
    if s.instagram_scale_caption is not null and exists (
      select 1 from schedules other join instagram_scale_deliveries d on d.schedule_id=other.id
      where d.child_id=s.platform_account_id and other.id<>s.id and other.status<>'cancelled'
        and (other.scheduled_at between least(s.scheduled_at,p_scheduled_at) and greatest(s.scheduled_at,p_scheduled_at))
    ) then raise exception 'instagram_scale_order_conflict'; end if;
    update schedules set scheduled_at=p_scheduled_at where id=s.id;
    update job_queue set run_at=p_scheduled_at where id=j.id;
  end if;
  return true;
end $$;

create function public.instagram_scale_summary(p_actor uuid, p_from timestamptz, p_until timestamptz)
returns table (
  id uuid, account_label text, connection_status text, enabled boolean, mother_id uuid,
  child_position smallint, sync_enabled boolean, calendar_policy jsonb, scheduled bigint,
  published bigint, failed bigint, views numeric, waiting_for_batch bigint, pending bigint, sync_error text
) language sql stable set search_path = public, pg_temp as $$
  select a.id, a.account_label,
    case when not a.enabled then 'disconnected'
      when a.config->>'status'='reconnect_required'
        or coalesce((a.config->>'token_expires_at')::timestamptz,'infinity') <= now()
        or not coalesce(has_instagram_page_token_for_account(a.id),false) then 'reconnect_required'
      else 'connected' end,
    a.enabled, l.mother_id,
    case when pilot.value->>'mother_id'=a.id::text then 0::smallint else l.position end,
    l.sync_enabled, a.config->'calendar_policy',
    coalesce(q.scheduled,0), coalesce(q.published,0), coalesce(q.failed,0), m.views,
    coalesce(w.n,0), coalesce(d.n,0), d.error
  from instagram_scale_accounts(p_actor) a
  left join instagram_scale_links l on l.child_id=a.id
  left join app_settings pilot on pilot.key='instagram_scale_pilot'
  left join lateral (
    select count(*) filter (where s.status in ('scheduled','queued','processing')) as scheduled,
      count(*) filter (where s.status='published' and s.published_at>=p_from and s.published_at<p_until) as published,
      count(*) filter (where s.status='failed' and s.scheduled_at>=p_from and s.scheduled_at<p_until) as failed
    from schedules s where s.platform_account_id=a.id and s.platform='instagram' and s.status<>'cancelled'
      and (s.status in ('scheduled','queued','processing') or (s.status='published' and s.published_at>=p_from and s.published_at<p_until)
        or (s.status='failed' and s.scheduled_at>=p_from and s.scheduled_at<p_until))
  ) q on true
  left join lateral (
    select sum(metrics.views) views from latest_instagram_metrics metrics where metrics.platform_account_id=a.id
      and metrics.media_product_type='REELS' and metrics.posted_at>=p_from and metrics.posted_at<p_until
  ) m on true
  left join lateral (
    select count(*) n from instagram_scale_sources src join schedules s on s.id=src.schedule_id
    where src.mother_id=a.id and src.batch_id is null and s.status<>'cancelled'
  ) w on true
  left join lateral (
    select count(*) n,max(last_error) error from instagram_scale_deliveries d
    where d.child_id=a.id and d.schedule_id is null
  ) d on true
  order by a.created_at, a.id
$$;

revoke all on function public.instagram_scale_due(uuid),
  public.instagram_scale_edit_schedule(uuid,uuid,timestamptz,boolean),
  public.instagram_scale_summary(uuid,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.instagram_scale_due(uuid),
  public.instagram_scale_edit_schedule(uuid,uuid,timestamptz,boolean),
  public.instagram_scale_summary(uuid,timestamptz,timestamptz) to service_role;

create function public.instagram_scale_finish(p_job uuid, p_worker text, p_payload jsonb)
returns void language plpgsql set search_path = public, pg_temp as $$
declare j job_queue%rowtype; media_id text; published timestamptz;
begin
  select * into j from job_queue where id=p_job and locked_by=p_worker and job_type='publish_reel' for update;
  media_id := p_payload->>'instagram_media_id';
  published := (p_payload->>'published_at')::timestamptz;
  if j.id is null or media_id is null or media_id is distinct from j.payload->>'instagram_media_id' or published is null
    or not exists (select 1 from instagram_scale_links where child_id=j.platform_account_id) then
    raise exception 'instagram_scale_receipt_missing';
  end if;
  update schedules set status='published', instagram_media_id=media_id, published_at=published, last_error=null
    where id=j.schedule_id and instagram_media_id is null;
  if not found then raise exception 'instagram_scale_schedule_changed'; end if;
  update job_queue set status='done', payload=p_payload, last_error=null, locked_at=null, locked_by=null where id=j.id;
  insert into job_queue(job_type, schedule_id, platform, platform_account_id, run_at, max_attempts, payload)
  select 'collect_metrics', j.schedule_id, 'instagram', j.platform_account_id,
    greatest(now(), published + interval '30 minutes'), 10, '{"metrics_stage":0}'
  where not exists (select 1 from job_queue q where q.schedule_id=j.schedule_id and q.job_type='collect_metrics');
end $$;
revoke all on function public.instagram_scale_finish(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.instagram_scale_finish(uuid,text,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.claim_due_publish_jobs(p_worker text, p_limit integer DEFAULT 3)
 RETURNS TABLE(job_id uuid, schedule_id uuid, run_at timestamp with time zone, attempts integer, max_attempts integer, payload jsonb, video_id uuid, storage_path text, storage_provider text, file_name text, caption text, schedule_status text, instagram_media_id text, platform_account_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.job_queue j
  set status='done',locked_at=null,locked_by=null,updated_at=now()
  from public.schedules s
  where j.schedule_id=s.id
    and j.job_type='publish_reel'
    and j.status in ('pending','running')
    and (s.status='published' or s.instagram_media_id is not null);

  update public.job_queue j
  set status='cancelled',locked_at=null,locked_by=null,updated_at=now()
  from public.schedules s
  where j.schedule_id=s.id
    and j.job_type='publish_reel'
    and j.status in ('pending','running')
    and s.status='cancelled';

  return query
  with candidates as (
    select j.id
    from public.job_queue j
    join public.schedules s on s.id=j.schedule_id
    join public.videos v on v.id=s.video_id
    join public.platform_accounts pa on pa.id=s.platform_account_id
    where j.job_type='publish_reel'
      and j.attempts < j.max_attempts
      and s.instagram_media_id is null
      and s.platform_account_id is not null
      and pa.platform='instagram'
      and pa.enabled=true
      and not exists (select 1 from public.instagram_scale_links l where l.child_id=pa.id)
      and coalesce(v.storage_provider,'supabase')='r2'
      and s.status in ('scheduled','queued','processing','failed')
      and (
        coalesce((select (value->>'enabled')::boolean from public.app_settings where key='media_cleaner'),true)=false
        or v.media_clean_status in ('ready','skipped','legacy')
      )
      and (
        (j.status='pending' and j.run_at <= now())
        or (j.status='running' and j.locked_at < now()-interval '10 minutes')
      )
    order by j.run_at asc
    for update of j skip locked
    limit greatest(1,least(coalesce(p_limit,3),10))
  ),
  claimed as (
    update public.job_queue j
    set status='running',
        attempts=j.attempts+1,
        locked_at=now(),
        locked_by=p_worker,
        last_error=null,
        updated_at=now()
    from candidates c
    where j.id=c.id
    returning j.*
  )
  select
    c.id,c.schedule_id,c.run_at,c.attempts,c.max_attempts,c.payload,
    s.video_id,v.storage_path,coalesce(v.storage_provider,'supabase'),v.file_name,coalesce(v.caption,''),
    s.status,s.instagram_media_id,s.platform_account_id
  from claimed c
  join public.schedules s on s.id=c.schedule_id
  join public.videos v on v.id=s.video_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_calendar_trial_video(p_schedule_id uuid, p_video_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s public.schedules%rowtype; v public.videos%rowtype; t public.reel_test_publications%rowtype; workspace uuid;
begin
 select workspace_id into workspace from app_members where user_id=p_actor and enabled and role='admin';
 if workspace is null then raise exception 'forbidden'; end if;
 select * into s from schedules where id=p_schedule_id for update;
 if not found or s.platform<>'instagram' or not exists(select 1 from platform_accounts where id=s.platform_account_id and workspace_id=workspace and platform='instagram' and enabled) then raise exception 'schedule_account_unavailable'; end if;
 if exists (select 1 from instagram_scale_links where child_id=s.platform_account_id) then
   raise exception 'instagram_scale_trial_unavailable';
 end if;
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
end $function$
;
