// Cancel only a chained Motion that has not been claimed or sent to RunningHub.
export async function cancelPipelineMotion(admin:any,userId:string,id:string){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return {ok:false,error:'Job inválido.',status:400};
  const {data,error}=await admin.rpc('cancel_waiting_pipeline_motion',{p_id:id,p_user_id:userId});
  if(error)throw error;
  if(data?.ok)return data;
  return {...data,ok:false,error:data?.reason==='not_found'?'Pipeline não encontrado.':'A fila está atualizando ou o envio já começou. Aguarde a atualização do status e tente novamente.'};
}

export async function stopGenjutsuMotion(admin:any,userId:string,id:string,cancelProvider:(taskId:string)=>Promise<any>){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return {ok:false,error:'Job inválido.',status:400};
  const {data:parent,error:parentError}=await admin.from('face_swap_jobs').select('id,meta,production_job_id,status').eq('id',id).eq('user_id',userId).contains('meta',{pipeline_version:2}).maybeSingle();
  if(parentError)throw parentError;
  if(!parent||parent.meta?.video_workflow?.key!=='genjutsu')return {ok:false,error:'GENJUTSU não encontrado.',status:404};
  if(!parent.production_job_id)return cancelPipelineMotion(admin,userId,id);
  const read=async()=>{
    const {data,error}=await admin.from('production_jobs').select('id,status,meta,runninghub_task_id,result_video_id,updated_at').eq('id',parent.production_job_id).eq('user_id',userId).maybeSingle();
    if(error)throw error;return data;
  };
  const current=await read();
  if(!current)return cancelPipelineMotion(admin,userId,id);
  if(current.meta?.workflow_key!=='genjutsu'||current.meta?.workflow_id!=='2117411301344411649')return {ok:false,error:'Workflow incompatível.',status:409};
  if(current.result_video_id||current.status==='ready')return {ok:false,error:'O vídeo já foi salvo. Use os controles do resultado.',status:409};
  if(current.status==='cancelled')return {ok:true,stopped:true};
  if(current.status==='failed')return {ok:false,error:'Esta produção já terminou com falha. Não há tarefa ativa para parar.',status:409};
  const taskId=String(current.runninghub_task_id||'');
  if(!taskId)return cancelPipelineMotion(admin,userId,id);
  if(!['queued','running'].includes(current.status))return {ok:false,error:'A tarefa está mudando de estado; atualize a fila antes de parar.',status:409};
  if(String(current.meta?.genjutsu_stop_requested_task_id||'')===taskId)return {ok:true,stop_requested:true};
  // Mark an accepted provider request, never hide a failed cancellation.
  await cancelProvider(taskId);
  for(let attempt=0;attempt<5;attempt++){
    const job=await read();
    if(!job||String(job.runninghub_task_id)!==taskId)return {ok:true,stop_requested:true,confirmation_pending:true};
    if(job.result_video_id||job.status==='ready')return {ok:true,result_ready:true};
    if(job.status==='cancelled')return {ok:true,stopped:true};
    if(job.status==='failed')return {ok:true,already_finished:true};
    if(!['queued','running'].includes(job.status))return {ok:true,stop_requested:true,confirmation_pending:true};
    if(String(job.meta?.genjutsu_stop_requested_task_id||'')===taskId)return {ok:true,stop_requested:true};
    const now=new Date().toISOString();
    const {data,error}=await admin.from('production_jobs').update({meta:{...job.meta,genjutsu_stop_requested_task_id:taskId,genjutsu_stop_requested_at:now},updated_at:now}).eq('id',job.id).eq('user_id',userId).eq('runninghub_task_id',taskId).eq('updated_at',job.updated_at).in('status',['queued','running']).is('result_video_id',null).select('id').maybeSingle();
    if(error)throw error;
    if(data)return {ok:true,stop_requested:true};
  }
  return {ok:true,stop_requested:true,confirmation_pending:true};
}
