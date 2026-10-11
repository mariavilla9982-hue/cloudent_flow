-- Keep schedules_unique_slot(platform_account_id, scheduled_at) unchanged.
create or replace function public.enforce_calendar_account_binding()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.platform = 'instagram' then
    if new.platform_account_id is null then
      raise exception 'instagram_account_required' using errcode='23514';
    end if;
    if tg_op='UPDATE' and old.platform_account_id is distinct from new.platform_account_id then
      raise exception 'schedule_account_immutable' using errcode='23514';
    end if;
    if tg_op='INSERT' then
      if not exists(select 1 from public.platform_accounts a where a.id=new.platform_account_id and a.platform='instagram' and a.enabled) then
        raise exception 'instagram_account_unavailable' using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_calendar_account_binding before insert or update on public.schedules
for each row execute function public.enforce_calendar_account_binding();

create or replace function public.bind_job_to_schedule_account()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare s public.schedules%rowtype;
begin
  if new.schedule_id is null then return new; end if;
  select * into s from public.schedules where id=new.schedule_id;
  if not found then raise exception 'schedule_not_found' using errcode='23503'; end if;
  if new.platform_account_id is not null and new.platform_account_id is distinct from s.platform_account_id then
    raise exception 'job_schedule_account_mismatch' using errcode='23514';
  end if;
  new.platform_account_id:=s.platform_account_id;
  new.platform:=s.platform;
  return new;
end $$;
create trigger trg_job_schedule_account_binding before insert or update of schedule_id, platform_account_id, platform on public.job_queue
for each row execute function public.bind_job_to_schedule_account();

create or replace function public.bind_calendar_pretrial_account()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare account_id uuid;
begin
  if new.trial_kind<>'prepost' or new.linked_schedule_id is null then return new; end if;
  select s.platform_account_id into account_id from public.schedules s where s.id=new.linked_schedule_id;
  if account_id is null then raise exception 'pretrial_schedule_account_required' using errcode='23514'; end if;
  if tg_op='UPDATE' and old.status in ('published','processing','container_created') then
    if old.meta->>'platform_account_id' is not null and old.meta->>'platform_account_id'<>account_id::text then
      raise exception 'pretrial_account_mismatch' using errcode='23514';
    end if;
  end if;
  new.meta:=coalesce(new.meta,'{}'::jsonb)||jsonb_build_object('platform_account_id',account_id);
  return new;
end $$;
create trigger trg_calendar_pretrial_account_binding before insert or update of linked_schedule_id, meta on public.reel_test_publications
for each row execute function public.bind_calendar_pretrial_account();

update public.job_queue j set platform_account_id=s.platform_account_id,platform=s.platform
from public.schedules s where s.id=j.schedule_id and j.status='pending'
and (j.platform_account_id is distinct from s.platform_account_id or j.platform is distinct from s.platform);
update public.reel_test_publications t set meta=coalesce(t.meta,'{}'::jsonb)||jsonb_build_object('platform_account_id',s.platform_account_id)
from public.schedules s where s.id=t.linked_schedule_id and t.trial_kind='prepost'
and t.status not in ('published','processing','container_created') and s.platform_account_id is not null
and (t.meta->>'platform_account_id') is distinct from s.platform_account_id::text;

