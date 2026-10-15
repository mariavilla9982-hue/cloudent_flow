import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const H={"Content-Type":"application/json"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const decoder=new TextDecoder();
const fromB64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));

async function decrypt(cipher:string,iv:string,master:string){
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(master));
  const key=await crypto.subtle.importKey("raw",hash,{name:"AES-GCM"},false,["decrypt"]);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(iv)},key,fromB64(cipher));
  return decoder.decode(plain);
}
function cleanBase(v:any){
  const x=String(v||"https://www.runninghub.ai").replace(/\/$/,"");
  return x.startsWith("https://")?x:"https://www.runninghub.ai";
}
async function legacyStatus(base:string,apiKey:string,taskId:string){
  const r=await fetch(base+"/task/openapi/status",{
    method:"POST",
    headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
    body:JSON.stringify({apiKey,taskId}),
    signal:AbortSignal.timeout(10000)
  });
  let j:any={};try{j=await r.json()}catch{}
  if(!r.ok)return {status:"UNKNOWN",source:"legacy_http",raw:j};
  if(Number(j?.code)===807)return {status:"NOT_FOUND",source:"legacy",raw:j};
  if(Number(j?.code)===0&&j?.data)return {status:String(j.data).toUpperCase(),source:"legacy",raw:j};
  return {status:"UNKNOWN",source:"legacy",raw:j};
}
async function providerStatus(base:string,apiKey:string,taskId:string){
  try{
    const r=await fetch(base+"/openapi/v2/query",{
      method:"POST",
      headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
      body:JSON.stringify({taskId}),
      signal:AbortSignal.timeout(10000)
    });
    let j:any={};try{j=await r.json()}catch{}
    const s=String(j?.status||"").toUpperCase();
    if(r.ok&&["QUEUED","RUNNING","SUCCESS","FAILED","CANCELLED","CANCELED"].includes(s))return {status:s,source:"v2",raw:j};
  }catch{}
  try{return await legacyStatus(base,apiKey,taskId)}catch(e:any){return {status:"UNKNOWN",source:"error",error:e instanceof Error?e.message:String(e)}}
}
async function wakeProduction(master:string){
  try{
    await fetch(Deno.env.get("SUPABASE_URL")+"/functions/v1/cloudent-production-worker",{
      method:"POST",
      headers:{"Content-Type":"application/json","x-cloudent-worker-secret":master},
      body:"{}",
      signal:AbortSignal.timeout(15000)
    });
  }catch{}
}

