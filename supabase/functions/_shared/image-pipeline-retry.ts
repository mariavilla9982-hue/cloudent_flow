import {genjutsuContentBlockMessage} from './genjutsu-diagnostics.ts';

export const knownGenjutsu503=(p:any)=>p?.meta?.workflow_key==='genjutsu'&&p.last_error==='Gemini recusou a operação (HTTP 503).';
// Resume only Motion. The original video and completed image stages are immutable.
export async function retryPipelineMotion(admin:any,userId:string,id:string,parent?:any,failedOnly=false){
  const check=(r:any)=>{if(r.error)throw r.error;return r.data;};
  const p=check(await admin.from('production_jobs').select('*').eq('id',id).eq('user_id',userId).maybeSingle());
  const j=parent??check(await admin.from('face_swap_jobs').select('*').eq('id',id).eq('user_id',userId).contains('meta',{pipeline_version:2}).maybeSingle());
  if(!p||!j||p.hidden_at||j.hidden_at||p.meta?.image_pipeline_version!==2||j.meta?.stage!=='control_motion')return {ok:false,error:'Pipeline não encontrado.',status:404};
  if(failedOnly&&p.status!=='failed')return {ok:false,error:'O vídeo já mudou de estado.',status:409};
  if(p.status==='motion_waiting'||['queued','running','uploading'].includes(p.status))return {ok:true,queued:true,task_exists:!!p.runninghub_task_id};
  if(p.meta?.workflow_key==='genjutsu'&&p.status==='failed'&&!p.runninghub_task_id){
    const block=genjutsuContentBlockMessage(p.meta.genjutsu_prompt?.verifiedProviderFinishReason);
    if(block)return {ok:false,error:block,status:409};
  }
  if(p.meta?.workflow_key==='genjutsu'&&p.status==='failed'&&!p.result_video_id&&!p.runninghub_task_id&&!p.meta?.pipeline_dispatch_intent&&!p.meta?.pipeline_dispatch_uncertain&&(p.meta?.genjutsu_prompt?.status!=='generating'||!!p.meta?.genjutsu_prompt?.interactionId||knownGenjutsu503(p))){
    const state=p.meta.genjutsu_prompt?{...p.meta.genjutsu_prompt,status:p.meta.genjutsu_prompt.status==='complete'?'complete':'preparing'}:undefined;
    if(state){delete state.retryAt;delete state.transientAttempts;}
    // An explicit retry starts a fresh analysis only after a terminal prompt
    // failure. Polling the rejected/completed interaction would replay the same
    // invalid output forever; in-progress interactions must still be resumed.
    if(state&&p.meta.genjutsu_prompt.status==='failed'){
      state.previousInteractionId=state.interactionId||state.previousInteractionId;
      delete state.interactionId;delete state.repairInteractionId;
      delete state.formatRepairAttempts;delete state.processingRetryAttempts;
      delete state.processingCheck;
      delete state.interactionStartedAt;delete state.interactionStatus;
    }
    for(const kind of ['video','image'])if(!state?.interactionId&&state?.[kind]&&(state[kind].state==='FAILED'||Date.parse(state[kind].expirationTime)<=Date.now()))delete state[kind];
    const meta={...p.meta,...(state?{genjutsu_prompt:state}:{})};
    const updated=check(await admin.from('production_jobs').update({status:'motion_waiting',attempt_count:0,next_attempt_at:new Date().toISOString(),last_error:null,completed_at:null,locked_at:null,locked_by:null,meta}).eq('id',id).eq('user_id',userId).eq('status','failed').is('runninghub_task_id',null).is('result_video_id',null).is('hidden_at',null).eq('updated_at',p.updated_at).select('id'));
    if(failedOnly&&!updated?.length)return {ok:false,error:'O vídeo já mudou de estado.',status:409};
    if(updated?.length)check(await admin.from('face_swap_jobs').update({status:'waiting',last_error:null,completed_at:null,meta:{...j.meta,provider_failed:false,dispatch_uncertain:false,error_stage:null,pipeline_status:'CONTROL_MOTION_WAITING'}}).eq('id',id).eq('user_id',userId));
    return {ok:true,queued:true,reused_inputs:true};
  }
  const recovery=p.meta?.genjutsu_capture_recovery;
  const unavailableCapture=p.meta?.workflow_key==='genjutsu'&&recovery?.status==='provider_output_unavailable'&&recovery.node_id==='482'&&String(recovery.task_id)===String(p.runninghub_task_id)&&p.meta?.motion_preview_file?.node_id==='482'&&String(p.meta.motion_preview_file.task_id)===String(p.runninghub_task_id)&&!p.meta?.motion_preview_available;
  if(p.status!=='failed'||!p.runninghub_task_id||p.meta?.provider_status!=='FAILED'||String(p.meta?.provider_status_task_id)!==String(p.runninghub_task_id)||p.meta?.pipeline_dispatch_uncertain||p.result_video_id||(p.meta?.motion_preview_file&&!unavailableCapture))return {ok:false,error:'Confirme a falha da tarefa antes de repetir. Uma saída existente deve ser recuperada.',status:409};
  const directFrame=p.meta.workflow_key==='genjutsu'&&p.meta.input_mode==='manual_frame'&&j.meta?.input_mode==='manual_frame';
  const image=directFrame?j.meta.prepared_frame:j.meta?.upscale_result;
  if(!p.original_storage_path||!image?.path||p.frame_storage_path!==image.path)return {ok:false,error:'Vídeo original ou frame preparado indisponível.',status:409};
  const meta={...p.meta,previous_motion_task_id:p.runninghub_task_id,pipeline_dispatch_intent:null,pipeline_dispatch_uncertain:false};
  if(unavailableCapture)meta.previous_motion_capture={task_id:p.runninghub_task_id,file:p.meta.motion_preview_file,recovery};
  delete meta.genjutsu_capture_recovery;delete meta.genjutsu_execution;delete meta.genjutsu_execution_error;
  for(const key of Object.keys(meta))if(key.startsWith('provider_')||key.startsWith('motion_preview_')||key.startsWith('motion_execution_'))delete meta[key];
  const claimed=check(await admin.from('production_jobs').update({status:'motion_waiting',progress:0,runninghub_task_id:null,runninghub_video_file:null,runninghub_frame_file:null,attempt_count:0,next_attempt_at:new Date().toISOString(),last_error:null,locked_at:null,locked_by:null,started_at:null,completed_at:null,meta,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',userId).eq('status','failed').eq('runninghub_task_id',p.runninghub_task_id).eq('updated_at',p.updated_at).is('result_video_id',null).is('hidden_at',null).select('id'));
  if(failedOnly&&!claimed?.length)return {ok:false,error:'O vídeo já mudou de estado.',status:409};
  if(!claimed?.length)return {ok:true,queued:true,task_exists:true};
  check(await admin.from('face_swap_jobs').update({status:'waiting',last_error:null,completed_at:null,meta:{...j.meta,provider_failed:false,dispatch_uncertain:false,error_stage:null,pipeline_status:'CONTROL_MOTION_RUNNING'}}).eq('id',id).eq('user_id',userId));
  return {ok:true,queued:true,resumed_stage:'control_motion',reused_inputs:true};
}
