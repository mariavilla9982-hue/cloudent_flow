alter table public.genjutsu_v3_jobs add column input_video_path text, add column input_image_path text;

create function public.handoff_genjutsu_v3(p_job_id uuid,p_worker text,p_frame jsonb default null,p_meta jsonb default null) returns uuid
language plpgsql set search_path = '' as $$
declare
 f public.face_swap_jobs;
 p public.production_jobs;
 frame_path text;
 frame_size bigint;
 frame_type text;
 frame_name text;
 v3 uuid;
 metadata jsonb;
begin
 select * into f from public.face_swap_jobs where id=p_job_id for update;
 if not found or f.storage_provider<>'r2' or f.meta->>'source' is distinct from 'face_swap_natural' then
   raise exception 'Origem inválida para GENJUTSU V3.';
 end if;
 if p_worker is null then
   if f.locked_by is not null or f.meta->>'stage' is distinct from 'control_motion' then
     raise exception 'O envio ainda está reservado no Face Swap.';
   end if;
 elsif f.locked_by is distinct from p_worker or f.meta->>'stage' is distinct from 'upscale'
   or f.meta#>>'{video_workflow,key}' is distinct from 'genjutsu_v3' then
   raise exception 'Reserva do Upscale inválida.';
 end if;

 select * into p from public.production_jobs where id=f.id for update;
 if found then
   if p.user_id<>f.user_id or p.meta->>'workflow_key' is distinct from 'genjutsu' or
      p.status not in ('motion_waiting','cancelled') or p.locked_by is not null or p.runninghub_task_id is not null or
      p.result_video_id is not null or p.meta->>'pipeline_dispatch_intent' is not null then
     raise exception 'O fluxo anterior já foi reservado ou enviado.';
   end if;
   update public.production_jobs set status='cancelled',updated_at=now(),
     meta=meta||'{"superseded_by":"genjutsu_v3"}'::jsonb where id=p.id and status='motion_waiting';
 end if;

 frame_path=coalesce(p_frame->>'path',f.result_storage_path);
 frame_type=coalesce(p_frame->>'mime',f.result_mime_type);
 frame_name=coalesce(p_frame->>'name',f.result_file_name);
 frame_size=coalesce((p_frame->>'size')::bigint,f.result_size_bytes);
 if f.original_storage_path is null or f.original_storage_path not like f.user_id::text||'/%'
   or frame_path is null or frame_path not like f.user_id::text||'/%'
   or coalesce(f.original_size_bytes,0) not between 1 and 31457280
   or coalesce(frame_size,0) not between 1 and 12582912
   or coalesce(f.original_mime_type,'') not in ('video/mp4','video/webm','video/quicktime')
   or coalesce(frame_type,'') not in ('image/jpeg','image/png','image/webp') then
   raise exception 'O vídeo original ou a foto do Upscale não está disponível no Backblaze.';
 end if;
 insert into public.genjutsu_v3_jobs(id,user_id,status,video_bytes,image_bytes,video_type,image_type,input_video_path,input_image_path)
 values(f.id,f.user_id,'queued',f.original_size_bytes,frame_size,f.original_mime_type,frame_type,f.original_storage_path,frame_path)
 on conflict(id) do nothing;
 select id into v3 from public.genjutsu_v3_jobs where id=f.id and user_id=f.user_id
   and input_video_path=f.original_storage_path and input_image_path=frame_path;
 if v3 is null then raise exception 'O job V3 existente tem entradas diferentes.'; end if;
 metadata=coalesce(p_meta,f.meta)||jsonb_build_object(
   'video_workflow','{"key":"genjutsu_v3","label":"GENJUTSU V3","workflowId":"2120974306862780417","videoNodeId":"1","videoFieldName":"video","frameNodeId":"2","frameFieldName":"image","outputNodeIds":["148","170"]}'::jsonb,
   'genjutsu_v3_job_id',v3,'stage','control_motion','pipeline_status','CONTROL_MOTION_WAITING','dispatch_intent',null,'dispatch_uncertain',false);
 update public.face_swap_jobs set status='waiting',progress=75,started_at=null,runninghub_task_id=null,
   production_job_id=null,result_storage_path=frame_path,result_file_name=frame_name,
   result_mime_type=frame_type,result_size_bytes=frame_size,meta=metadata,last_error=null,updated_at=now()
 where id=f.id;
 return v3;
end $$;
revoke all on function public.handoff_genjutsu_v3(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.handoff_genjutsu_v3(uuid,text,jsonb,jsonb) to service_role;
