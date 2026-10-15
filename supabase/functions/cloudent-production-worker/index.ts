
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

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


const H={"Content-Type":"application/json"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const MAX_DIRECT=30*1024*1024;

function cleanBase(v:any){
  const x=String(v||"https://www.runninghub.ai").replace(/\/$/,"");
  return x.startsWith("https://")?x:"https://www.runninghub.ai";
}
function extFrom(url:string,fileType?:string){
  const t=String(fileType||"").toLowerCase().replace(".","");
  if(["mp4","mov","webm","mkv","avi"].includes(t))return t;
  try{
    const p=new URL(url).pathname.split(".").pop()?.toLowerCase()||"";
    return ["mp4","mov","webm","mkv","avi"].includes(p)?p:"mp4";
  }catch{return "mp4"}
}

const rhDecoder=new TextDecoder();
const fromB64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function decryptRunningHubSecret(cipher:string,iv:string,master:string){
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(master));
  const key=await crypto.subtle.importKey("raw",hash,{name:"AES-GCM"},false,["decrypt"]);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(iv)},key,fromB64(cipher));
  return rhDecoder.decode(plain);
}

function mimeFor(ext:string){
  return ext==="mov"?"video/quicktime":ext==="webm"?"video/webm":ext==="avi"?"video/x-msvideo":ext==="mkv"?"video/x-matroska":"video/mp4";
}

function imageExtFrom(url:string,fileType?:string){
  const raw=String(fileType||"").toLowerCase().replace(".","").replace("jpeg","jpg");
  if(["jpg","png","webp"].includes(raw))return raw;
  try{
    const p=(new URL(url).pathname.split(".").pop()||"").toLowerCase().replace("jpeg","jpg");
    return ["jpg","png","webp"].includes(p)?p:"jpg";
  }catch{return "jpg"}
}
function imageMimeFor(ext:string){
  return ext==="png"?"image/png":ext==="webp"?"image/webp":"image/jpeg";
}


const MOTION_PREVIEW_WORKFLOW="2110721194974982146";
function isMotionPreviewJob(job:any){
  return job?.meta?.workflow_key==="motion_control"&&job?.meta?.workflow_id===MOTION_PREVIEW_WORKFLOW;
}
function motionPreviewFile(message:any,taskId:string){
  const d=message?.data;
  if(message?.type!=="executed"||String(d?.node)!=="384"||String(d?.prompt_id)!==String(taskId))return null;
  const output=d?.output||{};
  for(const key of ["images","videos","gifs"]){
    for(const item of Array.isArray(output[key])?output[key]:[]){
      const filename=String(item?.filename||"");
      const subfolder=String(item?.subfolder||"");
      if(!/\.(mp4|webm|mov)$/i.test(filename)||filename.includes("/")||filename.includes("\\")||filename.includes("..")||subfolder.split(/[\\/]/).includes(".."))continue;
      if(String(item?.type||"output")!=="output")continue;
      return {filename,subfolder,type:"output",node_id:"384",task_id:String(taskId)};
    }
  }
  return null;
}
function motionPreviewViewUrl(base:string,wss:string,file:any){
  const b=new URL(base),w=new URL(wss);
  if(w.protocol!=="wss:"||w.host!==b.host||!w.searchParams.get("Rh-Comfy-Auth"))throw new Error("Motion Control: canal de prévia inválido.");
  const u=new URL("/view",b);
  for(const key of ["Rh-Comfy-Auth","Rh-Identify"]){const value=w.searchParams.get(key);if(value)u.searchParams.set(key,value);}
  u.searchParams.set("filename",file.filename);u.searchParams.set("subfolder",file.subfolder||"");u.searchParams.set("type","output");
  return u.toString();
}
async function ensureMotionPreviewMonitor(admin:any,job:any,base:string,apiKey:string,master:string){
  if(!isMotionPreviewJob(job)||job.result_video_id||job.meta?.motion_preview_file)return;
  if(job.locked_by&&Date.now()-Date.parse(job.locked_at||"")<130000)return;
  const lease="motion-preview-"+crypto.randomUUID();
  let claim=admin.from("production_jobs").update({locked_by:lease,locked_at:new Date().toISOString()}).eq("id",job.id).eq("runninghub_task_id",job.runninghub_task_id).in("status",["queued","running"]);
  claim=job.locked_by?claim.eq("locked_by",job.locked_by):claim.is("locked_by",null);
  const {data:claimed,error}=await claim.select("id").maybeSingle();
  if(error||!claimed)return;
  const work=watchMotionPreview(admin,job,base,apiKey,master,lease);
  EdgeRuntime.waitUntil(work);
}
async function watchMotionPreview(admin:any,job:any,base:string,apiKey:string,master:string,lease:string){
  let captured=false,continueWatching=false;const began=Date.now();
  try{
    const r=await fetch(base+"/task/openapi/outputs",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+apiKey},body:JSON.stringify({apiKey,taskId:job.runninghub_task_id}),signal:AbortSignal.timeout(10000)});
    const j=await r.json(),wss=j?.data?.netWssUrl;
    if(!wss)return;
    motionPreviewViewUrl(base,wss,{filename:"check.mp4",subfolder:""});
    continueWatching=true;
    await new Promise<void>(resolve=>{
      const ws=new WebSocket(wss);let finished=false;
      const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);clearInterval(ping);try{ws.close()}catch{}resolve()};
      const timer=setTimeout(finish,105000);
      const ping=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send("ping")},20000);
      ws.onerror=finish;ws.onclose=finish;
      ws.onmessage=async event=>{
        if(finished||typeof event.data!=="string")return;
        let message:any;try{message=JSON.parse(event.data)}catch{return;}
        const file=motionPreviewFile(message,String(job.runninghub_task_id));
        if(!file)return;
        // Persist only the file descriptor. Provider credentials stay server-side.
        finished=true;clearTimeout(timer);clearInterval(ping);
        try{
          const {data:latest}=await admin.from("production_jobs").select("meta,status,runninghub_task_id").eq("id",job.id).maybeSingle();
          if(latest&&["queued","running"].includes(latest.status)&&String(latest.runninghub_task_id)===String(job.runninghub_task_id)){
            const {error}=await admin.from("production_jobs").update({meta:{...(latest.meta||{}),motion_preview_file:file,motion_preview_detected_at:new Date().toISOString()},updated_at:new Date().toISOString()}).eq("id",job.id).eq("locked_by",lease).eq("runninghub_task_id",job.runninghub_task_id);
            if(error)throw error;
            captured=true;
          }
        }catch{/* Retain the task and let the next listener retry. */}finally{try{ws.close()}catch{}resolve();}
      };
    });
  }catch{/* A transient monitor error must never fail or restart the paid generation. */}
  finally{
    await admin.from("production_jobs").update({locked_by:null,locked_at:null}).eq("id",job.id).eq("locked_by",lease);
    if(captured||(continueWatching&&Date.now()-began>60000)){
      const {data:latest}=await admin.from("production_jobs").select("status,result_video_id,runninghub_task_id").eq("id",job.id).maybeSingle();
      if(latest&&["queued","running"].includes(latest.status)&&String(latest.runninghub_task_id)===String(job.runninghub_task_id)){
        // Renew the listener without waiting for the next cron tick; no new RH task.
        await fetch(Deno.env.get("SUPABASE_URL")+"/functions/v1/cloudent-production-worker",{method:"POST",headers:{"Content-Type":"application/json","x-cloudent-worker-secret":master},body:"{}",signal:AbortSignal.timeout(15000)}).catch(()=>null);
      }
    }
  }
}

