create table public.genjutsu_v3_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  status text not null default 'draft' check (status in ('draft','queued','dispatching','running','ready','failed','review')),
  video_bytes integer not null,
  image_bytes integer not null,
  video_type text not null,
  image_type text not null,
  task_id text unique,
  started_at timestamptz,
  provider_finished_at timestamptz,
  outputs jsonb not null default '{}',
  error text,
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.genjutsu_v3_jobs enable row level security;
revoke all on public.genjutsu_v3_jobs from public, anon, authenticated;
grant select,insert,update on public.genjutsu_v3_jobs to service_role;
create index genjutsu_v3_jobs_user_created_idx on public.genjutsu_v3_jobs(user_id,created_at desc);
create index genjutsu_v3_jobs_active_idx on public.genjutsu_v3_jobs(status,created_at) where status in ('queued','dispatching','running');

create function public.claim_genjutsu_v3_job(p_lease uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare job public.genjutsu_v3_jobs;
begin
  perform pg_advisory_xact_lock(hashtextextended('cloudent-genjutsu-v3',0));
  update public.genjutsu_v3_jobs set status='review',
    error='Envio sem confirmação. Confira a tarefa no RunningHub antes de repetir.',
    updated_at=now(),lease_id=null,lease_until=null
  where status='dispatching' and lease_until<=now();
  if exists(select 1 from public.genjutsu_v3_jobs where status='dispatching') then return null; end if;
  select * into job from public.genjutsu_v3_jobs where status='running' order by created_at limit 1 for update;
  if found and job.lease_until>now() then return null; end if;
  if not found then
    if exists(select 1 from public.genjutsu_v3_jobs where status='review') then return null; end if;
    select * into job from public.genjutsu_v3_jobs where status='queued' order by created_at limit 1 for update;
  end if;
  if job.id is null then return null; end if;
  update public.genjutsu_v3_jobs set
    status=case when job.status='queued' then 'dispatching' else 'running' end,
    lease_id=p_lease,lease_until=now()+interval '5 minutes',updated_at=now()
  where id=job.id returning * into job;
  return to_jsonb(job);
end $$;
revoke all on function public.claim_genjutsu_v3_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_genjutsu_v3_job(uuid) to service_role;

create function public.wake_genjutsu_v3() returns bigint
language sql set search_path = '' as $$
  select net.http_post(
    url := 'https://iubzjfidmxfjvvonusos.supabase.co/functions/v1/cloudent-genjutsu-v3?action=worker',
    headers := jsonb_build_object('Content-Type','application/json','x-cloudent-worker-secret',public.get_cloudent_worker_secret()),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
  where exists(select 1 from public.genjutsu_v3_jobs where status in ('queued','dispatching','running'));
$$;
revoke all on function public.wake_genjutsu_v3() from public,anon,authenticated;
grant execute on function public.wake_genjutsu_v3() to service_role;
select cron.schedule('cloudent-genjutsu-v3-worker','* * * * *','select public.wake_genjutsu_v3()');
