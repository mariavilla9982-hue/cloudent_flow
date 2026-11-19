export const isMotionStatusJob=(job:any)=>job?.meta?.workflow_key==="motion_control";
export async function readMotionProviderStatus(base:string,apiKey:string,taskId:string){
  const post=async(path:string)=>{
    const response=await fetch(base+path,{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({apiKey,taskId}),signal:AbortSignal.timeout(10000)});
    let raw:any={};try{raw=await response.json()}catch{}
    return {response,raw};
  };
  const failureDetail=async(fallback:any)=>{
    try{
      const {response,raw}=await post("/task/openapi/outputs");
      const reason=raw?.data?.failedReason;
      if(response.ok&&Number(raw?.code)===805&&reason){
        const node=String(reason.node_id||reason.node_name||"").slice(0,100);
        const type=String(reason.exception_type||"");
        const message=String(reason.exception_message||"");
        if(/outofmemory|vram oom|insufficient vram|cuda.*out of memory/i.test(type+" "+message)){
          return "Memória de vídeo da GPU insuficiente (VRAM)"+(node?" · node "+node:"")+". A geração falhou na RunningHub. Revise a capacidade da GPU ou as dimensões/duração da entrada antes de tentar novamente.";
        }
        if(message||type)return [type,message,node?"node "+node:""].filter(Boolean).join(" · ").slice(0,1800);
      }
    }catch{}
    return fallback||"RunningHub falhou";
  };
  let lastError="RunningHub não retornou um status reconhecido.";
  try{
    const {response,raw}=await post("/openapi/v2/query");
    const status=String(raw?.status||"").toUpperCase();
    if(response.ok&&(!raw?.taskId||String(raw.taskId)===taskId)&&["QUEUED","RUNNING","SUCCESS","FAILED","CANCELLED","CANCELED"].includes(status)){
      const fallback=raw?.errorMessage||raw?.failedReason?.exception_message||raw?.failedReason?.node_name||null;
      return {status,source:"v2",raw,error:status==="FAILED"?await failureDetail(fallback):fallback,checkedAt:new Date().toISOString()};
    }
  }catch(e){lastError=e instanceof Error?e.message:String(e)}
  try{
    const {response,raw}=await post("/task/openapi/status");
    const status=Number(raw?.code)===0?String(raw?.data||"").toUpperCase():"";
    if(response.ok&&["QUEUED","RUNNING","SUCCESS","FAILED","CANCELLED","CANCELED"].includes(status)){
      let error:any=null;
      if(status==="FAILED"){
        error=await failureDetail(null);
      }
      return {status,source:"legacy",raw,error,checkedAt:new Date().toISOString()};
    }
    lastError="RunningHub: status indisponível · código "+String(raw?.code??response.status);
  }catch(e){lastError=e instanceof Error?e.message:String(e)}
  // HTTP errors and an unrecognized response must never become RUNNING.
  return {status:"UNKNOWN",source:"error",raw:null,error:lastError,checkedAt:new Date().toISOString()};
}
export async function applyMotionProviderStatus(admin:any,job:any,state:any){
  const {data,error}=await admin.rpc("sync_motion_task_status",{
    p_job_id:job.id,p_task_id:String(job.runninghub_task_id),p_status:state.status,
    p_source:state.source,p_checked_at:state.checkedAt,p_error:state.error||null
  });
  if(error)throw error;
  return data;
}
