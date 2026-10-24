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
    let detail:any=null;
    try{
      const response=await fetch(base+"/task/openapi/outputs",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({apiKey,taskId}),signal:AbortSignal.timeout(10000)});
      const payload=await response.json();
      if(response.ok)detail=extractMotionFailure(payload);
    }catch{}
    checked++;
    const next={...reserved,...(detail?{runninghub_failure:detail}: {})};
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
  const reason=payload?.data?.failedReason||payload?.failedReason||payload?.data?.data?.failedReason;
  if(Number(payload?.code)!==805||!reason||typeof reason!=="object")return null;
  const scrub=(v:any)=>String(v||"").replace(/https?:\/\/\S+/gi,"[URL]").replace(/(apiKey|token|authorization)\s*[:=]\s*\S+/gi,"$1=[redacted]").slice(0,1200);
  const node=scrub(reason.node_id||reason.nodeId||reason.node_name).slice(0,100),type=scrub(reason.exception_type),message=scrub(reason.exception_message);
  let display=[type,message,node?"node "+node:""].filter(Boolean).join(" · ");
  if(/outofmemory|vram oom|insufficient vram|cuda.*out of memory/i.test(type+" "+message))
    display="Memória de vídeo da GPU insuficiente (VRAM)"+(node?" · node "+node:"")+". A RunningHub encerrou a geração. Não houve nova tentativa automática.";
  if(!display)return null;
  return {node,exception_type:type,exception_message:message,message:display.slice(0,1800)};
}
