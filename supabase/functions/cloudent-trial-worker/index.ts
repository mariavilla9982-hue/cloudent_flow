
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
  const headers:Record<string,string>={};
  if(contentType)headers["Content-Type"]=contentType;
  const req=new Request(config.endpoint+"/"+encodeURIComponent(config.bucket)+"/"+r2KeyPath(key)+"?X-Amz-Expires="+Math.max(1,Math.min(604800,expires)),{method,headers});
  const signed=await aws.sign(req,{aws:{signQuery:true}});
  return signed.url.toString();
}
async function cloudentMediaGetUrl(admin:any,provider:any,key:any,expires=7200){
  if(String(provider||"supabase")==="r2"){
    const config=await getCloudentR2Config(admin);
    if(!config)throw new Error("R2 configurado no arquivo, mas credenciais estão ausentes.");
    return await r2PresignedUrl(config,"GET",String(key),expires);
  }
  const {data:signed,error}=await admin.storage.from("videos").createSignedUrl(String(key),expires);
  if(error||!signed?.signedUrl)throw error||new Error("Não foi possível gerar URL temporária do vídeo.");
  return signed.signedUrl;
}


const H={"Content-Type":"application/json"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});

async function graph(base:string,path:string,token:string,method="GET",params:Record<string,string>={}){
  const body=new URLSearchParams(params);
  const url=base+"/"+path.replace(/^\//,"");
  const finalUrl=method==="GET"&&Object.keys(params).length?url+"?"+body.toString():url;
  const r=await fetch(finalUrl,{
    method,
    headers:{Authorization:"Bearer "+token,...(method==="POST"?{"Content-Type":"application/x-www-form-urlencoded"}:{})},
    body:method==="POST"?body:undefined
  });
  let j:any={};try{j=await r.json()}catch{}
  if(!r.ok||j?.error){
    const e:any=new Error(j?.error?.error_user_msg||j?.error?.message||("Meta API "+r.status));
    e.payload=j?.error||j;
    throw e;
  }
  return j;
}

function metricMap(insights:any){
  const m:any={};
  for(const row of insights?.data||[])m[row.name]=Number(row?.values?.[0]?.value??row?.value??0)||0;
  return m;
}
async function fetchInsights(base:string,id:string,token:string){
  const sets=[
    "views,reach,saved,shares,total_interactions",
    "plays,reach,saved,shares,total_interactions",
    "views,reach,saved,shares",
    "plays,reach,saved,shares",
    "reach,saved,shares",
    "reach"
  ];
  let last:any=null;
  for(const set of sets){
    try{return await graph(base,id+"/insights?metric="+set,token)}
    catch(e){last=e}
  }
  throw last;
}
function localParts(d:Date,tz:string){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",weekday:"short",hour12:false}).formatToParts(d);
  const g=(t:string)=>p.find(x=>x.type===t)?.value||"";
  const dow:any={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return {date:g("year")+"-"+g("month")+"-"+g("day"),time:g("hour")+":"+g("minute")+":00",weekday:dow[g("weekday")]??0};
}
function retryDelay(attempt:number){
  return Math.min(15,Math.max(1,Math.pow(2,Math.max(0,attempt-1))))*60_000;
}
function normalizeGraduationStrategy(value:any){
  const s=String(value||"MANUAL").trim().toUpperCase();
  return s==="SS_PERFORMANCE"?"SS_PERFORMANCE":"MANUAL";
}
function trialParamUnsupported(message:string){
  return /trial_params|graduation_strategy|unknown parameter|unexpected parameter|invalid parameter.*trial|unsupported.*trial|gradua.*(desconhe|unknown|invalid)/i.test(message);
}


type InstagramRoute={accountId:string;igId:string;token:string;base:string;label:string};
async function resolveInstagramRoute(admin:any,platformAccountId:any):Promise<InstagramRoute>{
  const accountId=String(platformAccountId||"");
  if(!accountId)throw new Error("Agendamento sem conta do Instagram definida.");
  const {data:account,error:accountErr}=await admin.from("platform_accounts").select("id,platform,external_account_id,account_label,enabled,config").eq("id",accountId).maybeSingle();
  if(accountErr)throw accountErr;
  if(!account||account.platform!=="instagram"||!account.enabled)throw new Error("Conta do Instagram do agendamento está desativada ou não existe.");
  const {data:token,error:tokenErr}=await admin.rpc("get_instagram_page_token_for_account",{p_account_id:accountId});
  if(tokenErr)throw tokenErr;
  if(!token)throw new Error("Token ausente para a conta "+String(account.account_label||account.external_account_id||accountId)+".");
  const igId=String(account.external_account_id||"");
  if(!igId)throw new Error("Conta do Instagram sem external_account_id.");
  const mode=String(account.config?.api_mode||"instagram_login");
  const base=mode==="facebook_login"?"https://graph.facebook.com/v26.0":"https://graph.instagram.com/v26.0";
  return {accountId,igId,token:String(token),base,label:String(account.account_label||igId)};
}


async function routeForTrial(admin:any,job:any){
  const {data:row,error}=await admin.from("reel_test_publications").select("linked_schedule_id,cover_offset_ms,meta,instagram_media_id,published_at").eq("id",job.id).single();
  if(error)throw error;
  job.cover_offset_ms=row.cover_offset_ms;
  let accountId=String(row.meta?.platform_account_id||"");
  const scheduleId=row.linked_schedule_id||row.meta?.linked_schedule_id;
  if(scheduleId&&!accountId){
    const {data:schedule,error:se}=await admin.from("schedules").select("platform_account_id").eq("id",scheduleId).single();
    if(se)throw se;
    accountId=String(schedule?.platform_account_id||"");
    if(!accountId)throw new Error("Pré-Trial sem conta definida no calendário.");
  }
  if(!accountId){
    // Historical Trials predate multiple accounts; retain their original account for insights.
    if(row.published_at){
      const {data:account,error:ae}=await admin.from("platform_accounts").select("id").eq("platform","instagram").lte("created_at",row.published_at).order("created_at").limit(1).maybeSingle();
      if(ae)throw ae;
      accountId=String(account?.id||"");
    }else{
      const {data:integration,error:ie}=await admin.from("integrations").select("external_account_id").eq("provider","instagram").single();
      if(ie)throw ie;
      const {data:account,error:ae}=await admin.from("platform_accounts").select("id").eq("platform","instagram").eq("external_account_id",integration.external_account_id).single();
      if(ae)throw ae;
      accountId=String(account?.id||"");
    }
  }
  const route=await resolveInstagramRoute(admin,accountId);
  const meta={...(row.meta||{}),platform_account_id:route.accountId,instagram_account_id:route.igId,instagram_account_label:route.label};
  const {error:ue}=await admin.from("reel_test_publications").update({meta}).eq("id",job.id);
  if(ue)throw ue;
  job.meta=meta;
  return {...route,alreadyPublished:Boolean(row.instagram_media_id||row.published_at)};
}

Deno.serve(async(req:Request)=>{
  const supabaseUrl=Deno.env.get("SUPABASE_URL")!;
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

  try{
    const supplied=req.headers.get("x-cloudent-worker-secret")||"";
    const {data:expected,error:secretErr}=await admin.rpc("get_cloudent_worker_secret");
    if(secretErr)throw secretErr;
    if(!supplied||!expected||supplied!==expected)return out({ok:false,error:"unauthorized"},401);

    const workerId="trial-"+crypto.randomUUID();
    await admin.from("worker_runtime").upsert({
      worker_name:"trial_reels",
      last_heartbeat:new Date().toISOString(),
      updated_at:new Date().toISOString()
    },{onConflict:"worker_name"});

    const {data:settingsRows,error:settingsError}=await admin.from("app_settings").select("key,value").in("key",["timezone"]);
    if(settingsError)throw settingsError;
    const tz=String((settingsRows||[]).find((x:any)=>x.key==="timezone")?.value||"America/Recife");
    const results:any[]=[];

    const {data:jobs,error:claimErr}=await admin.rpc("claim_due_trial_reels",{p_worker:workerId,p_limit:3});
    if(claimErr)throw claimErr;

    for(const job of jobs||[]){
      try{
        const {token,base,igId,alreadyPublished}=await routeForTrial(admin,job);
        if(alreadyPublished){
          await admin.from("reel_test_publications").update({status:"published",locked_at:null,locked_by:null,next_attempt_at:null}).eq("id",job.id);
          results.push({id:job.id,state:"already_published"});
          continue;
        }

        let containerId=String(job.container_id||"");
        const meta:any={...(job.meta||{})};
        const trialKind=String(meta.trial_kind||(meta.source==="calendar_pretrial"?"prepost":"overnight"));

        if(!containerId){
          const mediaUrl=await cloudentMediaGetUrl(admin,job.storage_provider,job.storage_path,7200);

          const coverOffsetMs=Math.max(3000,Math.min(60000,Number(job.cover_offset_ms||3500)));
          let created:any;
          try{
            created=await graph(base,igId+"/media",String(token),"POST",{
              media_type:"REELS",
              video_url:mediaUrl,
              caption:String(job.caption||"").slice(0,2200),
              share_to_feed:"false",
              thumb_offset:String(coverOffsetMs),
              trial_params:JSON.stringify({graduation_strategy:normalizeGraduationStrategy(job.graduation_strategy)})
            });
          }catch(e:any){
            const message=e instanceof Error?e.message:String(e);
            if(trialParamUnsupported(message)){
              await admin.from("reel_test_publications").update({
                status:"failed",
                last_error:"A Meta recusou o parâmetro de Trial Reel nesta conta/API. O CloudentFlow não publicou como Reel normal.",
                locked_at:null,locked_by:null,next_attempt_at:null,
                meta:{...meta,trial_api_supported:false,trial_api_error:message,trial_api_checked_at:new Date().toISOString()},
                updated_at:new Date().toISOString()
              }).eq("id",job.id);
              results.push({id:job.id,state:"failed",error:"trial_api_not_supported"});
              continue;
            }
            throw e;
          }

          containerId=String(created.id);
          await admin.from("reel_test_publications").update({
            container_id:containerId,
            status:"processing",
            next_attempt_at:new Date(Date.now()+60_000).toISOString(),
            locked_at:null,locked_by:null,last_error:null,
            meta:{...meta,trial_api_supported:true,trial_api_checked_at:new Date().toISOString(),container_created_at:new Date().toISOString(),cover_offset_ms:coverOffsetMs,cover_strategy:"thumb_offset"},
            updated_at:new Date().toISOString()
          }).eq("id",job.id);

          results.push({id:job.id,state:"container_created",container_id:containerId});
          continue;
        }

        const st=await graph(base,containerId+"?fields=status_code,status",String(token),"GET");
        const code=String(st.status_code||"");
        if(code==="ERROR"||code==="EXPIRED"){
          const finalAttempt=Number(job.attempt_count)>=Number(job.max_attempts);
          await admin.from("reel_test_publications").update({
            status:finalAttempt?"failed":"scheduled",
            container_id:null,
            next_attempt_at:finalAttempt?null:new Date(Date.now()+retryDelay(Number(job.attempt_count))).toISOString(),
            locked_at:null,locked_by:null,
            last_error:"Container Trial falhou: "+String(st.status||code),
            updated_at:new Date().toISOString()
          }).eq("id",job.id);
          results.push({id:job.id,state:finalAttempt?"failed":"retry",status_code:code});
          continue;
        }

        if(code!=="FINISHED"){
          await admin.from("reel_test_publications").update({
            status:"processing",
            next_attempt_at:new Date(Date.now()+60_000).toISOString(),
            locked_at:null,locked_by:null,last_error:null,
            updated_at:new Date().toISOString()
          }).eq("id",job.id);
          results.push({id:job.id,state:"processing",status_code:code||"IN_PROGRESS"});
          continue;
        }

        const pub=await graph(base,igId+"/media_publish",String(token),"POST",{creation_id:containerId});
        const mediaId=String(pub.id);
        const publishedAt=new Date().toISOString();
        await admin.from("reel_test_publications").update({
          status:"published",
          instagram_media_id:mediaId,
          published_at:publishedAt,
          published_as_trial:true,
          next_attempt_at:null,
          locked_at:null,locked_by:null,last_error:null,
          metrics_stage:0,
          next_metric_at:new Date(Date.parse(publishedAt)+30*60_000).toISOString(),
          meta:{...meta,trial_api_supported:true,published_as_trial:true,cover_offset_ms:Number(meta.cover_offset_ms||job.cover_offset_ms||3500),cover_strategy:"thumb_offset"},
          updated_at:publishedAt
        }).eq("id",job.id);

        await admin.from("activity_logs").insert({
          level:"info",
          event_type:"trial_reel_published",
          message:"Trial Reel publicado automaticamente",
          meta:{trial_publication_id:job.id,instagram_media_id:mediaId,scheduled_at:job.scheduled_at,worker_id:workerId,trial_kind:trialKind,linked_schedule_id:meta.linked_schedule_id||null,cover_offset_ms:Number(meta.cover_offset_ms||job.cover_offset_ms||3500),cover_strategy:"thumb_offset"}
        });
        results.push({id:job.id,state:"published",instagram_media_id:mediaId});
      }catch(e:any){
        const message=e instanceof Error?e.message:String(e);
        const finalAttempt=Number(job.attempt_count)>=Number(job.max_attempts);
        await admin.from("reel_test_publications").update({
          status:finalAttempt?"failed":"scheduled",
          next_attempt_at:finalAttempt?null:new Date(Date.now()+retryDelay(Number(job.attempt_count))).toISOString(),
          locked_at:null,locked_by:null,last_error:message,
          updated_at:new Date().toISOString()
        }).eq("id",job.id);
        await admin.from("activity_logs").insert({
          level:"error",event_type:"trial_reel_publish_error",message,
          meta:{trial_publication_id:job.id,attempt:job.attempt_count}
        });
        results.push({id:job.id,state:finalAttempt?"failed":"retry",error:message});
      }
    }

    const {data:metricJobs,error:metricClaimError}=await admin.rpc("claim_due_trial_metric_jobs",{p_worker:workerId,p_limit:5});
    if(metricClaimError)throw metricClaimError;
    const metricOffsets=[2*60,6*60,24*60,48*60];

    for(const job of metricJobs||[]){
      try{
        const {token,base}=await routeForTrial(admin,job);
        if(!job.instagram_media_id)throw new Error("Instagram indisponível para métricas Trial.");
        const metricMeta:any=job.meta||{};
        const metricSource=String(metricMeta.trial_kind||(metricMeta.source==="calendar_pretrial"?"prepost":"overnight"))==="prepost"
          ?"instagram_prepost_trial"
          :"instagram_trial";
        const mediaSource=metricSource==="instagram_prepost_trial"?"prepost_trial_reel":"trial_reel";
        const media=await graph(base,String(job.instagram_media_id)+"?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",String(token));
        let raw:any={data:[]},insightError:string|null=null;
        try{raw=await fetchInsights(base,String(job.instagram_media_id),String(token))}catch(e){insightError=e instanceof Error?e.message:String(e)}
        const mm=metricMap(raw);

        const {data:mediaRow,error:mediaError}=await admin.from("instagram_media").upsert({
          ig_media_id:String(media.id),
          media_type:media.media_type||null,
          media_product_type:media.media_product_type||null,
          caption:media.caption||null,
          permalink:media.permalink||null,
          thumbnail_url:media.thumbnail_url||null,
          media_url:media.media_url||null,
          posted_at:media.timestamp||job.published_at||null,
          like_count:Number(media.like_count||0),
          comments_count:Number(media.comments_count||0),
          raw:{media,insights:raw,insights_error:insightError,source:mediaSource}
        },{onConflict:"ig_media_id"}).select().single();
        if(mediaError)throw mediaError;

        const snapshot={
          trial_publication_id:job.id,
          schedule_id:null,
          instagram_media_record_id:mediaRow.id,
          collected_at:new Date().toISOString(),
          views:Number(mm.views||mm.plays||0),
          reach:Number(mm.reach||0),
          likes:Number(media.like_count||0),
          comments:Number(media.comments_count||0),
          shares:Number(mm.shares||0),
          saves:Number(mm.saved||0),
          raw:{metrics:mm,insights_error:insightError,source:metricSource,stage:Number(job.metrics_stage||0)}
        };
        const {error:snapshotError}=await admin.from("metrics_snapshots").insert(snapshot);
        if(snapshotError)throw snapshotError;

        const when=new Date(media.timestamp||job.published_at||Date.now());
        const lp=localParts(when,tz);
        const samplePayload={
          schedule_id:null,
          instagram_media_record_id:mediaRow.id,
          sample_date:lp.date,
          sample_time:lp.time,
          weekday:lp.weekday,
          views:snapshot.views,reach:snapshot.reach,likes:snapshot.likes,comments:snapshot.comments,shares:snapshot.shares,saves:snapshot.saves,
          source:metricSource
        };
        const {data:existing,error:existingError}=await admin.from("smart_samples").select("id").eq("instagram_media_record_id",mediaRow.id).maybeSingle();
        if(existingError)throw existingError;
        if(existing?.id){
          const {error}=await admin.from("smart_samples").update(samplePayload).eq("id",existing.id);if(error)throw error;
        }else{
          const {error}=await admin.from("smart_samples").insert(samplePayload);if(error)throw error;
        }

        const nextStage=Number(job.metrics_stage||0)+1;
        const nextOffset=metricOffsets[Number(job.metrics_stage||0)] ?? null;
        const update:any={
          metrics_stage:nextStage,
          locked_at:null,locked_by:null,last_error:null,
          updated_at:new Date().toISOString()
        };
        if(nextStage>=5||nextOffset===null){
          update.next_metric_at=null;
          update.metrics_completed_at=new Date().toISOString();
        }else{
          update.next_metric_at=new Date(Date.parse(job.published_at)+nextOffset*60_000).toISOString();
        }
        await admin.from("reel_test_publications").update(update).eq("id",job.id);
        results.push({id:job.id,state:"metrics_collected",stage:job.metrics_stage,views:snapshot.views});
      }catch(e:any){
        const message=e instanceof Error?e.message:String(e);
        await admin.from("reel_test_publications").update({
          next_metric_at:new Date(Date.now()+10*60_000).toISOString(),
          locked_at:null,locked_by:null,last_error:"Métricas Trial: "+message,
          updated_at:new Date().toISOString()
        }).eq("id",job.id);
        results.push({id:job.id,state:"metrics_retry",error:message});
      }
    }

    const failures=results.filter(x=>x.state==="failed"||x.state==="retry"||x.state==="metrics_retry").length;
    await admin.from("worker_runtime").upsert({
      worker_name:"trial_reels",
      last_heartbeat:new Date().toISOString(),
      last_success_at:new Date().toISOString(),
      last_error:failures?results.filter(x=>x.error).map(x=>x.error).join(" | ").slice(0,2000):null,
      last_jobs:results.length,
      updated_at:new Date().toISOString()
    },{onConflict:"worker_name"});

    return out({ok:true,results});
  }catch(e:any){
    const message=e instanceof Error?e.message:String(e);
    try{
      await admin.from("worker_runtime").upsert({
        worker_name:"trial_reels",
        last_heartbeat:new Date().toISOString(),
        last_error:message,
        updated_at:new Date().toISOString()
      },{onConflict:"worker_name"});
    }catch{}
    return out({ok:false,error:message},500);
  }
});
