begin;
create temp table gen_prod as select * from public.production_jobs limit 0;
create temp table gen_face as select * from public.face_swap_jobs limit 0;
create temp table gen_settings(key text,value jsonb);
create temp table gen_integrations(provider text,config jsonb);
insert into gen_settings values('genjutsu_queue_config','{"prompt_concurrency":2}');
insert into gen_integrations values('runninghub','{"concurrency":5}');
-- Independent preparation leases. No video slot is claimed by this function.
create or replace function pg_temp.claim_genjutsu_prompt_job(p_worker text,p_limit integer default 1)
returns setof pg_temp.gen_prod language plpgsql security invoker set search_path=pg_temp,public as $$
declare j pg_temp.gen_prod; cap integer; active integer;
begin
 if p_worker not like 'genjutsu-prompt-%' or p_limit<1 then return;end if;
 perform pg_advisory_xact_lock(hashtext('cloudent-genjutsu-prompt-claim')::bigint);
 select greatest(1,least(4,coalesce((value->>'prompt_concurrency')::integer,2))) into cap from pg_temp.gen_settings where key='genjutsu_queue_config';cap:=coalesce(cap,2);
 select * into j from pg_temp.gen_prod c where c.meta->>'workflow_key'='genjutsu' and c.meta->>'workflow_id'='2117411301344411649'
 and c.hidden_at is null and c.runninghub_task_id is null and c.result_video_id is null
 and nullif(c.meta->>'pipeline_dispatch_intent','') is null
 and coalesce(c.meta->'genjutsu_prompt'->>'status','') not in ('complete','failed')
 and (c.status='motion_waiting' or (c.status='uploading' and c.locked_at<now()-interval '10 minutes'))
 and c.next_attempt_at<=now() and (c.locked_at is null or c.locked_at<now()-interval '2 minutes')
 order by (c.meta->'genjutsu_prompt'->>'interactionId' is not null) desc,c.created_at,c.id for update skip locked limit 1;
 if j.id is null then return;end if;
 select count(*) into active from pg_temp.gen_prod c where c.id<>j.id and c.hidden_at is null and c.meta->>'workflow_key'='genjutsu'
 and c.status in ('motion_waiting','uploading') and coalesce(c.meta->'genjutsu_prompt'->>'status','') not in ('complete','failed')
 and ((c.locked_by like 'genjutsu-prompt-%' and c.locked_at>now()-interval '2 minutes') or c.meta->'genjutsu_prompt'->>'interactionId' is not null);
 -- A known analysis is always eligible for polling, even when the limit was lowered.
 if active>=cap and j.meta->'genjutsu_prompt'->>'interactionId' is null then return;end if;
 return query update pg_temp.gen_prod set status='motion_waiting',locked_at=now(),locked_by=p_worker,updated_at=now(),
 meta=meta||jsonb_build_object('prompt_started_at',coalesce(meta->>'prompt_started_at',now()::text),'preparation_status','PREPARING') where id=j.id returning *;
end $$;



-- Only validated ready prompts can reserve either of the two video slots.
create or replace function pg_temp.claim_genjutsu_job(p_worker text,p_limit integer default 1)
returns setof pg_temp.gen_prod language plpgsql security invoker set search_path=pg_temp,public as $$
declare j pg_temp.gen_prod; n integer; capacity integer;
begin
 if p_limit<1 then return;end if;
 perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
 select * into j from pg_temp.gen_prod c where c.meta->>'workflow_key'='genjutsu' and c.meta->>'workflow_id'='2117411301344411649'
 and c.meta->'genjutsu_prompt'->>'status'='complete'
 and c.runninghub_task_id is null and c.result_video_id is null and c.hidden_at is null
 and nullif(c.meta->>'pipeline_dispatch_intent','') is null
 and c.next_attempt_at<=now() and (c.status='uploading' or c.attempt_count<c.max_attempts)
 and (c.status='motion_waiting' or (c.status='uploading' and c.locked_at<now()-interval '10 minutes'))
 and (c.locked_at is null or c.locked_at<now()-interval '10 minutes')
 order by c.created_at,c.id for update skip locked limit 1;
 if j.id is null then return;end if;
 -- Uncertain creates reserve one slot rather than blocking the entire queue.
 if (select count(*) from pg_temp.gen_prod c where c.id<>j.id and c.meta->>'workflow_key'='genjutsu'
 and (c.status in ('uploading','queued','running') or c.meta->>'pipeline_dispatch_uncertain'='true'))>=2 then return;end if;
 select (select count(*) from pg_temp.gen_prod where id<>j.id and (status in ('uploading','queued','running') or meta->>'pipeline_dispatch_uncertain'='true'))+
 (select count(*) from pg_temp.gen_face where status in ('uploading','queued','running')) into n;
 select greatest(1,least(10,coalesce((config->>'concurrency')::integer,1))) into capacity from pg_temp.gen_integrations where provider='runninghub';
 if n>=coalesce(capacity,1) then return;end if;
 return query update pg_temp.gen_prod set status='uploading',progress=5,
 attempt_count=case when j.status='uploading' then attempt_count else attempt_count+1 end,
 locked_at=now(),locked_by=p_worker,last_error=null,updated_at=now() where id=j.id returning *;
