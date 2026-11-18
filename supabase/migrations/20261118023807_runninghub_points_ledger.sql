-- Append-only task identities survive retries and deletion of the video/job.
create table public.runninghub_charges (
  task_id text primary key check (task_id ~ '^[0-9]+$'),
  user_id uuid not null,
  job_id uuid not null,
  module text not null,
  started_at timestamptz not null,
  points numeric check (points >= 0),
  coins numeric check (coins >= 0),
  money numeric check (money >= 0),
  third_party_money numeric check (third_party_money >= 0),
  provider_status text,
  settled boolean not null default false,
  attempts integer not null default 0,
  checked_at timestamptz,
  next_check_at timestamptz not null default now(),
  recorded_at timestamptz not null default now()
);
create index runninghub_charges_started on public.runninghub_charges(started_at desc);
create index runninghub_charges_pending on public.runninghub_charges(next_check_at) where not settled;
alter table public.runninghub_charges enable row level security;
revoke all on public.runninghub_charges from public,anon,authenticated;
grant select,insert,update on public.runninghub_charges to service_role;

create table public.runninghub_balance (
  id boolean primary key default true check (id),
  points numeric, coins numeric, money numeric, currency text,
  fetched_at timestamptz, next_refresh_at timestamptz,
  error text
);
insert into public.runninghub_balance(id) values (true);
alter table public.runninghub_balance enable row level security;
revoke all on public.runninghub_balance from public,anon,authenticated;
grant select,update on public.runninghub_balance to service_role;

create schema if not exists cloudent_private;
revoke all on schema cloudent_private from public,anon,authenticated;
create function cloudent_private.track_runninghub_task() returns trigger
language plpgsql security definer set search_path='' as $$
declare r jsonb:=to_jsonb(new); item record;
begin
  for item in
    select r->>'task_id' as task, 'GENJUTSU V3'::text as module
      where tg_table_name='genjutsu_v3_jobs'
    union all select r->>'runninghub_task_id',
      case when tg_table_name='face_swap_jobs' then 'Face Swap'
           when r->'meta'->>'workflow_key'='genjutsu' then 'GENJUTSU legado'
           when r->'meta'->>'workflow_key'='motion_control' then 'Motion Control' else 'Produção' end
      where tg_table_name in ('face_swap_jobs','production_jobs')
    union all select r->'meta'->>'face_swap_task_id','Face Swap' where tg_table_name='face_swap_jobs'
    union all select r->'meta'->>'upscale_task_id','Upscale' where tg_table_name='face_swap_jobs'
  loop
    if item.task ~ '^[0-9]+$' then
      insert into public.runninghub_charges(task_id,user_id,job_id,module,started_at)
      values(item.task,(r->>'user_id')::uuid,(r->>'id')::uuid,item.module,
        coalesce((r->>'started_at')::timestamptz,(r->>'created_at')::timestamptz,now()))
      on conflict(task_id) do nothing;
    end if;
  end loop;
  return new;
end $$;
revoke all on function cloudent_private.track_runninghub_task() from public,anon,authenticated;
create trigger runninghub_track_v3 after insert or update of task_id on public.genjutsu_v3_jobs
  for each row execute function cloudent_private.track_runninghub_task();
create trigger runninghub_track_faces after insert or update of runninghub_task_id,meta on public.face_swap_jobs
  for each row execute function cloudent_private.track_runninghub_task();
create trigger runninghub_track_production after insert or update of runninghub_task_id on public.production_jobs
  for each row execute function cloudent_private.track_runninghub_task();

-- One bounded recovery of known tasks. Lost historical retry IDs cannot be inferred.
insert into public.runninghub_charges(task_id,user_id,job_id,module,started_at)
select task_id,user_id,id,'GENJUTSU V3',coalesce(started_at,created_at)
from public.genjutsu_v3_jobs where task_id ~ '^[0-9]+$'
on conflict do nothing;
insert into public.runninghub_charges(task_id,user_id,job_id,module,started_at)
select distinct on (task) task,user_id,id,module,coalesce(started_at,created_at) from (
 select user_id,id,started_at,created_at,runninghub_task_id as task,
 case when meta->>'workflow_key'='genjutsu' then 'GENJUTSU legado'
 when meta->>'workflow_key'='motion_control' then 'Motion Control' else 'Produção' end as module
 from public.production_jobs where created_at>=now()-interval '7 days'
 union all select user_id,id,started_at,created_at,
 coalesce(meta->>'face_swap_task_id',runninghub_task_id),'Face Swap'
 from public.face_swap_jobs where created_at>=now()-interval '7 days'
 union all select user_id,id,started_at,created_at,meta->>'upscale_task_id','Upscale'
 from public.face_swap_jobs where created_at>=now()-interval '7 days'
) s where task ~ '^[0-9]+$' on conflict do nothing;

