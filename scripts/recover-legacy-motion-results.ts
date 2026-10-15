import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {AwsClient} from "npm:aws4fetch@1.0.20";
type CloudentR2Config={account_id:string;access_key_id:string;secret_access_key:string;bucket:string;endpoint:string};
async function getCloudentR2Config(admin:any):Promise<CloudentR2Config|null>{
  const {data,error}=await admin.rpc("get_cloudent_r2_config");
  if(error)return null;
  const row=Array.isArray(data)?data[0]:data;
  if(!row?.access_key_id||!row?.secret_access_key||!row?.bucket)return null;
  return {
    account_id:String(row.account_id||""),
    access_key_id:String(row.access_key_id),
    secret_access_key:String(row.secret_access_key),
    bucket:String(row.bucket),
    endpoint:String(row.endpoint||("https://"+row.account_id+".r2.cloudflarestorage.com")).replace(/\/$/,"")
  };
}
function s3RegionFromEndpoint(endpoint:string){
  try{
    const host=new URL(endpoint).hostname;
    const m=host.match(/^s3\.([^.]+)\.backblazeb2\.com$/i);
    return m?.[1]||"auto";
  }catch{return "auto"}
}
function r2KeyPath(key:string){return String(key||"").split("/").map(encodeURIComponent).join("/")}
async function r2PresignedUrl(config:CloudentR2Config,method:string,key:string,expires=3600,contentType=""){
  const aws=new AwsClient({service:"s3",region:s3RegionFromEndpoint(config.endpoint),accessKeyId:config.access_key_id,secretAccessKey:config.secret_access_key});
  const headers:Record<string,string>={};if(contentType)headers["Content-Type"]=contentType;
  const req=new Request(config.endpoint+"/"+encodeURIComponent(config.bucket)+"/"+r2KeyPath(key)+"?X-Amz-Expires="+Math.max(1,Math.min(604800,expires)),{method,headers});
  const signed=await aws.sign(req,{aws:{signQuery:true}});
  return signed.url.toString();
}
async function deleteR2Object(config:CloudentR2Config,key:string){
  const url=await r2PresignedUrl(config,"DELETE",key,900);
  const res=await fetch(url,{method:"DELETE"});
  if(!res.ok&&res.status!==404)throw new Error("r2_delete_"+res.status);
}
async function putAndVerifyR2(config:CloudentR2Config,key:string,blob:Blob,mime:string){
  let lastStatus=0;
  for(let attempt=1;attempt<=3;attempt++){
    const putUrl=await r2PresignedUrl(config,"PUT",key,1800);
    const put=await fetch(putUrl,{method:"PUT",headers:{"Content-Type":mime},body:blob});
    lastStatus=put.status;
    if(put.ok){
      const headUrl=await r2PresignedUrl(config,"HEAD",key,900);
      const head=await fetch(headUrl,{method:"HEAD"});
      if(head.ok)return true;
      lastStatus=head.status;
    }
    if(attempt<3)await new Promise(resolve=>setTimeout(resolve,700*attempt));
  }
  throw new Error("r2_upload_verify_failed_"+lastStatus);
}



const rhDecoder=new TextDecoder();
const fromB64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function decryptRunningHubSecret(cipher:string,iv:string,master:string){
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(master));
  const key=await crypto.subtle.importKey("raw",hash,{name:"AES-GCM"},false,["decrypt"]);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(iv)},key,fromB64(cipher));
  return rhDecoder.decode(plain);
}


