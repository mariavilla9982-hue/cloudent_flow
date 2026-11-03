-- User request 2026-11-03: at most two GENJUTSU production jobs.
-- Shared advisory lock, global capacity and uncertain-dispatch guards preserved.
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
  -- Ambiguous dispatch still blocks claims, regardless of the requested cap.
  if exists(select 1 from public.production_jobs active where active.id<>j.id
    and active.meta->>'workflow_key'='genjutsu'
    and active.meta->>'pipeline_dispatch_uncertain'='true') then return; end if;
  if (select count(*) from public.production_jobs active where active.id<>j.id
    and active.meta->>'workflow_key'='genjutsu'
    and active.status in ('uploading','queued','running'))>=2 then return; end if;
  select (select count(*) from public.production_jobs where id<>j.id and status in ('uploading','queued','running'))+
         (select count(*) from public.face_swap_jobs where status in ('uploading','queued','running')) into n;
  select greatest(1,least(10,coalesce((config->>'concurrency')::integer,1))) into capacity from public.integrations where provider='runninghub';
  if n>=coalesce(capacity,1) then return; end if;
  return query update public.production_jobs set status='uploading',progress=5,attempt_count=case when j.status='uploading' then attempt_count else attempt_count+1 end,
    locked_at=now(),locked_by=p_worker,last_error=null,updated_at=now() where id=j.id returning *;
end $$;
revoke all on function public.claim_genjutsu_job(text,integer) from public,anon,authenticated;
grant execute on function public.claim_genjutsu_job(text,integer) to service_role;
