import {motionStorageHealth,requireMotionStorage,motionCheckObject,MotionStorageSafetyError,storageRPC} from "./motion-storage-protection.ts";
import {applyMotionProviderStatus} from "./motion-provider-state.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const H={"Content-Type":"application/json"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const MAX_DIRECT=30*1024*1024;
const decoder=new TextDecoder();
const fromB64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));

async function decrypt(cipher:string,iv:string,master:string){
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(master));
  const key=await crypto.subtle.importKey("raw",hash,{name:"AES-GCM"},false,["decrypt"]);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(iv)},key,fromB64(cipher));
  return decoder.decode(plain);
}
// Hardware selection stays outside the immutable workflow graph.
function motionExecutionOptions(job:any,cfg:any){
  if(job?.meta?.workflow_key!=="motion_control")throw new Error("Motion Control: workflow do job inválido.");
  if(cfg?.executionInstanceType!=="plus")throw new Error("Motion Control: configuração de GPU 48 GB ausente. Execução bloqueada.");
  return {instanceType:"plus"};
}
function cleanBase(v:any){
  const x=String(v||"https://www.runninghub.ai").replace(/\/$/,"");
  return x.startsWith("https://")?x:"https://www.runninghub.ai";
}

async function readMotionProviderCapacity(base:string,apiKey:string){
  const response=await fetch(base+"/openapi/v2/queue/status",{
    headers:{"Authorization":"Bearer "+apiKey},cache:"no-store",signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)throw new Error("Motion Control: não foi possível consultar as vagas da RunningHub.");
  const payload=await response.json(),data=payload?.data;
  const integer=(value:any)=>value!==null&&value!==undefined&&String(value).trim()!==""&&Number.isSafeInteger(Number(value))&&Number(value)>=0;
  if(Number(payload?.code)!==0||!data||!integer(data.concurrentLimit)||Number(data.concurrentLimit)<1||
    !integer(data.runningCount)||!integer(data.queuedCount)||!integer(data.totalCurrentTasks)||
    Number(data.totalCurrentTasks)<Number(data.runningCount)+Number(data.queuedCount))
    throw new Error("Motion Control: resposta de capacidade inválida. Fila preservada.");
  const capacity={concurrent_limit:Number(data.concurrentLimit),running:Number(data.runningCount),queued:Number(data.queuedCount),total:Number(data.totalCurrentTasks),checked_at:new Date().toISOString()};
  return {...capacity,available:Math.max(0,capacity.concurrent_limit-capacity.total)};
}

function s3RegionFromEndpoint(endpoint:string){
  try{const m=new URL(endpoint).hostname.match(/^s3\.([^.]+)\.backblazeb2\.com$/i);return m?.[1]||"auto"}catch{return "auto"}
}
function keyPath(key:string){return String(key||"").split("/").map(encodeURIComponent).join("/")}
async function getObjectConfig(admin:any){
  const {data,error}=await admin.rpc("get_cloudent_r2_config");
  if(error)return null;
  const row=Array.isArray(data)?data[0]:data;
  if(!row?.access_key_id||!row?.secret_access_key||!row?.bucket)return null;
  return {account_id:String(row.account_id||""),access_key_id:String(row.access_key_id),secret_access_key:String(row.secret_access_key),bucket:String(row.bucket),endpoint:String(row.endpoint||("https://"+row.account_id+".r2.cloudflarestorage.com")).replace(/\/$/,"")};
}
async function signed(config:any,method:string,key:string,expires=3600){
  const aws=new AwsClient({service:"s3",region:s3RegionFromEndpoint(config.endpoint),accessKeyId:config.access_key_id,secretAccessKey:config.secret_access_key});
  const req=new Request(config.endpoint+"/"+encodeURIComponent(config.bucket)+"/"+keyPath(key)+"?X-Amz-Expires="+Math.max(1,Math.min(604800,expires)),{method});
  return (await aws.sign(req,{aws:{signQuery:true}})).url.toString();
}
function parseMaybeJson(value:any){
  if(typeof value!=="string")return value;
  try{return JSON.parse(value)}catch{return value}
}
function apiPrompt(payload:any){
  let root=parseMaybeJson(payload?.data??payload);
  // RunningHub getJsonApiFormat commonly wraps the API-format graph in data.prompt as a JSON string.
  if(root&&typeof root==="object"&&root.prompt!==undefined){
    const prompt=parseMaybeJson(root.prompt);
    if(prompt&&typeof prompt==="object")return prompt;
  }
  if(root&&typeof root==="object"&&root.data?.prompt!==undefined){
    const prompt=parseMaybeJson(root.data.prompt);
    if(prompt&&typeof prompt==="object")return prompt;
  }
  return root;
}
function deepNode(root:any,id:string):any{
  if(!root||typeof root!=="object")return null;
  if(root[id]&&typeof root[id]==="object")return root[id];
  for(const key of ["workflow","prompt","data","nodes"]){
    let v=parseMaybeJson(root[key]);
    if(v&&typeof v==="object"){
      if(Array.isArray(v)){
        const found=v.find((x:any)=>String(x?.id??x?.nodeId??"")===String(id));
        if(found)return found;
      }else if(v[id])return v[id];
    }
  }
  return null;
}
function nodeHasField(node:any,field:string){
  if(!node)return false;
  if(node.inputs&&Object.prototype.hasOwnProperty.call(node.inputs,field))return true;
  if(Array.isArray(node.inputs)&&node.inputs.some((x:any)=>String(x?.name||"")===field))return true;
  if(Array.isArray(node.fields)&&node.fields.some((x:any)=>String(x?.fieldName||x?.name||"")===field))return true;
  return false;
}
async function validateWorkflow(base:string,apiKey:string,cfg:any){
  if(String(cfg.workflowId)!=="2110721194974982146"||String(cfg.videoNodeId)!=="275"||String(cfg.videoFieldName)!=="video"||String(cfg.frameNodeId)!=="299"||String(cfg.frameFieldName)!=="image"||String(cfg.outputNodeId)!=="285")throw new Error("Motion Control: workflow ou mapeamento diferente do V7 autorizado. Execução bloqueada.");
  const r=await fetch(base+"/api/openapi/getJsonApiFormat",{method:"POST",headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({apiKey,workflowId:String(cfg.workflowId)})});
  let j:any={};try{j=await r.json()}catch{}
  if(!r.ok||Number(j?.code)!==0)throw new Error(j?.msg||j?.message||("Motion Control workflow não acessível · HTTP "+r.status));
  const format=apiPrompt(j);
  const video=deepNode(format,String(cfg.videoNodeId||"275"));
  const frame=deepNode(format,String(cfg.frameNodeId||"299"));
  if(!video||!nodeHasField(video,String(cfg.videoFieldName||"video")))throw new Error("Motion Control: node #275 / campo video não encontrado no API Format do workflow.");
  if(!frame||!nodeHasField(frame,String(cfg.frameFieldName||"image")))throw new Error("Motion Control: node #299 / campo image não encontrado no API Format do workflow.");
  const output=deepNode(format,"285");
  if(String(video.class_type||video.type||"")!=="VHS_LoadVideo")throw new Error("Motion Control: node #275 não é VHS_LoadVideo.");
  if(String(frame.class_type||frame.type||"")!=="LoadImage")throw new Error("Motion Control: node #299 não é LoadImage.");
  if(!output||String(output.class_type||output.type||"")!=="VHS_VideoCombine")throw new Error("Motion Control: saída #285 VHS_VideoCombine ausente ou inválida.");
  const preview=deepNode(format,"384");
  if(!preview||String(preview.class_type||preview.type||"")!=="SaveVideo")throw new Error("Motion Control: saída #384 SaveVideo ausente ou inválida.");
  return {video_class:"VHS_LoadVideo",frame_class:"LoadImage",output_class:"VHS_VideoCombine",output_node:"285",preview_class:"SaveVideo",preview_node:"384"};
}
async function rhJson(base:string,apiKey:string,path:string,body:any){
  const r=await fetch(base+path,{method:"POST",headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({...body,apiKey})});
  let j:any={};try{j=await r.json()}catch{}
  if(!r.ok)throw new Error(j?.msg||j?.message||("RunningHub HTTP "+r.status));
  return j;
}
async function getCredits(base:string,apiKey:string){
  try{const j=await rhJson(base,apiKey,"/uc/openapi/accountStatus",{});const n=Number(j?.data?.remainCoins);return Number(j?.code)===0&&Number.isFinite(n)?n:null}catch{return null}
}
async function prepareInput(admin:any,base:string,apiKey:string,job:any,path:string,name:string,mime:string){
  if(String(job.storage_provider||"supabase")==="r2"){
    const cfg=await getObjectConfig(admin);if(!cfg)throw new Error("Armazenamento R2/B2 não configurado.");
    const expected=path===job.original_storage_path?Number(job.original_size_bytes||0):Number(job.frame_size_bytes||0);
    if(!await motionCheckObject(admin,cfg,path,expected))throw new Error("Arquivo do Motion Control não encontrado.");
    if(!await storageRPC(admin,"motion_storage_record_read",{p_count:1}))throw new MotionStorageSafetyError("Orçamento preventivo de leituras atingido.");
    return await signed(cfg,"GET",path,3600);
  }
  const {data:blob,error}=await admin.storage.from("production").download(path);
  if(error||!blob)throw new Error(error?.message||"Arquivo do Motion Control não encontrado.");
  if(blob.size>MAX_DIRECT){
    const {data:signedUrl,error:signError}=await admin.storage.from("production").createSignedUrl(path,3600);
    if(signError||!signedUrl?.signedUrl)throw new Error(signError?.message||"Falha ao criar URL temporária.");
    return signedUrl.signedUrl;
  }
  const form=new FormData();form.append("apiKey",apiKey);form.append("file",new File([blob],name,{type:mime||blob.type||"application/octet-stream"}));form.append("fileType","input");
  const r=await fetch(base+"/task/openapi/upload",{method:"POST",headers:{"Authorization":"Bearer "+apiKey},body:form});
  let j:any={};try{j=await r.json()}catch{}
  if(!r.ok||Number(j?.code)!==0||!j?.data?.fileName)throw new Error(j?.msg||("Upload RunningHub falhou · HTTP "+r.status));
  return String(j.data.fileName);
}

Deno.serve(async(req:Request)=>{
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  const workerId="motion-"+crypto.randomUUID();
  try{
    const supplied=String(req.headers.get("x-cloudent-worker-secret")||"");
    const {data:expected,error:secretError}=await admin.rpc("get_cloudent_worker_secret");
    if(secretError)throw secretError;
    if(!supplied||supplied!==String(expected||""))return out({ok:false,error:"unauthorized"},401);
    await admin.from("worker_runtime").upsert({worker_name:"motion_control",last_heartbeat:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"worker_name"});

    const [{data:integration,error:ie},{data:queueSetting},{data:motionSetting}]=await Promise.all([
      admin.from("integrations").select("enabled,config").eq("provider","runninghub").maybeSingle(),
      admin.from("app_settings").select("value").eq("key","production_queue").maybeSingle(),
      admin.from("app_settings").select("value").eq("key","motion_control_workflow").maybeSingle()
    ]);
    if(ie)throw ie;
    const rh:any=integration?.config||{},cfg:any=motionSetting?.value||{};
    let apiKey="";if(rh.apiKeyCipher&&rh.apiKeyIv){try{apiKey=await decrypt(String(rh.apiKeyCipher),String(rh.apiKeyIv),String(expected))}catch{}}
    const base=cleanBase(rh.baseUrl),concurrency=Math.max(1,Math.min(10,Number(rh.concurrency||1)));
    const enabled=integration?.enabled!==false&&queueSetting?.value?.enabled!==false;
    const configured=!!(apiKey&&cfg.workflowId&&cfg.videoNodeId&&cfg.frameNodeId);
    if(!enabled||!configured){
      const message=!enabled?"Motion Control pausado":"Configuração do Motion Control pendente";
      await admin.from("worker_runtime").upsert({worker_name:"motion_control",last_heartbeat:new Date().toISOString(),last_success_at:new Date().toISOString(),last_error:configured?null:message,last_jobs:0,updated_at:new Date().toISOString()},{onConflict:"worker_name"});
      return out({ok:true,enabled,configured,processed:0,message});
    }

    const storageState=await motionStorageHealth(admin);
    if(!storageState?.allow_primary)return out({ok:true,enabled:true,configured:true,processed:0,storage_paused:true,message:"Fila preservada: aguardando armazenamento."});
    const [{count:productionActive},{count:faceActive}]=await Promise.all([
      admin.from("production_jobs").select("*",{count:"exact",head:true}).in("status",["uploading","queued","running"]),
      admin.from("face_swap_jobs").select("*",{count:"exact",head:true}).in("status",["uploading","queued","running"])
    ]);
    const active=Number(productionActive||0)+Number(faceActive||0);
    let slots=Math.max(0,concurrency-active);
    if(slots<=0)return out({ok:true,enabled:true,configured:true,processed:0,active,concurrency,message:"Aguardando vaga do RunningHub"});

    const {count:waiting}=await admin.from("production_jobs").select("*",{count:"exact",head:true}).eq("status","motion_waiting").contains("meta",{workflow_key:"motion_control"}).lte("next_attempt_at",new Date().toISOString());
    if(!Number(waiting||0))return out({ok:true,enabled:true,configured:true,processed:0,active,concurrency});

    // Account capacity includes tasks created outside CloudentFlow. Check before any claim or media read/upload.
    let providerCapacity;
    try{
      providerCapacity=await readMotionProviderCapacity(base,apiKey);
      await admin.from("app_settings").upsert({key:"motion_provider_capacity",value:providerCapacity,updated_at:new Date().toISOString()},{onConflict:"key"});
    }catch{
      return out({ok:true,enabled:true,configured:true,processed:0,active,concurrency,provider_capacity_unknown:true,message:"Não foi possível confirmar vagas da RunningHub. Fila preservada; nova consulta automática."});
    }
    slots=Math.min(slots,providerCapacity.available);
    if(slots<=0)return out({ok:true,enabled:true,configured:true,processed:0,active,concurrency,provider_capacity:providerCapacity,provider_queue_waiting:true,message:"Aguardando vaga da RunningHub; retomada automática."});

    try{
      const info=await validateWorkflow(base,apiKey,cfg);
      await admin.from("app_settings").upsert({key:"motion_control_workflow",value:{...cfg,lastValidatedAt:new Date().toISOString(),lastValidationError:null,lastValidatedNodes:info},updated_at:new Date().toISOString()},{onConflict:"key"});
    }catch(e:any){
      const message=e instanceof Error?e.message:String(e);
      await admin.from("app_settings").upsert({key:"motion_control_workflow",value:{...cfg,lastValidationError:message},updated_at:new Date().toISOString()},{onConflict:"key"});
      const {data:toFail}=await admin.from("production_jobs").select("id").eq("status","motion_waiting").contains("meta",{workflow_key:"motion_control"}).limit(slots);
      const ids=(toFail||[]).map((x:any)=>x.id);
      if(ids.length)await admin.from("production_jobs").update({status:"failed",last_error:message,locked_at:null,locked_by:null,updated_at:new Date().toISOString()}).in("id",ids);
      throw new Error(message);
    }

    const {data:claimed,error:claimError}=await admin.rpc("claim_motion_control_jobs",{p_worker:workerId,p_limit:slots});
    if(claimError)throw claimError;
    let processed=0;
    for(const job of claimed||[]){
      try{
        if(job.runninghub_task_id)continue;
        const executionOptions=motionExecutionOptions(job,cfg);
        const {error:hardwareError}=await admin.from("production_jobs").update({
          meta:{...(job.meta||{}),execution_instance_type:"plus",execution_instance_used:"plus",execution_instance_vram_gb:48,execution_instance_policy:"motion_default_48gb",execution_instance_authorized:false,workflow_id:String(cfg.workflowId)},
          updated_at:new Date().toISOString()
        }).eq("id",job.id).eq("locked_by",workerId);
        if(hardwareError)throw hardwareError;
        const videoInput=await prepareInput(admin,base,apiKey,job,job.original_storage_path,job.original_file_name,job.original_mime_type||"video/mp4");
        await admin.from("production_jobs").update({progress:15,runninghub_video_file:videoInput,updated_at:new Date().toISOString()}).eq("id",job.id);
        const frameInput=await prepareInput(admin,base,apiKey,job,job.frame_storage_path,job.frame_file_name,job.frame_mime_type||"image/jpeg");
        await admin.from("production_jobs").update({progress:25,runninghub_frame_file:frameInput,updated_at:new Date().toISOString()}).eq("id",job.id);
        const creditsBefore=concurrency===1?await getCredits(base,apiKey):null;
        if(Number.isFinite(creditsBefore))await admin.from("production_jobs").update({credits_before:creditsBefore,updated_at:new Date().toISOString()}).eq("id",job.id);
        const {data:existingTask,error:existingError}=await admin.from("production_jobs").select("runninghub_task_id").eq("id",job.id).maybeSingle();
        if(existingError)throw existingError;
        if(existingTask?.runninghub_task_id)continue;
        await requireMotionStorage(admin);
        const created=await rhJson(base,apiKey,"/task/openapi/create",{...executionOptions,workflowId:String(cfg.workflowId),nodeInfoList:[{nodeId:String(cfg.videoNodeId||"275"),fieldName:String(cfg.videoFieldName||"video"),fieldValue:videoInput},{nodeId:String(cfg.frameNodeId||"299"),fieldName:String(cfg.frameFieldName||"image"),fieldValue:frameInput}],addMetadata:true});
        if(Number(created?.code)!==0||!created?.data?.taskId)throw new Error(created?.msg||"RunningHub não retornou taskId no Motion Control.");
        const taskId=String(created.data.taskId);
        const taskStatus=String(created.data.taskStatus||"QUEUED").toUpperCase();
        const {error:attachError}=await admin.from("production_jobs").update({status:"queued",progress:38,started_at:null,runninghub_task_id:taskId,locked_at:null,locked_by:null,last_error:null,updated_at:new Date().toISOString()}).eq("id",job.id).is("runninghub_task_id",null);
        if(attachError)throw attachError;
        await applyMotionProviderStatus(admin,{id:job.id,runninghub_task_id:taskId},{status:["RUNNING","QUEUED","FAILED"].includes(taskStatus)?taskStatus:"UNKNOWN",source:"create",error:created?.data?.promptTips||null,checkedAt:new Date().toISOString()});
        EdgeRuntime.waitUntil(fetch(Deno.env.get("SUPABASE_URL")+"/functions/v1/cloudent-production-worker",{method:"POST",headers:{"Content-Type":"application/json","x-cloudent-worker-secret":String(expected)},body:"{}",signal:AbortSignal.timeout(15000)}).catch(()=>null));
        processed++;
      }catch(e:any){
        if(e instanceof MotionStorageSafetyError){await storageRPC(admin,"release_motion_storage_claim",{p_job_id:job.id,p_worker:workerId});continue;}
        const message=e instanceof Error?e.message:String(e);
        await admin.from("production_jobs").update({status:"failed",locked_at:null,locked_by:null,last_error:message,updated_at:new Date().toISOString()}).eq("id",job.id);
        processed++;
      }
    }
    await admin.from("worker_runtime").upsert({worker_name:"motion_control",last_heartbeat:new Date().toISOString(),last_success_at:new Date().toISOString(),last_error:null,last_jobs:processed,updated_at:new Date().toISOString()},{onConflict:"worker_name"});
    return out({ok:true,enabled:true,configured:true,processed,active,concurrency});
  }catch(e:any){
    const message=e instanceof Error?e.message:String(e);
    try{await admin.from("worker_runtime").upsert({worker_name:"motion_control",last_heartbeat:new Date().toISOString(),last_error:message,updated_at:new Date().toISOString()},{onConflict:"worker_name"})}catch{}
    return out({ok:false,error:message},500);
  }
});