async function cancelMotionAfterSave(admin:any,jobId:string,rhJson:(path:string,body:any)=>Promise<any>){
  const {data:job,error}=await admin.from("production_jobs").select("*").eq("id",jobId).maybeSingle();
  if(error)throw error;
  if(!job||!isMotionPreviewJob(job)||!job.result_video_id||!job.result_storage_path||!job.meta?.motion_preview_available)return false;
  if(!["queued","running"].includes(job.status))return false;
  const meta=job.meta||{},taskId=String(job.runninghub_task_id||"");
  if(!taskId||String(meta.motion_preview_file?.task_id)!==taskId||meta.result_node_id!=="384")throw new Error("Motion Control: cancelamento bloqueado até confirmar a origem do vídeo #384.");
  const {data:video,error:videoError}=await admin.from("videos").select("id,status,storage_path,storage_provider,size_bytes,mime_type").eq("id",job.result_video_id).maybeSingle();
  if(videoError)throw videoError;
  if(!video||video.status!=="ready"||video.storage_path!==job.result_storage_path||!String(video.storage_path).startsWith(job.user_id+"/production-results/")||Number(video.size_bytes)<=0||String(video.storage_provider||"supabase")!==String(job.storage_provider||"supabase"))throw new Error("Motion Control: cópia persistida não confirmada. Task preservada.");
  if(!meta.motion_preview_verified_at||!/^[a-f0-9]{64}$/.test(String(meta.motion_preview_sha256||""))||Number(meta.motion_preview_verified_bytes)!==Number(video.size_bytes)){
    let blob:Blob;
    if(String(video.storage_provider||"supabase")==="r2"){
      const config=await getCloudentR2Config(admin);if(!config)throw new Error("r2_not_configured");
      const url=await r2PresignedUrl(config,"GET",video.storage_path,300);
      const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error("Motion Control: não foi possível verificar o vídeo salvo. Task preservada.");
      blob=await response.blob();
    }else{
      const {data,error}=await admin.storage.from("videos").download(video.storage_path);
      if(error||!data)throw new Error("Motion Control: não foi possível verificar o vídeo salvo. Task preservada.");
      blob=data;
    }
    const bytes=new Uint8Array(await blob.arrayBuffer());
    const mp4=new TextDecoder().decode(bytes.slice(4,8))==="ftyp";
    const webm=bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
    if(bytes.length!==Number(video.size_bytes)||(!mp4&&!webm))throw new Error("Motion Control: cópia do vídeo inválida. Task preservada.");
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");
    if(meta.motion_preview_source_sha256&&digest!==meta.motion_preview_source_sha256)throw new Error("Motion Control: cópia diferente do vídeo capturado. Task preservada.");
    Object.assign(meta,{motion_preview_verified_at:new Date().toISOString(),motion_preview_sha256:digest,motion_preview_verified_bytes:bytes.length});
    const {data:verified,error:verificationError}=await admin.from("production_jobs").update({meta}).eq("id",job.id).eq("runninghub_task_id",taskId).in("status",["queued","running"]).select("id").maybeSingle();
    if(verificationError)throw verificationError;if(!verified)return false;
  }
  const terminal=(state:any)=>Number(state?.code)===0&&["SUCCESS","FAILED","CANCELLED","CANCELED"].includes(String(state?.data||"").toUpperCase());
  let state=await rhJson("/task/openapi/status",{taskId});
  let cancellation:any={};
  if(!terminal(state)){
    const last=Date.parse(meta.provider_cancel_requested_at||"");
    if(!Number.isFinite(last)||Date.now()-last>=30000){
      const response=await rhJson("/task/openapi/cancel",{taskId});
      cancellation={provider_cancel_requested_at:new Date().toISOString(),provider_cancel_accepted:Number(response?.code)===0,provider_cancel_error:Number(response?.code)===0?null:"RunningHub não confirmou cancelamento · código "+String(response?.code??"indisponível")};
    }
    state=await rhJson("/task/openapi/status",{taskId});
  }
  const done=terminal(state),now=new Date().toISOString();
  const {error:updateError}=await admin.from("production_jobs").update({
    status:done?"ready":"running",progress:done?100:99,completed_at:done?now:null,
    meta:{...meta,...cancellation,provider_task_pending:!done,provider_terminal_status:done?String(state.data).toUpperCase():null,...(done?{provider_cancel_confirmed_at:now}:{})},
    last_error:null,updated_at:now
  }).eq("id",job.id).eq("runninghub_task_id",taskId).in("status",["queued","running"]);
  if(updateError)throw updateError;
  return done;
}

