-- Keep all existing schemas/media and V7 claims. Only the new Genjutsu path is serialized.
create or replace function public.genjutsu_image_eligible(p_id uuid,p_created_at timestamptz)
returns boolean language sql stable security invoker set search_path=public as $$
  select not exists (
    select 1 from public.face_swap_jobs older
    where older.meta->'video_workflow'->>'key'='genjutsu'
      and older.meta->>'stage'<>'upload'
      and (older.created_at,older.id)<(p_created_at,p_id)
      and (older.status in ('waiting','uploading','queued','running') or older.meta->>'dispatch_uncertain'='true')
  );
$$;
revoke all on function public.genjutsu_image_eligible(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.genjutsu_image_eligible(uuid,timestamptz) to service_role;

create or replace function public.lease_image_pipeline(p_id uuid,p_worker text,p_limit integer default 1)
returns setof public.face_swap_jobs language plpgsql security invoker set search_path=public as $$
declare j public.face_swap_jobs; n integer;
begin
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
  select * into j from public.face_swap_jobs where id=p_id for update;
  if j.id is null or j.meta->>'pipeline_version'<>'2' or j.hidden_at is not null
    or j.status not in ('waiting','uploading','queued','running')
    or (j.locked_at is not null and j.locked_at>now()-interval '10 minutes') then return; end if;
  if j.meta->'video_workflow'->>'key'='genjutsu' and not public.genjutsu_image_eligible(j.id,j.created_at) then return; end if;
  if j.status='waiting' and j.meta->>'stage' in ('face_swap','upscale') then
    if exists (
      select 1 from public.face_swap_jobs pending
      where pending.meta @> '{"pipeline_version":2}'::jsonb and pending.hidden_at is null and pending.status='waiting'
        and (coalesce(pending.meta->'video_workflow'->>'key','')<>'genjutsu' or public.genjutsu_image_eligible(pending.id,pending.created_at))
        and ((j.meta->>'stage'='upscale' and pending.meta->>'stage'='face_swap')
          or (pending.meta->>'stage'=j.meta->>'stage' and (pending.created_at,pending.id)<(j.created_at,j.id)))
    ) then return; end if;
  end if;
  if j.status='waiting' and j.meta->>'stage'<>'control_motion' then
    select (select count(*) from public.face_swap_jobs where status in ('uploading','queued','running'))+
           (select count(*) from public.production_jobs where status in ('uploading','queued','running')) into n;
    if n>=greatest(1,least(p_limit,10)) then return; end if;
  end if;
  return query update public.face_swap_jobs set locked_by=p_worker,locked_at=now(),
    status=case when j.status='waiting' and j.meta->>'stage'<>'control_motion' then 'uploading' else j.status end,
    updated_at=now() where id=p_id returning *;
end $$;
revoke all on function public.lease_image_pipeline(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.lease_image_pipeline(uuid,text,integer) to service_role;

create or replace function public.claim_genjutsu_job(p_worker text,p_limit integer default 1)
returns setof public.production_jobs language plpgsql security invoker set search_path=public as $$
declare j public.production_jobs; n integer; capacity integer;
begin
  if p_limit<1 then return; end if;
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
  select * into j from public.production_jobs candidate
  where candidate.meta->>'workflow_key'='genjutsu' and candidate.meta->>'workflow_id'='2117411301344411649'
    and candidate.runninghub_task_id is null and candidate.result_video_id is null and candidate.hidden_at is null
    and candidate.meta->>'pipeline_dispatch_intent' is null
    and candidate.next_attempt_at<=now() and (candidate.status='uploading' or candidate.attempt_count<candidate.max_attempts)
    and (candidate.status='motion_waiting' or (candidate.status='uploading' and candidate.locked_at<now()-interval '10 minutes'))
    and (candidate.locked_at is null or candidate.locked_at<now()-interval '10 minutes')
  order by candidate.created_at,candidate.id for update skip locked limit 1;
  if j.id is null then return; end if;
  if exists(select 1 from public.production_jobs active where active.id<>j.id
    and active.meta->>'workflow_key'='genjutsu'
    and (active.status in ('uploading','queued','running') or active.meta->>'pipeline_dispatch_uncertain'='true')) then return; end if;
  select (select count(*) from public.production_jobs where id<>j.id and status in ('uploading','queued','running'))+
         (select count(*) from public.face_swap_jobs where status in ('uploading','queued','running')) into n;
  select greatest(1,least(10,coalesce((config->>'concurrency')::integer,1))) into capacity from public.integrations where provider='runninghub';
  if n>=coalesce(capacity,1) then return; end if;
  return query update public.production_jobs set status='uploading',progress=5,attempt_count=case when j.status='uploading' then attempt_count else attempt_count+1 end,
    locked_at=now(),locked_by=p_worker,last_error=null,updated_at=now() where id=j.id returning *;
end $$;
revoke all on function public.claim_genjutsu_job(text,integer) from public,anon,authenticated;
grant execute on function public.claim_genjutsu_job(text,integer) to service_role;
