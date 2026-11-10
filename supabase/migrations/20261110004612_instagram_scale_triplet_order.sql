-- Match the pilot sequence example while keeping each batch and schedule ID stable.
create or replace function public.instagram_scale_distribute()
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  pilot_id uuid;
  batch uuid;
  ids uuid[];
  total integer;
  last_block_start integer;
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
    -- Rotate each group of three. Fold a final remainder into the last group.
    last_block_start := (total / 3 - 1) * 3;
    insert into instagram_scale_deliveries(source_schedule_id, child_id, batch_id, position)
    select ranked.id, l.child_id, batch,
      block.start_at + ((ranked.n - 1 - block.start_at - l.position + width.size) % width.size) + 1
    from unnest(ids) with ordinality ranked(id, n)
    cross join lateral (select least(((ranked.n - 1) / 3) * 3, last_block_start) as start_at) block
    cross join lateral (select case when block.start_at = last_block_start then total - block.start_at else 3 end as size) width
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
