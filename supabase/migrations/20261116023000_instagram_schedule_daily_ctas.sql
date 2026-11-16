alter table public.schedules add column instagram_calendar_caption text;

create unique index schedules_instagram_caption_per_day
on public.schedules (
  platform_account_id,
  ((scheduled_at at time zone 'America/Sao_Paulo')::date),
  instagram_calendar_caption
)
where platform = 'instagram' and status <> 'cancelled' and instagram_calendar_caption <> '';

insert into public.app_settings (key, value)
select 'instagram_calendar_ctas', jsonb_build_object(
  'workspace_id', value->>'workspace_id',
  'captions', jsonb_build_array(
    'Eu ia me comportar hoje… aí abri os Stories. 😏',
    'Esse foi meu lado comportado. O outro tá nos Stories.',
    'Se esse olhar te fez parar, clica na minha foto.',
    'Aqui eu fiz charme. Nos Stories eu exagerei um pouquinho.',
    'O vídeo acabou bem na hora que eu perdi a pose. Continua nos Stories.',
    'Eu sei que você reparou. Vai nos Stories e me diz no quê. 😌',
    'Se eu piscar nos Stories, você finge que foi coincidência? 😉'
  )
)
from public.app_settings
where key = 'instagram_calendar_captions' and value->>'workspace_id' is not null
on conflict (key) do nothing;

create function public.assign_instagram_schedule_caption() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  local_day date;
  pool jsonb;
  chosen text;
begin
  if new.platform <> 'instagram' or new.status = 'cancelled'
    or new.published_at is not null or new.instagram_media_id is not null then
    return new;
  end if;

  local_day := (new.scheduled_at at time zone 'America/Sao_Paulo')::date;
  if tg_op = 'UPDATE' then
    if old.instagram_calendar_caption is null or old.published_at is not null
      or old.instagram_media_id is not null
      or (old.status <> 'cancelled' and
          local_day = (old.scheduled_at at time zone 'America/Sao_Paulo')::date) then
      return new;
    end if;
  end if;

  select setting.value->'captions' into pool
  from public.app_settings setting
  join public.platform_accounts account on account.id = new.platform_account_id
  where setting.key = 'instagram_calendar_ctas'
    and (
      account.workspace_id::text = setting.value->>'workspace_id'
      or (account.workspace_id is null and lower(ltrim(account.account_label, '@')) = 'sahryjapah')
    );

  if jsonb_typeof(pool) is distinct from 'array' then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'instagram-calendar-caption:' || new.platform_account_id::text || ':' || local_day::text, 0
  ));

  select candidate.caption into chosen
  from (select distinct caption from jsonb_array_elements_text(pool) as entry(caption)) candidate
  where length(btrim(candidate.caption)) between 1 and 2200
    and not exists (
      select 1 from public.schedules existing
      where existing.platform_account_id = new.platform_account_id
        and existing.platform = 'instagram'
        and existing.status <> 'cancelled'
        and existing.id <> new.id
        and (existing.scheduled_at at time zone 'America/Sao_Paulo')::date = local_day
        and existing.instagram_calendar_caption <> ''
        and existing.instagram_calendar_caption = candidate.caption
    )
  order by random()
  limit 1;

  new.instagram_calendar_caption := coalesce(chosen, '');
  return new;
end;
$$;

revoke all on function public.assign_instagram_schedule_caption() from public, anon, authenticated;
create trigger trg_instagram_schedule_caption
before insert or update of scheduled_at, status on public.schedules
for each row execute function public.assign_instagram_schedule_caption();

create or replace function public.ensure_instagram_caption_on_schedule_insert() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.platform = 'instagram' and new.instagram_scale_caption is null
    and new.instagram_calendar_caption is null then
    update public.videos
    set caption = public.pick_instagram_calendar_caption(), updated_at = now()
    where id = new.video_id and not public.is_instagram_calendar_caption(caption);
  end if;
  return new;
end;
$$;
