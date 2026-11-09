-- Mode 1 shares one queue across prompt preparation and video generation.
-- Larger prompt limits still use independent preparation and two video slots.
create or replace function public.genjutsu_serial_head()
returns uuid language sql stable security invoker set search_path=public as $$
 select c.id
 from production_jobs c
 where c.meta->>'workflow_key'='genjutsu' and c.meta->>'workflow_id'='2117411301344411649'
 and c.hidden_at is null and c.runninghub_task_id is null and c.result_video_id is null
 and nullif(c.meta->>'pipeline_dispatch_intent','') is null
 and (c.status='uploading' or (c.status='motion_waiting' and c.attempt_count<c.max_attempts))
 and coalesce(c.meta->'genjutsu_prompt'->>'status','')<>'failed'
 -- An existing turn survives retries and a switch from parallel mode.
 order by (c.status='uploading') desc,
   (c.meta->>'prompt_started_at' is not null or c.meta->'genjutsu_prompt'->>'interactionId' is not null) desc,
   c.created_at,c.id
 limit 1;
$$;
revoke all on function public.genjutsu_serial_head() from public,anon,authenticated;
grant execute on function public.genjutsu_serial_head() to service_role;

-- Both lanes take the same lock before selecting or claiming in serial mode.
create or replace function public.claim_genjutsu_prompt_job(p_worker text,p_limit integer default 1)
returns setof public.production_jobs language plpgsql security invoker set search_path=public as $$
declare j public.production_jobs; cap integer; active integer; head_id uuid;
begin
 if p_worker not like 'genjutsu-prompt-%' or p_limit<1 then return;end if;
 perform pg_advisory_xact_lock(hashtext('cloudent-genjutsu-prompt-claim')::bigint);
 select greatest(1,least(4,coalesce((value->>'prompt_concurrency')::integer,2))) into cap from app_settings where key='genjutsu_queue_config';cap:=coalesce(cap,2);
 if cap=1 then
  head_id:=public.genjutsu_serial_head();
  if head_id is null or exists(select 1 from production_jobs c
    where c.id<>head_id and c.meta->>'workflow_key'='genjutsu'
    and (c.status in ('uploading','queued','running') or c.meta->>'pipeline_dispatch_uncertain'='true'))
  then return;end if;
 end if;
 select * into j from production_jobs c where c.meta->>'workflow_key'='genjutsu' and c.meta->>'workflow_id'='2117411301344411649'
 and (cap<>1 or c.id=head_id)
 and c.hidden_at is null and c.runninghub_task_id is null and c.result_video_id is null
 and nullif(c.meta->>'pipeline_dispatch_intent','') is null
 and coalesce(c.meta->'genjutsu_prompt'->>'status','') not in ('complete','failed')
 and (c.status='motion_waiting' or (c.status='uploading' and c.locked_at<now()-interval '10 minutes'))
 and c.next_attempt_at<=now() and (c.locked_at is null or c.locked_at<now()-interval '2 minutes')
 order by (c.meta->'genjutsu_prompt'->>'interactionId' is not null) desc,c.created_at,c.id for update skip locked limit 1;
 if j.id is null then return;end if;
 if cap<>1 then
  select count(*) into active from production_jobs c where c.id<>j.id and c.hidden_at is null and c.meta->>'workflow_key'='genjutsu'
  and c.status in ('motion_waiting','uploading') and coalesce(c.meta->'genjutsu_prompt'->>'status','') not in ('complete','failed')
  and ((c.locked_by like 'genjutsu-prompt-%' and c.locked_at>now()-interval '2 minutes') or c.meta->'genjutsu_prompt'->>'interactionId' is not null);
  -- In parallel mode, continue polling known analyses after a limit reduction.
  if active>=cap and j.meta->'genjutsu_prompt'->>'interactionId' is null then return;end if;
 end if;
 return query update production_jobs set status='motion_waiting',locked_at=now(),locked_by=p_worker,updated_at=now(),
 meta=meta||jsonb_build_object('prompt_started_at',coalesce(meta->>'prompt_started_at',now()::text),'preparation_status','PREPARING') where id=j.id returning *;
end $$;
revoke all on function public.claim_genjutsu_prompt_job(text,integer) from public,anon,authenticated;
grant execute on function public.claim_genjutsu_prompt_job(text,integer) to service_role;

