import {MotionStorageSafetyError as MotionStorageError,motionStorageHealth,motionCheckObject,motionStorageRead,motionObjectConfig,reserveMotionStorage,storageRPC,RESERVE_INPUT_MAX} from "./motion-storage-protection.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"GET,POST,PATCH,OPTIONS",
  "Content-Type":"application/json"
};
const out=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:CORS});
const cleanName=(v,fallback)=>String(v||fallback).replace(/[^\w.\- ()]/g,"_").slice(0,180);
const ext=(name,mime,fallback)=>{
  const n=String(name||"").toLowerCase();
  const m=n.match(/\.([a-z0-9]{2,5})$/);
  if(m)return m[1];
  const map={"video/mp4":"mp4","video/quicktime":"mov","video/webm":"webm","image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
  return map[String(mime||"").toLowerCase()]||fallback;
};
function s3RegionFromEndpoint(endpoint){
  try{
    const host=new URL(endpoint).hostname;
    const m=host.match(/^s3\.([^.]+)\.backblazeb2\.com$/i);
    return m?.[1]||"auto";
  }catch{return "auto"}
}
function keyPath(key){return String(key||"").split("/").map(encodeURIComponent).join("/")}
async function getObjectConfig(admin){
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
async function signed(config,method,key,expires=3600,contentType=""){
  const aws=new AwsClient({service:"s3",region:s3RegionFromEndpoint(config.endpoint),accessKeyId:config.access_key_id,secretAccessKey:config.secret_access_key});
  const headers={}; if(contentType)headers["Content-Type"]=contentType;
  const req=new Request(config.endpoint+"/"+encodeURIComponent(config.bucket)+"/"+keyPath(key)+"?X-Amz-Expires="+Math.max(1,Math.min(604800,expires)),{method,headers});
  const request=await aws.sign(req,{aws:{signQuery:true}});
  return request.url.toString();
}
async function exists(admin,config,key,expectedSize=0){return motionCheckObject(admin,config,key,expectedSize);}
async function wake(admin){
  try{
    const {data:secret}=await admin.rpc("get_cloudent_worker_secret");
    if(!secret)return;
    const base=String(Deno.env.get("SUPABASE_URL")||"").replace(/\/$/,"");
    await fetch(base+"/functions/v1/cloudent-motion-control-worker",{
      method:"POST",
      headers:{"Content-Type":"application/json","x-cloudent-worker-secret":String(secret)},
      body:"{}"
    });
  }catch{}
}
async function userFromReq(admin,req){
  const raw=String(req.headers.get("Authorization")||"");
  const token=raw.replace(/^Bearer\s+/i,"").trim();
  if(!token)return null;
  const {data,error}=await admin.auth.getUser(token);
  if(error||!data?.user)return null;
  return data.user;
}
function isMotion(job){return String(job?.meta?.workflow_key||"")==="motion_control"}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  const admin=createClient(Deno.env.get("SUPABASE_URL"),Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const user=await userFromReq(admin,req);
    if(!user)return out({ok:false,error:"unauthorized"},401);
    const {data:accessMember,error:accessError}=await admin.from("app_members").select("role,enabled").eq("user_id",user.id).maybeSingle();
    if(accessError||!accessMember?.enabled||accessMember.role!=="admin")return out({error:"forbidden"},403);
    const url=new URL(req.url);
    const action=url.searchParams.get("action")||"";
    const resource=url.searchParams.get("resource")||"";

    if(req.method==="GET"&&resource==="storage-health"){
      return out({ok:true,storage:await storageRPC(admin,"motion_storage_status")});
    }
    if(req.method==="GET"&&resource==="thumbnail"){
      const id=String(url.searchParams.get("id")||""),kind=String(url.searchParams.get("kind")||"");
      if(!["video-thumb","frame-thumb"].includes(kind))return out({error:"thumbnail_kind_invalid"},400);
      const {data:job,error}=await admin.from("production_jobs").select("id,user_id,storage_provider,meta").eq("id",id).eq("user_id",user.id).maybeSingle();
      if(error)throw error;if(!job||!isMotion(job))return out({error:"thumbnail_not_found"},404);
      const path=String(kind==="video-thumb"?job.meta?.original_thumbnail_path:job.meta?.frame_thumbnail_path);
      if(!path||!path.startsWith(user.id+"/"))return out({error:"thumbnail_not_found"},404);
      let blob;
      if(job.storage_provider==="r2"){
        const health=await motionStorageHealth(admin);
        if(!health?.allow_primary)throw new MotionStorageError("Miniaturas aguardam a recuperação do armazenamento.");
        const cfg=await motionObjectConfig(admin);if(!cfg)throw new MotionStorageError("Armazenamento indisponível.");
        const response=await motionStorageRead(admin,cfg,path);
        if(!response.ok)return out({error:"thumbnail_not_found"},404);
        const size=Number(response.headers.get("content-length")||0);
        if(size>256*1024){await response.body?.cancel();return out({error:"thumbnail_too_large"},413);}
        blob=await response.blob();
      }else{
        const {data,error}=await admin.storage.from("production").download(path);if(error||!data)return out({error:"thumbnail_not_found"},404);blob=data;
      }
      if(blob.size>256*1024||!["image/jpeg","image/png","image/webp"].includes(blob.type.split(";")[0]))return out({error:"thumbnail_invalid"},415);
      return new Response(blob,{headers:{...CORS,"Content-Type":blob.type,"Cache-Control":"private, max-age=86400","X-Content-Type-Options":"nosniff"}});
    }

    if(req.method==="GET"&&resource==="config"){
      const [{data:setting},{data:integration}]=await Promise.all([
        admin.from("app_settings").select("value,updated_at").eq("key","motion_control_workflow").maybeSingle(),
        admin.from("integrations").select("enabled,config").eq("provider","runninghub").maybeSingle()
      ]);
      const cfg=setting?.value||{};
      return out({ok:true,workflow:{
        workflowId:String(cfg.workflowId||""),
        videoNodeId:String(cfg.videoNodeId||"275"),
        videoFieldName:String(cfg.videoFieldName||"video"),
        frameNodeId:String(cfg.frameNodeId||"299"),
        frameFieldName:String(cfg.frameFieldName||"image"),
        outputNodeId:String(cfg.outputNodeId||"285"),
        title:String(cfg.title||"Motion Control V7"),
        lastValidatedAt:cfg.lastValidatedAt||null,
        lastValidationError:cfg.lastValidationError||null
      },runninghub:{enabled:integration?.enabled!==false,apiKeyConfigured:!!integration?.config?.apiKeyConfigured}});
    }

    if(req.method==="POST"&&["upload-ticket","upload-complete","upload"].includes(action)){
      const {data:credentials,error:credentialsError}=await admin.from("integrations").select("config").eq("provider","runninghub").maybeSingle();
      if(credentialsError)throw credentialsError;
      if(!credentials?.config?.apiKeyConfigured)return out({ok:false,error:"provider_reconnection_required",message:"Reconecte o RunningHub e o Backblaze em Configurações antes de iniciar uma nova geração."},409);
    }
    if(req.method==="POST"&&action==="upload-ticket"){
      const body=await req.json();
      const videoSize=Math.max(0,Number(body.video_size_bytes||0));
      const frameSize=Math.max(0,Number(body.frame_size_bytes||0));
      if(!videoSize||!frameSize)throw new Error("Vídeo e frame são obrigatórios.");
      if(videoSize>2*1024*1024*1024)throw new Error("Vídeo maior que 2 GB.");
      if(frameSize>30*1024*1024)throw new Error("Frame maior que 30 MB.");
      const cfg=await getObjectConfig(admin);
      const health=await motionStorageHealth(admin);
      const jobId=crypto.randomUUID();
      if(!cfg||!health?.allow_primary){
        await reserveMotionStorage(admin,jobId,user.id,videoSize+frameSize);
        return out({ok:true,fallback:true,reserve:true,job_id:jobId,max_input_bytes:RESERVE_INPUT_MAX,storage_paused:true});
      }
      const day=new Date().toISOString().slice(0,10);
      const base=user.id+"/motion-control-inputs/"+day+"/"+jobId;
      const videoMime=String(body.video_mime_type||"video/mp4");
      const frameMime=String(body.frame_mime_type||"image/jpeg");
      const vext=ext(body.video_file_name,videoMime,"mp4");
      const fext=ext(body.frame_file_name,frameMime,"jpg");
      const parts={
        video:{path:base+"/video."+vext,content_type:videoMime},
        frame:{path:base+"/frame."+fext,content_type:frameMime},
        video_thumb:body.has_video_thumb?{path:base+"/video-thumb.jpg",content_type:"image/jpeg"}:null,
        frame_thumb:body.has_frame_thumb?{path:base+"/frame-thumb.jpg",content_type:"image/jpeg"}:null
      };
      for(const p of Object.values(parts)){
        if(p)p.upload_url=await signed(cfg,"PUT",p.path,1800,p.content_type);
      }
      return out({ok:true,job_id:jobId,...parts});
    }

    if(req.method==="POST"&&action==="upload-complete"){
      const body=await req.json();
      const jobId=String(body.job_id||"");
      if(!/^[0-9a-f-]{36}$/i.test(jobId))throw new Error("Job inválido.");
      const prefix=user.id+"/motion-control-inputs/";
      const videoPath=String(body.video_path||"");
      const framePath=String(body.frame_path||"");
      if(!videoPath.startsWith(prefix)||!framePath.startsWith(prefix))throw new Error("Caminho de upload inválido.");
      const cfg=await getObjectConfig(admin);
      if(!cfg)throw new Error("Armazenamento de produção indisponível.");
      const storageState=await motionStorageHealth(admin);
      if(!storageState?.allow_primary)throw new MotionStorageError("O armazenamento principal está protegido. Seus arquivos selecionados foram preservados; tente novamente após a recuperação.");
      const [videoOk,frameOk]=await Promise.all([exists(admin,cfg,videoPath,Number(body.video_size_bytes||0)),exists(admin,cfg,framePath,Number(body.frame_size_bytes||0))]);
      if(!videoOk||!frameOk)throw new Error("Vídeo ou frame ainda não terminou de enviar.");
      const videoThumbPath=String(body.video_thumb_path||"");
      const frameThumbPath=String(body.frame_thumb_path||"");
      const meta={
        workflow_key:"motion_control",
        workflow_label:"Motion Control V7",
        workflow_nodes:{video:"275",frame:"299",output:"285"},
        manual_run:true,
        original_thumbnail_path:videoThumbPath.startsWith(prefix)?videoThumbPath:null,
        frame_thumbnail_path:frameThumbPath.startsWith(prefix)?frameThumbPath:null
      };
      const {data:job,error}=await admin.from("production_jobs").insert({
        id:jobId,user_id:user.id,storage_provider:"r2",
        original_storage_path:videoPath,
        original_file_name:cleanName(body.video_file_name,"motion.mp4"),
        original_mime_type:String(body.video_mime_type||"video/mp4"),
        original_size_bytes:Number(body.video_size_bytes||0),
        frame_storage_path:framePath,
        frame_file_name:cleanName(body.frame_file_name,"frame.jpg"),
        frame_mime_type:String(body.frame_mime_type||"image/jpeg"),
        frame_size_bytes:Number(body.frame_size_bytes||0),
        status:"motion_waiting",progress:0,max_attempts:1,attempt_count:0,meta
      }).select("*").single();
      if(error)throw error;
      await wake(admin);
      return out({ok:true,job});
    }

    if(req.method==="POST"&&action==="upload"){
      const fd=await req.formData();
      const video=fd.get("video"), frame=fd.get("frame");
      if(!(video instanceof File)||!(frame instanceof File))throw new Error("Vídeo e frame são obrigatórios.");
      const requestedId=String(fd.get("reservation_id")||"");
      if(requestedId&&!/^[0-9a-f-]{36}$/i.test(requestedId))throw new Error("Reserva inválida.");
      const jobId=requestedId||crypto.randomUUID();
      const {data:existing,error:existingError}=await admin.from("production_jobs").select("*").eq("id",jobId).eq("user_id",user.id).maybeSingle();
      if(existingError)throw existingError;
      if(existing&&isMotion(existing))return out({ok:true,job:existing});
      await reserveMotionStorage(admin,jobId,user.id,video.size+frame.size);
      const base=user.id+"/motion-control-reserve/"+jobId;
      const videoPath=base+"/video."+ext(video.name,video.type,"mp4");
      const framePath=base+"/frame."+ext(frame.name,frame.type,"jpg");
      const uploads=[
        admin.storage.from("production").upload(videoPath,video,{contentType:video.type||"video/mp4",upsert:false}),
        admin.storage.from("production").upload(framePath,frame,{contentType:frame.type||"image/jpeg",upsert:false})
      ];
      const videoThumb=fd.get("video_thumb"),frameThumb=fd.get("frame_thumb");
      let videoThumbPath=null,frameThumbPath=null;
      if(videoThumb instanceof File&&videoThumb.size<=256*1024){
        videoThumbPath=base+"/video-thumb.jpg";
        uploads.push(admin.storage.from("production").upload(videoThumbPath,videoThumb,{contentType:"image/jpeg",upsert:false}));
      }
      if(frameThumb instanceof File&&frameThumb.size<=256*1024){
        frameThumbPath=base+"/frame-thumb.jpg";
        uploads.push(admin.storage.from("production").upload(frameThumbPath,frameThumb,{contentType:"image/jpeg",upsert:false}));
      }
      const results=await Promise.all(uploads);
      const failed=results.find(x=>x.error);
      if(failed?.error)throw failed.error;
      const {data:job,error}=await admin.from("production_jobs").insert({
        id:jobId,user_id:user.id,storage_provider:"supabase",
        original_storage_path:videoPath,original_file_name:cleanName(video.name,"motion.mp4"),original_mime_type:video.type||"video/mp4",original_size_bytes:video.size,
        frame_storage_path:framePath,frame_file_name:cleanName(frame.name,"frame.jpg"),frame_mime_type:frame.type||"image/jpeg",frame_size_bytes:frame.size,
        status:"motion_waiting",progress:0,max_attempts:1,attempt_count:0,
        meta:{workflow_key:"motion_control",workflow_label:"Motion Control V7",workflow_nodes:{video:"275",frame:"299",output:"285"},storage_reserve:true,manual_run:true,original_thumbnail_path:videoThumbPath,frame_thumbnail_path:frameThumbPath}
      }).select("*").single();
      if(error)throw error;
      await wake(admin);
      return out({ok:true,job});
    }

    if(req.method==="PATCH"&&action==="job"){
      const body=await req.json();
      const id=String(body.id||""),operation=String(body.operation||"");
      const {data:job,error}=await admin.from("production_jobs").select("*").eq("id",id).eq("user_id",user.id).maybeSingle();
      if(error)throw error;
      if(!job||!isMotion(job))return out({ok:false,error:"Motion Control job não encontrado."},404);
      if(operation==="cancel"){
        await admin.from("production_jobs").update({status:"cancelled",locked_at:null,locked_by:null,last_error:null,updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",user.id);
        return out({ok:true,cancelled:true});
      }
      if(operation==="run"||operation==="retry"){
        if(job.runninghub_task_id&&(operation!=="retry"||job.status!=="failed"||job.meta?.provider_status!=="FAILED"))return out({ok:true,queued:job.status==="queued",task_exists:true});
        if(["queued","running","uploading"].includes(String(job.status||"")))return out({ok:true,queued:true});
        const nextMeta={...(job.meta||{}),workflow_key:"motion_control",manual_run:true};
        for(const key of ["provider_status","provider_status_checked_at","provider_status_task_id","provider_status_source","provider_status_error","provider_run_started_at","provider_run_started_task_id","provider_queue_waiting"])delete nextMeta[key];
        const {error:ue}=await admin.from("production_jobs").update({
          status:"motion_waiting",progress:0,runninghub_task_id:null,runninghub_video_file:null,runninghub_frame_file:null,
          attempt_count:0,max_attempts:1,next_attempt_at:new Date().toISOString(),locked_at:null,locked_by:null,last_error:null,
          started_at:null,completed_at:null,meta:nextMeta,updated_at:new Date().toISOString()
        }).eq("id",id).eq("user_id",user.id);
        if(ue)throw ue;
        await wake(admin);
        return out({ok:true,queued:true});
      }
      return out({ok:false,error:"Operação inválida."},400);
    }

    if(req.method==="PATCH"&&action==="run-queue"){
      const {data:rows,error}=await admin.from("production_jobs").select("id,meta").eq("user_id",user.id).eq("status","motion_waiting").contains("meta",{workflow_key:"motion_control"});
      if(error)throw error;
      for(const row of rows||[]){
        await admin.from("production_jobs").update({meta:{...(row.meta||{}),manual_run:true},next_attempt_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",row.id).eq("user_id",user.id);
      }
      await wake(admin);
      return out({ok:true,queued:(rows||[]).length});
    }

    if(req.method==="PATCH"&&action==="clear-completed"){
      const body=await req.json().catch(()=>({}));
      const scope=String(body.workflow_key||"motion_control");
      const {data:rows,error}=await admin.from("production_jobs").select("id,meta").eq("user_id",user.id).eq("status","ready").is("hidden_at",null);
      if(error)throw error;
      const ids=(rows||[]).filter(r=>scope==="motion_control"?isMotion(r):!isMotion(r)).map(r=>r.id);
      if(ids.length){
        const {error:ue}=await admin.from("production_jobs").update({hidden_at:new Date().toISOString(),updated_at:new Date().toISOString()}).in("id",ids).eq("user_id",user.id);
        if(ue)throw ue;
      }
      return out({ok:true,cleared:ids.length});
    }

    return out({ok:false,error:"not_found"},404);
  }catch(e){
    return out({ok:false,error:e instanceof Error?e.message:String(e),...(e instanceof MotionStorageError?{code:e.code}:{})},e instanceof MotionStorageError?503:500);
  }
});
