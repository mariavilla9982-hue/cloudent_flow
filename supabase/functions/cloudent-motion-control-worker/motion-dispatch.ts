export class MotionCreateError extends Error{
  payload:any;httpStatus:number;
  constructor(payload:any,httpStatus=200){super(String(payload?.msg||payload?.message||"RunningHub não confirmou a criação."));this.payload=payload;this.httpStatus=httpStatus;}
}
export function motionDispatchFailurePatch(job:any,error:any,acceptedTaskId:string|null=null,now=new Date()){
  const m={...(job.meta||{})},payload=error instanceof MotionCreateError?error.payload:null;
  const code=Number(payload?.code),msg=String(payload?.msg||"").trim();
  const taskId=acceptedTaskId||job.runninghub_task_id;
  const time=now.toISOString();
  if(taskId)return {status:"queued",progress:38,started_at:null,runninghub_task_id:String(taskId),locked_at:null,locked_by:null,last_error:null,updated_at:time,
    meta:{...m,pipeline_dispatch_uncertain:false,provider_queue_waiting:true,provider_status:"UNKNOWN",provider_status_error:"Tarefa criada; aguardando confirmação do status.",provider_status_task_id:String(taskId)}};
  const noTask=payload&&!payload?.data?.taskId&&!payload?.taskId;
  const capacity=noTask&&(code===421||code===814||msg==="TASK_QUEUE_MAXED"||msg==="PERSONAL_QUEUE_COUNT_LIMIT");
  if(capacity)return {status:"motion_waiting",progress:0,started_at:null,attempt_count:Math.max(0,Number(job.attempt_count||0)-1),
    next_attempt_at:new Date(now.getTime()+30000).toISOString(),locked_at:null,locked_by:null,last_error:null,updated_at:time,
    meta:{...m,pipeline_dispatch_intent:null,pipeline_dispatch_uncertain:false,provider_queue_waiting:true,queue_reason:"provider_capacity",last_dispatch_rejection:msg||String(code),last_dispatch_rejection_at:time}};
  const rejected=noTask&&[401,403,416,433,435,436].includes(code);
  return {status:"failed",locked_at:null,locked_by:null,last_error:rejected?String(error.message):
    m.pipeline_dispatch_intent?"Envio sem confirmação da RunningHub. Não será repetido automaticamente; é necessário reconciliar a tarefa.":String(error?.message||error),
    updated_at:time,meta:{...m,provider_queue_waiting:false,...(rejected?{pipeline_dispatch_intent:null,pipeline_dispatch_uncertain:false,dispatch_rejected:true,last_dispatch_rejection:msg||String(code)}:
      m.pipeline_dispatch_intent?{pipeline_dispatch_uncertain:true}:{})}};
}
