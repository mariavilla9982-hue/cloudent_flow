import {retryNextFailedGenjutsu} from './_shared/image-pipeline-retry.ts';
import {runGenjutsuPreparation} from './_shared/genjutsu-preparation.ts';
import {GENJUTSU_CONFIG,isGenjutsuJob,validateGenjutsuWorkflow,prepareGenjutsuStage,genjutsuInputs,genjutsuPromptWait,applyGenjutsuStatus} from './_shared/genjutsu-stage.ts';
import {MotionCreateError,motionDispatchFailurePatch} from "./motion-dispatch.ts";
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
  if(job?.meta?.workflow_key==="genjutsu"){if(cfg.workflowId!==GENJUTSU_CONFIG.workflowId||cfg.executionInstanceType!=="ultra"||job.runninghub_task_id)throw new Error("Genjutsu: configuração de execução inválida.");return {instanceType:"ultra"};}
  if(job?.meta?.workflow_key!=="motion_control")throw new Error("Motion Control: workflow do job inválido.");
  if(!["plus","ultra"].includes(cfg?.executionInstanceType))throw new Error("Motion Control: configuração de GPU inválida. Execução bloqueada.");
  if(job.runninghub_task_id)throw new Error("Motion Control: tarefa já criada. Nenhuma geração enviada.");
  if(cfg.executionInstanceType==="ultra"&&(cfg.hardwarePolicy!=="motion_default_84gb"||cfg.executionVramGb!==84))throw new Error("Motion Control: política de GPU 84 GB inválida. Execução bloqueada.");
  const grant=job.meta.execution_ultra_once;
  if(grant){
    if(grant.state!=="pending"||grant.job_id!==job.id||grant.workflow_id!==String(cfg.workflowId)||
      !/^[0-9a-f-]{36}$/i.test(String(grant.approval_id||""))||!/^\d+$/.test(String(grant.source_task_id||""))||
      job.runninghub_task_id||Number(job.attempt_count)!==1||Number(job.max_attempts)!==1)
      throw new Error("GPU 84 GB: autorização única ausente, consumida ou incompatível. Nenhuma geração enviada.");
    return {instanceType:"ultra"};
  }
  if(job.meta.execution_instance_type==="ultra"&&cfg.executionInstanceType!=="ultra")throw new Error("GPU 84 GB exige autorização única para este envio.");
  return {instanceType:cfg.executionInstanceType};
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
  if(!r.ok)throw new MotionCreateError(j,r.status);
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

