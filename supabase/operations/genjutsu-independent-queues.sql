-- Independent preparation leases. No video slot is claimed by this function.
create or replace function public.claim_genjutsu_prompt_job(p_worker text,p_limit integer default 1)
returns setof public.production_jobs language plpgsql security invoker set search_path=public as $$
declare j public.production_jobs; cap integer; active integer;
begin
 if p_worker not like 'genjutsu-prompt-%' or p_limit<1 then return;end if;
 perform pg_advisory_xact_lock(hashtext('cloudent-genjutsu-prompt-claim')::bigint);
 select greatest(1,least(4,coalesce((value->>'prompt_concurrency')::integer,2))) into cap from app_settings where key='genjutsu_queue_config';cap:=coalesce(cap,2);
 select * into j from production_jobs c where c.meta->>'workflow_key'='genjutsu' and c.meta->>'workflow_id'='2117411301344411649'
 and c.hidden_at is null and c.runninghub_task_id is null and c.result_video_id is null
 and nullif(c.meta->>'pipeline_dispatch_intent','') is null
 and coalesce(c.meta->'genjutsu_prompt'->>'status','') not in ('complete','failed')
 and (c.status='motion_waiting' or (c.status='uploading' and c.locked_at<now()-interval '10 minutes'))
 and c.next_attempt_at<=now() and (c.locked_at is null or c.locked_at<now()-interval '2 minutes')
 order by (c.meta->'genjutsu_prompt'->>'interactionId' is not null) desc,c.created_at,c.id for update skip locked limit 1;
 if j.id is null then return;end if;
 select count(*) into active from production_jobs c where c.id<>j.id and c.hidden_at is null and c.meta->>'workflow_key'='genjutsu'
 and c.status in ('motion_waiting','uploading') and coalesce(c.meta->'genjutsu_prompt'->>'status','') not in ('complete','failed')
 and ((c.locked_by like 'genjutsu-prompt-%' and c.locked_at>now()-interval '2 minutes') or c.meta->'genjutsu_prompt'->>'interactionId' is not null);
 -- A known analysis is always eligible for polling, even when the limit was lowered.
 if active>=cap and j.meta->'genjutsu_prompt'->>'interactionId' is null then return;end if;
 return query update production_jobs set status='motion_waiting',locked_at=now(),locked_by=p_worker,updated_at=now(),
 meta=meta||jsonb_build_object('prompt_started_at',coalesce(meta->>'prompt_started_at',now()::text),'preparation_status','PREPARING') where id=j.id returning *;
end $$;
revoke all on function public.claim_genjutsu_prompt_job(text,integer) from public,anon,authenticated;
grant execute on function public.claim_genjutsu_prompt_job(text,integer) to service_role;

-- Only validated ready prompts can reserve either of the two video slots.
create or replace function public.claim_genjutsu_job(p_worker text,p_limit integer default 1)
returns setof public.production_jobs language plpgsql security invoker set search_path=public as $$
declare j public.production_jobs; n integer; capacity integer;
begin
 if p_limit<1 then return;end if;
 perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
 select * into j from production_jobs c where c.meta->>'workflow_key'='genjutsu' and c.meta->>'workflow_id'='2117411301344411649'
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
 and (c.status in ('uploading','queued','running') or c.meta->>'pipeline_dispatch_uncertain'='true'))>=2 then return;end if;
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
declare stamp jsonb; lane text; due boolean; sent boolean:=false; prev timestamptz; repetitions integer; k integer;
begin
 perform pg_advisory_xact_lock(hashtext('cloudent-genjutsu-wake')::bigint);
 select value into stamp from app_settings where key='genjutsu_queue_wake';stamp:=coalesce(stamp,'{}'::jsonb);
 foreach lane in array array['prepare','video'] loop
  prev:=nullif(stamp->>lane,'')::timestamptz;
  if prev is not null and prev>now()-interval '10 seconds' then continue;end if;
  select exists(select 1 from production_jobs c where c.meta->>'workflow_key'='genjutsu'
   and c.hidden_at is null and c.runninghub_task_id is null and c.result_video_id is null and nullif(c.meta->>'pipeline_dispatch_intent','') is null
   and (c.status='motion_waiting' or (c.status='uploading' and c.locked_at<now()-interval '10 minutes')) and c.next_attempt_at<=now()
   and (c.locked_at is null or c.locked_at<now()-interval '2 minutes')
   and case when lane='prepare' then coalesce(c.meta->'genjutsu_prompt'->>'status','') not in ('complete','failed')
            else c.meta->'genjutsu_prompt'->>'status'='complete' end) into due;
  if lane='video' and (select count(*) from production_jobs where meta->>'workflow_key'='genjutsu' and (status in ('uploading','queued','running') or meta->>'pipeline_dispatch_uncertain'='true'))>=2 then due:=false;end if;
  if due then
   repetitions:=case when lane='prepare' then coalesce((select greatest(1,least(4,(value->>'prompt_concurrency')::integer)) from app_settings where key='genjutsu_queue_config'),2) else 2 end;
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

-- Preserve existing production/V7 cron sections; replace only the final GENJUTSU wake.
do $$ declare command_text text; marker text:=E'select net.http_post(\n  url:=''https://iubzjfidmxfjvvonusos.supabase.co/functions/v1/cloudent-motion-control-worker?workflow=genjutsu'''; pos integer;
begin
 select command into command_text from cron.job where jobname='cloudent-image-pipeline';
 if command_text is null then raise exception 'Existing recovery cron missing';end if;
 pos:=strpos(command_text,marker);
 if pos>0 then command_text:=left(command_text,pos-1)||'select public.wake_genjutsu_queue();';
 elsif strpos(command_text,'wake_genjutsu_queue()')=0 then raise exception 'Existing GENJUTSU cron shape changed';end if;
 perform cron.schedule('cloudent-image-pipeline','* * * * *',command_text);
end $$;

-- Legacy prompt repairs consumed a video attempt without ever dispatching.
-- Exact scoped repair: no task, receipt, intent, result or active lease is reset.
update public.production_jobs set attempt_count=0,
 meta=meta||jsonb_build_object('legacy_prompt_attempt_restored_at',now()),updated_at=now()
where id in ('2b03858b-4a28-41a3-beed-a5cf813fc233','a9c5bd7f-b48a-43ec-80c2-8ad8218e1c10')
 and meta->>'workflow_key'='genjutsu' and meta->>'prompt_repair_20261104'='true'
 and meta->'genjutsu_prompt'->>'status'='complete' and status='motion_waiting'
 and attempt_count=1 and max_attempts=1 and runninghub_task_id is null and result_video_id is null
 and locked_by is null and locked_at is null and nullif(meta->>'pipeline_dispatch_intent','') is null
 and coalesce(meta->>'pipeline_dispatch_uncertain','false')='false'
 and meta->'previous_motion_capture' is null;