const ALLOWED:Record<string,string>={"549fc435-bb8a-4a23-ac34-1df98ff31bb2":"2110795310253510658","aeef5ee8-8fe2-4c2a-889d-e4ada681e289":"2110796785862623234","39113d5a-2479-4de6-a2a4-9c225f8e8ad2":"2110798132256739329","7fed1f19-755f-4e5f-b126-71caf69b509a":"2110798633702559746"};
const out=(v:any,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"Content-Type":"application/json"}});
const hash=async(b:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await b.arrayBuffer()))).map(x=>x.toString(16).padStart(2,"0")).join("");
Deno.serve(async(req)=>{
const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const {data:secret}=await admin.rpc("get_cloudent_worker_secret");
if(!secret||req.headers.get("x-cloudent-worker-secret")!==secret)return out({error:"unauthorized"},401);
let id="",lease="";
try{
const input=await req.json();id=String(input.job_id||"");
if(input.operation!=="recover_legacy_result"||!ALLOWED[id])return out({error:"outside_recovery_scope"},400);
const {data:job,error:je}=await admin.from("production_jobs").select("*").eq("id",id).single();if(je)throw je;
if(job.runninghub_task_id!==ALLOWED[id]||job.meta?.workflow_key!=="motion_control"||job.meta?.workflow_id!=="2110721194974982146")throw Error("job_task_scope_mismatch");
if(job.status==="ready"&&job.result_video_id&&job.meta?.legacy_result_recovery?.task_id===ALLOWED[id])return out({ok:true,id,already_recovered:true});
if(job.status!=="failed"||job.result_video_id||job.meta?.provider_status!=="SUCCESS")throw Error("job_not_recoverable");
lease="legacy-recovery-"+crypto.randomUUID();
const {data:locked,error:le}=await admin.from("production_jobs").update({locked_by:lease,locked_at:new Date().toISOString()}).eq("id",id).eq("runninghub_task_id",ALLOWED[id]).eq("status","failed").is("locked_by",null).is("result_video_id",null).select("id").maybeSingle();
if(le)throw le;if(!locked)throw Error("job_locked");
const {data:i}=await admin.from("integrations").select("config").eq("provider","runninghub").single();
const c=i.config,apiKey=await decryptRunningHubSecret(c.apiKeyCipher,c.apiKeyIv,secret),base=String(c.baseUrl||"https://www.runninghub.ai").replace(/\/$/,"");
const post=async(path:string)=>{const r=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+apiKey},body:JSON.stringify({apiKey,taskId:ALLOWED[id]}),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error("provider_http_"+r.status);return await r.json();};
const state=await post("/openapi/v2/query");
if(state.taskId!==ALLOWED[id]||state.status!=="SUCCESS")throw Error("provider_not_success_for_task");
const result=await post("/task/openapi/outputs");
if(Number(result.code)!==0||!Array.isArray(result.data)||result.data.length!==1)throw Error("unexpected_output_list");
const item=result.data[0],node=String(item.nodeId??item.node_id??"");
if(node!=="313"||item.fileType!=="mp4")throw Error("unexpected_legacy_output");
const v2=state.results?.find((x:any)=>String(x.nodeId)==="313");
if(!v2||!String(v2.url).endsWith(String(item.objectKey))||!String(item.fileUrl).endsWith(String(item.objectKey)))throw Error("provider_output_crosscheck_failed");
const url=new URL(String(item.fileUrl));
if(url.protocol!=="https:"||!["rh-hk-images.xiaoyaoyou.com","rh-hk-images-1252422369.cos.ap-hongkong.myqcloud.com"].includes(url.hostname)||!url.pathname.includes("/output/AnimateDiff_"))throw Error("invalid_output_url");
const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error("download_failed_"+r.status);
const blob=await r.blob(),head=new Uint8Array(await blob.slice(0,16).arrayBuffer());
if(blob.size<16||String.fromCharCode(...head.slice(4,8))!=="ftyp")throw Error("invalid_mp4");
const sha=await hash(blob),path=job.user_id+"/production-results/2026-10-15/"+id+"-legacy313.mp4";
if(job.storage_provider!=="r2")throw Error("unexpected_storage_provider");
const config=await getCloudentR2Config(admin);if(!config)throw Error("storage_unavailable");
const {data:existing}=await admin.from("videos").select("id,storage_path").eq("id",id).maybeSingle();
if(existing&&existing.storage_path!==path)throw Error("video_id_conflict");
await putAndVerifyR2(config,path,blob,"video/mp4");
const saved=await fetch(await r2PresignedUrl(config,"GET",path,900),{signal:AbortSignal.timeout(20000)});
if(!saved.ok)throw Error("copy_read_failed");
const copy=await saved.blob();if(copy.size!==blob.size||await hash(copy)!==sha)throw Error("copy_hash_mismatch");
const {error:ve}=await admin.from("videos").upsert({id,storage_path:path,storage_provider:"r2",file_name:"runninghub-"+id.slice(0,8)+".mp4",mime_type:"video/mp4",size_bytes:blob.size,status:"ready",platform:"instagram",caption:""},{onConflict:"id"});if(ve)throw ve;
const {data:latest}=await admin.from("production_jobs").select("meta").eq("id",id).eq("runninghub_task_id",ALLOWED[id]).eq("locked_by",lease).single();if(!latest)throw Error("lease_lost");
const usage=state.usage||{},coins=Number(usage.consumeCoins),runtime=Number(usage.taskCostTime);
if(!Number.isFinite(coins)||!Number.isFinite(runtime))throw Error("usage_missing");
const recovery={task_id:ALLOWED[id],node_id:"313",source_workflow_id:"2100995504908824578",expected_workflow_id:"2110721194974982146",source_workflow_inferred_from_output:true,verified_sha256:sha,size_bytes:blob.size,recovered_at:new Date().toISOString(),original_error:job.last_error};
const {data:updated,error:ue}=await admin.from("production_jobs").update({
status:"ready",progress:100,result_video_id:id,result_storage_path:path,result_url:String(item.fileUrl),
credits_used:coins,runninghub_runtime_seconds:runtime,
last_error:null,completed_at:new Date().toISOString(),locked_by:null,locked_at:null,updated_at:new Date().toISOString(),
meta:{...latest.meta,provider_task_pending:false,provider_queue_waiting:false,result_node_id:"313",credit_source:"runninghub_usage",legacy_result_recovery:recovery}
}).eq("id",id).eq("status","failed").eq("runninghub_task_id",ALLOWED[id]).eq("locked_by",lease).is("result_video_id",null).select("id").maybeSingle();
if(ue)throw ue;if(!updated)throw Error("job_changed");
await admin.from("activity_logs").insert({level:"info",event_type:"motion_legacy_result_recovered",message:"Vídeo antigo recuperado da mesma task; execução veio do fluxo video 7 minutos",meta:{production_job_id:id,result_video_id:id,task_id:ALLOWED[id],node_id:"313",credits_used:coins}});
return out({ok:true,id,video_id:id,size_bytes:blob.size,verified_sha256:sha,credits_used:coins,task_preserved:true});
}catch(e){if(id&&lease)await admin.from("production_jobs").update({locked_by:null,locked_at:null}).eq("id",id).eq("locked_by",lease);return out({error:String(e)},500)}
});