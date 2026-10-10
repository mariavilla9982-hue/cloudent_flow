
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

type CloudentR2Config={account_id:string;access_key_id:string;secret_access_key:string;bucket:string;endpoint:string};
async function getCloudentR2Config(admin:any):Promise<CloudentR2Config|null>{
  const {data,error}=await admin.rpc("get_cloudent_r2_config");
  if(error)return null;
  const row=Array.isArray(data)?data[0]:data;
  if(!row?.access_key_id||!row?.secret_access_key||!row?.bucket)return null;
  return {account_id:String(row.account_id||""),access_key_id:String(row.access_key_id),secret_access_key:String(row.secret_access_key),bucket:String(row.bucket),endpoint:String(row.endpoint||("https://"+row.account_id+".r2.cloudflarestorage.com")).replace(/\/$/,"")};
}
function s3RegionFromEndpoint(endpoint:string){
  try{
    const host=new URL(endpoint).hostname;
    const m=host.match(/^s3\.([^.]+)\.backblazeb2\.com$/i);
    return m?.[1]||"auto";
  }catch{return "auto"}
}
function r2KeyPath(key:string){return String(key||"").split("/").map(encodeURIComponent).join("/")}
async function r2PresignedUrl(config:CloudentR2Config,method:string,key:string,expires=900){
  const aws=new AwsClient({service:"s3",region:s3RegionFromEndpoint(config.endpoint),accessKeyId:config.access_key_id,secretAccessKey:config.secret_access_key});
  const req=new Request(config.endpoint+"/"+encodeURIComponent(config.bucket)+"/"+r2KeyPath(key)+"?X-Amz-Expires="+Math.max(1,Math.min(604800,expires)),{method});
  const signed=await aws.sign(req,{aws:{signQuery:true}});return signed.url.toString();
}
async function deleteVideoStorage(admin:any,provider:any,paths:string[]){
  const unique=[...new Set((paths||[]).filter(Boolean).map(String))];
  if(!unique.length)return;
  if(String(provider||"supabase")==="r2"){
    const cfg=await getCloudentR2Config(admin);if(!cfg)throw new Error("r2_not_configured");
    for(const path of unique){
      const url=await r2PresignedUrl(cfg,"DELETE",path,900);
      const res=await fetch(url,{method:"DELETE"});
      if(!res.ok&&res.status!==404)throw new Error("r2_delete_"+res.status);
    }
  }else{
    const {error}=await admin.storage.from("videos").remove(unique);if(error)throw error;
  }
}


import {metricContext,metricGraph,storeMetric,metricCutoff} from "./metrics-core.ts";
const H={"Content-Type":"application/json"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});

