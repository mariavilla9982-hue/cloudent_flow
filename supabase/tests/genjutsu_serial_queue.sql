begin;
create temp table gen_face as select * from public.face_swap_jobs limit 0;
create temp table gen_prod as select * from public.production_jobs limit 0;
create temp table gen_integrations(provider text,config jsonb);
insert into gen_integrations values ('runninghub','{"concurrency":2}');
-- Keep all existing schemas/media and V7 claims. Only the new Genjutsu path is serialized.
create or replace function pg_temp.genjutsu_image_eligible(p_id uuid,p_created_at timestamptz)
returns boolean language sql stable security invoker set search_path=public as $$
  select not exists (
    select 1 from pg_temp.gen_face older
    where older.meta->'video_workflow'->>'key'='genjutsu'
      and older.meta->>'stage'<>'upload'
      and (older.created_at,older.id)<(p_created_at,p_id)
      and (older.status in ('waiting','uploading','queued','running') or older.meta->>'dispatch_uncertain'='true')
  );
$$;

create or replace function pg_temp.lease_image_pipeline(p_id uuid,p_worker text,p_limit integer default 1)
returns setof pg_temp.gen_face language plpgsql security invoker set search_path=public as $$
declare j pg_temp.gen_face; n integer;
begin
  perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
  select * into j from pg_temp.gen_face where id=p_id for update;
  if j.id is null or j.meta->>'pipeline_version'<>'2' or j.hidden_at is not null
    or j.status not in ('waiting','uploading','queued','running')
    or (j.locked_at is not null and j.locked_at>now()-interval '10 minutes') then return; end if;
  if j.meta->'video_workflow'->>'key'='genjutsu' and not pg_temp.genjutsu_image_eligible(j.id,j.created_at) then return; end if;
  if j.status='waiting' and j.meta->>'stage' in ('face_swap','upscale') then
    if exists (
      select 1 from pg_temp.gen_face pending
      where pending.meta @> '{"pipeline_version":2}'::jsonb and pending.hidden_at is null and pending.status='waiting'
        and (coalesce(pending.meta->'video_workflow'->>'key','')<>'genjutsu' or pg_temp.genjutsu_image_eligible(pending.id,pending.created_at))
        and ((j.meta->>'stage'='upscale' and pending.meta->>'stage'='face_swap')
          or (pending.meta->>'stage'=j.meta->>'stage' and (pending.created_at,pending.id)<(j.created_at,j.id)))
    ) then return; end if;
  end if;
  if j.status='waiting' and j.meta->>'stage'<>'control_motion' then
    select (select count(*) from pg_temp.gen_face where status in ('uploading','queued','running'))+
           (select count(*) from pg_temp.gen_prod where status in ('uploading','queued','running')) into n;
    if n>=greatest(1,least(p_limit,10)) then return; end if;
  end if;
  return query update pg_temp.gen_face set locked_by=p_worker,locked_at=now(),
    status=case when j.status='waiting' and j.meta->>'stage'<>'control_motion' then 'uploading' else j.status end,
    updated_at=now() where id=p_id returning *;
end $$;

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
  if exists(select 1 from pg_temp.gen_prod active where active.id<>j.id
    and active.meta->>'workflow_key'='genjutsu'
    and (active.status in ('uploading','queued','running') or active.meta->>'pipeline_dispatch_uncertain'='true')) then return; end if;
  select (select count(*) from pg_temp.gen_prod where id<>j.id and status in ('uploading','queued','running'))+
         (select count(*) from pg_temp.gen_face where status in ('uploading','queued','running')) into n;
  select greatest(1,least(10,coalesce((config->>'concurrency')::integer,1))) into capacity from pg_temp.gen_integrations where provider='runninghub';
  if n>=coalesce(capacity,1) then return; end if;
  return query update pg_temp.gen_prod set status='uploading',progress=5,attempt_count=case when j.status='uploading' then attempt_count else attempt_count+1 end,
    locked_at=now(),locked_by=p_worker,last_error=null,updated_at=now() where id=j.id returning *;
end $$;