Deno.serve(async(req:Request)=>{
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const supplied=String(req.headers.get("x-cloudent-worker-secret")||"");
    const {data:expected,error:secretError}=await admin.rpc("get_cloudent_worker_secret");
    if(secretError)throw secretError;
    const master=String(expected||"");
    if(!master||supplied!==master)return out({ok:false,error:"unauthorized"},401);

    const {data:integration,error:integrationError}=await admin.from("integrations").select("enabled,config").eq("provider","runninghub").maybeSingle();
    if(integrationError)throw integrationError;
    const cfg:any=integration?.config||{};
    if(integration?.enabled===false)return out({ok:true,processed:0,message:"runninghub_disabled"});
    let apiKey="";
    if(cfg.apiKeyCipher&&cfg.apiKeyIv){try{apiKey=await decrypt(String(cfg.apiKeyCipher),String(cfg.apiKeyIv),master)}catch{}}
    if(!apiKey)return out({ok:false,error:"runninghub_api_key_unavailable"},500);
    const base=cleanBase(cfg.baseUrl);

    const {data:jobs,error:jobsError}=await admin.from("production_jobs")
      .select("id,status,progress,started_at,updated_at,runninghub_task_id,result_video_id,meta")
      .in("status",["queued","running"])
      .contains("meta",{workflow_key:"motion_control"})
      .not("runninghub_task_id","is",null)
      .order("created_at",{ascending:true})
      .limit(30);
    if(jobsError)throw jobsError;

    let processed=0,queued=0,running=0,terminal=0,unknown=0,needsCapture=false;
    for(const job of jobs||[]){
      const taskId=String(job.runninghub_task_id||"");
      if(!taskId)continue;
      const state=await providerStatus(base,apiKey,taskId);
      const status=String(state.status||"UNKNOWN").toUpperCase();
      const now=new Date().toISOString();
      const meta:any={...(job.meta||{}),provider_status:status,provider_status_source:state.source||null,provider_status_checked_at:now};

      if(["QUEUED","PENDING"].includes(status)){
        meta.provider_queue_waiting=true;
        meta.provider_run_started_at=null;
        await admin.from("production_jobs").update({status:"queued",progress:38,started_at:null,meta,last_error:null,updated_at:now}).eq("id",job.id).eq("runninghub_task_id",taskId);
        queued++;processed++;continue;
      }

      if(status==="RUNNING"){
        const oldStarted=Date.parse(String(job.started_at||""));
        const oldUpdated=Date.parse(String(job.updated_at||""));
        const suspicious=Number.isFinite(oldStarted)&&Number.isFinite(oldUpdated)&&oldUpdated+1000<oldStarted;
        let runStarted=String(meta.provider_run_started_at||"");
        if(!runStarted||job.status!=="running"||job.meta?.provider_queue_waiting===true||suspicious)runStarted=now;
        meta.provider_queue_waiting=false;
        meta.provider_run_started_at=runStarted;
        await admin.from("production_jobs").update({status:"running",progress:Math.max(62,Number(job.progress||0)),started_at:runStarted,meta,last_error:null,updated_at:now}).eq("id",job.id).eq("runninghub_task_id",taskId);
        running++;processed++;continue;
      }

      if(status==="SUCCESS"){
        meta.provider_queue_waiting=false;
        meta.provider_terminal_status="SUCCESS";
        meta.provider_task_pending=true;
        await admin.from("production_jobs").update({meta,last_error:null,updated_at:now}).eq("id",job.id).eq("runninghub_task_id",taskId);
        needsCapture=true;terminal++;processed++;continue;
      }

      if(["FAILED","CANCELLED","CANCELED","NOT_FOUND"].includes(status)){
        meta.provider_queue_waiting=false;
        meta.provider_terminal_status=status;
        meta.provider_task_pending=false;
        if(job.result_video_id){
          await admin.from("production_jobs").update({status:"ready",progress:100,completed_at:now,meta,last_error:null,locked_at:null,locked_by:null,updated_at:now}).eq("id",job.id).eq("runninghub_task_id",taskId);
        }else{
          await admin.from("production_jobs").update({status:"failed",meta,last_error:status==="NOT_FOUND"?"RunningHub não encontrou mais esta task.":"RunningHub encerrou a task como "+status,completed_at:now,locked_at:null,locked_by:null,updated_at:now}).eq("id",job.id).eq("runninghub_task_id",taskId);
        }
        terminal++;processed++;continue;
      }

      meta.provider_status_error=state.error||null;
      await admin.from("production_jobs").update({meta,updated_at:now}).eq("id",job.id).eq("runninghub_task_id",taskId);
      unknown++;processed++;
    }

    if(needsCapture)EdgeRuntime.waitUntil(wakeProduction(master));
    await admin.from("worker_runtime").upsert({worker_name:"motion_status",last_heartbeat:new Date().toISOString(),last_success_at:new Date().toISOString(),last_error:null,last_jobs:processed,updated_at:new Date().toISOString()},{onConflict:"worker_name"});
    return out({ok:true,processed,queued,running,terminal,unknown});
  }catch(e:any){
    const message=e instanceof Error?e.message:String(e);
    try{await admin.from("worker_runtime").upsert({worker_name:"motion_status",last_heartbeat:new Date().toISOString(),last_error:message,updated_at:new Date().toISOString()},{onConflict:"worker_name"})}catch{}
    return out({ok:false,error:message},500);
  }
});
