-- Preserve live GENJUTSU 0 queue contracts, with consistent priority and safe tombstones.
BEGIN;
ALTER TABLE public.face_swap_jobs ADD COLUMN IF NOT EXISTS queue_priority_at timestamptz;
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS queue_priority_at timestamptz;
CREATE OR REPLACE FUNCTION public.claim_genjutsu_job(p_worker text, p_limit integer DEFAULT 1)
 RETURNS SETOF production_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare j public.production_jobs; n integer; capacity integer; cap integer; head_id uuid;
begin
 -- genjutsu_paused_guard_20261118
 if coalesce((select value->>'paused' from public.app_settings where key='genjutsu_queue_config'),'false')='true' then return;end if;
 if p_limit<1 then return;end if;
 perform pg_advisory_xact_lock(hashtext('cloudent-genjutsu-prompt-claim')::bigint);
 perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
 select 1 into cap from app_settings where key='genjutsu_queue_config';cap:=1;
 if cap=1 then
  head_id:=public.genjutsu_serial_head();
  if head_id is null then return;end if;
 end if;
 select * into j from production_jobs c where c.meta->>'workflow_key'='genjutsu' and c.meta->>'workflow_id'='2124648844280733698'
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
 -- Module limit is the serial guard above; remote capacity is verified by the worker.
 return query update production_jobs set status='uploading',progress=5,
 attempt_count=case when j.status='uploading' then attempt_count else attempt_count+1 end,
 locked_at=now(),locked_by=p_worker,last_error=null,updated_at=now(),
 meta=meta||case when cap=1 then jsonb_build_object('genjutsu_serial_turn_at',coalesce(meta->>'genjutsu_serial_turn_at',now()::text)) else '{}'::jsonb end
 where id=j.id returning *;
end $function$;