end $$;




do $test$
declare n integer; a uuid; j production_jobs;
begin
 insert into gen_prod(id,user_id,status,created_at,meta,attempt_count,max_attempts,next_attempt_at)
 select ('00000000-0000-4000-8000-'||lpad(x::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000099'::uuid,'motion_waiting',now()+x*interval '1 second',
 jsonb_build_object('workflow_key','genjutsu','workflow_id','2117411301344411649')||case when x<=3 then '{"genjutsu_prompt":{"status":"complete"}}'::jsonb else '{}'::jsonb end,0,3,now() from generate_series(1,6)x;
 select count(*) into n from pg_temp.claim_genjutsu_job('video1');if n<>1 then raise exception 'first video';end if;
 select count(*) into n from pg_temp.claim_genjutsu_job('video2');if n<>1 then raise exception 'second video';end if;
 select count(*) into n from pg_temp.claim_genjutsu_job('video3');if n<>0 then raise exception 'third exceeded limit';end if;
 select count(*) into n from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-1');if n<>1 then raise exception 'prep blocked by two videos';end if;
 select count(*) into n from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-2');if n<>1 then raise exception 'second prep blocked';end if;
 select count(*) into n from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-3');if n<>0 then raise exception 'prep exceeded own limit';end if;
 update gen_prod set status='failed',locked_at=null,locked_by=null where locked_by='video1';
 select count(*) into n from pg_temp.claim_genjutsu_job('video-next');if n<>1 then raise exception 'failure did not free video slot';end if;
 update gen_prod set status='ready',locked_at=null,locked_by=null where locked_by='video2';
 select count(*) into n from pg_temp.claim_genjutsu_job('no-ready-prompt');if n<>0 then raise exception 'dispatched unfinished prompt';end if;
 update gen_prod set meta=meta||'{"genjutsu_prompt":{"status":"complete"},"preparation_status":"READY_FOR_VIDEO"}',locked_at=null,locked_by=null where locked_by='genjutsu-prompt-1';
 select count(*) into n from pg_temp.claim_genjutsu_job('ready-next');if n<>1 then raise exception 'completion did not free video slot';end if;
 update gen_prod set locked_at=now()-interval '11 minutes' where locked_by='ready-next';
 select count(*) into n from pg_temp.claim_genjutsu_job('reclaimed');if n<>1 then raise exception 'abandoned video reservation not recovered';end if;
 if(select attempt_count from gen_prod where locked_by='reclaimed')<>1 then raise exception 'reclaim duplicated attempt';end if;
 update gen_prod set runninghub_task_id='known-task',locked_at=now()-interval '1 day' where locked_by='reclaimed';
 select count(*) into n from pg_temp.claim_genjutsu_job('restart');if n<>0 then raise exception 'accepted task duplicated after restart';end if;
 update gen_prod set status='failed',locked_at=null,locked_by=null where locked_by='genjutsu-prompt-2';
 select count(*) into n from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-last');if n<>1 then raise exception 'failed prompt blocked next';end if;
 update gen_prod set locked_at=now()-interval '3 minutes' where locked_by='genjutsu-prompt-last';
 select count(*) into n from pg_temp.claim_genjutsu_prompt_job('genjutsu-prompt-recover');if n<>1 then raise exception 'abandoned preparation lease stuck';end if;
 -- One ambiguous create reserves only its own slot; another independent ready job may proceed.
 update gen_prod set status='ready',runninghub_task_id=null,locked_at=null,locked_by=null;
 update gen_prod set status='failed',meta=meta||'{"pipeline_dispatch_uncertain":true}' where id='00000000-0000-4000-8000-000000000001';
 update gen_prod set status='motion_waiting' where id='00000000-0000-4000-8000-000000000002';
 select count(*) into n from pg_temp.claim_genjutsu_job('one-uncertain');if n<>1 then raise exception 'one ambiguous task blocked all slots';end if;
 update gen_prod set status='motion_waiting' where id='00000000-0000-4000-8000-000000000003';
 select count(*) into n from pg_temp.claim_genjutsu_job('two-reserved');if n<>0 then raise exception 'ambiguous task failed to reserve slot';end if;
end $test$;
select 'PASS independent prompt/video claims; two videos; failure/completion advance; no unfinished prompt dispatch; restart idempotence; expired leases; failed prompt isolation; uncertain slot accounting' as result;
rollback;
