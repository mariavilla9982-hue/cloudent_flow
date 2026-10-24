// Invoked only behind the existing status-worker secret; never starts or retries tasks.
export async function enrichFailedMotionJobs(admin:any,base:string,apiKey:string){
  const {data:jobs,error}=await admin.from("production_jobs").select("id,user_id,status,runninghub_task_id,last_error,updated_at,meta")
    .eq("status","failed").contains("meta",{workflow_key:"motion_control"}).not("runninghub_task_id","is",null)
    .in("last_error",["工作流运行失败","RunningHub falhou","RunningHub falhou.","Falha do workflow na RunningHub."])
    .order("updated_at",{ascending:true}).limit(5);
  if(error)throw error;
  let checked=0,repaired=0;
  for(const job of jobs||[]){
    const taskId=String(job.runninghub_task_id),m=job.meta||{};
    if(m.failure_detail_task_id===taskId&&(Number(m.failure_detail_attempts||0)>=3||Date.parse(m.failure_detail_next_check||"")>Date.now()))continue;
    const claim=crypto.randomUUID(),claimTime=new Date().toISOString();
    const reserved={...m,failure_detail_claim:claim,failure_detail_task_id:taskId,failure_detail_checked_at:claimTime,failure_detail_next_check:new Date(Date.now()+300000).toISOString(),
      failure_detail_attempts:m.failure_detail_task_id===taskId?Number(m.failure_detail_attempts||0)+1:1};
    const {data:claimed,error:claimError}=await admin.from("production_jobs").update({meta:reserved,updated_at:claimTime})
      .eq("id",job.id).eq("status","failed").eq("runninghub_task_id",taskId).eq("updated_at",job.updated_at).eq("last_error",job.last_error).select("id").maybeSingle();
    if(claimError||!claimed)continue;
    let detail:any=null,querySummary:any={state:"unavailable"};
    try{
      const response=await fetch(base+"/task/openapi/outputs",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({apiKey,taskId}),signal:AbortSignal.timeout(10000)});
      const payload=await response.json();
      querySummary={http:response.status,code:payload?.code??null,message:String(payload?.msg||payload?.message||"").replace(/https?:\/\/\S+/gi,"[URL]").slice(0,300),data_type:Array.isArray(payload?.data)?"array":typeof payload?.data,data_keys:payload?.data&&typeof payload.data==="object"?Object.keys(payload.data).slice(0,20):[],reason_type:typeof(payload?.data?.failedReason||payload?.failedReason)};
      if(response.ok)detail=extractMotionFailure(payload);
    }catch{}
    checked++;
    const next={...reserved,failure_detail_response:querySummary,...(detail?{runninghub_failure:detail}: {})};
    const values:any={meta:next};if(detail?.message)values.last_error=detail.message;
    const {data:saved,error:saveError}=await admin.from("production_jobs").update(values).eq("id",job.id).eq("status","failed").eq("runninghub_task_id",taskId).contains("meta",{failure_detail_claim:claim}).select("id").maybeSingle();
    if(saveError)throw saveError;
    if(saved&&detail?.message){
      repaired++;
      // The linked pipeline may already have copied the generic failure; update only that same failed task.
      const {data:parent}=await admin.from("face_swap_jobs").select("id,meta").eq("id",job.id).eq("user_id",job.user_id).eq("production_job_id",job.id).eq("status","failed").maybeSingle();
      if(parent?.meta?.pipeline_version===2&&parent.meta.stage==="control_motion")
        await admin.from("face_swap_jobs").update({last_error:detail.message}).eq("id",job.id).eq("user_id",job.user_id).eq("status","failed").eq("production_job_id",job.id);
    }
  }
  return {checked,repaired};
}
export function extractMotionFailure(payload:any){
  const parse=(v:any)=>{if(typeof v==="string")try{return JSON.parse(v)}catch{}return v;};
  const data=parse(payload?.data),reason=parse(data?.failedReason||payload?.failedReason||data?.data?.failedReason);
  if(Number(payload?.code)!==805||!reason||typeof reason!=="object")return null;
  const scrub=(v:any)=>String(v||"").replace(/https?:\/\/\S+/gi,"[URL]").replace(/(apiKey|token|authorization)\s*[:=]\s*\S+/gi,"$1=[redacted]").slice(0,1200);
  const node=scrub(reason.node_id||reason.nodeId||reason.node_name).slice(0,100),type=scrub(reason.exception_type),message=scrub(reason.exception_message);
  let display=[type,message,node?"node "+node:""].filter(Boolean).join(" · ");
  if(/outofmemory|vram oom|insufficient vram|cuda.*out of memory/i.test(type+" "+message))
    display="Memória de vídeo da GPU insuficiente (VRAM)"+(node?" · node "+node:"")+". A RunningHub encerrou a geração. Não houve nova tentativa automática.";
  if(!display)return null;
  return {node,exception_type:type,exception_message:message,message:display.slice(0,1800)};
}

export async function enrichPreviousMotionFailure(admin:any,base:string,apiKey:string){
  const {data:jobs,error}=await admin.from("production_jobs").select("id,status,updated_at,meta")
    .eq("status","motion_waiting").is("runninghub_task_id",null).contains("meta",{workflow_key:"motion_control"})
    .not("meta->>previous_motion_task_id","is",null).is("meta->previous_motion_failure",null).order("updated_at",{ascending:true}).limit(1);
  if(error)throw error;
  for(const job of jobs||[]){
    const taskId=String(job.meta.previous_motion_task_id),stamp=new Date().toISOString();
    const claimedMeta={...job.meta,previous_motion_failure:{task_id:taskId,state:"checking",checked_at:stamp}};
    const {data:claimed}=await admin.from("production_jobs").update({meta:claimedMeta,updated_at:stamp}).eq("id",job.id).eq("status","motion_waiting").is("runninghub_task_id",null).eq("updated_at",job.updated_at).select("id").maybeSingle();
    if(!claimed)continue;
    let summary:any={task_id:taskId,state:"unavailable",checked_at:stamp};
    try{
      const response=await fetch(base+"/openapi/v2/query",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({apiKey,taskId}),signal:AbortSignal.timeout(10000)});
      const raw=await response.json();
      if(response.ok&&String(raw?.taskId)===taskId){
        const clean=(v:any)=>String(v||"").replace(/https?:\/\/\S+/gi,"[URL]").replace(/(apiKey|token|authorization)\s*[:=]\s*\S+/gi,"$1=[redacted]").slice(0,1200);
        summary={task_id:taskId,state:"observed",checked_at:stamp,status:String(raw.status||""),error_code:clean(raw.errorCode),message:clean(raw.errorMessage),
          detail:extractMotionFailure({code:805,failedReason:raw.failedReason}),output_384_available:Array.isArray(raw.results)&&raw.results.some((x:any)=>String(x.nodeId)==="384"&&!!x.url)};
      }
    }catch{}
    const {data:fresh}=await admin.from("production_jobs").select("meta").eq("id",job.id).eq("status","motion_waiting").is("runninghub_task_id",null).maybeSingle();
    if(fresh&&String(fresh.meta?.previous_motion_task_id)===taskId)
      await admin.from("production_jobs").update({meta:{...fresh.meta,previous_motion_failure:summary}}).eq("id",job.id).eq("status","motion_waiting").is("runninghub_task_id",null).contains("meta",{previous_motion_task_id:taskId});
  }
}