REVOKE ALL ON FUNCTION public.claim_genjutsu_job(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_genjutsu_job(text,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.claim_genjutsu_prompt_job(p_worker text, p_limit integer DEFAULT 1)
 RETURNS SETOF production_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare j public.production_jobs; cap integer; active integer; head_id uuid;
begin
 if p_worker not like 'genjutsu-prompt-%' or p_limit<1 then return;end if;
 perform pg_advisory_xact_lock(hashtext('cloudent-genjutsu-prompt-claim')::bigint);
 select 1 into cap from app_settings where key='genjutsu_queue_config';cap:=1;
 if cap=1 then
  head_id:=public.genjutsu_serial_head();
  if head_id is null or exists(select 1 from production_jobs c
    where c.id<>head_id and c.meta->>'workflow_key'='genjutsu'
    and (c.status in ('uploading','queued','running') or c.meta->>'pipeline_dispatch_uncertain'='true'))
  then return;end if;
 end if;
 select * into j from production_jobs c where c.meta->>'workflow_key'='genjutsu' and c.meta->>'workflow_id'='2124648844280733698'
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
 meta=meta||jsonb_build_object('prompt_started_at',coalesce(meta->>'prompt_started_at',now()::text),'preparation_status','PREPARING')||
   case when cap=1 then jsonb_build_object('genjutsu_serial_turn_at',coalesce(meta->>'genjutsu_serial_turn_at',now()::text)) else '{}'::jsonb end
 where id=j.id returning *;
end $function$;

REVOKE ALL ON FUNCTION public.claim_genjutsu_prompt_job(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_genjutsu_prompt_job(text,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.genjutsu_image_eligible(p_id uuid,p_created_at timestamptz) RETURNS boolean LANGUAGE sql STABLE SET search_path TO public AS $function$
 select not exists (
 select 1 from face_swap_jobs older join face_swap_jobs current on current.id=p_id
 where older.meta->'video_workflow'->>'key'='genjutsu' and older.hidden_at is null
 and older.meta->>'stage' not in ('upload','control_motion')
 and (older.status in ('waiting','uploading','queued','running') or older.meta->>'dispatch_uncertain'='true')
 and older.id<>current.id
 and (older.status in ('uploading','queued','running') or
 (coalesce(older.queue_priority_at,'-infinity'::timestamptz)>coalesce(current.queue_priority_at,'-infinity'::timestamptz)) or
 (older.queue_priority_at is not distinct from current.queue_priority_at and (older.created_at,older.id)<(current.created_at,current.id)))
 ); $function$;

REVOKE ALL ON FUNCTION public.genjutsu_image_eligible(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.genjutsu_image_eligible(uuid,timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION public.genjutsu_queue_action(p_id uuid, p_user_id uuid, p_operation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare f face_swap_jobs; p production_jobs; stamp timestamptz:=clock_timestamp();
begin
 if p_operation not in ('delete','request_delete','prioritize','unprioritize') then return jsonb_build_object('ok',false,'status',400,'error','Operação inválida.');end if;
 -- Same ordering as the prompt/video claims; protects deletion vs handoff and dispatch.
 perform pg_advisory_xact_lock(hashtext('cloudent-genjutsu-prompt-claim')::bigint);
 perform pg_advisory_xact_lock(hashtext('cloudent-runninghub-claim')::bigint);
 select * into f from face_swap_jobs where id=p_id and user_id=p_user_id for update;
 if f.id is null or f.meta->>'pipeline_version' is distinct from '2' or f.meta->'video_workflow'->>'key' is distinct from 'genjutsu'
 then return jsonb_build_object('ok',false,'status',404,'error','Vídeo não encontrado.');end if;
 select * into p from production_jobs where id=f.production_job_id and user_id=p_user_id for update;
 if p_operation='delete' and f.hidden_at is not null then return jsonb_build_object('ok',true,'already_deleted',true);end if;
 if f.hidden_at is not null then return jsonb_build_object('ok',false,'status',409,'error','Vídeo excluído.');end if;
 if p.id is not null and p.meta->>'workflow_key' is distinct from 'genjutsu' then raise exception 'Workflow inválido';end if;
 if p_operation in ('prioritize','unprioritize') then
  if p.id is not null and ((p.locked_at>now()-interval '2 minutes') or p.status<>'motion_waiting' or p.runninghub_task_id is not null or p.result_video_id is not null or nullif(p.meta->>'pipeline_dispatch_intent','') is not null)
   or p.id is null and (f.status<>'waiting' or f.runninghub_task_id is not null or nullif(f.meta->>'dispatch_intent','') is not null)
  then return jsonb_build_object('ok',false,'status',409,'error','Só vídeos pendentes podem ser priorizados.');end if;
  update face_swap_jobs set queue_priority_at=case when p_operation='prioritize' then stamp else null end,updated_at=stamp where id=f.id;
  update production_jobs set queue_priority_at=case when p_operation='prioritize' then stamp else null end,updated_at=stamp where id=p.id;
 else
  -- Known terminal receipt is required for remote work, including failed/uncertain creates.
  if p.id is not null and (p.status in ('queued','running') or p.meta->>'provider_task_pending'='true' or p.meta->>'pipeline_dispatch_uncertain'='true'
    or p.runninghub_task_id is not null and p.status not in ('ready','cancelled') and coalesce(p.meta->>'provider_status','') not in ('SUCCESS','FAILED','CANCELLED','CANCEL'))
  or f.runninghub_task_id is not null and f.status in ('uploading','queued','running')
  then
   if p_operation='request_delete' then
    update production_jobs set meta=meta||jsonb_build_object('delete_requested_at',stamp),updated_at=stamp where id=p.id;
    update face_swap_jobs set meta=meta||jsonb_build_object('delete_requested_at',stamp),updated_at=stamp where id=f.id;
    return jsonb_build_object('ok',true,'confirmation_pending',true);
   end if;
   return jsonb_build_object('ok',false,'reason','remote_active','status',409,'error','Confirme o encerramento da tarefa remota antes de excluir.');
  end if;
  if (p.locked_at>now()-interval '10 minutes') or (f.locked_at>now()-interval '10 minutes')
    or p.status='uploading' or f.status in ('uploading','queued','running')
    or p.runninghub_task_id is null and nullif(p.meta->>'pipeline_dispatch_intent','') is not null
    or f.meta->>'dispatch_uncertain'='true'
  then return jsonb_build_object('ok',false,'status',409,'error','Envio ou atualização em andamento. Aguarde a confirmação antes de excluir.');end if;
  update production_jobs set hidden_at=stamp,status=case when status='motion_waiting' then 'cancelled' else status end,
    locked_at=null,locked_by=null,queue_priority_at=null,meta=meta||jsonb_build_object('deleted_at',stamp,'auto_retry_disabled',true),updated_at=stamp where id=p.id;
  update face_swap_jobs set hidden_at=stamp,status=case when status='waiting' then 'cancelled' else status end,
    locked_at=null,locked_by=null,queue_priority_at=null,meta=meta||jsonb_build_object('deleted_at',stamp),updated_at=stamp where id=f.id;
 end if;
 insert into activity_logs(level,event_type,message,meta) values('info','genjutsu_queue_'||p_operation,'GENJUTSU 0: '||p_operation,jsonb_build_object('job_id',f.id,'user_id',p_user_id));
 return jsonb_build_object('ok',true,'prioritized',p_operation='prioritize');
end $function$;

REVOKE ALL ON FUNCTION public.genjutsu_queue_action(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.genjutsu_queue_action(uuid,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.genjutsu_serial_head()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 select c.id
 from production_jobs c
 where c.meta->>'workflow_key'='genjutsu' and c.meta->>'workflow_id'='2124648844280733698'
 and c.hidden_at is null and c.runninghub_task_id is null and c.result_video_id is null
 and nullif(c.meta->>'pipeline_dispatch_intent','') is null
 and (c.status='uploading' or (c.status='motion_waiting' and c.attempt_count<c.max_attempts))
 and coalesce(c.meta->'genjutsu_prompt'->>'status','')<>'failed'
 -- A reserved turn survives an earlier video becoming eligible or being retried.
 order by (c.status='uploading') desc,
   (c.locked_at>now()-interval '2 minutes') desc nulls last,
   (coalesce(c.meta->'genjutsu_prompt'->>'status','')<>'complete'
      and c.meta->'genjutsu_prompt'->>'interactionId' is not null) desc,
   c.queue_priority_at desc nulls last,c.created_at,c.id
 limit 1;
$function$;

REVOKE ALL ON FUNCTION public.genjutsu_serial_head() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.genjutsu_serial_head() TO service_role;
CREATE OR REPLACE FUNCTION public.lease_image_pipeline(p_id uuid, p_worker text, p_limit integer DEFAULT 1)
 RETURNS SETOF face_swap_jobs
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
          or (pending.meta->>'stage'=j.meta->>'stage' and (
            coalesce(pending.queue_priority_at,'-infinity'::timestamptz)>coalesce(j.queue_priority_at,'-infinity'::timestamptz)
            or pending.queue_priority_at is not distinct from j.queue_priority_at and (pending.created_at,pending.id)<(j.created_at,j.id))))
    ) then return; end if;
  end if;
  if j.status='waiting' and j.meta->>'stage'<>'control_motion' then
    select count(*) into n from public.face_swap_jobs where status in ('uploading','queued','running');
    if n>=greatest(1,least(p_limit,10)) then return; end if;
  end if;
  return query update public.face_swap_jobs set locked_by=p_worker,locked_at=now(),
    status=case when j.status='waiting' and j.meta->>'stage'<>'control_motion' then 'uploading' else j.status end,
    updated_at=now() where id=p_id returning *;
end
$function$;

REVOKE ALL ON FUNCTION public.lease_image_pipeline(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lease_image_pipeline(uuid,text,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.schedule_genjutsu_result(p_id uuid, p_user_id uuid, p_account_id uuid, p_at timestamp with time zone, p_caption text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare p production_jobs; s schedules; stamp timestamptz:=clock_timestamp();
begin
 select * into p from production_jobs where id=p_id and user_id=p_user_id for update;
 if p.id is null or p.hidden_at is not null or p.meta->>'workflow_key' is distinct from 'genjutsu' or p.meta->>'workflow_id' is distinct from '2124648844280733698'
 then return jsonb_build_object('ok',false,'status',404,'error','Vídeo não encontrado.');end if;
 if p.status<>'ready' or p.result_video_id is null then return jsonb_build_object('ok',false,'status',409,'error','O vídeo ainda não está concluído.');end if;
 if p_at<=now() then return jsonb_build_object('ok',false,'status',400,'error','Escolha um horário futuro.');end if;
 -- API resolves account access first. Also require enabled Instagram account inside the transaction.
 if not exists(select 1 from platform_accounts where id=p_account_id and platform='instagram' and enabled)
 then return jsonb_build_object('ok',false,'status',409,'error','Escolha uma conta Instagram conectada.');end if;
 perform 1 from videos where id=p.result_video_id for update;
 select * into s from schedules where video_id=p.result_video_id and status<>'cancelled' order by created_at limit 1;
 if s.id is not null then return jsonb_build_object('ok',true,'already_scheduled',true,'schedule',to_jsonb(s));end if;
 update videos set caption=p_caption,status='scheduled',platform='instagram',platform_account_id=p_account_id where id=p.result_video_id;
 insert into schedules(video_id,scheduled_at,status,smart_mode,smart_strategy,smart_strategy_locked,platform,platform_account_id)
 values(p.result_video_id,p_at,'scheduled','manual','manual',true,'instagram',p_account_id) returning * into s;
 insert into job_queue(job_type,platform,platform_account_id,schedule_id,run_at,payload)
 values('publish_reel','instagram',p_account_id,s.id,p_at,jsonb_build_object('schedule_id',s.id,'production_job_id',p.id));
 update production_jobs set meta=meta||jsonb_build_object('scheduled',true,'schedule_id',s.id,'scheduled_at',p_at,'platform_account_id',p_account_id),updated_at=stamp where id=p.id;
 insert into activity_logs(level,event_type,message,meta) values('info','production_result_scheduled','GENJUTSU 0 adicionado ao calendário',jsonb_build_object('production_job_id',p.id,'schedule_id',s.id));
 return jsonb_build_object('ok',true,'schedule',to_jsonb(s));
end $function$;

REVOKE ALL ON FUNCTION public.schedule_genjutsu_result(uuid,uuid,uuid,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_genjutsu_result(uuid,uuid,uuid,timestamptz,text) TO service_role;
COMMIT;