// One explicitly authorized test. Does not unpause production or forge cancellation proof.
const TEST_JOB='90bfb2cd-0e38-4716-8e68-3fbaa8fb4505';
const TEST_OWNER='8ab89cf8-699e-4ae8-833f-1f215f1d4d69';
const TEST_EXPIRES=Date.parse('2026-11-20T02:00:00Z');
Deno.serve(async(req:Request)=>{
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 let job:any=null,lease='genjutsu-authorized-test-'+crypto.randomUUID(),intent=false;
 try{
  const {data:secret,error:se}=await admin.rpc('get_cloudent_worker_secret');
  if(se||!secret||req.headers.get('x-cloudent-worker-secret')!==secret)return out({ok:false,error:'unauthorized'},401);
  if(req.method!=='POST'||Date.now()>TEST_EXPIRES)return out({ok:false,error:'test_closed'},410);
  const body=await req.json();if(body.job_id!==TEST_JOB)return out({ok:false,error:'wrong_test_job'},400);
  const {data:current,error:je}=await admin.from('production_jobs').select('*').eq('id',TEST_JOB).eq('user_id',TEST_OWNER).single();
  if(je||!current)throw Error('test_job_unavailable');
  if(current.runninghub_task_id||current.meta?.pipeline_dispatch_intent)return out({ok:true,already_dispatched:true,task_id:current.runninghub_task_id});
  if(current.status!=='motion_waiting'||current.locked_by||current.hidden_at||current.attempt_count!==0||!isGenjutsuJob(current))throw Error('test_job_not_eligible');
  const {count:active,error:ae}=await admin.from('production_jobs').select('id',{count:'exact',head:true}).in('status',['uploading','queued','running']);
  if(ae||active!==0)throw Error('another_task_active');
  const {data:ui}=await admin.from('app_settings').select('value').eq('key','genjutsu_ui_cancel').single();
  if(ui?.value?.enabled!==true||ui.value.owner_user_id!==TEST_OWNER)throw Error('browser_not_ready');
  const {data:integration,error:ie}=await admin.from('integrations').select('enabled,config').eq('provider','runninghub').single();
  if(ie||!integration?.enabled)throw Error('integration_not_ready');
  const rh=integration.config,base=cleanBase(rh.baseUrl);
  if(base!=='https://www.runninghub.ai')throw Error('unexpected_provider');
  const apiKey=await decrypt(rh.apiKeyCipher,rh.apiKeyIv,String(secret));
  await requireMotionStorage(admin);
  const capacity=await readMotionProviderCapacity(base,apiKey);if(capacity.total!==0)throw Error('provider_not_idle');
  await validateGenjutsuWorkflow(base,apiKey);
  const {data:claimed,error:ce}=await admin.from('production_jobs').update({status:'uploading',locked_by:lease,locked_at:new Date().toISOString(),updated_at:new Date().toISOString()})
   .eq('id',TEST_JOB).eq('user_id',TEST_OWNER).eq('updated_at',current.updated_at).eq('status','motion_waiting').is('runninghub_task_id',null).is('locked_by',null).select('*').maybeSingle();
  if(ce||!claimed)throw Error('test_lease_lost');job=claimed;
  const object=await getObjectConfig(admin);if(!object||job.storage_provider!=='r2')throw Error('primary_storage_required');
  const ready=await prepareGenjutsuStage({admin,job,workerId:lease,key:Deno.env.get('GEMINI_API_KEY')||'',readBlob:async(path:string)=>{
   await requireMotionStorage(admin);if(!await storageRPC(admin,'motion_storage_record_read',{p_count:1}))throw Error('storage_budget_unavailable');
   return fetch(await signed(object,'GET',path,900),{signal:AbortSignal.timeout(30000)});
  }});
  if(!ready){await admin.from('production_jobs').update({status:'motion_waiting',meta:job.meta,locked_by:null,locked_at:null,updated_at:new Date().toISOString()}).eq('id',TEST_JOB).eq('locked_by',lease);job=null;return out({ok:true,preparing:true});}
  const probeResponse=await fetch('https://cloudent-flow.vercel.app/api/runninghub-browser',{method:'POST',headers:{'Content-Type':'application/json','x-cloudent-worker-secret':String(secret)},body:JSON.stringify({operation:'probe'}),signal:AbortSignal.timeout(45000)});
  const probe=await probeResponse.json();if(!probeResponse.ok||!probe.ok||!probe.ready||probe.account_id!==ui.value.account_id)throw Error('browser_probe_failed');
  const video=await prepareInput(admin,base,apiKey,job,job.original_storage_path,job.original_file_name,job.original_mime_type||'video/mp4');
  const frame=await prepareInput(admin,base,apiKey,job,job.frame_storage_path,job.frame_file_name,job.frame_mime_type||'image/jpeg');
  const inputs=await genjutsuInputs(video,frame,job);
  const now=new Date().toISOString();
  const meta={...job.meta,execution_instance_type:'ultra',execution_instance_used:'ultra',execution_instance_vram_gb:84,
   authorized_cancel_test:{max_points:1200,authorized_at:now,budget_stop_after_seconds:30,one_task_only:true},
   pipeline_dispatch_intent:crypto.randomUUID(),pipeline_dispatch_uncertain:true,
   genjutsu_dispatch_prompt:{sha256:job.meta.genjutsu_prompt.promptSha256,fingerprint:job.meta.genjutsu_prompt.fingerprint,node_id:'910',field:'value',prepared_at:now}};
  const {data:reserved,error:re}=await admin.from('production_jobs').update({meta,attempt_count:1,runninghub_video_file:video,runninghub_frame_file:frame,updated_at:now}).eq('id',TEST_JOB).eq('locked_by',lease).is('runninghub_task_id',null).select('id').maybeSingle();
  if(re||!reserved)throw Error('dispatch_reservation_lost');intent=true;
  const created=await rhJson(base,apiKey,'/task/openapi/create',{...inputs,addMetadata:true});
  if(Number(created?.code)!==0||!/^\d{15,25}$/.test(String(created?.data?.taskId||'')))throw Error('create_not_confirmed');
  const taskId=String(created.data.taskId);
  const {data:attached,error:attachError}=await admin.from('production_jobs').update({status:'queued',progress:38,runninghub_task_id:taskId,locked_by:null,locked_at:null,started_at:null,last_error:null,meta:{...meta,pipeline_dispatch_uncertain:false},updated_at:new Date().toISOString()})
   .eq('id',TEST_JOB).eq('locked_by',lease).is('runninghub_task_id',null).select('id').maybeSingle();
  if(attachError||!attached){console.error(JSON.stringify({event:'authorized_test_attach_failed',job_id:TEST_JOB,task_id:taskId}));return out({ok:false,task_id:taskId,error:'attach_failed'},500);}
  EdgeRuntime.waitUntil(fetch(Deno.env.get('SUPABASE_URL')+'/functions/v1/cloudent-production-worker',{method:'POST',headers:{'Content-Type':'application/json','x-cloudent-worker-secret':String(secret)},body:'{}',signal:AbortSignal.timeout(15000)}).catch(()=>null));
  return out({ok:true,job_id:TEST_JOB,task_id:taskId,created_at:now,budget_stop_after_seconds:30});
 }catch(e){
  if(job&&!intent)await admin.from('production_jobs').update({status:'motion_waiting',meta:job.meta,locked_by:null,locked_at:null,updated_at:new Date().toISOString()}).eq('id',TEST_JOB).eq('locked_by',lease);
  // No provider response, prompt content, credentials or signed URLs in diagnostics.
  return out({ok:false,error:intent?'dispatch_uncertain':genjutsuPromptWait(e,job)?'preparation_waiting':'test_preflight_failed'},intent?409:503);
 }
});