create function public.claim_runninghub_balance() returns boolean
language sql set search_path='' as $$
 with claimed as (update public.runninghub_balance set next_refresh_at=now()+interval '60 seconds'
 where id=true and (next_refresh_at is null or next_refresh_at<=now()) returning id)
 select exists(select 1 from claimed);
$$;
create function public.claim_runninghub_charges() returns setof public.runninghub_charges
language sql set search_path='' as $$
 with claimed as (
 select task_id from public.runninghub_charges where not settled and next_check_at<=now()
 order by (module='GENJUTSU V3') desc,started_at desc limit 6 for update skip locked
 ) update public.runninghub_charges c set attempts=c.attempts+1,next_check_at=now()+interval '2 minutes'
 from claimed where c.task_id=claimed.task_id returning c.*;
$$;

create function public.runninghub_points_summary() returns jsonb
language sql stable set search_path='' as $$
with clock as (select (now() at time zone 'America/Sao_Paulo')::date as today),
ranges as (
 select 'today' as key,today::timestamp at time zone 'America/Sao_Paulo' as since,(today+1)::timestamp at time zone 'America/Sao_Paulo' as until from clock
 union all select 'yesterday',(today-1)::timestamp at time zone 'America/Sao_Paulo',today::timestamp at time zone 'America/Sao_Paulo' from clock
 union all select 'month',date_trunc('month',today)::timestamp at time zone 'America/Sao_Paulo',(today+1)::timestamp at time zone 'America/Sao_Paulo' from clock
), totals as (
 select r.key,scope.module,
 count(c.task_id) as tasks,
 count(c.task_id) filter(where not c.settled) as pending,
 case when count(c.task_id)=0 then 0 else sum(c.points) filter(where c.settled) end as points,
 sum(c.coins) filter(where c.settled) as coins
 from ranges r cross join (values ('all'),('GENJUTSU V3')) scope(module)
 left join public.runninghub_charges c on c.started_at>=r.since and c.started_at<r.until
 and (scope.module='all' or c.module=scope.module)
 group by r.key,scope.module
), modules as (
 select module,count(*) as tasks,count(*) filter(where not settled) as pending,
 sum(points) filter(where settled) as points,sum(coins) filter(where settled) as coins
 from public.runninghub_charges where started_at >= (select since from ranges where key='month')
 group by module
)
select jsonb_build_object(
 'balance',(select to_jsonb(b)-'id'-'next_refresh_at' from public.runninghub_balance b where id=true),
 'totals',(select jsonb_agg(to_jsonb(t)) from totals t),
 'modules',coalesce((select jsonb_agg(to_jsonb(m)) from modules m),'[]'::jsonb),
 'recent',coalesce((select jsonb_agg(to_jsonb(h)) from (
 select task_id,module,started_at,points,coins,settled,provider_status from public.runninghub_charges order by started_at desc limit 10) h),'[]'::jsonb),
 'timezone','America/Sao_Paulo',
 'coverage','Gastos das tarefas do Cloudent por início da execução. Histórico anterior à ativação pode estar incompleto; usos fora do Cloudent não entram nos gastos.',
 'updated_at',now());
$$;
revoke all on function public.claim_runninghub_balance() from public,anon,authenticated;
revoke all on function public.claim_runninghub_charges() from public,anon,authenticated;
revoke all on function public.runninghub_points_summary() from public,anon,authenticated;
grant execute on function public.claim_runninghub_balance(), public.claim_runninghub_charges(), public.runninghub_points_summary() to service_role;

create function public.wake_runninghub_points() returns bigint
language sql set search_path='' as $$
 select net.http_post(
 url:='https://iubzjfidmxfjvvonusos.supabase.co/functions/v1/cloudent-points?action=worker',
 headers:=jsonb_build_object('Content-Type','application/json','x-cloudent-worker-secret',public.get_cloudent_worker_secret()),
 body:='{}'::jsonb,timeout_milliseconds:=50000);
$$;
revoke all on function public.wake_runninghub_points() from public,anon,authenticated;
grant execute on function public.wake_runninghub_points() to service_role;
select cron.schedule('cloudent-runninghub-points','*/5 * * * *','select public.wake_runninghub_points()');
