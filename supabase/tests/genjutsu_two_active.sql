begin;
create temp table gen_prod as select * from public.production_jobs limit 0;
create temp table gen_face as select * from public.face_swap_jobs limit 0;
create temp table gen_integrations(provider text,config jsonb);
insert into gen_integrations values ('runninghub','{"concurrency":5}');
create or replace function pg_temp.claim_genjutsu_job(p_worker text,p_limit integer default 1)
returns setof pg_temp.gen_prod language plpgsql security invoker set search_path=public as $$
declare j pg_temp.gen_prod; n integer; capacity integer;
begin
  if p_limit<1 then return; end if;
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
  select * into j from pg_temp.gen_prod candidate
  where candidate.meta->>'workflow_key'='genjutsu' and candidate.meta->>'workflow_id'='2117411301344411649'
    and candidate.runninghub_task_id is null and candidate.result_video_id is null and candidate.hidden_at is null
    and candidate.meta->>'pipeline_dispatch_intent' is null
    and candidate.next_attempt_at<=now() and (candidate.status='uploading' or candidate.attempt_count<candidate.max_attempts)
    and (candidate.status='motion_waiting' or (candidate.status='uploading' and candidate.locked_at<now()-interval '10 minutes'))
    and (candidate.locked_at is null or candidate.locked_at<now()-interval '10 minutes')
  order by candidate.created_at,candidate.id for update skip locked limit 1;
  if j.id is null then return; end if;
  -- Ambiguous dispatch still blocks claims, regardless of the requested cap.
  if exists(select 1 from pg_temp.gen_prod active where active.id<>j.id
    and active.meta->>'workflow_key'='genjutsu'
    and active.meta->>'pipeline_dispatch_uncertain'='true') then return; end if;
  if (select count(*) from pg_temp.gen_prod active where active.id<>j.id
    and active.meta->>'workflow_key'='genjutsu'
    and active.status in ('uploading','queued','running'))>=2 then return; end if;
  select (select count(*) from pg_temp.gen_prod where id<>j.id and status in ('uploading','queued','running'))+
         (select count(*) from pg_temp.gen_face where status in ('uploading','queued','running')) into n;
  select greatest(1,least(10,coalesce((config->>'concurrency')::integer,1))) into capacity from pg_temp.gen_integrations where provider='runninghub';
  if n>=coalesce(capacity,1) then return; end if;
  return query update pg_temp.gen_prod set status='uploading',progress=5,attempt_count=case when j.status='uploading' then attempt_count else attempt_count+1 end,
    locked_at=now(),locked_by=p_worker,last_error=null,updated_at=now() where id=j.id returning *;
end $$;

do $test$
declare a uuid:='00000000-0000-4000-8000-000000000001'; b uuid:='00000000-0000-4000-8000-000000000002'; c uuid:='00000000-0000-4000-8000-000000000003'; n integer;
begin
 insert into gen_prod(id,user_id,status,created_at,meta,attempt_count,max_attempts,next_attempt_at)
 select x,a,'motion_waiting','2026-11-01'::timestamptz,'{"workflow_key":"genjutsu","workflow_id":"2117411301344411649"}'::jsonb,0,1,now() from unnest(array[a,b,c]) x;
 select count(*) into n from pg_temp.claim_genjutsu_job('first',1);if n<>1 then raise exception 'first claim';end if;
 select count(*) into n from pg_temp.claim_genjutsu_job('second',1);if n<>1 then raise exception 'second claim blocked';end if;
 select count(*) into n from pg_temp.claim_genjutsu_job('third',1);if n<>0 then raise exception 'third exceeded cap';end if;
 update gen_prod set locked_at=now()-interval '11 minutes' where id=a;
 select count(*) into n from pg_temp.claim_genjutsu_job('recover',1);if n<>1 then raise exception 'expired lease not reclaimed at cap';end if;
 if(select attempt_count from gen_prod where id=a)<>1 then raise exception 'duplicate attempt';end if;
 update gen_prod set status='ready',locked_at=null,locked_by=null where id=a;
 select count(*) into n from pg_temp.claim_genjutsu_job('next',1);if n<>1 then raise exception 'next after completion';end if;
 update gen_prod set status='motion_waiting',locked_by=null,locked_at=null,attempt_count=0 where id=c;
 update gen_prod set status='failed',meta=meta||'{"pipeline_dispatch_uncertain":true}' where id=a;
 select count(*) into n from pg_temp.claim_genjutsu_job('uncertain',1);if n<>0 then raise exception 'ambiguous task bypassed';end if;
 update gen_prod set meta=meta-'pipeline_dispatch_uncertain' where id=a;
 update gen_integrations set config='{"concurrency":1}';
 select count(*) into n from pg_temp.claim_genjutsu_job('global-full',1);if n<>0 then raise exception 'global cap ignored';end if;
 update gen_prod set status='ready' where id=b;
 insert into gen_face(id,status,meta) values(gen_random_uuid(),'running','{}');
 select count(*) into n from pg_temp.claim_genjutsu_job('image-full',1);if n<>0 then raise exception 'face task not counted';end if;
 update gen_face set status='ready';
 select count(*) into n from pg_temp.claim_genjutsu_job('free',1);if n<>1 then raise exception 'free capacity not used';end if;
end $test$;
select 'PASS two active, third blocked, expired lease recovery, no duplicate attempt, FIFO next, uncertain dispatch, shared global/image capacity' as result;
rollback;