async function graph(base:string,path:string,token:string){
  const r=await fetch(base+"/"+path.replace(/^\//,""),{headers:{Authorization:"Bearer "+token}});
  let j:any={};try{j=await r.json()}catch{}
  if(!r.ok||j?.error)throw new Error(j?.error?.message||("Meta API "+r.status));
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
function parts(d:Date,tz:string){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",weekday:"short",hour12:false}).formatToParts(d);
  const g=(t:string)=>p.find(x=>x.type===t)?.value||"";
  const dow:any={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return {date:g("year")+"-"+g("month")+"-"+g("day"),time:g("hour")+":"+g("minute"),weekday:dow[g("weekday")]??0};
}
function zonedToUtc(date:string,time:string,tz:string){
  const [y,mo,d]=date.split("-").map(Number),[h,mi]=time.split(":").map(Number);
  const guess=Date.UTC(y,mo-1,d,h,mi,0,0);
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(new Date(guess));
  const g=(t:string)=>Number(p.find(x=>x.type===t)?.value||0);
  const asTz=Date.UTC(g("year"),g("month")-1,g("day"),g("hour"),g("minute"),g("second"));
  return new Date(guess-(asTz-guess));
}
function median(a:number[]){
  if(!a.length)return 0;
  const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);
  return s.length%2?s[m]:(s[m-1]+s[m])/2;
}
function percentile(values:number[],p:number){
  if(!values.length)return 0;
  const a=[...values].sort((x,y)=>x-y);
  const i=Math.min(a.length-1,Math.max(0,Math.round((a.length-1)*p)));
  return a[i];
}
function sampleMinute(s:any){
  const t=String(s.sample_time||"00:00");
  return Number(t.slice(0,2))*60+Number(t.slice(3,5));
}
function viralBaseline(samples:any[]){
  const views=samples.map((s:any)=>Number(s.views)||0).filter((x:number)=>x>0);
  const reach=samples.map((s:any)=>Number(s.reach)||0).filter((x:number)=>x>0);
  return {
    medianViews:Math.max(1,median(views)),
    p75Views:Math.max(1,percentile(views,.75)),
    p90Views:Math.max(1,percentile(views,.90)),
    medianReach:Math.max(1,median(reach))
  };
}
function viralStrength(s:any,b:any){
  const views=Math.max(1,Number(s.views)||1),reach=Math.max(1,Number(s.reach)||1);
  const vRatio=views/Math.max(1,b.medianViews);
  const rRatio=reach/Math.max(1,b.medianReach);
  const breakout=Math.max(0,Math.log2(vRatio));
  const elite=views>=b.p90Views?2.4:views>=b.p75Views?1.45:1;
  return Math.min(8,elite*(1+breakout*.72+Math.max(0,Math.log2(rRatio))*.18));
}
function scoreSample(s:any,b:any){
  const reach=Math.max(1,Number(s.reach)||1),views=Math.max(0,Number(s.views)||0);
  const vr=Math.min(2.5,views/reach);
  const likeRate=(Number(s.likes)||0)/reach*100;
  const commentRate=(Number(s.comments)||0)/reach*100;
  const shareRate=(Number(s.shares)||0)/reach*100;
  const saveRate=(Number(s.saves)||0)/reach*100;
  const breakout=Math.max(0,Math.log2((views+1)/(Math.max(1,b.medianViews)+1)));
  return Math.log10(views+10)*15+
    Math.log10(reach+10)*8+
    vr*14+
    likeRate*1.6+
    commentRate*4.5+
    shareRate*12+
    saveRate*9+
    Math.min(5,breakout)*18;
}
function smartWeightedAvg(samples:any[],baseline:any,targetMinute:number|null=null){
  if(!samples.length)return 0;
  let sum=0,w=0;
  for(const s of samples){
    const age=Math.max(0,(Date.now()-new Date(String(s.sample_date)+"T12:00:00Z").getTime())/86400000);
    const recency=Math.pow(.5,age/45);
    const viral=viralStrength(s,baseline);
    const distance=targetMinute===null?0:Math.abs(sampleMinute(s)-targetMinute);
    const proximity=targetMinute===null?1:Math.max(.12,1-distance/90);
    const ww=recency*viral*proximity;
    sum+=scoreSample(s,baseline)*ww;
    w+=ww;
  }
  return w?sum/w:0;
}

Deno.serve(async(req:Request)=>{
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const supplied=req.headers.get("x-cloudent-worker-secret")||"";
    const {data:expected,error:se}=await admin.rpc("get_cloudent_worker_secret");
    if(se)throw se;
    if(!supplied||supplied!==expected)return out({ok:false,error:"unauthorized"},401);

    const requestUrl=new URL(req.url);
    if(requestUrl.searchParams.get("metrics_only")==="1"){
      const accountId=requestUrl.searchParams.get("account_id");
      if(!accountId)return out({error:"account_id_required"},400);
      const context=await metricContext(admin,accountId);
      const after=requestUrl.searchParams.get("after");
      const fields="id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count";
      const list=await metricGraph(context.base,context.account.external_account_id+"/media?fields="+fields+"&limit=12"+(after?"&after="+encodeURIComponent(after):""),context.token);
      const cutoff=metricCutoff(120),errors:any[]=[];let synced=0;
      const recent=(list.data||[]).filter((m:any)=>m.media_product_type==="REELS"&&new Date(m.timestamp).getTime()>=new Date(cutoff).getTime());
      for(let i=0;i<recent.length;i+=3)await Promise.all(recent.slice(i,i+3).map(async(m:any)=>{try{await storeMetric(admin,context,m);synced++}catch(e){errors.push({id:m.id,error:e instanceof Error?e.message:String(e)})}}));
      const next_cursor=list.paging?.next&&(list.data||[]).every((m:any)=>new Date(m.timestamp).getTime()>=new Date(cutoff).getTime())?list.paging.cursors?.after||null:null;
      return out({ok:true,synced,errors,next_cursor});
    }
    const workerId="automation-"+crypto.randomUUID();
    await admin.from("worker_runtime").upsert({
      worker_name:"automation",
      last_heartbeat:new Date().toISOString(),
      updated_at:new Date().toISOString()
    },{onConflict:"worker_name"});

    const {data:settingRows}=await admin.from("app_settings").select("key,value");
    const settings:any=Object.fromEntries((settingRows||[]).map((x:any)=>[x.key,x.value]));
    const automation=settings.automation||{};
    const smart=settings.smart_scheduler||{};
    const tz=String(settings.timezone||"America/Recife");
    const minGap=Number(settings.min_gap_minutes||60);
    const postsPerDay=Number(settings.posts_per_day||5);
    const distribution=settings.schedule_distribution||{};
    const windows=distribution.windows||{morning:[360,719],afternoon:[720,1140],night:[1141,1439]};
    const periodQuotas=[
      {name:"morning",quota:Number(distribution.morning ?? 2),start:Number(windows.morning?.[0]??360),end:Number(windows.morning?.[1]??719)},
      {name:"afternoon",quota:Number(distribution.afternoon ?? 3),start:Number(windows.afternoon?.[0]??720),end:Number(windows.afternoon?.[1]??1140)},
      {name:"night",quota:Number(distribution.night ?? 0),start:Number(windows.night?.[0]??1141),end:Number(windows.night?.[1]??1439)}
    ];
    const exploration=Math.max(0,Math.min(40,Number(smart.exploration||14)));
    const offsets=(automation.metricsOffsetsMinutes||[30,120,360,1440,2880]).map((x:any)=>Number(x));
    const lookback=Number(smart.lookbackDays||60);
    const minSamples=Number(smart.minSamples||3);
    const minConfidence=Number(smart.minConfidence||55);
    const reevaluateHours=Number(smart.reevaluateHours||168);

    // Existing validation state decides whether a weekday still needs exploration.
    // Only the active daily ranks count; historical ranks stay preserved but dormant.
    const {data:validationBefore,error:validationBeforeError}=await admin.from("smart_time_validation")
      .select("weekday,rank,state")
      .lte("rank",postsPerDay);
    if(validationBeforeError)throw validationBeforeError;
    const validationBeforeRows=validationBefore||[];

    const {data:token,error:te}=await admin.rpc("get_instagram_page_token");if(te)throw te;
    const {data:integration,error:ie}=await admin.from("integrations").select("enabled,external_account_id,config").eq("provider","instagram").maybeSingle();if(ie)throw ie;
    const mode=integration?.config?.api_mode||"instagram_login";
    const base=mode==="facebook_login"?"https://graph.facebook.com/v26.0":"https://graph.instagram.com/v26.0";

    const {data:jobs,error:ce}=await admin.rpc("claim_due_metric_jobs",{p_worker:workerId,p_limit:5});if(ce)throw ce;
    const metricResults:any[]=[];

    for(const job of jobs||[]){
      try{
        if(!job.instagram_media_id)throw new Error("instagram_media_id_missing");
        const {data:schedule,error:accountError}=await admin.from("schedules").select("platform_account_id").eq("id",job.schedule_id).single();
        if(accountError)throw accountError;
        if(!schedule?.platform_account_id)throw new Error("instagram_account_not_assigned");
        const context=await metricContext(admin,schedule.platform_account_id);
        const media=await metricGraph(context.base,String(job.instagram_media_id)+"?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",context.token);
        await storeMetric(admin,context,media,job.schedule_id);
        const now=new Date().toISOString();
        await admin.from("instagram_metrics_sync_state").upsert({account_id:context.account.id,metrics_error:null,last_metrics_attempt_at:now,updated_at:now},{onConflict:"account_id"});

        await admin.from("job_queue").update({
          status:"done",locked_at:null,locked_by:null,last_error:null,updated_at:new Date().toISOString()
        }).eq("id",job.job_id);

        const stage=Number(job.payload?.metrics_stage||0);
        const nextStage=stage+1;
        if(nextStage<offsets.length){
          const baseTime=new Date(job.published_at||job.scheduled_at).getTime();
          const target=baseTime+offsets[nextStage]*60_000;
          await admin.from("job_queue").insert({
            job_type:"collect_metrics",
            schedule_id:job.schedule_id,
            run_at:new Date(Math.max(target,Date.now()+60_000)).toISOString(),
            status:"pending",
            max_attempts:10,
            payload:{metrics_stage:nextStage}
          });
        }

        metricResults.push({schedule_id:job.schedule_id,state:"collected",stage});
      }catch(e:any){
        const message=e instanceof Error?e.message:(typeof e==="object"?JSON.stringify(e):String(e));
        const final=Number(job.attempts)>=Number(job.max_attempts);
        await admin.from("job_queue").update({
          status:final?"failed":"pending",
          run_at:final?job.run_at:new Date(Date.now()+10*60_000).toISOString(),
          locked_at:null,locked_by:null,last_error:message,updated_at:new Date().toISOString()
        }).eq("id",job.job_id);
        metricResults.push({schedule_id:job.schedule_id,state:final?"failed":"retry",error:message});
      }
    }


    // published_media_retention_cleanup
    // Delete only physical media that has already been successfully published for the
    // configured retention period. Database rows, Instagram metadata, metric snapshots
    // and smart-learning samples are intentionally preserved.
    const retention=settings.storage_retention||{};
    const retentionEnabled=retention.enabled!==false;
    const retentionDays=Math.max(1,Number(retention.published_days||7));
    const retentionCalendarDays=retention.calendar_days===true;
    let retentionCutoff=new Date(Date.now()-retentionDays*86400000).toISOString();
    if(retentionCalendarDays){
      const todayLocal=parts(new Date(),tz).date;
      const [ry,rm,rd]=todayLocal.split("-").map(Number);
      const targetDate=new Date(Date.UTC(ry,rm-1,rd-(retentionDays-1),12,0,0)).toISOString().slice(0,10);
      retentionCutoff=zonedToUtc(targetDate,"00:00",tz).toISOString();
    }
    const cleanupResults:any[]=[];

    async function captureRetentionSnapshot(
      mediaId:string,
      schedule:any|null,
      publishedAt:string|null,
      source:string
    ){
      if(!token||!integration?.enabled||!mediaId)return {captured:false,reason:"instagram_unavailable"};
      try{
        const media=await graph(base,String(mediaId)+"?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",token);
        let raw:any={data:[]},insightError:string|null=null;
        try{raw=await fetchInsights(base,String(mediaId),token)}
        catch(e){insightError=e instanceof Error?e.message:String(e)}
        const mm=metricMap(raw);

        const {data:mediaRow,error:me}=await admin.from("instagram_media").upsert({
          ig_media_id:String(media.id),
          media_type:media.media_type||null,
          media_product_type:media.media_product_type||null,
          caption:media.caption||null,
          permalink:media.permalink||null,
          thumbnail_url:media.thumbnail_url||null,
          media_url:media.media_url||null,
          posted_at:media.timestamp||publishedAt||null,
          like_count:Number(media.like_count||0),
          comments_count:Number(media.comments_count||0),
          raw:{media,insights:raw,insights_error:insightError,source}
        },{onConflict:"ig_media_id"}).select().single();
        if(me)throw me;

        const snap={
          schedule_id:schedule?.id||null,
          instagram_media_record_id:mediaRow.id,
          collected_at:new Date().toISOString(),
          views:Number(mm.views||mm.plays||0),
          reach:Number(mm.reach||0),
          likes:Number(media.like_count||0),
          comments:Number(media.comments_count||0),
          shares:Number(mm.shares||0),
          saves:Number(mm.saved||0),
          raw:{metrics:mm,insights_error:insightError,source}
        };
        const {error:sne}=await admin.from("metrics_snapshots").insert(snap);
        if(sne)throw sne;

        const when=new Date(media.timestamp||publishedAt||schedule?.published_at||schedule?.scheduled_at||Date.now());
        const lp=parts(when,tz);
        const samplePayload={
          schedule_id:schedule?.id||null,
          instagram_media_record_id:mediaRow.id,
          sample_date:lp.date,
          sample_time:lp.time+":00",
          weekday:lp.weekday,
          views:snap.views,reach:snap.reach,likes:snap.likes,comments:snap.comments,shares:snap.shares,saves:snap.saves,
          source:source==="retention_cleanup_final"
            ?"instagram"
            :source==="retention_cleanup_prepost_trial_final"
              ?"instagram_prepost_trial"
              :"instagram_trial"
        };

        let existing:any=null;
        if(schedule?.id){
          const {data,error}=await admin.from("smart_samples").select("id").eq("schedule_id",schedule.id).maybeSingle();
          if(error)throw error;
          existing=data;
        }
        if(!existing?.id){
          const {data,error}=await admin.from("smart_samples").select("id").eq("instagram_media_record_id",mediaRow.id).maybeSingle();
          if(error)throw error;
          existing=data;
        }
        if(existing?.id){
          const {error}=await admin.from("smart_samples").update(samplePayload).eq("id",existing.id);
          if(error)throw error;
        }else{
          const {error}=await admin.from("smart_samples").insert(samplePayload);
          if(error)throw error;
        }
        return {captured:true,views:snap.views,reach:snap.reach};
      }catch(e:any){
        return {captured:false,error:e instanceof Error?e.message:String(e)};
      }
    }

    if(retentionEnabled){
      // Normal scheduled posts.
      const {data:oldPublished,error:oldPublishedError}=await admin.from("schedules")
        .select("id,video_id,published_at,scheduled_at,instagram_media_id,status")
        .eq("status","published")
        .not("video_id","is",null)
        .not("published_at","is",null)
        .not("instagram_media_id","is",null)
        .lte("published_at",retentionCutoff)
        .order("published_at",{ascending:true})
        .limit(50);
      if(oldPublishedError)throw oldPublishedError;

      const uniqueVideoIds=[...new Set((oldPublished||[]).map((x:any)=>String(x.video_id)).filter(Boolean))];
      for(const videoId of uniqueVideoIds){
        try{
          const {data:video,error:videoError}=await admin.from("videos")
            .select("id,storage_path,original_storage_path,storage_provider,file_name,size_bytes,status,storage_deleted_at,media_clean_report,created_at")
            .eq("id",videoId).maybeSingle();
          if(videoError)throw videoError;
          if(!video)continue;
          const storageWasAlreadyDeleted=!!video.storage_deleted_at;

          const {data:videoSchedules,error:videoSchedulesError}=await admin.from("schedules")
            .select("id,status,published_at,scheduled_at,instagram_media_id")
            .eq("video_id",videoId)
            .order("published_at",{ascending:false,nullsFirst:false});
          if(videoSchedulesError)throw videoSchedulesError;

          const live=(videoSchedules||[]).filter((s:any)=>s.status!=="cancelled");
          const published=live.filter((s:any)=>s.status==="published"&&s.published_at&&s.instagram_media_id);
          if(!published.length)continue;
          if(live.some((s:any)=>s.status!=="published"))continue;

          const newestPublished=Math.max(...published.map((s:any)=>new Date(s.published_at).getTime()));
          if(!Number.isFinite(newestPublished)||newestPublished>new Date(retentionCutoff).getTime())continue;

          // Take the final retention snapshot only on the first physical cleanup.
          // Previously this ran every automation cycle after storage_deleted_at was set,
          // producing thousands of duplicate snapshots/logs.
          const finalSnapshots:any[]=[];
          if(!storageWasAlreadyDeleted){
            for(const s of published){
              finalSnapshots.push(await captureRetentionSnapshot(
                String(s.instagram_media_id),
                s,
                s.published_at,
                "retention_cleanup_final"
              ));
            }
          }

          let videoDeleted=storageWasAlreadyDeleted;
          let storageCleanupChanged=false;
          let mediaBytes=Number(video.size_bytes||0);
          if(!videoDeleted){
            const mediaPaths=[video.storage_path,video.original_storage_path]
              .filter(Boolean).map(String).filter((x:string,i:number,a:string[])=>a.indexOf(x)===i);
            if(mediaPaths.length)await deleteVideoStorage(admin,video.storage_provider,mediaPaths);
            const report:any=video.media_clean_report||{};
            const inputBytes=Number(report.input_bytes||0);
            const outputBytes=Number(report.output_bytes||video.size_bytes||0);
            mediaBytes=video.original_storage_path&&video.original_storage_path!==video.storage_path
              ? Math.max(0,inputBytes)+Math.max(0,outputBytes)
              : Math.max(0,outputBytes||Number(video.size_bytes||0));
            const deletedAt=new Date().toISOString();
            const {error:updateVideoError}=await admin.from("videos")
              .update({storage_deleted_at:deletedAt,updated_at:deletedAt})
              .eq("id",videoId);
            if(updateVideoError)throw updateVideoError;
            videoDeleted=true;
            storageCleanupChanged=true;
          }

          let productionBytes=0;
          let productionFiles=0;

          // A produced video can be re-uploaded into the calendar, which creates a
          // new videos row. Track that provenance too so yesterday's published
          // media does not leave its source/frame/result copies behind.
          const sourceBytes=Number((video.media_clean_report||{}).input_bytes||video.size_bytes||0);
          const fileStem=String(video.file_name||"").replace(/\.[^.]+$/,"");
          const videoCreatedAt=new Date(video.created_at||0).getTime();

          const {data:productionCandidates,error:productionRowsError}=await admin.from("production_jobs")
            .select("id,storage_provider,result_video_id,original_storage_path,frame_storage_path,original_size_bytes,frame_size_bytes,inputs_deleted_at,completed_at,videos!production_jobs_result_video_id_fkey(id,storage_path,original_storage_path,storage_provider,size_bytes,storage_deleted_at)")
            .not("result_video_id","is",null)
            .in("status",["ready","completed"]);
          if(productionRowsError)throw productionRowsError;

          const productionRows=(productionCandidates||[]).filter((p:any)=>{
            const result:any=Array.isArray(p.videos)?p.videos[0]:p.videos;
            if(String(p.result_video_id||"")===String(videoId))return true;
            if(String(p.id||"")===fileStem)return true;
            const resultBytes=Number(result?.size_bytes||0);
            const completedAt=new Date(p.completed_at||0).getTime();
            const nearInTime=Number.isFinite(videoCreatedAt)&&Number.isFinite(completedAt)&&
              completedAt<=videoCreatedAt+10*60_000&&videoCreatedAt-completedAt<=3*86400000;
            return sourceBytes>0&&resultBytes===sourceBytes&&nearInTime;
          });

          for(const p of productionRows){
            if(!p.inputs_deleted_at){
              const paths=[p.original_storage_path,p.frame_storage_path].filter(Boolean).map(String);
              if(paths.length){
                if(String(p.storage_provider||"supabase")==="r2"){
                  await deleteVideoStorage(admin,"r2",paths);
                }else{
                  const {error:inputRemoveError}=await admin.storage.from("production").remove(paths);
                  if(inputRemoveError)throw inputRemoveError;
                }
              }
              const inputDeletedAt=new Date().toISOString();
              const {error:jobUpdateError}=await admin.from("production_jobs")
                .update({inputs_deleted_at:inputDeletedAt,updated_at:inputDeletedAt})
                .eq("id",p.id);
              if(jobUpdateError)throw jobUpdateError;
              productionBytes+=Number(p.original_size_bytes||0)+Number(p.frame_size_bytes||0);
              productionFiles+=paths.length;
            }

            // If the calendar used a duplicate row, the original production result
            // is another physical copy. Remove it only when no unfinished schedule
            // still points directly at that result.
            if(String(p.result_video_id||"")!==String(videoId)){
              const result:any=Array.isArray(p.videos)?p.videos[0]:p.videos;
              if(result?.id&&!result.storage_deleted_at){
                const {data:activeRefs,error:activeRefError}=await admin.from("schedules")
                  .select("id,status")
                  .eq("video_id",result.id)
                  .in("status",["scheduled","queued","processing","failed"]);
                if(activeRefError)throw activeRefError;
                if(!(activeRefs||[]).length){
                  const resultPaths=[result.storage_path,result.original_storage_path]
                    .filter(Boolean).map(String).filter((x:string,i:number,a:string[])=>a.indexOf(x)===i);
                  if(resultPaths.length)await deleteVideoStorage(admin,result.storage_provider,resultPaths);
                  const resultDeletedAt=new Date().toISOString();
                  const {error:resultUpdateError}=await admin.from("videos")
                    .update({storage_deleted_at:resultDeletedAt,updated_at:resultDeletedAt})
                    .eq("id",result.id);
                  if(resultUpdateError)throw resultUpdateError;
                  productionBytes+=Number(result.size_bytes||0);
                  productionFiles+=resultPaths.length;
                }
              }
            }
          }

          if(storageCleanupChanged||productionFiles>0){
            const freedBytes=(storageCleanupChanged?mediaBytes:0)+productionBytes;
            await admin.from("activity_logs").insert({
              level:"info",
              event_type:"published_media_storage_cleaned",
              message:"Arquivos físicos de post publicado foram removidos após a retenção; dados de aprendizado foram preservados",
              meta:{
                video_id:videoId,
                retention_days:retentionDays,
                video_file:video.file_name||null,
                bytes_freed:freedBytes,
                production_files_removed:productionFiles,
                learning_data_preserved:true,
                final_snapshots:finalSnapshots
              }
            });
            cleanupResults.push({type:"published_video",video_id:videoId,bytes_freed:freedBytes});
          }
        }catch(e:any){
          cleanupResults.push({type:"published_video",video_id:videoId,error:e instanceof Error?e.message:String(e)});
        }
      }

      // Trial/test Reels live outside the normal schedules/videos relation.
      const {data:trialRows,error:trialRowsError}=await admin.from("reel_test_publications")
        .select("id,storage_path,original_storage_path,storage_provider,file_name,published_at,instagram_media_id,storage_deleted_at,media_clean_report,trial_kind,shared_storage,source_video_id")
        .eq("status","published")
        .is("storage_deleted_at",null)
        .not("published_at","is",null)
        .not("instagram_media_id","is",null)
        .lte("published_at",retentionCutoff)
        .order("published_at",{ascending:true})
        .limit(50);
      if(trialRowsError)throw trialRowsError;

      for(const trial of trialRows||[]){
        try{
          const finalSnapshot=await captureRetentionSnapshot(
            String(trial.instagram_media_id),
            null,
            trial.published_at,
            trial.trial_kind==="prepost"
              ?"retention_cleanup_prepost_trial_final"
              :"retention_cleanup_trial_final"
          );
          const trialPaths=[trial.storage_path,trial.original_storage_path]
            .filter(Boolean).map(String).filter((x:string,i:number,a:string[])=>a.indexOf(x)===i);
          // Daytime pre-post Trials share the normal Reel object. Their retention
          // must never delete that shared file; normal video retention owns it.
          if(!trial.shared_storage&&trialPaths.length){
            await deleteVideoStorage(admin,trial.storage_provider,trialPaths);
          }
          const deletedAt=new Date().toISOString();
          const {error:updateTrialError}=await admin.from("reel_test_publications")
            .update({storage_deleted_at:deletedAt,updated_at:deletedAt})
            .eq("id",trial.id);
          if(updateTrialError)throw updateTrialError;

          await admin.from("activity_logs").insert({
            level:"info",
            event_type:"trial_reel_storage_cleaned",
            message:"Arquivo físico de Reel de teste publicado foi removido após a retenção; dados extraídos foram preservados",
            meta:{
              publication_id:trial.id,
              retention_days:retentionDays,
              file_name:trial.file_name||null,
              learning_data_preserved:true,
              final_snapshot:finalSnapshot
            }
          });
          cleanupResults.push({type:"trial_reel",publication_id:trial.id});
        }catch(e:any){
          cleanupResults.push({type:"trial_reel",publication_id:trial.id,error:e instanceof Error?e.message:String(e)});
        }
      }
    }

    // Recalculate recommended hours from real Instagram samples.
    const cutoff=new Date(Date.now()-lookback*86400000).toISOString().slice(0,10);
    const {data:samples,error:sampe}=await admin.from("smart_samples").select("*").eq("source","instagram").gte("sample_date",cutoff);
    if(sampe)throw sampe;

    const all=samples||[];
    const baseline=viralBaseline(all);
    const prior=all.length?smartWeightedAvg(all,baseline,null):60;
    const recommendations:any[]=[];

    // Viral-weighted scheduler:
    // 15-minute candidate windows, day-specific history first, global history only as fallback.
    for(let dow=0;dow<7;dow++){
      const candidates:any[]=[];
      for(let minute=6*60;minute<=23*60+45;minute+=15){
        const day=all.filter((s:any)=>Number(s.weekday)===dow&&Math.abs(sampleMinute(s)-minute)<=75);
        const global=all.filter((s:any)=>Math.abs(sampleMinute(s)-minute)<=60);
        const ds=smartWeightedAvg(day,baseline,minute);
        const gs=smartWeightedAvg(global,baseline,minute);

        // Real samples from the same weekday dominate.
        // Global performance only fills gaps where that weekday has little history.
        let score=prior*.58;
        if(day.length)score=ds*.86+(gs||prior)*.14;
        else if(global.length)score=gs*.78+prior*.22;

        const viralDay=day.filter((s:any)=>Number(s.views||0)>=baseline.p75Views).length;
        const viralGlobal=global.filter((s:any)=>Number(s.views||0)>=baseline.p90Views).length;
        score+=viralDay*16+viralGlobal*5;

        const sampleCount=day.length||global.length;
        const confidence=Math.max(5,Math.min(100,Math.round(
          (Math.min(day.length,4)/4)*62+
          (Math.min(global.length,6)/6)*18+
          (viralDay?16:0)+
          (viralGlobal?4:0)
        )));

        candidates.push({weekday:dow,minute,score,confidence,sample_count:sampleCount,day_samples:day.length});
      }

      // Balanced A/B scheduler: keep the requested 2 morning + 3 afternoon/early-evening distribution
      // while reserving controlled exploration only inside active day parts.
      const selectionGap=Math.max(minGap,60);
      const selected:any[]=[];
      const canUse=(c:any)=>selected.every((x:any)=>Math.abs(x.minute-c.minute)>=selectionGap);
      const activePeriodNames=periodQuotas.filter((p:any)=>p.quota>0).map((p:any)=>p.name);
      const testPeriod=activePeriodNames.length?activePeriodNames[dow%activePeriodNames.length]:"afternoon";
      const validatedCountForDay=validationBeforeRows.filter((x:any)=>Number(x.weekday)===dow&&Number(x.rank)<=postsPerDay&&x.state==="validated").length;
      const needsExploration=validatedCountForDay<postsPerDay;
      let testsRemaining=exploration>0&&needsExploration?Math.max(1,Math.round(postsPerDay*exploration/100)):0;

      for(const period of periodQuotas){
        const pool=candidates.filter((c:any)=>c.minute>=period.start&&c.minute<=period.end);
        const reserveTest=testsRemaining>0&&period.name===testPeriod?1:0;
        const stableTarget=Math.max(0,period.quota-reserveTest);
        let chosenInPeriod=0;

        const provenPool=[...pool]
          .filter((c:any)=>c.confidence>=minConfidence || c.sample_count>=minSamples)
          .sort((a:any,b:any)=>
            b.score-a.score ||
            b.confidence-a.confidence ||
            b.day_samples-a.day_samples
          );

        for(const c of provenPool){
          if(chosenInPeriod>=stableTarget)break;
          if(canUse(c)){
            selected.push({...c,period:period.name,recommendation_type:"stable"});
            chosenInPeriod++;
          }
        }

        if(chosenInPeriod<stableTarget){
          const fallback=[...pool].sort((a:any,b:any)=>
            b.score-a.score ||
            b.confidence-a.confidence ||
            b.sample_count-a.sample_count
          );
          for(const c of fallback){
            if(chosenInPeriod>=stableTarget)break;
            if(!selected.some((x:any)=>x.minute===c.minute)&&canUse(c)){
              selected.push({...c,period:period.name,recommendation_type:"stable"});
              chosenInPeriod++;
            }
          }
        }

        if(reserveTest){
          const testPool=[...pool]
            .filter((c:any)=>!selected.some((x:any)=>x.minute===c.minute)&&canUse(c))
            .sort((a:any,b:any)=>{
              const aUnproven=(a.sample_count<minSamples||a.confidence<minConfidence)?1:0;
              const bUnproven=(b.sample_count<minSamples||b.confidence<minConfidence)?1:0;
              return bUnproven-aUnproven ||
                a.sample_count-b.sample_count ||
                b.score-a.score;
            });
          if(testPool[0]){
            selected.push({...testPool[0],period:period.name,recommendation_type:"test"});
            testsRemaining--;
          }
        }

        // Guarantee the exact quota even if the test candidate could not be found.
        let totalInPeriod=selected.filter((x:any)=>x.period===period.name).length;
        if(totalInPeriod<period.quota){
          const fill=[...pool].sort((a:any,b:any)=>b.score-a.score||b.confidence-a.confidence);
          for(const c of fill){
            if(totalInPeriod>=period.quota)break;
            if(!selected.some((x:any)=>x.minute===c.minute)&&canUse(c)){
              selected.push({...c,period:period.name,recommendation_type:"stable"});
              totalInPeriod++;
            }
          }
        }
      }

      selected.sort((a,b)=>a.minute-b.minute).forEach((c,i)=>{
        const hh=String(Math.floor(c.minute/60)).padStart(2,"0");
        const mm=String(c.minute%60).padStart(2,"0");
        recommendations.push({
          weekday:dow,
          rank:i+1,
          recommended_time:hh+":"+mm+":00",
          score:Number(c.score.toFixed(4)),
          confidence:c.confidence,
          sample_count:c.sample_count,
          recommendation_type:c.recommendation_type||"tested",
          updated_at:new Date().toISOString()
        });
      });
    }

    let validationSummary:any={new:0,testing:0,validated:0,revalidate:0};
    let validationRows:any[]=[];
    if(recommendations.length){
      const {error:staleRecError}=await admin.from("smart_recommendations").delete().gt("rank",postsPerDay);
      if(staleRecError)throw staleRecError;
      const {error:recWriteError}=await admin.from("smart_recommendations").upsert(recommendations,{onConflict:"weekday,rank"});
      if(recWriteError)throw recWriteError;

      const {data:validationResult,error:validationError}=await admin.rpc("evaluate_smart_time_validation");
      if(validationError)throw validationError;
      validationSummary=validationResult||validationSummary;

      const {data:validationData,error:validationReadError}=await admin.from("smart_time_validation")
        .select("weekday,rank,state,champion_time,champion_score,champion_confidence,champion_sample_count,candidate_time,candidate_score,candidate_confidence,candidate_sample_count,validation_streak,challenger_streak,challenger_fail_streak,decline_streak,rollback_time,validated_at,revalidate_started_at,last_decision_at,updated_at")
        .lte("rank",postsPerDay)
        .order("weekday").order("rank");
      if(validationReadError)throw validationReadError;
      validationRows=validationData||[];
    }

    // Raw model recommendations keep learning continuously, while the effective
    // calendar time is frozen once a slot becomes validated.
    const effectiveRecommendations=recommendations.map((rec:any)=>{
      const v=validationRows.find((x:any)=>Number(x.weekday)===Number(rec.weekday)&&Number(x.rank)===Number(rec.rank));
      if(!v)return {...rec,model_time:rec.recommended_time,validation_state:"testing"};

      let effectiveTime=rec.recommended_time;
      let effectiveType=rec.recommendation_type||"tested";
      let score=rec.score,confidence=rec.confidence,sampleCount=rec.sample_count;

      if(v.state==="validated"&&v.champion_time){
        effectiveTime=v.champion_time;
        effectiveType="validated";
        score=Number(v.champion_score||rec.score);
        confidence=Number(v.champion_confidence||rec.confidence);
        sampleCount=Number(v.champion_sample_count||rec.sample_count);
      }else if(v.state==="revalidate"){
        const challengerTime=v.candidate_time||v.champion_time||rec.recommended_time;
        // Never let a challenger collide with another frozen champion.
        const cm=String(challengerTime).slice(0,5);
        const cmin=Number(cm.slice(0,2))*60+Number(cm.slice(3,5));
        const conflicts=validationRows.some((other:any)=>{
          if(Number(other.weekday)!==Number(rec.weekday)||Number(other.rank)===Number(rec.rank)||!other.champion_time)return false;
          const ot=String(other.champion_time).slice(0,5);
          const omin=Number(ot.slice(0,2))*60+Number(ot.slice(3,5));
          return Math.abs(cmin-omin)<minGap;
        });
        effectiveTime=conflicts?(v.champion_time||rec.recommended_time):challengerTime;
        effectiveType="revalidate";
        score=conflicts?Number(v.champion_score||rec.score):Number(v.candidate_score||rec.score);
        confidence=conflicts?Number(v.champion_confidence||rec.confidence):Number(v.candidate_confidence||rec.confidence);
        sampleCount=conflicts?Number(v.champion_sample_count||rec.sample_count):Number(v.candidate_sample_count||rec.sample_count);
        return {
          ...rec,
          model_time:rec.recommended_time,
          recommended_time:effectiveTime,
          recommendation_type:effectiveType,
          validation_state:v.state,
          champion_time:v.champion_time||null,
          candidate_time:v.candidate_time||null,
          score,confidence,sample_count:sampleCount,
          validation_conflict:conflicts,
          challenger_streak:Number(v.challenger_streak||0),
          rollback_time:v.rollback_time||null
        };
      }else if(v.state==="testing"){
        effectiveType=rec.recommendation_type==="test"?"test":"testing";
      }else if(v.state==="new"){
        effectiveType="new";
      }

      const em=String(effectiveTime).slice(0,5);
      const emin=Number(em.slice(0,2))*60+Number(em.slice(3,5));
      const conflict=v.state!=="validated"&&validationRows.some((other:any)=>{
        if(Number(other.weekday)!==Number(rec.weekday)||Number(other.rank)===Number(rec.rank)||!other.champion_time)return false;
        const ot=String(other.champion_time).slice(0,5);
        const omin=Number(ot.slice(0,2))*60+Number(ot.slice(3,5));
        return Math.abs(emin-omin)<minGap;
      });

      return {
        ...rec,
        model_time:rec.recommended_time,
        recommended_time:effectiveTime,
        recommendation_type:effectiveType,
        validation_state:v.state,
        champion_time:v.champion_time||null,
        candidate_time:v.candidate_time||null,
        score,confidence,sample_count:sampleCount,
        validation_conflict:conflict,
        validation_streak:Number(v.validation_streak||0),
        challenger_streak:Number(v.challenger_streak||0),
        rollback_time:v.rollback_time||null
      };
    });

    // Automatically reorganize future scheduled posts outside the lock window.
    let adjusted=0;
    if(automation.enabled!==false&&automation.autoOptimizeCalendar!==false&&effectiveRecommendations.length){
      const lockMinutes=Number(automation.lockWindowMinutes||120);
      const from=new Date(Date.now()-24*60*60_000).toISOString();
      const to=new Date(Date.now()+14*86400000).toISOString();
      const {data:schedules,error:sce}=await admin.from("schedules")
        .select("id,scheduled_at,status,instagram_media_id,auto_adjust_count,smart_mode,smart_strategy,smart_strategy_locked,last_auto_adjusted_at")
        .gte("scheduled_at",from).lte("scheduled_at",to)
        .neq("status","cancelled");
      if(sce)throw sce;

      const groups=new Map<string,any[]>();
      for(const s of schedules||[]){
        const lp=parts(new Date(s.scheduled_at),tz);
        if(!groups.has(lp.date))groups.set(lp.date,[]);
        groups.get(lp.date)!.push({...s,local:lp});
      }

      const changes:any[]=[];
      for(const [date,rows] of groups.entries()){
        const weekday=rows[0]?.local?.weekday??0;
        const recs=effectiveRecommendations.filter((r:any)=>r.weekday===weekday).sort((a:any,b:any)=>a.rank-b.rank);
        if(!recs.length)continue;

        const lockAt=Date.now()+lockMinutes*60_000;
        const movable=rows
          .filter(r=>{
            const last=r.last_auto_adjusted_at?new Date(r.last_auto_adjusted_at).getTime():0;
            const cooledDown=!last||(Date.now()-last)>=reevaluateHours*60*60_000;
            return ["scheduled","queued"].includes(r.status)&&!r.instagram_media_id&&r.smart_mode==="auto"&&cooledDown&&new Date(r.scheduled_at).getTime()>lockAt;
          })
          .sort((a,b)=>new Date(a.scheduled_at).getTime()-new Date(b.scheduled_at).getTime());
        if(!movable.length)continue;

        const fixedTimes=rows
          .filter(r=>!movable.some(m=>m.id===r.id))
          .map(r=>r.local.time);

        const available=recs.filter((r:any)=>{
          if(r.validation_conflict)return false;
          // The recommendation builder already guarantees the 2+3 quota and spacing.
          // Keep all five generated slots usable, including controlled low-evidence tests.
          const t=String(r.recommended_time).slice(0,5);
          const mins=Number(t.slice(0,2))*60+Number(t.slice(3,5));
          return fixedTimes.every(ft=>{
            const fm=Number(ft.slice(0,2))*60+Number(ft.slice(3,5));
            return Math.abs(mins-fm)>=minGap;
          });
        });

        movable.forEach((r,i)=>{
          const rec=available[i];
          if(!rec)return;
          const t=String(rec.recommended_time).slice(0,5);
          const target=zonedToUtc(date,t,tz).toISOString();
          const targetStrategy=rec.recommendation_type==="test"?"test":"stable";
          const strategyChanged=!r.smart_strategy_locked && r.smart_strategy!==targetStrategy;
          if(Math.abs(new Date(target).getTime()-new Date(r.scheduled_at).getTime())>=15*60_000 || strategyChanged){
            changes.push({id:r.id,scheduled_at:target,smart_strategy:targetStrategy});
          }
        });
      }

      if(changes.length){
        const {data:n,error:ae}=await admin.rpc("apply_auto_schedule_adjustments",{p_adjustments:changes});
        if(ae)throw ae;
        adjusted=Number(n||0);
        await admin.from("activity_logs").insert({
          level:"info",event_type:"calendar_auto_optimized",
          message:"Smart Scheduler reorganizou horários futuros automaticamente",
          meta:{adjusted,recommendation_count:effectiveRecommendations.length,validation:validationSummary}
        });
      }
    }


    // Separate Trial Reel learning: only instagram_trial samples are used here.
    // They never feed the normal Smart Scheduler above.
    const trialCfg:any=settings.trial_scheduler||{};
    const trialEnabled=trialCfg.enabled!==false;
    const trialSlots=Math.max(1,Math.min(4,Number(trialCfg.slots||4)));
    const trialGap=Math.max(45,Number(trialCfg.min_gap_minutes||60));
    const trialMinSamples=Math.max(1,Number(trialCfg.min_samples||3));
    const trialLookback=Math.max(7,Number(trialCfg.lookback_days||60));
    const trialFallback=(Array.isArray(trialCfg.fallback_times)?trialCfg.fallback_times:["00:30","02:00","03:30","05:00"])
      .map((x:any)=>String(x).slice(0,5)).slice(0,trialSlots);

    let trialRecommendations:any[]=[];
    let trialAdjusted=0;
    if(trialEnabled){
      const trialCutoff=new Date(Date.now()-trialLookback*86400000).toISOString().slice(0,10);
      const {data:trialSamples,error:trialSampleError}=await admin.from("smart_samples")
        .select("*").eq("source","instagram_trial").gte("sample_date",trialCutoff);
      if(trialSampleError)throw trialSampleError;

      const trialAll=trialSamples||[];
      const trialBaseline=viralBaseline(trialAll);
      const trialPrior=trialAll.length?smartWeightedAvg(trialAll,trialBaseline,null):0;

      for(let dow=0;dow<7;dow++){
        const candidates:any[]=[];
        for(let minute=0;minute<=330;minute+=30){
          const day=trialAll.filter((s:any)=>Number(s.weekday)===dow&&Math.abs(sampleMinute(s)-minute)<=60);
          const global=trialAll.filter((s:any)=>Math.abs(sampleMinute(s)-minute)<=45);
          const dayScore=smartWeightedAvg(day,trialBaseline,minute);
          const globalScore=smartWeightedAvg(global,trialBaseline,minute);
          let score=trialPrior||1;
          if(day.length)score=dayScore*.84+(globalScore||trialPrior||dayScore)*.16;
          else if(global.length)score=globalScore*.78+(trialPrior||globalScore)*.22;

          const sampleCount=day.length||global.length;
          const confidence=Math.max(5,Math.min(100,Math.round(
            (Math.min(day.length,4)/4)*70+
            (Math.min(global.length,6)/6)*25+
            (sampleCount>=trialMinSamples?5:0)
          )));
          candidates.push({weekday:dow,minute,score,confidence,sample_count:sampleCount});
        }

        const selected:any[]=[];
        const canUse=(c:any)=>selected.every((x:any)=>Math.abs(x.minute-c.minute)>=trialGap);
        [...candidates].sort((a:any,b:any)=>
          b.score-a.score ||
          b.confidence-a.confidence ||
          b.sample_count-a.sample_count
        ).forEach((c:any)=>{
          if(selected.length>=trialSlots)return;
          if(canUse(c))selected.push(c);
        });

        // Until the separate learning has enough data, keep stable fallback hours.
        if(trialAll.filter((s:any)=>Number(s.weekday)===dow).length<trialMinSamples){
          selected.length=0;
          trialFallback.forEach((t:string)=>{
            const minute=Number(t.slice(0,2))*60+Number(t.slice(3,5));
            selected.push({weekday:dow,minute,score:0,confidence:5,sample_count:0});
          });
        }

        selected.sort((a:any,b:any)=>a.minute-b.minute).slice(0,trialSlots).forEach((c:any,i:number)=>{
          const hh=String(Math.floor(c.minute/60)).padStart(2,"0");
          const mm=String(c.minute%60).padStart(2,"0");
          trialRecommendations.push({
            weekday:dow,
            rank:i+1,
            recommended_time:hh+":"+mm+":00",
            score:Number((c.score||0).toFixed(4)),
            confidence:Number(c.confidence||5),
            sample_count:Number(c.sample_count||0),
            updated_at:new Date().toISOString()
          });
        });
      }

      if(trialRecommendations.length){
        const {error:trialRecError}=await admin.from("trial_time_recommendations")
          .upsert(trialRecommendations,{onConflict:"weekday,rank"});
        if(trialRecError)throw trialRecError;
      }

      if(trialCfg.auto_apply!==false&&trialRecommendations.length){
        const lockAt=Date.now()+120*60_000;
        const until=new Date(Date.now()+14*86400000).toISOString();
        const {data:trialFuture,error:trialFutureError}=await admin.from("reel_test_publications")
          .select("id,scheduled_at,status,slot_index,auto_time,container_id,last_auto_adjusted_at")
          .eq("trial_kind","overnight")
          .eq("status","scheduled")
          .eq("auto_time",true)
          .is("hidden_at",null)
          .is("container_id",null)
          .gte("scheduled_at",new Date(lockAt).toISOString())
          .lte("scheduled_at",until);
        if(trialFutureError)throw trialFutureError;

        for(const row of trialFuture||[]){
          const local=parts(new Date(row.scheduled_at),tz);
          const slot=Math.max(0,Math.min(trialSlots-1,Number(row.slot_index||0)));
          const rec=trialRecommendations.find((x:any)=>Number(x.weekday)===Number(local.weekday)&&Number(x.rank)===slot+1);
          if(!rec)continue;
          const target=zonedToUtc(local.date,String(rec.recommended_time).slice(0,5),tz).toISOString();
          if(Math.abs(new Date(target).getTime()-new Date(row.scheduled_at).getTime())<15*60_000)continue;

          const {error:updateTrialError}=await admin.from("reel_test_publications").update({
            scheduled_at:target,
            next_attempt_at:target,
            last_auto_adjusted_at:new Date().toISOString(),
            updated_at:new Date().toISOString()
          }).eq("id",row.id).eq("status","scheduled").is("container_id",null);
          if(updateTrialError)throw updateTrialError;
          trialAdjusted++;
        }

        if(trialAdjusted){
          await admin.from("activity_logs").insert({
            level:"info",
            event_type:"trial_scheduler_auto_adjusted",
            message:"Horários dos Reels teste foram ajustados pelo aprendizado separado",
            meta:{adjusted:trialAdjusted,recommendations:trialRecommendations.length}
          });
        }
      }
    }

    await admin.from("worker_runtime").upsert({
      worker_name:"automation",
      last_heartbeat:new Date().toISOString(),
      last_success_at:new Date().toISOString(),
      last_error:null,
      last_jobs:metricResults.length,
      updated_at:new Date().toISOString()
    },{onConflict:"worker_name"});

    return out({ok:true,metrics:metricResults,recommendations:recommendations.length,effective_recommendations:effectiveRecommendations.length,validation:validationSummary,adjusted,trial_recommendations:trialRecommendations.length,trial_adjusted:trialAdjusted,storage_cleanup:cleanupResults});
  }catch(e:any){
    const message=e instanceof Error?e.message:(typeof e==="object"?JSON.stringify(e):String(e));
    try{
      await admin.from("worker_runtime").upsert({
        worker_name:"automation",last_heartbeat:new Date().toISOString(),last_error:message,updated_at:new Date().toISOString()
      },{onConflict:"worker_name"});
    }catch{}
    return out({ok:false,error:message},500);
  }
});
