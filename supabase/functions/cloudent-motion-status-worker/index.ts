import {enrichFailedMotionJobs} from "../_shared/motion-failure-repair.ts";
import {motionStorageHealth} from "./motion-storage-protection.ts";
import {readMotionProviderStatus,applyMotionProviderStatus} from "./motion-provider-state.ts";
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
    let apiKey="";
    if(cfg.apiKeyCipher&&cfg.apiKeyIv){try{apiKey=await decrypt(String(cfg.apiKeyCipher),String(cfg.apiKeyIv),master)}catch{}}
    if(!apiKey)return out({ok:false,error:"runninghub_api_key_unavailable"},500);
    const base=cleanBase(cfg.baseUrl);

    const options=await req.json().catch(()=>({}));
    // Storage availability must not stop real provider-status reconciliation.
    let storageState:any=null;
    try{storageState=await motionStorageHealth(admin);}catch{}
    if(storageState?.just_recovered&&options.sync_only!==true){
      EdgeRuntime.waitUntil(fetch(Deno.env.get("SUPABASE_URL")+"/functions/v1/cloudent-motion-control-worker",{
        method:"POST",headers:{"Content-Type":"application/json","x-cloudent-worker-secret":master},body:"{}",signal:AbortSignal.timeout(15000)
      }).catch(()=>null));
    }
    const jobs:any[]=[];
    for(let offset=0;;offset+=500){
      const {data:page,error:jobsError}=await admin.from("production_jobs")
        .select("id,status,runninghub_task_id,meta")
        .in("status",["queued","running"])
        .contains("meta",{workflow_key:"motion_control"})
        .not("runninghub_task_id","is",null).order("id",{ascending:true}).range(offset,offset+499);
      if(jobsError)throw jobsError;
      jobs.push(...(page||[]));
      if((page||[]).length<500)break;
    }

    let processed=0,queued=0,running=0,terminal=0,unknown=0,needsCapture=false;
    for(let offset=0;offset<(jobs||[]).length;offset+=4){
      await Promise.all((jobs||[]).slice(offset,offset+4).map(async(job:any)=>{
        const state=await readMotionProviderStatus(base,apiKey,String(job.runninghub_task_id));
        const updated=await applyMotionProviderStatus(admin,job,state);
        if(!updated)return;
        processed++;
        if(state.status==="QUEUED")queued++;
        else if(state.status==="RUNNING")running++;
        else if(state.status==="SUCCESS"){terminal++;needsCapture=true;}
        else if(["FAILED","CANCELED","CANCELLED"].includes(state.status))terminal++;
        else unknown++;
      }));
    }

    const failureDetails=await enrichFailedMotionJobs(admin,base,apiKey);
    if(needsCapture&&options.sync_only!==true)EdgeRuntime.waitUntil(wakeProduction(master));
    await admin.from("worker_runtime").upsert({worker_name:"motion_status",last_heartbeat:new Date().toISOString(),last_success_at:new Date().toISOString(),last_error:null,last_jobs:processed,updated_at:new Date().toISOString()},{onConflict:"worker_name"});
    return out({ok:true,processed,queued,running,terminal,unknown,failure_details:failureDetails,storage_phase:storageState?.phase||"unknown"});
  }catch(e:any){
    const message=e instanceof Error?e.message:String(e);
    try{await admin.from("worker_runtime").upsert({worker_name:"motion_status",last_heartbeat:new Date().toISOString(),last_error:message,updated_at:new Date().toISOString()},{onConflict:"worker_name"})}catch{}
    return out({ok:false,error:message},500);
  }
});
