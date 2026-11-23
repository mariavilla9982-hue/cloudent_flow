// Quarantine an unlocatable task; never assert provider cancellation or permit a retry.
export function missingMotionTaskPatch(job:any,observations:any[],now=Date.now()){
 if(job?.meta?.workflow_key!=='motion_control'||job.status!=='running'||job.locked_by||job.result_video_id||job.meta.motion_preview_file||!job.runninghub_task_id||observations.length!==2)return null;
 for(const o of observations){
  if(o.task_id!==job.runninghub_task_id||o.status!=='UNKNOWN'||o.status_code!==807||o.outputs_code!==807||!Number.isFinite(o.checked_at)||now-o.checked_at<0||now-o.checked_at>60000)return null;
  const c=o.capacity;
  if(!c||Number(c.code)!==0||![c.data?.concurrentLimit,c.data?.runningCount,c.data?.queuedCount,c.data?.totalCurrentTasks].every(x=>x!==null&&x!==undefined&&String(x).trim()!==''&&Number.isSafeInteger(Number(x)))||Number(c.data.concurrentLimit)<1||Number(c.data.runningCount)!==0||Number(c.data.queuedCount)!==0||Number(c.data.totalCurrentTasks)!==0)return null;
 }
 return {status:'failed',last_error:'RunningHub não localizou esta tarefa (807). A fila externa foi confirmada vazia. Execução isolada para liberar a fila; nova tentativa bloqueada até reconciliação.',completed_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString(),meta:{...job.meta,provider_status:'UNKNOWN',provider_terminal_status:null,provider_reconciliation_required:true,provider_retry_blocked:true,pipeline_dispatch_uncertain:false,missing_task_quarantine:{task_id:job.runninghub_task_id,observed_at:new Date(now).toISOString(),status_code:807,outputs_code:807,empty_queue_checks:2,reason:'task_not_found_provider_idle',retry_blocked:true}}};
}
