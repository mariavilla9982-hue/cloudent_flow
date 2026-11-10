import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const H={"Content-Type":"application/json"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});

async function graph(base:string,path:string,token:string,method="GET",params:Record<string,string>={}){
  const body=new URLSearchParams(params);
  const url=base+"/"+path.replace(/^\//,"");
  const finalUrl=method==="GET"&&Object.keys(params).length?url+(url.includes("?")?"&":"?")+body.toString():url;
  const r=await fetch(finalUrl,{method,headers:{Authorization:"Bearer "+token,...(method==="POST"?{"Content-Type":"application/x-www-form-urlencoded"}:{})},body:method==="POST"?body:undefined,signal:AbortSignal.timeout(12000)});
  let j:any={};try{j=await r.json()}catch{}
  if(!r.ok||j?.error){const e:any=new Error(j?.error?.error_user_msg||j?.error?.message||("Meta API "+r.status));e.payload=j?.error||j;throw e;}
  return j;
}
function s3RegionFromEndpoint(endpoint:string){try{const host=new URL(endpoint).hostname;const m=host.match(/^s3\.([^.]+)\.backblazeb2\.com$/i);return m?.[1]||"auto"}catch{return "auto"}}
function keyPath(key:string){return String(key||"").split("/").map(encodeURIComponent).join("/")}
async function signedMediaUrl(admin:any,key:string,expires=7200){
  const {data,error}=await admin.rpc("get_cloudent_r2_config");if(error)throw error;
  const r=Array.isArray(data)?data[0]:data;
  if(!r?.access_key_id||!r?.secret_access_key||!r?.bucket||!r?.endpoint)throw new Error("r2_not_configured");
  const aws=new AwsClient({service:"s3",region:s3RegionFromEndpoint(String(r.endpoint)),accessKeyId:String(r.access_key_id),secretAccessKey:String(r.secret_access_key)});
  const req=new Request(String(r.endpoint).replace(/\/$/,"")+"/"+encodeURIComponent(String(r.bucket))+"/"+keyPath(key)+"?X-Amz-Expires="+expires,{method:"GET"});
  return (await aws.sign(req,{aws:{signQuery:true}})).url.toString();
}
// Use the current setting so the pause also applies to already scheduled Reels.
async function firstCommentsEnabled(admin:any){
  const {data,error}=await admin.from("app_settings").select("value").eq("key","instagram_first_comments").maybeSingle();
  return !error&&data?.value?.enabled===true;
}

async function pickFirstComment(admin:any,caption:string,scheduleId:string){
  const {data,error}=await admin.rpc("pick_instagram_first_comment",{p_caption:caption,p_seed:scheduleId});
  if(error)throw error;
  const value=Array.isArray(data)?data[0]:data;
  const text=String(value||"").trim();
  return text&&text!==String(caption||"").trim()?text:null;
}

class MediaGuardError extends Error{
  code:string;
  constructor(code:string,message:string){super(message);this.code=code;}
}
function mediaFingerprint(v:any){return JSON.stringify([v.storage_provider,v.storage_path,v.size_bytes]);}
async function verifyMediaReadable(url:string){
  let r:Response;
  try{r=await fetch(url,{headers:{Range:"bytes=0-15"},signal:AbortSignal.timeout(15000)})}catch{throw new MediaGuardError("media_unavailable","Não foi possível ler o vídeo no armazenamento. Nova verificação automática em 5 minutos.");}
  const status=r.status;try{await r.body?.cancel()}catch{}
  if(status===404)throw new MediaGuardError("media_missing","Arquivo do vídeo não encontrado. Reenvie ou recupere a mídia deste agendamento.");
  if(!r.ok)throw new MediaGuardError("media_unavailable","Armazenamento indisponível (HTTP "+status+"). Nova verificação automática em 5 minutos.");
}
Deno.serve(async(req:Request)=>{
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  let leasedJob:string|null=null,schedule:any=null,video:any=null,job:any=null,account:any=null;
  let pilotChild=false,publishUncertain=false;const worker="calendar-main-"+crypto.randomUUID();
  try{
    if(req.method!=="POST")return out({ok:false,error:"method_not_allowed"},405);
    const supplied=req.headers.get("x-cloudent-worker-secret")||"";
    const {data:expected,error:secretErr}=await admin.rpc("get_cloudent_worker_secret");if(secretErr)throw secretErr;
    if(!supplied||!expected||supplied!==expected)return out({ok:false,error:"unauthorized"},401);
    const body=await req.json().catch(()=>({}));
    const scheduleId=String(body.schedule_id||"");if(!scheduleId)return out({ok:false,error:"schedule_id_required"},400);

    const {data:s,error:se}=await admin.from("schedules").select("id,video_id,status,published_at,instagram_media_id,platform_account_id,attempt_count,last_error,instagram_scale_caption").eq("id",scheduleId).maybeSingle();if(se)throw se;
    if(!s)return out({ok:false,error:"schedule_not_found"},404);
    if(s.instagram_media_id||s.status==="published")return out({ok:true,state:"already_published",instagram_media_id:s.instagram_media_id});
    if(!s.platform_account_id)throw new Error("schedule_without_platform_account");
    schedule=s;
    const {data:v,error:ve}=await admin.from("videos").select("id,storage_provider,storage_path,size_bytes,file_name,caption,media_clean_status,status").eq("id",s.video_id).single();if(ve)throw ve;
    video=v;
    const {data:blocked,error:blockError}=await admin.from("app_settings").select("value").eq("key","calendar_media_block_"+s.id).maybeSingle();if(blockError)throw blockError;
    if(blocked?.value?.source_key===mediaFingerprint(v)&&Date.parse(blocked.value.next_retry_at)>Date.now())return out({ok:false,state:"media_required",error:blocked.value.message,next_retry_at:blocked.value.next_retry_at},409);


    const {data:claims,error:claimError}=await admin.rpc("claim_calendar_publish_schedule",{p_schedule_id:scheduleId,p_worker:worker});if(claimError)throw claimError;
    const j=claims?.[0];if(!j)return out({ok:true,state:"not_due_or_claimed"});leasedJob=j.id;job=j;
    pilotChild=s.instagram_scale_caption!=null;

    const {data:pa,error:pe}=await admin.from("platform_accounts").select("id,platform,external_account_id,account_label,enabled,config,updated_at").eq("id",s.platform_account_id).single();if(pe)throw pe;
    account=pa;
    pilotChild=pilotChild||pa.config?.scale_pilot_child===true;
    publishUncertain=pilotChild&&Boolean(j.payload?.publish_started_at&&!j.payload?.instagram_media_id);

    if(!j.payload?.container_id&&String(v.storage_provider||"")!=="r2")throw new MediaGuardError("media_storage_invalid","Vídeo vinculado ao armazenamento antigo. Recupere ou reenvie o arquivo para o Backblaze.");
    if(!["ready","skipped","legacy"].includes(String(v.media_clean_status||"")))throw new Error("video_not_clean_ready");

    if(pa.platform!=="instagram"||!pa.enabled)throw new Error("instagram_account_unavailable");
    const {data:token,error:te}=await admin.rpc("get_instagram_page_token_for_account",{p_account_id:pa.id});if(te)throw te;if(!token)throw new Error("instagram_token_missing");
    const igId=String(pa.external_account_id||"");if(!igId)throw new Error("instagram_external_id_missing");
    const base=String(pa.config?.api_mode||"instagram_login")==="facebook_login"?"https://graph.facebook.com/v26.0":"https://graph.instagram.com/v26.0";


    let payload:any={...(j.payload||{})};
    let containerId=String(payload.container_id||"");
    const caption=String(s.instagram_scale_caption??v.caption??"").slice(0,2200);
    const now=new Date().toISOString();

    if(!containerId){
      const mediaUrl=await signedMediaUrl(admin,String(v.storage_path),7200);
      await verifyMediaReadable(mediaUrl);
      await admin.from("app_settings").delete().eq("key","calendar_media_block_"+scheduleId);
      const coverOffsetMs=3500;
      const firstCommentMessage=await firstCommentsEnabled(admin)?await pickFirstComment(admin,caption,scheduleId):null;
      // Normal Reels must appear only in the Reels tab, never in the main profile/feed grid.
      const created=await graph(base,igId+"/media",String(token),"POST",{media_type:"REELS",video_url:mediaUrl,caption,share_to_feed:"false",thumb_offset:String(coverOffsetMs)});
      containerId=String(created.id||"");
      if(!containerId)throw new Error("instagram_container_receipt_missing");
      payload={...payload,container_id:containerId,container_created_at:now,cover_offset_ms:coverOffsetMs,platform_account_id:String(pa.id),first_comment_message:firstCommentMessage,share_to_feed:false};
      await admin.from("job_queue").update({status:"running",attempts:Math.max(1,Number(j.attempts||0)+1),locked_at:now,locked_by:worker,last_error:null,payload,updated_at:now}).eq("id",j.id).eq("locked_by",worker).throwOnError();
      await admin.from("schedules").update({status:"processing",attempt_count:Math.max(1,Number(s.attempt_count||0)+1),last_error:null}).eq("id",scheduleId);
      return out({ok:true,state:"container_created",container_id:containerId,first_comment_message:firstCommentMessage,share_to_feed:false});
    }

    if(payload.publish_started_at&&!payload.instagram_media_id){
      if(pilotChild)throw new Error("instagram_publish_confirmation_required");
      await admin.from("schedules").update({status:"failed",last_error:"Confirmação da publicação necessária antes de repetir."}).eq("id",scheduleId);
      return out({ok:false,state:"confirmation_required",error:"Publicação enviada; confirmação necessária antes de repetir."},409);
    }
    const st=payload.instagram_media_id?{status_code:"FINISHED"}:await graph(base,containerId+"?fields=status_code,status",String(token),"GET");
    const code=String(st.status_code||"");
    if(code!=="FINISHED"){
      if(code==="ERROR"||code==="EXPIRED"){
        if(pilotChild){
          delete payload.container_id;
          delete payload.container_created_at;
          job.payload=payload;
          throw new Error("instagram_container_failed");
        }
        const msg="Container falhou: "+String(st.status||code);
        await admin.from("job_queue").update({status:"failed",last_error:msg,locked_at:null,locked_by:null,updated_at:now}).eq("id",j.id);
        await admin.from("schedules").update({status:"failed",last_error:msg}).eq("id",scheduleId);
        return out({ok:false,state:"container_failed",status_code:code,error:msg},409);
      }
      if(pilotChild&&code==="PUBLISHED"){
        job.payload={...payload,publish_started_at:now};
        throw new Error("instagram_publish_confirmation_required");
      }
      if(pilotChild&&Date.parse(payload.container_created_at)<Date.now()-15*60000){
        delete payload.container_id;
        delete payload.container_created_at;
        job.payload=payload;
        throw new Error("instagram_container_timeout");
      }
      return out({ok:true,state:"processing",status_code:code||"IN_PROGRESS"});
    }

    let mediaId=String(payload.instagram_media_id||"");
    if(!mediaId){
      if(payload.publish_started_at)return out({ok:false,state:"confirmation_required",error:"Publicação enviada; confirmação necessária antes de repetir."},409);
      if(pilotChild){
        const quota=await graph(base,igId+"/content_publishing_limit",String(token),"GET",{fields:"quota_usage,config"});
        const limits=quota?.data?.[0],used=Number(limits?.quota_usage),maximum=Number(limits?.config?.quota_total);
        if(!Number.isFinite(used)||!Number.isFinite(maximum)||maximum<1)throw new Error("instagram_quota_unavailable");
        if(used>=maximum)throw new Error("instagram_quota_reached");
      }
      payload={...payload,publish_started_at:new Date().toISOString(),idempotency_key:"calendar-main:"+scheduleId};
      const intent=admin.from("job_queue").update({payload}).eq("id",j.id).eq("locked_by",worker);
      if(pilotChild)await intent.select("id").single().throwOnError();
      else await intent.throwOnError();
      if(pilotChild){publishUncertain=true;job.payload=payload}
      const pub=await graph(base,igId+"/media_publish",String(token),"POST",{creation_id:containerId});
      mediaId=String(pub.id||"");
      if(!mediaId)throw new Error("instagram_publish_receipt_missing");
      payload={...payload,instagram_media_id:mediaId,published_at:new Date().toISOString()};
      if(pilotChild){publishUncertain=false;job.payload=payload}
      await admin.from("job_queue").update({payload,updated_at:new Date().toISOString()}).eq("id",j.id).eq("locked_by",worker).throwOnError();
    }

    const publishedAt=String(payload.published_at||new Date().toISOString());
    let firstCommentId=String(payload.first_comment_id||"")||null;
    let firstCommentError:string|null=null;
    const skipFirstComment=!await firstCommentsEnabled(admin);
    let comment=skipFirstComment?"":String(payload.first_comment_message||"").trim();
    if(!skipFirstComment&&(!comment||comment===caption.trim()))comment=String(await pickFirstComment(admin,caption,scheduleId)||"").trim();
    if(comment&&!firstCommentId){
      try{const c=await graph(base,mediaId+"/comments",String(token),"POST",{message:comment.slice(0,2200)});firstCommentId=String(c.id||"")||null;}catch(e:any){firstCommentError=e instanceof Error?e.message:String(e);}
    }
    payload={...payload,first_comment_message:comment||null,first_comment_id:firstCommentId,first_comment_error:firstCommentError,share_to_feed:false};

    if(pilotChild){
      await admin.rpc("instagram_scale_finish",{p_job:j.id,p_worker:worker,p_payload:payload}).throwOnError();
    }else{
      await admin.from("schedules").update({status:"published",published_at:publishedAt,instagram_media_id:mediaId,attempt_count:Math.max(2,Number(s.attempt_count||0)+1),last_error:null}).eq("id",scheduleId);
      await admin.from("videos").update({status:"published",platform_account_id:pa.id}).eq("id",v.id);
      await admin.from("job_queue").update({status:"done",attempts:Math.max(2,Number(j.attempts||0)+1),locked_at:null,locked_by:null,last_error:null,payload,updated_at:publishedAt}).eq("id",j.id);
    }
    try{
      const media=await graph(base,mediaId+"?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp",String(token),"GET");
      await admin.from("instagram_media").upsert({ig_media_id:mediaId,platform_account_id:pa.id,media_type:media.media_type||"VIDEO",media_product_type:media.media_product_type||"REELS",caption:media.caption||caption,permalink:media.permalink||null,thumbnail_url:media.thumbnail_url||null,posted_at:media.timestamp?new Date(media.timestamp).toISOString():publishedAt,raw:{media,api_mode:String(pa.config?.api_mode||"instagram_login"),share_to_feed:false},updated_at:publishedAt},{onConflict:"ig_media_id"});
    }catch{}
    await admin.from("activity_logs").insert({level:"info",event_type:"automatic_reel_published",message:"Reel publicado automaticamente pelo worker 24/7",meta:{job_id:j.id,worker_id:"recovery-"+scheduleId,schedule_id:scheduleId,account_label:pa.account_label,cover_strategy:"thumb_offset",cover_offset_ms:3500,share_to_feed:false,first_comment_id:firstCommentId,first_comment_message:comment||null,instagram_media_id:mediaId,first_comment_error:firstCommentError,platform_account_id:pa.id}});
    if(firstCommentId)await admin.from("activity_logs").insert({level:"info",event_type:"automatic_first_comment_published",message:"Primeiro comentário automático publicado no Reel",meta:{schedule_id:scheduleId,instagram_media_id:mediaId,platform_account_id:pa.id,instagram_comment_id:firstCommentId,message:comment}});
    return out({ok:true,state:"published",instagram_media_id:mediaId,first_comment_id:firstCommentId,first_comment_message:comment||null,first_comment_error:firstCommentError,share_to_feed:false});
  }catch(e:any){
    if(pilotChild&&schedule&&job){
      const providerCode=Number(e?.payload?.code);
      const reconnect=providerCode===190||e?.message==="instagram_token_missing";
      const quota=e?.message==="instagram_quota_reached"||[4,17,32,613,2207051].includes(providerCode);
      const uncertain=publishUncertain||e?.message==="instagram_publish_confirmation_required";
      const receipt=Boolean(job.payload?.instagram_media_id);
      const reason=uncertain?"Confirmação da Meta pendente. O envio não será repetido."
        :reconnect?"Reconecte esta conta do Instagram."
        :quota?"Limite temporário da Meta. A publicação aguardará nova vaga."
        :e instanceof MediaGuardError?e.message:"A Meta ou o armazenamento não concluíram esta etapa.";
      const attempts=Number(job.attempts||0)+(quota||reconnect||receipt?0:1);
      const runAt=new Date(Date.now()+(quota?30:Math.min(30,2**Math.min(attempts,5)))*60000).toISOString();
      if(reconnect&&account){
        await admin.from("platform_accounts").update({config:{...account.config,status:"reconnect_required"},updated_at:new Date().toISOString()})
          .eq("id",account.id).eq("updated_at",account.updated_at);
      }
      await admin.from("job_queue").update({status:receipt?"running":"failed",attempts,run_at:runAt,last_error:reason,payload:job.payload})
        .eq("id",job.id).eq("locked_by",worker).throwOnError();
      await admin.from("schedules").update({status:receipt?"processing":"failed",last_error:reason,attempt_count:attempts})
        .eq("id",schedule.id).is("instagram_media_id",null).throwOnError();
      await admin.from("activity_logs").insert({level:"error",event_type:"instagram_scale_publish_error",message:reason,
        meta:{schedule_id:schedule.id,platform_account_id:schedule.platform_account_id,provider_code:Number.isFinite(providerCode)?providerCode:null}});
      return out({ok:false,state:uncertain?"confirmation_required":"retry",error:reason},409);
    }
    if(e instanceof MediaGuardError&&schedule&&video&&leasedJob){
      const now=new Date().toISOString(),key="calendar_media_block_"+schedule.id;
      const {data:previous}=await admin.from("app_settings").select("value").eq("key",key).maybeSingle();
      const value={code:e.code,message:e.message,source_key:mediaFingerprint(video),checked_at:now,next_retry_at:new Date(Date.now()+5*60000).toISOString()};
      await admin.from("app_settings").upsert({key,value,updated_at:now},{onConflict:"key"}).throwOnError();
      await admin.from("job_queue").update({status:"failed",last_error:e.message,updated_at:now}).eq("id",leasedJob).eq("locked_by",worker).throwOnError();
      await admin.from("schedules").update({status:"failed",last_error:e.message,updated_at:now}).eq("id",schedule.id).is("instagram_media_id",null).throwOnError();
      if(previous?.value?.source_key!==value.source_key||previous?.value?.code!==value.code)await admin.from("activity_logs").insert({level:"error",event_type:"calendar_media_blocked",message:e.message,meta:{schedule_id:schedule.id,video_id:video.id,file_name:video.file_name,error_code:e.code}});
      return out({ok:false,state:"media_required",error:e.message,next_retry_at:value.next_retry_at},409);
    }
    return out({ok:false,error:e instanceof Error?e.message:String(e),detail:e?.payload||null},500);
  }
  finally{if(leasedJob)await admin.from("job_queue").update({locked_at:null,locked_by:null}).eq("id",leasedJob).eq("locked_by",worker);}
});
