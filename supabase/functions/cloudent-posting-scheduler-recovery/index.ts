import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const H={"Content-Type":"application/json"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});

function region(endpoint:string){try{return new URL(endpoint).hostname.match(/^s3\.([^.]+)\.backblazeb2\.com$/i)?.[1]||"auto"}catch{return "auto"}}
function keyPath(key:string){return String(key||"").split("/").map(encodeURIComponent).join("/")}
async function r2Url(admin:any,key:string,expires=7200){
  const {data,error}=await admin.rpc("get_cloudent_r2_config");if(error)throw error;const r=Array.isArray(data)?data[0]:data;
  if(!r?.access_key_id||!r?.secret_access_key||!r?.bucket||!r?.endpoint)throw new Error("r2_not_configured");
  const aws=new AwsClient({service:"s3",region:region(String(r.endpoint)),accessKeyId:String(r.access_key_id),secretAccessKey:String(r.secret_access_key)});
  const req=new Request(String(r.endpoint).replace(/\/$/,"")+"/"+encodeURIComponent(String(r.bucket))+"/"+keyPath(key)+"?X-Amz-Expires="+expires,{method:"GET"});
  return (await aws.sign(req,{aws:{signQuery:true}})).url.toString();
}
async function graph(base:string,path:string,token:string,method="GET",params:Record<string,string>={}){
  const body=new URLSearchParams(params),url=base+"/"+path.replace(/^\//,"");
  const finalUrl=method==="GET"&&Object.keys(params).length?url+(url.includes("?")?"&":"?")+body.toString():url;
  const r=await fetch(finalUrl,{method,headers:{Authorization:"Bearer "+token,...(method==="POST"?{"Content-Type":"application/x-www-form-urlencoded"}:{})},body:method==="POST"?body:undefined});
  let j:any={};try{j=await r.json()}catch{};
  if(!r.ok||j?.error){const e:any=new Error(j?.error?.error_user_msg||j?.error?.message||("Meta API "+r.status));e.payload=j?.error||j;throw e}return j;
}
function trialReason(e:any){const m=e instanceof Error?e.message:String(e||"");if(/requisito de seguidores|follower.*(requirement|threshold)|not eligible.*trial|ineleg.*reels.*teste/i.test(m))return "trial_not_eligible";if(Number(e?.payload?.code)===190||/access token.*expired|invalid.*access token/i.test(m))return "instagram_reconnect_required";return null}
async function route(admin:any,accountId:string){
  const {data:a,error}=await admin.from("platform_accounts").select("id,platform,external_account_id,account_label,enabled,config").eq("id",accountId).maybeSingle();if(error)throw error;
  if(!a||a.platform!=="instagram"||!a.enabled)throw new Error("instagram_account_unavailable");
  const {data:token,error:te}=await admin.rpc("get_instagram_page_token_for_account",{p_account_id:a.id});if(te)throw te;if(!token)throw new Error("instagram_token_missing");
  const base=String(a.config?.api_mode||"instagram_login")==="facebook_login"?"https://graph.facebook.com/v26.0":"https://graph.instagram.com/v26.0";
  return {token:String(token),base,igId:String(a.external_account_id||""),label:String(a.account_label||"")};
}

Deno.serve(async(req:Request)=>{
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    if(req.method!=="POST")return out({ok:false,error:"method_not_allowed"},405);
    const supplied=req.headers.get("x-cloudent-worker-secret")||"";const {data:expected,error:se}=await admin.rpc("get_cloudent_worker_secret");if(se)throw se;
    if(!supplied||!expected||supplied!==expected)return out({ok:false,error:"unauthorized"},401);
    const now=new Date().toISOString(),results:any[]=[];
    for(const worker of ["automation","instagram_publish","trial_reels"]){await admin.from("worker_runtime").upsert({worker_name:worker,last_heartbeat:now,updated_at:now},{onConflict:"worker_name"})}

    // If a pre-trial was missed and the normal post time has already arrived, close the stale trial.
    const {data:stale}=await admin.from("reel_test_publications").select("id,linked_schedule_id").eq("status","scheduled").is("locked_at",null).is("container_id",null).lte("scheduled_at",now).not("linked_schedule_id","is",null).limit(20);
    for(const t of stale||[]){
      const {data:s}=await admin.from("schedules").select("scheduled_at,status,instagram_media_id").eq("id",t.linked_schedule_id).maybeSingle();
      if(s&&Date.parse(s.scheduled_at)<=Date.now()&&(s.instagram_media_id||s.status==="published"||Date.parse(s.scheduled_at)<=Date.now())){
        if(!s.instagram_media_id&&s.status!=="published")continue;
        await admin.from("reel_test_publications").update({status:"failed",last_error:"Reel normal já publicado; Pré-Trial pendente encerrado.",next_attempt_at:null,locked_at:null,locked_by:null,updated_at:now}).eq("id",t.id);
      }
    }

    // Trials that are due while the linked normal Reel is still in the future.
    const worker="calendar-trial-"+crypto.randomUUID();
    const {data:trials,error:trErr}=await admin.rpc("claim_due_trial_reels",{p_worker:worker,p_limit:3});if(trErr)throw trErr;
    for(const job of trials||[]){
      let publishing=false;
      try{
        const scheduleId=String(job.linked_schedule_id||job.meta?.linked_schedule_id||"");let accountId=String(job.meta?.platform_account_id||"");let normal:any=null;
        if(scheduleId){const {data:s}=await admin.from("schedules").select("scheduled_at,status,instagram_media_id,platform_account_id").eq("id",scheduleId).maybeSingle();normal=s;if(!s||!accountId||accountId!==String(s.platform_account_id||""))throw new Error("trial_account_mismatch");}
        if(normal&&Date.parse(normal.scheduled_at)<=Date.now()){
          await admin.from("reel_test_publications").update({status:"failed",last_error:"Horário do Reel normal já chegou; Pré-Trial atrasado encerrado.",next_attempt_at:null,locked_at:null,locked_by:null,updated_at:now}).eq("id",job.id);results.push({type:"trial",id:job.id,state:"closed_late"});continue;
        }
        if(!accountId)throw new Error("trial_without_platform_account");const r=await route(admin,accountId);
        let container=String(job.container_id||"");
        if(!container){
          const mediaUrl=String(job.storage_provider||"supabase")==="r2"?await r2Url(admin,String(job.storage_path),7200):(await admin.storage.from("videos").createSignedUrl(String(job.storage_path),7200)).data?.signedUrl;
          if(!mediaUrl)throw new Error("trial_media_url_missing");const cover=Math.max(3000,Math.min(60000,Number(job.cover_offset_ms||3500)));
          const created=await graph(r.base,r.igId+"/media",r.token,"POST",{media_type:"REELS",video_url:mediaUrl,caption:String(job.caption||"").slice(0,2200),share_to_feed:"false",thumb_offset:String(cover),trial_params:JSON.stringify({graduation_strategy:String(job.graduation_strategy||"manual").toUpperCase()==="SS_PERFORMANCE"?"SS_PERFORMANCE":"MANUAL"})});
          container=String(created.id);await admin.from("reel_test_publications").update({container_id:container,status:"processing",next_attempt_at:new Date(Date.now()+60000).toISOString(),last_error:null,locked_at:null,locked_by:null,updated_at:now}).eq("id",job.id);results.push({type:"trial",id:job.id,state:"container_created"});continue;
        }
        const st=await graph(r.base,container+"?fields=status_code,status",r.token);const code=String(st.status_code||"");
        if(code!=="FINISHED"){
          if(code==="ERROR"||code==="EXPIRED"){await admin.from("reel_test_publications").update({status:"scheduled",container_id:null,next_attempt_at:new Date(Date.now()+120000).toISOString(),last_error:"Container Trial falhou: "+String(st.status||code),updated_at:now}).eq("id",job.id);results.push({type:"trial",id:job.id,state:"retry"});}
          else{await admin.from("reel_test_publications").update({status:"processing",next_attempt_at:new Date(Date.now()+60000).toISOString(),last_error:null,updated_at:now}).eq("id",job.id);results.push({type:"trial",id:job.id,state:"processing"});}continue;
        }
        const {error:publishLockError}=await admin.from("reel_test_publications").update({status:"publishing",meta:{...(job.meta||{}),publish_started_at:new Date().toISOString(),idempotency_key:"calendar-trial:"+job.id}}).eq("id",job.id).eq("locked_by",worker).throwOnError();
        if(publishLockError)throw publishLockError;
        publishing=true;
        const pub=await graph(r.base,r.igId+"/media_publish",r.token,"POST",{creation_id:container});const mediaId=String(pub.id),publishedAt=new Date().toISOString();
        await admin.from("reel_test_publications").update({status:"published",instagram_media_id:mediaId,published_at:publishedAt,published_as_trial:true,next_attempt_at:null,last_error:null,locked_at:null,locked_by:null,metrics_stage:0,next_metric_at:new Date(Date.now()+30*60000).toISOString(),updated_at:publishedAt}).eq("id",job.id);
        await admin.from("activity_logs").insert({level:"info",event_type:"trial_reel_published",message:"Trial Reel publicado automaticamente",meta:{trial_publication_id:job.id,instagram_media_id:mediaId,linked_schedule_id:scheduleId||null,worker_id:"posting-scheduler-recovery"}});results.push({type:"trial",id:job.id,state:"published",instagram_media_id:mediaId});
      }catch(e:any){const reason=trialReason(e),message=e instanceof Error?e.message:String(e);await admin.from("reel_test_publications").update({status:publishing?"publishing":reason?"failed":"scheduled",next_attempt_at:(publishing||reason)?null:new Date(Date.now()+120000).toISOString(),last_error:publishing?"Confirmação da publicação necessária: "+message:message,updated_at:now}).eq("id",job.id);await admin.from("activity_logs").insert({level:"error",event_type:"trial_reel_publish_error",message,meta:{trial_publication_id:job.id,failure_reason:reason}});results.push({type:"trial",id:job.id,state:reason?"failed":"retry",error:message});}
      finally{await admin.from("reel_test_publications").update({locked_at:null,locked_by:null}).eq("id",job.id).eq("locked_by",worker);}
    }

    // Normal Reels. The dedicated recovery publisher is idempotent and resumes container processing on later ticks.
    const {data:due,error:dueErr}=await admin.from("schedules").select("id").eq("platform","instagram").in("status",["scheduled","processing","failed"]).lte("scheduled_at",now).is("instagram_media_id",null).order("scheduled_at").limit(5);if(dueErr)throw dueErr;
    for(const s of due||[]){
      try{const rr=await fetch(Deno.env.get("SUPABASE_URL")+"/functions/v1/cloudent-instagram-publish-recovery",{method:"POST",headers:{"Content-Type":"application/json","x-cloudent-worker-secret":String(expected)},body:JSON.stringify({schedule_id:s.id}),signal:AbortSignal.timeout(20000)});let j:any={};try{j=await rr.json()}catch{};results.push({type:"normal",id:s.id,http:rr.status,...j});}catch(e:any){results.push({type:"normal",id:s.id,state:"retry",error:e instanceof Error?e.message:String(e)})}
    }
    const failed=results.filter(x=>x.state==="failed"||x.state==="retry"||x.ok===false);for(const worker of ["automation","instagram_publish","trial_reels"]){await admin.from("worker_runtime").upsert({worker_name:worker,last_heartbeat:new Date().toISOString(),last_success_at:new Date().toISOString(),last_error:failed.length?failed.map(x=>x.error||x.state).join(" | ").slice(0,2000):null,last_jobs:results.length,updated_at:new Date().toISOString()},{onConflict:"worker_name"})}
    return out({ok:true,results});
  }catch(e:any){return out({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