do $test$
declare first_id uuid:='00000000-0000-4000-8000-000000000001'; second_id uuid:='00000000-0000-4000-8000-000000000002'; n integer;
begin
 insert into gen_face(id,user_id,status,created_at,meta) values
 (first_id,first_id,'waiting','2026-11-01','{"pipeline_version":2,"stage":"face_swap","video_workflow":{"key":"genjutsu"}}'),
 (second_id,first_id,'waiting','2026-11-02','{"pipeline_version":2,"stage":"face_swap","video_workflow":{"key":"genjutsu"}}');
 select count(*) into n from pg_temp.lease_image_pipeline(second_id,'second',2); if n<>0 then raise exception 'second Genjutsu bypassed first';end if;
 select count(*) into n from pg_temp.lease_image_pipeline(first_id,'first',2);if n<>1 then raise exception 'first Genjutsu not leased';end if;
 update gen_face set status='waiting',locked_by=null,locked_at=null,meta=jsonb_set(meta,'{stage}','"upscale"') where id=first_id;
 select count(*) into n from pg_temp.lease_image_pipeline(first_id,'upscale',2);if n<>1 then raise exception 'ineligible later face blocked first upscale';end if;
 update gen_face set status='waiting',locked_by=null,locked_at=null,meta=jsonb_set(meta,'{stage}','"control_motion"') where id=first_id;
 select count(*) into n from pg_temp.lease_image_pipeline(second_id,'second',2);if n<>0 then raise exception 'second started during Gemini/video';end if;
 update gen_face set status='ready' where id=first_id;
 select count(*) into n from pg_temp.lease_image_pipeline(second_id,'second',2);if n<>1 then raise exception 'second not released after completion';end if;
 update gen_face set status='failed',meta=meta||'{"dispatch_uncertain":true}' where id=first_id;
 update gen_face set status='waiting',locked_by=null,locked_at=null where id=second_id;
 select count(*) into n from pg_temp.lease_image_pipeline(second_id,'second',2);if n<>0 then raise exception 'uncertain older generation did not block next';end if;
 truncate gen_face;
 insert into gen_face(id,user_id,status,created_at,meta) values(first_id,first_id,'waiting','2026-11-01','{"pipeline_version":2,"stage":"face_swap","video_workflow":{"key":"motion_control"}}');
 select count(*) into n from pg_temp.lease_image_pipeline(first_id,'v7',2);if n<>1 then raise exception 'V7 image behavior changed';end if;
 truncate gen_face;
 insert into gen_prod(id,user_id,status,created_at,meta,attempt_count,max_attempts,next_attempt_at) values
 (first_id,first_id,'motion_waiting','2026-11-01','{"workflow_key":"genjutsu","workflow_id":"2117411301344411649"}',0,1,now()),
 (second_id,first_id,'motion_waiting','2026-11-02','{"workflow_key":"genjutsu","workflow_id":"2117411301344411649"}',0,1,now());
 select count(*) into n from pg_temp.claim_genjutsu_job('first',2);if n<>1 then raise exception 'first video not claimed';end if;
 select count(*) into n from pg_temp.claim_genjutsu_job('second',2);if n<>0 then raise exception 'concurrent Genjutsu videos';end if;
 update gen_prod set locked_at=now()-interval '11 minutes' where id=first_id;
 select count(*) into n from pg_temp.claim_genjutsu_job('recover',1);if n<>1 then raise exception 'expired pre-create lease cannot recover';end if;
 if (select attempt_count from gen_prod where id=first_id)<>1 then raise exception 'recovery consumed duplicate attempt';end if;
 update gen_prod set status='ready',locked_at=null,locked_by=null where id=first_id;
 select count(*) into n from pg_temp.claim_genjutsu_job('next',1);if n<>1 then raise exception 'next video not released';end if;
 update gen_prod set status='motion_waiting',locked_at=null,locked_by=null,attempt_count=0 where id=second_id;
 update gen_prod set status='failed',meta=meta||'{"pipeline_dispatch_uncertain":true}' where id=first_id;
 select count(*) into n from pg_temp.claim_genjutsu_job('uncertain',1);if n<>0 then raise exception 'uncertain dispatch allowed another video';end if;
 update gen_prod set status='ready',meta=meta-'pipeline_dispatch_uncertain' where id=first_id;
 insert into gen_face(id,status,meta) values(gen_random_uuid(),'queued','{}'),(gen_random_uuid(),'running','{}');
 select count(*) into n from pg_temp.claim_genjutsu_job('full',1);if n<>0 then raise exception 'shared provider capacity bypassed';end if;
end $test$;
select 'PASS: whole-job FIFO, image-stage handoff, V7 isolation, one video, lease recovery, uncertain dispatch and shared capacity' as result;
rollback;
