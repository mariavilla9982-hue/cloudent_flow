// Resume only Motion. The original video and completed image stages are immutable.
export async function retryPipelineMotion(admin:any,userId:string,id:string){
  const check=(r:any)=>{if(r.error)throw r.error;return r.data;};
  const p=check(await admin.from('production_jobs').select('*').eq('id',id).eq('user_id',userId).maybeSingle());
  const j=check(await admin.from('face_swap_jobs').select('*').eq('id',id).eq('user_id',userId).contains('meta',{pipeline_version:2}).maybeSingle());
  if(!p||!j||p.meta?.image_pipeline_version!==2||j.meta?.stage!=='control_motion')return {ok:false,error:'Pipeline não encontrado.',status:404};
  if(p.status==='motion_waiting'||['queued','running','uploading'].includes(p.status))return {ok:true,queued:true,task_exists:!!p.runninghub_task_id};
  if(p.status!=='failed'||!p.runninghub_task_id||p.meta?.provider_status!=='FAILED'||String(p.meta?.provider_status_task_id)!==String(p.runninghub_task_id)||p.meta?.pipeline_dispatch_uncertain||p.result_video_id||p.meta?.motion_preview_file)return {ok:false,error:'Confirme a falha da tarefa antes de repetir. Uma saída existente deve ser recuperada.',status:409};
  if(!p.original_storage_path||!j.meta?.upscale_result?.path||p.frame_storage_path!==j.meta.upscale_result.path)return {ok:false,error:'Vídeo original ou imagem Upscale indisponível.',status:409};
  const meta={...p.meta,previous_motion_task_id:p.runninghub_task_id,pipeline_dispatch_intent:null,pipeline_dispatch_uncertain:false};
  for(const key of Object.keys(meta))if(key.startsWith('provider_')||key.startsWith('motion_preview_')||key.startsWith('motion_execution_'))delete meta[key];
  const claimed=check(await admin.from('production_jobs').update({status:'motion_waiting',progress:0,runninghub_task_id:null,runninghub_video_file:null,runninghub_frame_file:null,attempt_count:0,next_attempt_at:new Date().toISOString(),last_error:null,locked_at:null,locked_by:null,started_at:null,completed_at:null,meta,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',userId).eq('status','failed').eq('runninghub_task_id',p.runninghub_task_id).select('id'));
  if(!claimed?.length)return {ok:true,queued:true,task_exists:true};
  check(await admin.from('face_swap_jobs').update({status:'waiting',last_error:null,completed_at:null,meta:{...j.meta,provider_failed:false,dispatch_uncertain:false,error_stage:null,pipeline_status:'CONTROL_MOTION_RUNNING'}}).eq('id',id).eq('user_id',userId));
  return {ok:true,queued:true,resumed_stage:'control_motion',reused_inputs:true};
}