-- Only validated ready prompts can reserve a video slot.
create or replace function public.claim_genjutsu_job(p_worker text,p_limit integer default 1)
returns setof public.production_jobs language plpgsql security invoker set search_path=public as $$
declare j public.production_jobs; n integer; capacity integer; cap integer; head_id uuid;
begin
 if p_limit<1 then return;end if;
 perform pg_advisory_xact_lock(hashtext('cloudent-genjutsu-prompt-claim')::bigint);
 perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
 select greatest(1,least(4,coalesce((value->>'prompt_concurrency')::integer,2))) into cap from app_settings where key='genjutsu_queue_config';cap:=coalesce(cap,2);
 if cap=1 then
  head_id:=public.genjutsu_serial_head();
  if head_id is null then return;end if;
 end if;
 select * into j from production_jobs c where c.meta->>'workflow_key'='genjutsu' and c.meta->>'workflow_id'='2117411301344411649'
 and (cap<>1 or c.id=head_id)
 and c.meta->'genjutsu_prompt'->>'status'='complete'
 and c.runninghub_task_id is null and c.result_video_id is null and c.hidden_at is null
 and nullif(c.meta->>'pipeline_dispatch_intent','') is null
 and c.next_attempt_at<=now() and (c.status='uploading' or c.attempt_count<c.max_attempts)
 and (c.status='motion_waiting' or (c.status='uploading' and c.locked_at<now()-interval '10 minutes'))
 and (c.locked_at is null or c.locked_at<now()-interval '10 minutes')
 order by c.created_at,c.id for update skip locked limit 1;
 if j.id is null then return;end if;
 -- Uncertain creates reserve one slot rather than blocking the entire queue.
 if (select count(*) from production_jobs c where c.id<>j.id and c.meta->>'workflow_key'='genjutsu'
 and (c.status in ('uploading','queued','running') or c.meta->>'pipeline_dispatch_uncertain'='true'))>=(case when cap=1 then 1 else 2 end) then return;end if;
 select (select count(*) from production_jobs where id<>j.id and (status in ('uploading','queued','running') or meta->>'pipeline_dispatch_uncertain'='true'))+
 (select count(*) from face_swap_jobs where status in ('uploading','queued','running')) into n;
 select greatest(1,least(10,coalesce((config->>'concurrency')::integer,1))) into capacity from integrations where provider='runninghub';
 if n>=coalesce(capacity,1) then return;end if;
 return query update production_jobs set status='uploading',progress=5,
 attempt_count=case when j.status='uploading' then attempt_count else attempt_count+1 end,
 locked_at=now(),locked_by=p_worker,last_error=null,updated_at=now() where id=j.id returning *;
end $$;
revoke all on function public.claim_genjutsu_job(text,integer) from public,anon,authenticated;
grant execute on function public.claim_genjutsu_job(text,integer) to service_role;

-- Metadata-only wake, at most one request per lane per 10 seconds. Cron remains recovery fallback.
create or replace function public.wake_genjutsu_queue()
returns boolean language plpgsql security invoker set search_path=public as $$
declare stamp jsonb; lane text; due boolean; sent boolean:=false; prev timestamptz; repetitions integer; k integer; cap integer; head_id uuid;
begin
 perform pg_advisory_xact_lock(hashtext('cloudent-genjutsu-wake')::bigint);
 select value into stamp from app_settings where key='genjutsu_queue_wake';stamp:=coalesce(stamp,'{}'::jsonb);
 select greatest(1,least(4,coalesce((value->>'prompt_concurrency')::integer,2))) into cap from app_settings where key='genjutsu_queue_config';cap:=coalesce(cap,2);
 if cap=1 then
  head_id:=public.genjutsu_serial_head();
  if head_id is null or exists(select 1 from production_jobs c
    where c.id<>head_id and c.meta->>'workflow_key'='genjutsu'
    and (c.status in ('uploading','queued','running') or c.meta->>'pipeline_dispatch_uncertain'='true'))
  then return false;end if;
 end if;
 foreach lane in array array['prepare','video'] loop
  prev:=nullif(stamp->>lane,'')::timestamptz;
  if prev is not null and prev>now()-interval '10 seconds' then continue;end if;
  select exists(select 1 from production_jobs c where c.meta->>'workflow_key'='genjutsu'
   and (cap<>1 or c.id=head_id)
   and c.hidden_at is null and c.runninghub_task_id is null and c.result_video_id is null and nullif(c.meta->>'pipeline_dispatch_intent','') is null
   and (c.status='motion_waiting' or (c.status='uploading' and c.locked_at<now()-interval '10 minutes')) and c.next_attempt_at<=now()
   and (c.locked_at is null or c.locked_at<now()-case when cap=1 and lane='video' then interval '10 minutes' else interval '2 minutes' end)
   and case when lane='prepare' then coalesce(c.meta->'genjutsu_prompt'->>'status','') not in ('complete','failed')
            else c.meta->'genjutsu_prompt'->>'status'='complete' end) into due;
  if cap<>1 and lane='video' and (select count(*) from production_jobs where meta->>'workflow_key'='genjutsu' and (status in ('uploading','queued','running') or meta->>'pipeline_dispatch_uncertain'='true'))>=2 then due:=false;end if;
  if due then
   repetitions:=case when cap=1 then 1 when lane='prepare' then cap else 2 end;
   for k in 1..repetitions loop
   perform net.http_post(url:='https://iubzjfidmxfjvvonusos.supabase.co/functions/v1/cloudent-motion-control-worker?workflow=genjutsu'||case when lane='prepare' then '&phase=prepare' else '' end,
    headers:=jsonb_build_object('Content-Type','application/json','x-cloudent-worker-secret',public.get_cloudent_worker_secret()),body:='{}'::jsonb,timeout_milliseconds:=60000);
   end loop;
   stamp:=stamp||jsonb_build_object(lane,now());sent:=true;
  end if;
 end loop;
 if sent then insert into app_settings(key,value,updated_at) values('genjutsu_queue_wake',stamp,now()) on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;end if;
 return sent;
end $$;
revoke all on function public.wake_genjutsu_queue() from public,anon,authenticated;
grant execute on function public.wake_genjutsu_queue() to service_role;