Deno.serve(async(req:Request)=>{
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  const workerId="production-"+crypto.randomUUID();
  try{
    const supplied=req.headers.get("x-cloudent-worker-secret")||"";
    const {data:expected,error:se}=await admin.rpc("get_cloudent_worker_secret");
    if(se)throw se;
    if(!supplied||supplied!==expected)return out({ok:false,error:"unauthorized"},401);

    await admin.from("worker_runtime").upsert({
      worker_name:"production",last_heartbeat:new Date().toISOString(),updated_at:new Date().toISOString()
    },{onConflict:"worker_name"});

    const [{data:integration,error:ie},{data:queueSetting}]=await Promise.all([
      admin.from("integrations").select("enabled,config").eq("provider","runninghub").maybeSingle(),
      admin.from("app_settings").select("value").eq("key","production_queue").maybeSingle()
    ]);
    if(ie)throw ie;

    const cfg:any=integration?.config||{};
    let apiKey="";
    if(cfg.apiKeyCipher&&cfg.apiKeyIv){
      try{apiKey=await decryptRunningHubSecret(String(cfg.apiKeyCipher),String(cfg.apiKeyIv),String(expected))}catch{}
    }
    const workflowId=String(cfg.workflowId||"").trim();
    const videoNodeId=String(cfg.videoNodeId||"").trim();
    const videoFieldName=String(cfg.videoFieldName||"video").trim();
    const frameNodeId=String(cfg.frameNodeId||"").trim();
    const frameFieldName=String(cfg.frameFieldName||"image").trim();
    const faceSwapWorkflowId=String(cfg.faceSwapWorkflowId||"").trim();
    const faceSwapReferenceNodeId=String(cfg.faceSwapReferenceNodeId||"17").trim();
    const faceSwapReferenceFieldName=String(cfg.faceSwapReferenceFieldName||"image").trim();
    const faceSwapOutputNodeId=String(cfg.faceSwapOutputNodeId||"240").trim();
    const faceSwapEnabled=cfg.faceSwapEnabled!==false;
    const faceSwapConfigured=!!(apiKey&&faceSwapWorkflowId&&faceSwapReferenceNodeId);
    const concurrency=Math.max(1,Math.min(10,Number(cfg.concurrency||1)));
    const base=cleanBase(cfg.baseUrl);
    const enabled=integration?.enabled!==false && queueSetting?.value?.enabled!==false;
    const configured=!!(apiKey&&workflowId&&videoNodeId&&frameNodeId);

    if(!enabled||!configured){
      const message=!enabled?"Produção RunningHub pausada":"Configuração do RunningHub pendente";
      await admin.from("worker_runtime").upsert({
        worker_name:"production",last_heartbeat:new Date().toISOString(),last_success_at:new Date().toISOString(),
        last_error:configured?null:message,last_jobs:0,updated_at:new Date().toISOString()
      },{onConflict:"worker_name"});
      return out({ok:true,configured,enabled,processed:0,message});
    }

    async function getAccountCredits(){
      try{
        const r=await fetch(base+"/uc/openapi/accountStatus",{
          method:"POST",
          headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
          body:JSON.stringify({apikey:apiKey})
        });
        let j:any={};try{j=await r.json()}catch{}
        if(!r.ok||Number(j?.code)!==0)return null;
        const n=Number(j?.data?.remainCoins);
        return Number.isFinite(n)?n:null;
      }catch{return null}
    }

    async function rhJson(path:string,body:any){
      const r=await fetch(base+path,{
        method:"POST",
        headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
        body:JSON.stringify({...body,apiKey})
      });
      let j:any={};try{j=await r.json()}catch{}
      if(!r.ok)throw new Error(j?.msg||j?.message||("RunningHub HTTP "+r.status));
      return j;
    }

    async function prepareInput(path:string,name:string,mime:string,provider="supabase",characterAudit:any=null){
      if(String(provider||"supabase")==="r2"){
        const r2=await getCloudentR2Config(admin);
        if(!r2)throw new Error("r2_not_configured");
        return await r2PresignedUrl(r2,"GET",path,3600);
      }
      const {data:blob,error}=await admin.storage.from("production").download(path);
      if(error||!blob)throw new Error(error?.message||"Arquivo de produção não encontrado");
      if(characterAudit){
        const hash=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
        const sha256=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join("");
        if(characterAudit.expected_sha256&&characterAudit.expected_sha256!==sha256)throw new Error("character_content_mismatch");
        characterAudit.sha256=sha256;
        characterAudit.size_bytes=blob.size;
      }
      if(blob.size>MAX_DIRECT){
        const {data:signed,error:signError}=await admin.storage.from("production").createSignedUrl(path,3600);
        if(signError||!signed?.signedUrl)throw new Error(signError?.message||"Falha ao criar URL temporária");
        return signed.signedUrl;
      }
      const form=new FormData();
      form.append("apiKey",String(apiKey));
      form.append("file",new File([blob],name,{type:mime||blob.type||"application/octet-stream"}));
      form.append("fileType","input");
      const r=await fetch(base+"/task/openapi/upload",{method:"POST",headers:{"Authorization":"Bearer "+apiKey},body:form});
      let j:any={};try{j=await r.json()}catch{}
      if(!r.ok||j?.code!==0||!j?.data?.fileName)throw new Error(j?.msg||("Falha no upload RunningHub "+r.status));
      return String(j.data.fileName);
    }

    async function saveResult(job:any,item:any,usage:any=null,previewBlob:Blob|null=null){
      const early=previewBlob!==null;
      if(early&&!isMotionPreviewJob(job))throw new Error("motion_preview_scope_invalid");
      const fileUrl=String(item?.fileUrl||item?.url||"");
      if(!fileUrl&&!early)throw new Error("RunningHub concluiu sem URL de resultado");
      const rr=early?null:await fetch(fileUrl);
      if(rr&&!rr.ok)throw new Error("Não consegui baixar o resultado do RunningHub");
      const blob=previewBlob||await rr!.blob();
      if(!blob.size)throw new Error("Vídeo vazio retornado pelo RunningHub");
      const ext=extFrom(fileUrl,item?.fileType||item?.outputType);
      const mime=mimeFor(ext);
      const path=job.user_id+"/production-results/"+new Date().toISOString().slice(0,10)+"/"+job.id+"."+ext;
      const provider=String(job.storage_provider||"supabase")==="r2"?"r2":"supabase";
      let r2:CloudentR2Config|null=null;
      if(provider==="r2"){
        r2=await getCloudentR2Config(admin);
        if(!r2)throw new Error("r2_not_configured");
        await putAndVerifyR2(r2,path,blob,mime);
      }else{
        const {error:ue}=await admin.storage.from("videos").upload(path,blob,{contentType:mime,upsert:true});
        if(ue)throw ue;
      }
      const name="runninghub-"+job.id.slice(0,8)+"."+ext;
      const videoPayload={storage_path:path,storage_provider:provider,file_name:name,mime_type:mime,size_bytes:blob.size,status:"ready",platform:"instagram",caption:""};
      const videoWrite=early?admin.from("videos").upsert({id:job.id,...videoPayload},{onConflict:"id"}):admin.from("videos").insert(videoPayload);
      const {data:video,error:ve}=await videoWrite.select().single();
      if(ve){
        if(provider==="r2"&&r2)await deleteR2Object(r2,path).catch(()=>null);
        else await admin.storage.from("videos").remove([path]).catch(()=>null);
        throw ve;
      }

      const consumeCoins=usage?.consumeCoins;
      const consumeMoney=usage?.consumeMoney;
      const thirdPartyConsumeMoney=usage?.thirdPartyConsumeMoney;
      const runtime=usage?.taskCostTime;
      const rawCredits=consumeCoins===null||consumeCoins===undefined||consumeCoins===""?null:Number(consumeCoins);
      let creditsUsed=rawCredits!==null&&Number.isFinite(rawCredits)?Number(rawCredits):null;
      let creditSource=creditsUsed!==null?"runninghub_usage":null;
      const rawCost=consumeMoney===null||consumeMoney===undefined||consumeMoney===""?null:Number(consumeMoney);
      const costMoney=rawCost!==null&&Number.isFinite(rawCost)?Number(rawCost):null;
      const rawThird=thirdPartyConsumeMoney===null||thirdPartyConsumeMoney===undefined||thirdPartyConsumeMoney===""?null:Number(thirdPartyConsumeMoney);
      const thirdPartyCost=rawThird!==null&&Number.isFinite(rawThird)?Number(rawThird):null;
      const runtimeSeconds=runtime===null||runtime===undefined||runtime===""?null:Number(runtime);
      let creditsAfter:any=null;

      const before=Number(job.credits_before);
      if(!early&&concurrency===1&&Number.isFinite(before)){
        for(let attempt=0;attempt<4;attempt++){
          creditsAfter=await getAccountCredits();
          if(Number.isFinite(creditsAfter)){
            const delta=Math.max(0,before-Number(creditsAfter));
            if(delta>0){
              creditsUsed=delta;
              creditSource="balance_delta";
              break;
            }
          }
          if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1500));
        }
      }

      const {error:saveError}=await admin.from("production_jobs").update({
        status:early?"running":"ready",progress:early?99:100,result_url:early?null:fileUrl,result_storage_path:path,result_video_id:video.id,
        credits_used:Number.isFinite(creditsUsed)?creditsUsed:null,
        credits_after:Number.isFinite(creditsAfter)?creditsAfter:null,
        runninghub_cost_money:Number.isFinite(costMoney)?costMoney:null,
        runninghub_third_party_cost_money:Number.isFinite(thirdPartyCost)?thirdPartyCost:null,
        runninghub_runtime_seconds:Number.isFinite(runtimeSeconds)?runtimeSeconds:null,
        meta:{...(job.meta||{}),...(early?{motion_preview_available:true,motion_preview_source_sha256:Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await blob.arrayBuffer()))).map(x=>x.toString(16).padStart(2,"0")).join(""),motion_preview_saved_at:new Date().toISOString(),result_node_id:"384",provider_task_pending:true}:{}),credit_source:creditSource,cost_source:(Number.isFinite(costMoney)||Number.isFinite(thirdPartyCost))?"runninghub_usage":null},
        completed_at:early?null:new Date().toISOString(),locked_at:null,locked_by:null,last_error:null,updated_at:new Date().toISOString()
      }).eq("id",job.id);
      if(early&&saveError)throw saveError;
      await admin.from("activity_logs").insert({
        level:"info",event_type:early?"motion_preview_ready":"runninghub_production_ready",message:early?"Vídeo #384 salvo; execução RunningHub continua":"Vídeo do RunningHub finalizado e salvo",
        meta:{production_job_id:job.id,result_video_id:video.id,credits_used:Number.isFinite(creditsUsed)?creditsUsed:null}
      });
      if(early)await cancelMotionAfterSave(admin,job.id,rhJson);
    }


    function pickFaceSwapOutput(items:any[]){
      const list=Array.isArray(items)?items:[];
      const isImage=(x:any)=>{
        const type=String(x?.fileType||x?.outputType||"").toLowerCase();
        const url=String(x?.fileUrl||x?.url||"").toLowerCase();
        return /jpg|jpeg|png|webp/.test(type)||/\.(jpg|jpeg|png|webp)(?:\?|$)/.test(url);
      };
      const exact=list.find((x:any)=>{
        const node=String(x?.nodeId??x?.node_id??x?.nodeInfoId??x?.nodeInfo?.nodeId??"");
        return node===faceSwapOutputNodeId&&isImage(x);
      });
      return exact||list.find(isImage)||list[0]||null;
    }

    async function ensureProductionFromFaceSwap(job:any,resultPath:string,resultName:string,resultMime:string,resultSize:number){
      const {data:existing,error:existingError}=await admin.from("production_jobs")
        .select("id,status").eq("id",job.id).maybeSingle();
      if(existingError)throw existingError;
      if(existing)return existing.id;

      const {data:created,error:createError}=await admin.from("production_jobs").insert({
        id:job.id,
        user_id:job.user_id,
        storage_provider:String(job.storage_provider||"supabase"),
        original_storage_path:job.original_storage_path,
        original_file_name:job.original_file_name,
        original_mime_type:job.original_mime_type||"video/mp4",
        original_size_bytes:Number(job.original_size_bytes||0),
        frame_storage_path:resultPath,
        frame_file_name:resultName,
        frame_mime_type:resultMime,
        frame_size_bytes:Number(resultSize||0),
        status:"waiting",
        progress:0,
        meta:{
          source:"face_swap",
          face_swap_job_id:job.id,
          manual_run:true,
          auto_chained:true
        }
      }).select("id").single();
      if(createError)throw createError;
      return created.id;
    }

    async function saveFaceSwapResult(job:any,item:any,usage:any=null){
      const fileUrl=String(item?.fileUrl||item?.url||"");
      if(!fileUrl)throw new Error("Face Swap concluiu sem URL de imagem");
      const rr=await fetch(fileUrl);
      if(!rr.ok)throw new Error("Não consegui baixar a imagem do Face Swap");
      const blob=await rr.blob();
      if(!blob.size)throw new Error("Face Swap retornou imagem vazia");
      const ext=imageExtFrom(fileUrl,item?.fileType||item?.outputType);
      const mime=imageMimeFor(ext);
      const path=job.user_id+"/face-swap-results/"+new Date().toISOString().slice(0,10)+"/"+job.id+"."+ext;
      const provider=String(job.storage_provider||"supabase")==="r2"?"r2":"supabase";
      let r2:CloudentR2Config|null=null;
      if(provider==="r2"){
        r2=await getCloudentR2Config(admin);
        if(!r2)throw new Error("r2_not_configured");
        await putAndVerifyR2(r2,path,blob,mime);
      }else{
        const {error:ue}=await admin.storage.from("production").upload(path,blob,{contentType:mime,upsert:true});
        if(ue)throw ue;
      }

      const resultName="face-swap-"+String(job.id).slice(0,8)+"."+ext;
      let productionJobId:any=job.production_job_id||null;
      if(job.auto_send===true){
        try{
          productionJobId=await ensureProductionFromFaceSwap(job,path,resultName,mime,blob.size);
        }catch(e){
          if(provider==="r2"&&r2)await deleteR2Object(r2,path).catch(()=>null);
          else await admin.storage.from("production").remove([path]).catch(()=>null);
          throw e;
        }
      }

      const consumeCoins=usage?.consumeCoins;
      const consumeMoney=usage?.consumeMoney;
      const thirdPartyConsumeMoney=usage?.thirdPartyConsumeMoney;
      const runtime=usage?.taskCostTime;
      const rawCredits=consumeCoins===null||consumeCoins===undefined||consumeCoins===""?null:Number(consumeCoins);
      let creditsUsed=rawCredits!==null&&Number.isFinite(rawCredits)?rawCredits:null;
      const rawCost=consumeMoney===null||consumeMoney===undefined||consumeMoney===""?null:Number(consumeMoney);
      const costMoney=rawCost!==null&&Number.isFinite(rawCost)?rawCost:null;
      const rawThird=thirdPartyConsumeMoney===null||thirdPartyConsumeMoney===undefined||thirdPartyConsumeMoney===""?null:Number(thirdPartyConsumeMoney);
      const thirdPartyCost=rawThird!==null&&Number.isFinite(rawThird)?rawThird:null;
      const runtimeSeconds=runtime===null||runtime===undefined||runtime===""?null:Number(runtime);
      let creditsAfter:any=null;
      const before=Number(job.credits_before);
      if(concurrency===1&&Number.isFinite(before)){
        for(let attempt=0;attempt<4;attempt++){
          creditsAfter=await getAccountCredits();
          if(Number.isFinite(creditsAfter)){
            const delta=Math.max(0,before-Number(creditsAfter));
            if(delta>0){creditsUsed=delta;break}
          }
          if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1200));
        }
      }

      const {error:updateError}=await admin.from("face_swap_jobs").update({
        status:"ready",
        progress:100,
        result_url:fileUrl,
        result_storage_path:path,
        result_file_name:resultName,
        result_mime_type:mime,
        result_size_bytes:blob.size,
        production_job_id:productionJobId,
        credits_used:Number.isFinite(creditsUsed)?creditsUsed:null,
        credits_after:Number.isFinite(creditsAfter)?creditsAfter:null,
        runninghub_cost_money:Number.isFinite(costMoney)?costMoney:null,
        runninghub_third_party_cost_money:Number.isFinite(thirdPartyCost)?thirdPartyCost:null,
        runninghub_runtime_seconds:Number.isFinite(runtimeSeconds)?runtimeSeconds:null,
        completed_at:new Date().toISOString(),
        locked_at:null,
        locked_by:null,
        last_error:null,
        updated_at:new Date().toISOString()
      }).eq("id",job.id);
      if(updateError)throw updateError;

      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"face_swap_ready",
        message:job.auto_send===true?"Face Swap pronto e enviado para Produção IA":"Face Swap pronto",
        meta:{face_swap_job_id:job.id,production_job_id:productionJobId,auto_send:job.auto_send===true}
      });
    }

    let touched=0;
    const {data:activeFaceSwap,error:faceActiveError}=await admin.from("face_swap_jobs")
      .select("*").in("status",["queued","running"]).order("created_at",{ascending:true}).limit(50);
    if(faceActiveError)throw faceActiveError;

    for(const job of activeFaceSwap||[]){
      try{
        let handledByV2=false;
        try{
          const vr=await fetch(base+"/openapi/v2/query",{
            method:"POST",
            headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
            body:JSON.stringify({taskId:job.runninghub_task_id})
          });
          let vj:any={};try{vj=await vr.json()}catch{}
          const status=String(vj?.status||"").toUpperCase();
          if(vr.ok&&["QUEUED","RUNNING","SUCCESS","FAILED"].includes(status)){
            handledByV2=true;
            if(status==="SUCCESS"&&Array.isArray(vj?.results)&&vj.results.length){
              const item=pickFaceSwapOutput(vj.results);
              if(!item)throw new Error("Face Swap concluiu sem imagem");
              let usage=vj?.usage||null;
              try{
                const legacy=await rhJson("/task/openapi/outputs",{taskId:job.runninghub_task_id});
                if(Number(legacy?.code)===0&&Array.isArray(legacy?.data)&&legacy.data.length){
                  const costItem=pickFaceSwapOutput(legacy.data)||legacy.data[0];
                  usage={
                    consumeCoins:costItem?.consumeCoins??legacy?.usage?.consumeCoins??usage?.consumeCoins??null,
                    consumeMoney:costItem?.consumeMoney??legacy?.usage?.consumeMoney??usage?.consumeMoney??null,
                    thirdPartyConsumeMoney:costItem?.thirdPartyConsumeMoney??legacy?.usage?.thirdPartyConsumeMoney??usage?.thirdPartyConsumeMoney??null,
                    taskCostTime:costItem?.taskCostTime??legacy?.usage?.taskCostTime??usage?.taskCostTime??null
                  };
                }
              }catch{}
              await saveFaceSwapResult(job,item,usage);
              touched++;
            }else if(status==="FAILED"){
              const reason=vj?.errorMessage||vj?.failedReason?.exception_message||vj?.failedReason?.node_name||"Face Swap falhou";
              const retry=Number(job.attempt_count)<Number(job.max_attempts);
              await admin.from("face_swap_jobs").update({
                status:retry?"waiting":"failed",
                progress:retry?0:job.progress,
                runninghub_task_id:retry?null:job.runninghub_task_id,
                next_attempt_at:new Date(Date.now()+5*60_000).toISOString(),
                locked_at:null,locked_by:null,last_error:String(reason),
                started_at:retry?null:job.started_at,
                updated_at:new Date().toISOString()
              }).eq("id",job.id);
              touched++;
            }else{
              await admin.from("face_swap_jobs").update({
                status:status==="QUEUED"?"queued":"running",
                progress:status==="QUEUED"?38:Math.max(62,Number(job.progress||0)),
                last_error:null,updated_at:new Date().toISOString()
              }).eq("id",job.id);
            }
          }
        }catch{if(isMotionPreviewJob(job))handledByV2=false;}

        if(handledByV2)continue;

        const j=await rhJson("/task/openapi/outputs",{taskId:job.runninghub_task_id});
        const resultCode=Number(j?.code);
        const data=j?.data;
        if(resultCode===0&&Array.isArray(data)&&data.length){
          const item=pickFaceSwapOutput(data);
          if(!item)throw new Error("Face Swap concluiu sem imagem");
          await saveFaceSwapResult(job,item,{
            consumeCoins:item?.consumeCoins??j?.usage?.consumeCoins??null,
            consumeMoney:item?.consumeMoney??j?.usage?.consumeMoney??null,
            thirdPartyConsumeMoney:item?.thirdPartyConsumeMoney??j?.usage?.thirdPartyConsumeMoney??null,
            taskCostTime:item?.taskCostTime??j?.usage?.taskCostTime??null
          });
          touched++;
        }else if(resultCode===805){
          const reason=data?.failedReason?.exception_message||data?.failedReason?.node_name||j?.msg||"Face Swap falhou";
          const retry=Number(job.attempt_count)<Number(job.max_attempts);
          await admin.from("face_swap_jobs").update({
            status:retry?"waiting":"failed",
            progress:retry?0:job.progress,
            runninghub_task_id:retry?null:job.runninghub_task_id,
            next_attempt_at:new Date(Date.now()+5*60_000).toISOString(),
            locked_at:null,locked_by:null,last_error:String(reason),
            started_at:retry?null:job.started_at,
            updated_at:new Date().toISOString()
          }).eq("id",job.id);
          touched++;
        }else{
          const queued=resultCode===813;
          await admin.from("face_swap_jobs").update({
            status:queued?"queued":"running",
            progress:queued?38:Math.max(62,Number(job.progress||0)),
            last_error:null,updated_at:new Date().toISOString()
          }).eq("id",job.id);
        }
      }catch(e:any){
        await admin.from("face_swap_jobs").update({
          last_error:e instanceof Error?e.message:String(e),updated_at:new Date().toISOString()
        }).eq("id",job.id);
      }
    }

    const {data:active,error:ae}=await admin.from("production_jobs")
      .select("*").in("status",["queued","running"]).order("created_at",{ascending:true}).limit(50);
    if(ae)throw ae;

    for(const job of active||[]){
      try{
        if(isMotionPreviewJob(job)){
          if(job.result_video_id&&job.meta?.motion_preview_available){
            await cancelMotionAfterSave(admin,job.id,rhJson);
            continue;
          }
          const file=job.meta?.motion_preview_file;
          if(file&&String(file.task_id)===String(job.runninghub_task_id)&&file.node_id==="384"){
            const valid=motionPreviewFile({type:"executed",data:{node:"384",prompt_id:job.runninghub_task_id,output:{videos:[file]}}},String(job.runninghub_task_id));
            if(!valid)throw new Error("Motion Control: arquivo de prévia inválido.");
            const lease="motion-save-"+crypto.randomUUID();
            const {data:locked}=await admin.from("production_jobs").update({locked_by:lease,locked_at:new Date().toISOString()}).eq("id",job.id).eq("runninghub_task_id",job.runninghub_task_id).is("result_video_id",null).is("locked_by",null).select("id").maybeSingle();
            if(!locked)continue;
            try{
              const outputs=await rhJson("/task/openapi/outputs",{taskId:job.runninghub_task_id});
              const wss=outputs?.data?.netWssUrl;
              if(wss){
                const rr=await fetch(motionPreviewViewUrl(base,wss,valid),{signal:AbortSignal.timeout(30000)});
                if(!rr.ok)throw new Error("Motion Control: download da saída #384 indisponível · HTTP "+rr.status);
                const blob=await rr.blob();
                const bytes=new Uint8Array(await blob.slice(0,16).arrayBuffer());
                const mp4=new TextDecoder().decode(bytes.slice(4,8))==="ftyp";
                const webm=bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
                if(!mp4&&!webm)throw new Error("Motion Control: saída #384 não retornou um arquivo de vídeo.");
                await saveResult(job,{fileType:valid.filename.split(".").pop()},null,blob);
                touched++;continue;
              }
              if(Number(outputs?.code)===0&&Array.isArray(outputs.data)){
                const item=outputs.data.find((x:any)=>String(x?.nodeId??x?.node_id??"")==="384");
                if(item){await saveResult(job,item,item);touched++;continue;}
              }
              throw new Error("Motion Control: saída #384 ainda não acessível.");
            }finally{await admin.from("production_jobs").update({locked_by:null,locked_at:null}).eq("id",job.id).eq("locked_by",lease);}
          }
          await ensureMotionPreviewMonitor(admin,job,base,apiKey,String(expected));
        }
        let handledByV2=false;
        try{
          const vr=await fetch(base+"/openapi/v2/query",{
            method:"POST",
            headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
            body:JSON.stringify({taskId:job.runninghub_task_id})
          });
          let vj:any={};try{vj=await vr.json()}catch{}
          const status=String(vj?.status||"").toUpperCase();
          if(vr.ok&&["QUEUED","RUNNING","SUCCESS","FAILED"].includes(status)){
            handledByV2=true;
            if(status==="SUCCESS"&&Array.isArray(vj?.results)&&vj.results.length){
              let item=vj.results.find((x:any)=>String(x?.outputType||"").toLowerCase().match(/mp4|mov|webm|mkv|avi/))||vj.results[0];
              if(isMotionPreviewJob(job)){
                const exact=await rhJson("/task/openapi/outputs",{taskId:job.runninghub_task_id});
                item=Array.isArray(exact?.data)?exact.data.find((x:any)=>String(x?.nodeId??x?.node_id??"")==="384"):null;
                if(!item)throw new Error("Motion Control: saída #384 ausente nos resultados.");
              }
              let usage=vj?.usage||null;
              try{
                const legacy=await rhJson("/task/openapi/outputs",{taskId:job.runninghub_task_id});
                if(Number(legacy?.code)===0&&Array.isArray(legacy?.data)&&legacy.data.length){
                  const costItem=legacy.data.find((x:any)=>String(x?.fileType||"").toLowerCase().match(/mp4|mov|webm|mkv|avi/))||legacy.data[0];
                  usage={
                    consumeCoins:costItem?.consumeCoins??legacy?.usage?.consumeCoins??usage?.consumeCoins??null,
                    consumeMoney:costItem?.consumeMoney??legacy?.usage?.consumeMoney??usage?.consumeMoney??null,
                    thirdPartyConsumeMoney:costItem?.thirdPartyConsumeMoney??legacy?.usage?.thirdPartyConsumeMoney??usage?.thirdPartyConsumeMoney??null,
                    taskCostTime:costItem?.taskCostTime??legacy?.usage?.taskCostTime??usage?.taskCostTime??null
                  };
                }
              }catch{}
              await saveResult(job,item,usage);
              touched++;
            }else if(status==="FAILED"){
              const reason=vj?.errorMessage||vj?.failedReason?.exception_message||vj?.failedReason?.node_name||"RunningHub falhou";
              const retry=Number(job.attempt_count)<Number(job.max_attempts);
              await admin.from("production_jobs").update({
                status:retry?"waiting":"failed",progress:retry?0:job.progress,runninghub_task_id:retry?null:job.runninghub_task_id,
                credits_used:vj?.usage?.consumeCoins===null||vj?.usage?.consumeCoins===undefined?job.credits_used:Number(vj.usage.consumeCoins),
                runninghub_runtime_seconds:vj?.usage?.taskCostTime===null||vj?.usage?.taskCostTime===undefined?job.runninghub_runtime_seconds:Number(vj.usage.taskCostTime),
                next_attempt_at:new Date(Date.now()+5*60_000).toISOString(),locked_at:null,locked_by:null,last_error:String(reason),
                started_at:retry?null:job.started_at,
                updated_at:new Date().toISOString()
              }).eq("id",job.id);
              touched++;
            }else{
              await admin.from("production_jobs").update({
                status:status==="QUEUED"?"queued":"running",
                progress:status==="QUEUED"?38:Math.max(62,Number(job.progress||0)),
                last_error:null,updated_at:new Date().toISOString()
              }).eq("id",job.id);
            }
          }
        }catch{}

        if(handledByV2)continue;

        const j=await rhJson("/task/openapi/outputs",{taskId:job.runninghub_task_id});
        const resultCode=Number(j?.code);
        const data=j?.data;
        if(resultCode===0 && Array.isArray(data) && data.length){
          const item=isMotionPreviewJob(job)?data.find((x:any)=>String(x?.nodeId??x?.node_id??"")==="384"):data.find((x:any)=>String(x?.fileType||"").toLowerCase().match(/mp4|mov|webm|mkv|avi/))||data[0];
          if(!item)throw new Error("Motion Control: saída #384 ausente nos resultados.");
          await saveResult(job,item,{
            consumeCoins:item?.consumeCoins??null,
            consumeMoney:item?.consumeMoney??null,
            thirdPartyConsumeMoney:item?.thirdPartyConsumeMoney??null,
            taskCostTime:item?.taskCostTime??null
          });
          touched++;
        }else if(resultCode===805){
          const reason=data?.failedReason?.exception_message||data?.failedReason?.node_name||j?.msg||"RunningHub falhou";
          const retry=Number(job.attempt_count)<Number(job.max_attempts);
          await admin.from("production_jobs").update({
            status:retry?"waiting":"failed",progress:retry?0:job.progress,runninghub_task_id:retry?null:job.runninghub_task_id,
            next_attempt_at:new Date(Date.now()+5*60_000).toISOString(),locked_at:null,locked_by:null,last_error:String(reason),
            started_at:retry?null:job.started_at,
            updated_at:new Date().toISOString()
          }).eq("id",job.id);
          touched++;
        }else{
          const queued=resultCode===813;
          await admin.from("production_jobs").update({
            status:queued?"queued":"running",progress:queued?38:Math.max(62,Number(job.progress||0)),last_error:null,updated_at:new Date().toISOString()
          }).eq("id",job.id);
        }
      }catch(e:any){
        await admin.from("production_jobs").update({
          last_error:e instanceof Error?e.message:String(e),updated_at:new Date().toISOString()
        }).eq("id",job.id);
      }
    }

    // Repair recent Face Swap usage when an older worker completed without persisting it.
    try{
      const cutoff=new Date(Date.now()-7*86400000).toISOString();
      const {data:missingFaceCosts}=await admin.from("face_swap_jobs")
        .select("id,runninghub_task_id,credits_used,runninghub_cost_money,runninghub_third_party_cost_money,runninghub_runtime_seconds,updated_at")
        .eq("status","ready")
        .is("credits_used",null)
        .not("runninghub_task_id","is",null)
        .gte("completed_at",cutoff)
        .order("completed_at",{ascending:false})
        .limit(12);
      for(const row of missingFaceCosts||[]){
        try{
          const legacy=await rhJson("/task/openapi/outputs",{taskId:row.runninghub_task_id});
          if(Number(legacy?.code)!==0||!Array.isArray(legacy?.data)||!legacy.data.length)continue;
          const item=pickFaceSwapOutput(legacy.data)||legacy.data[0];
          const coinRaw=item?.consumeCoins??legacy?.usage?.consumeCoins;
          const moneyRaw=item?.consumeMoney??legacy?.usage?.consumeMoney;
          const thirdRaw=item?.thirdPartyConsumeMoney??legacy?.usage?.thirdPartyConsumeMoney;
          const runtimeRaw=item?.taskCostTime??legacy?.usage?.taskCostTime;
          const coin=coinRaw===null||coinRaw===undefined||coinRaw===""?null:Number(coinRaw);
          const money=moneyRaw===null||moneyRaw===undefined||moneyRaw===""?null:Number(moneyRaw);
          const third=thirdRaw===null||thirdRaw===undefined||thirdRaw===""?null:Number(thirdRaw);
          const runtime=runtimeRaw===null||runtimeRaw===undefined||runtimeRaw===""?null:Number(runtimeRaw);
          await admin.from("face_swap_jobs").update({
            credits_used:Number.isFinite(coin)?coin:row.credits_used,
            runninghub_cost_money:Number.isFinite(money)?money:row.runninghub_cost_money,
            runninghub_third_party_cost_money:Number.isFinite(third)?third:row.runninghub_third_party_cost_money,
            runninghub_runtime_seconds:Number.isFinite(runtime)?runtime:row.runninghub_runtime_seconds,
            updated_at:new Date().toISOString()
          }).eq("id",row.id);
        }catch{}
      }
    }catch{}

    // Repair real RH coin usage for completed jobs where V2 returned no usage.
    try{
      const cutoff=new Date(Date.now()-14*86400000).toISOString();
      const {data:missingCredits}=await admin.from("production_jobs")
        .select("id,runninghub_task_id,credits_used,runninghub_cost_money,runninghub_third_party_cost_money,runninghub_runtime_seconds,meta")
        .eq("status","ready")
        .is("credits_used",null)
        .not("runninghub_task_id","is",null)
        .gte("completed_at",cutoff)
        .order("completed_at",{ascending:false})
        .limit(12);
      for(const row of missingCredits||[]){
        try{
          const legacy=await rhJson("/task/openapi/outputs",{taskId:row.runninghub_task_id});
          if(Number(legacy?.code)!==0||!Array.isArray(legacy?.data)||!legacy.data.length)continue;
          const item=legacy.data.find((x:any)=>String(x?.fileType||"").toLowerCase().match(/mp4|mov|webm|mkv|avi/))||legacy.data[0];
          const raw=item?.consumeCoins??legacy?.usage?.consumeCoins;
          const cost=raw===null||raw===undefined||raw===""?null:Number(raw);
          const rawMoney=item?.consumeMoney??legacy?.usage?.consumeMoney;
          const money=rawMoney===null||rawMoney===undefined||rawMoney===""?null:Number(rawMoney);
          const rawThird=item?.thirdPartyConsumeMoney??legacy?.usage?.thirdPartyConsumeMoney;
          const third=rawThird===null||rawThird===undefined||rawThird===""?null:Number(rawThird);
          const rawRuntime=item?.taskCostTime??legacy?.usage?.taskCostTime;
          const runtime=rawRuntime===null||rawRuntime===undefined||rawRuntime===""?null:Number(rawRuntime);
          const probe={
            code:legacy?.code??null,
            data_count:Array.isArray(legacy?.data)?legacy.data.length:0,
            item_keys:item?Object.keys(item).slice(0,20):[],
            consumeCoins:item?.consumeCoins??legacy?.usage?.consumeCoins??null,
            consumeMoney:item?.consumeMoney??legacy?.usage?.consumeMoney??null,
            thirdPartyConsumeMoney:item?.thirdPartyConsumeMoney??legacy?.usage?.thirdPartyConsumeMoney??null,
            taskCostTime:item?.taskCostTime??legacy?.usage?.taskCostTime??null
          };
          const hasCoin=cost!==null&&Number.isFinite(cost);
          const hasMoney=money!==null&&Number.isFinite(money);
          const hasThird=third!==null&&Number.isFinite(third);
          if(hasCoin||hasMoney||hasThird){
            await admin.from("production_jobs").update({
              credits_used:hasCoin?cost:row.credits_used,
              runninghub_cost_money:hasMoney?money:row.runninghub_cost_money,
              runninghub_third_party_cost_money:hasThird?third:row.runninghub_third_party_cost_money,
              runninghub_runtime_seconds:Number.isFinite(runtime)?runtime:row.runninghub_runtime_seconds,
              meta:{
                ...(row.meta||{}),
                credit_source:hasCoin?"runninghub_outputs_repair":row.meta?.credit_source||null,
                cost_source:(hasMoney||hasThird)?"runninghub_outputs_repair":row.meta?.cost_source||null,
                credit_probe:probe
              },
              updated_at:new Date().toISOString()
            }).eq("id",row.id);
            touched++;
          }else{
            await admin.from("production_jobs").update({
              meta:{...(row.meta||{}),credit_probe:probe},
              updated_at:new Date().toISOString()
            }).eq("id",row.id);
          }
        }catch{}
      }
    }catch{}

    const [{count:productionActiveCount},{count:faceSwapActiveCount},{count:priorityProductionCount}]=await Promise.all([
      admin.from("production_jobs").select("*",{count:"exact",head:true}).in("status",["uploading","queued","running"]),
      admin.from("face_swap_jobs").select("*",{count:"exact",head:true}).in("status",["uploading","queued","running"]),
      admin.from("production_jobs").select("*",{count:"exact",head:true}).eq("status","waiting").contains("meta",{manual_run:true})
    ]);
    const activeCount=Number(productionActiveCount||0)+Number(faceSwapActiveCount||0);
    const slots=Math.max(0,concurrency-activeCount);

    async function startProductionJobs(){
      const {data:claimed,error:ce}=await admin.rpc("claim_production_jobs",{p_worker:workerId,p_limit:concurrency});
      if(ce)throw ce;
      for(const job of claimed||[]){
        try{
          const videoInput=await prepareInput(job.original_storage_path,job.original_file_name,job.original_mime_type||"video/mp4",job.storage_provider||"supabase");
          await admin.from("production_jobs").update({progress:15,runninghub_video_file:videoInput,updated_at:new Date().toISOString()}).eq("id",job.id);
          const frameInput=await prepareInput(job.frame_storage_path,job.frame_file_name,job.frame_mime_type||"image/jpeg",job.storage_provider||"supabase");
          await admin.from("production_jobs").update({progress:25,runninghub_frame_file:frameInput,updated_at:new Date().toISOString()}).eq("id",job.id);

          const creditsBefore=concurrency===1?await getAccountCredits():null;
          if(Number.isFinite(creditsBefore)){
            await admin.from("production_jobs").update({credits_before:creditsBefore,updated_at:new Date().toISOString()}).eq("id",job.id);
          }

          const created=await rhJson("/task/openapi/create",{
            workflowId,
            nodeInfoList:[
              {nodeId:videoNodeId,fieldName:videoFieldName,fieldValue:videoInput},
              {nodeId:frameNodeId,fieldName:frameFieldName,fieldValue:frameInput}
            ],
            addMetadata:true
          });
          if(Number(created?.code)!==0||!created?.data?.taskId)throw new Error(created?.msg||"RunningHub não retornou taskId");
          const taskId=String(created.data.taskId);
          const taskStatus=String(created.data.taskStatus||"QUEUED").toUpperCase();
          await admin.from("production_jobs").update({
            status:taskStatus==="RUNNING"?"running":"queued",progress:taskStatus==="RUNNING"?55:35,
            runninghub_task_id:taskId,locked_at:null,locked_by:null,last_error:null,updated_at:new Date().toISOString()
          }).eq("id",job.id);
          touched++;
        }catch(e:any){
          const message=e instanceof Error?e.message:String(e);
          const retry=Number(job.attempt_count)<Number(job.max_attempts);
          await admin.from("production_jobs").update({
            status:retry?"waiting":"failed",progress:retry?0:job.progress,
            next_attempt_at:new Date(Date.now()+5*60_000).toISOString(),
            locked_at:null,locked_by:null,last_error:message,
            started_at:retry?null:job.started_at,
            updated_at:new Date().toISOString()
          }).eq("id",job.id);
          touched++;
        }
      }
      return (claimed||[]).length;
    }

    async function startFaceSwapJobs(){
      if(!faceSwapEnabled||!faceSwapConfigured)return 0;
      const {data:claimed,error:ce}=await admin.rpc("claim_face_swap_jobs",{p_worker:workerId,p_limit:concurrency});
      if(ce)throw ce;
      for(const job of claimed||[]){
        try{
          const frameInput=await prepareInput(job.frame_storage_path,job.frame_file_name,job.frame_mime_type||"image/jpeg",job.storage_provider||"supabase");
          await admin.from("face_swap_jobs").update({
            progress:25,runninghub_frame_file:frameInput,updated_at:new Date().toISOString()
          }).eq("id",job.id);

          const creditsBefore=concurrency===1?await getAccountCredits():null;
          if(Number.isFinite(creditsBefore)){
            await admin.from("face_swap_jobs").update({
              credits_before:creditsBefore,updated_at:new Date().toISOString()
            }).eq("id",job.id);
            job.credits_before=creditsBefore;
          }

          const nodeInfoList:any[]=[{nodeId:faceSwapReferenceNodeId,fieldName:faceSwapReferenceFieldName,fieldValue:frameInput}];
          const character=job.meta?.character;
          if(!character?.storage_path)throw new Error("character_snapshot_missing");
          if(!String(character.storage_path).startsWith(job.user_id+"/face-swap-characters/"))throw new Error("character_path_invalid");
          const characterAudit:any={storage_path:character.storage_path,file_name:character.file_name,expected_sha256:character.sha256||null,node_id:String(cfg.faceSwapCharacterNodeId||"23")};
          const characterInput=await prepareInput(character.storage_path,"character."+(character.mime_type==="image/jpeg"?"jpg":character.mime_type==="image/webp"?"webp":"png"),character.mime_type||"image/png","supabase",characterAudit);
          characterAudit.runninghub_file=characterInput;
          const {error:auditError}=await admin.from("face_swap_jobs").update({meta:{...(job.meta||{}),character_input:characterAudit}}).eq("id",job.id);
          if(auditError)throw auditError;
          nodeInfoList.push({nodeId:characterAudit.node_id,fieldName:String(cfg.faceSwapCharacterFieldName||"image"),fieldValue:characterInput});
          const created=await rhJson("/task/openapi/create",{
            workflowId:faceSwapWorkflowId,
            nodeInfoList,
            addMetadata:true
          });
          if(Number(created?.code)!==0||!created?.data?.taskId)throw new Error(created?.msg||"RunningHub não retornou taskId no Face Swap");
          const taskId=String(created.data.taskId);
          const taskStatus=String(created.data.taskStatus||"QUEUED").toUpperCase();
          await admin.from("face_swap_jobs").update({
            status:taskStatus==="RUNNING"?"running":"queued",
            progress:taskStatus==="RUNNING"?55:35,
            runninghub_task_id:taskId,locked_at:null,locked_by:null,last_error:null,updated_at:new Date().toISOString()
          }).eq("id",job.id);
          touched++;
        }catch(e:any){
          const message=e instanceof Error?e.message:String(e);
          const retry=Number(job.attempt_count)<Number(job.max_attempts);
          await admin.from("face_swap_jobs").update({
            status:retry?"waiting":"failed",progress:retry?0:job.progress,
            next_attempt_at:new Date(Date.now()+5*60_000).toISOString(),
            locked_at:null,locked_by:null,last_error:message,
            started_at:retry?null:job.started_at,
            updated_at:new Date().toISOString()
          }).eq("id",job.id);
          touched++;
        }
      }
      return (claimed||[]).length;
    }

    if(slots>0){
      // Finish the second half of an automatic Face Swap pipeline before starting another face.
      if(Number(priorityProductionCount||0)>0){
        await startProductionJobs();
        await startFaceSwapJobs();
      }else{
        await startFaceSwapJobs();
        await startProductionJobs();
      }
    }

    await admin.from("worker_runtime").upsert({
      worker_name:"production",last_heartbeat:new Date().toISOString(),last_success_at:new Date().toISOString(),
      last_error:null,last_jobs:touched,updated_at:new Date().toISOString()
    },{onConflict:"worker_name"});
    return out({ok:true,configured:true,face_swap_configured:faceSwapConfigured,processed:touched,concurrency});
  }catch(e:any){
    const message=e instanceof Error?e.message:String(e);
    try{await admin.from("worker_runtime").upsert({
      worker_name:"production",last_heartbeat:new Date().toISOString(),last_error:message,updated_at:new Date().toISOString()
    },{onConflict:"worker_name"})}catch{}
    return out({ok:false,error:message},500);
  }
});


