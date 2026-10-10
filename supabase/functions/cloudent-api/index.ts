
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { defaultCharacterBase64 } from "./default-character.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Content-Type": "application/json"
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: cors });

function readableError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    for (const key of ["message", "error_description", "error", "details", "hint", "code"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {}
  }
  return "unexpected_backend_error";
}


type CloudentR2Config={account_id:string;access_key_id:string;secret_access_key:string;bucket:string;endpoint:string};

function normalizeR2Config(row:any):CloudentR2Config|null{
  if(!row?.access_key_id||!row?.secret_access_key||!row?.bucket)return null;
  const accountId=String(row.account_id||"").trim();
  return {
    account_id:accountId,
    access_key_id:String(row.access_key_id).trim(),
    secret_access_key:String(row.secret_access_key).trim(),
    bucket:String(row.bucket).trim(),
    endpoint:String(row.endpoint||("https://"+accountId+".r2.cloudflarestorage.com")).trim().replace(/\/$/,"")
  };
}
async function getCloudentR2Config(admin:any):Promise<CloudentR2Config|null>{
  const {data,error}=await admin.rpc("get_cloudent_r2_config");
  if(error)return null;
  return normalizeR2Config(Array.isArray(data)?data[0]:data);
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
  const aws=new AwsClient({
    service:"s3",region:s3RegionFromEndpoint(config.endpoint),
    accessKeyId:config.access_key_id,
    secretAccessKey:config.secret_access_key
  });
  const headers:Record<string,string>={};
  if(contentType)headers["Content-Type"]=contentType;
  const request=new Request(
    config.endpoint+"/"+encodeURIComponent(config.bucket)+"/"+r2KeyPath(key)+"?X-Amz-Expires="+Math.max(1,Math.min(604800,Number(expires)||3600)),
    {method,headers}
  );
  const signed=await aws.sign(request,{aws:{signQuery:true}});
  return signed.url.toString();
}
async function storageSignedGet(admin:any,provider:string,path:string,expires=3600){
  if(provider==="r2"){
    const cfg=await getCloudentR2Config(admin);
    if(!cfg)throw new Error("r2_not_configured");
    return await r2PresignedUrl(cfg,"GET",path,expires);
  }
  const {data,error}=await admin.storage.from("videos").createSignedUrl(path,expires);
  if(error||!data?.signedUrl)throw error||new Error("signed_url_failed");
  return data.signedUrl;
}
async function storageSignedGetBucket(admin:any,provider:string,path:string,expires=3600,supabaseBucket="videos"){
  if(provider==="r2"){
    const cfg=await getCloudentR2Config(admin);
    if(!cfg)throw new Error("r2_not_configured");
    return await r2PresignedUrl(cfg,"GET",path,expires);
  }
  const {data,error}=await admin.storage.from(supabaseBucket).createSignedUrl(path,expires);
  if(error||!data?.signedUrl)throw error||new Error("signed_url_failed");
  return data.signedUrl;
}
function safeDownloadName(name:string){
  return String(name||"video.mp4").replace(/[\r\n"\\]/g,"_").slice(0,160)||"video.mp4";
}
async function storageSignedDownloadBucket(admin:any,provider:string,path:string,fileName:string,expires=3600,supabaseBucket="videos"){
  const cleanName=safeDownloadName(fileName);
  if(provider==="r2"){
    const cfg=await getCloudentR2Config(admin);
    if(!cfg)throw new Error("r2_not_configured");
    const aws=new AwsClient({
      service:"s3",region:s3RegionFromEndpoint(cfg.endpoint),
      accessKeyId:cfg.access_key_id,
      secretAccessKey:cfg.secret_access_key
    });
    const base=cfg.endpoint+"/"+encodeURIComponent(cfg.bucket)+"/"+r2KeyPath(path);
    const params=new URLSearchParams();
    params.set("X-Amz-Expires",String(Math.max(1,Math.min(604800,Number(expires)||3600))));
    params.set("response-content-disposition",'attachment; filename="'+cleanName+'"');
    const request=new Request(base+"?"+params.toString(),{method:"GET"});
    const signed=await aws.sign(request,{aws:{signQuery:true}});
    return signed.url.toString();
  }
  const {data,error}=await admin.storage.from(supabaseBucket).createSignedUrl(path,expires,{download:cleanName});
  if(error||!data?.signedUrl)throw error||new Error("signed_download_url_failed");
  return data.signedUrl;
}
async function storageDeletePathsBucket(admin:any,provider:string,paths:string[],supabaseBucket="videos"){
  const unique=[...new Set((paths||[]).filter(Boolean).map(String))];
  if(!unique.length)return;
  if(provider==="r2"){
    const cfg=await getCloudentR2Config(admin);
    if(!cfg)throw new Error("r2_not_configured");
    for(const path of unique){
      const url=await r2PresignedUrl(cfg,"DELETE",path,900);
      const res=await fetch(url,{method:"DELETE"});
      if(!res.ok&&res.status!==404)throw new Error("r2_delete_"+res.status);
    }
    return;
  }
  const {error}=await admin.storage.from(supabaseBucket).remove(unique);
  if(error)throw error;
}

async function storageDeletePaths(admin:any,provider:string,paths:string[]){
  const unique=[...new Set((paths||[]).filter(Boolean).map(String))];
  if(!unique.length)return;
  if(provider==="r2"){
    const cfg=await getCloudentR2Config(admin);
    if(!cfg)throw new Error("r2_not_configured");
    for(const path of unique){
      const url=await r2PresignedUrl(cfg,"DELETE",path,900);
      const res=await fetch(url,{method:"DELETE"});
      if(!res.ok&&res.status!==404)throw new Error("r2_delete_"+res.status);
    }
    return;
  }
  const {error}=await admin.storage.from("videos").remove(unique);
  if(error)throw error;
}
async function storageObjectExists(admin:any,provider:string,path:string){
  if(provider==="r2"){
    const cfg=await getCloudentR2Config(admin);
    if(!cfg)return false;
    const url=await r2PresignedUrl(cfg,"HEAD",path,300);
    const res=await fetch(url,{method:"HEAD"});
    return res.ok;
  }
  const slash=path.lastIndexOf("/");
  const folder=path.slice(0,slash),name=path.slice(slash+1);
  const {data,error}=await admin.storage.from("videos").list(folder,{search:name,limit:10});
  if(error)throw error;
  return !!(data||[]).find((x:any)=>x.name===name);
}

function safeMediaExt(name:string,fallback="mp4"){
  const raw=String(name||"").includes(".")?String(name).split(".").pop()||fallback:fallback;
  const ext=raw.toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8);
  return ext||fallback;
}

const secretEncoder = new TextEncoder();
const toB64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
async function runninghubEncrypt(value:string,master:string){
  const hash=await crypto.subtle.digest("SHA-256",secretEncoder.encode(master));
  const key=await crypto.subtle.importKey("raw",hash,{name:"AES-GCM"},false,["encrypt"]);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,secretEncoder.encode(value));
  return {cipher:toB64(new Uint8Array(encrypted)),iv:toB64(iv)};
}

const fromB64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function runninghubDecrypt(cipher:string,iv:string,master:string){
  const hash=await crypto.subtle.digest("SHA-256",secretEncoder.encode(master));
  const key=await crypto.subtle.importKey("raw",hash,{name:"AES-GCM"},false,["decrypt"]);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(iv)},key,fromB64(cipher));
  return new TextDecoder().decode(plain);
}

const X_WARMUP_PLAN=[
  {day:1,title:"Observação",summary:{observe_minutes:[10,10],likes:[0,0],follows:[0,0],replies:[0,0],posts:[0,0],notes:["Ler feed normalmente","Sem interações"]}},
  {day:2,title:"Interação mínima",summary:{observe_minutes:[10,15],likes:[0,5],follows:[0,0],replies:[0,0],posts:[0,0],notes:["Curtir até 5 posts"]}},
  {day:3,title:"Interação leve",summary:{observe_minutes:[10,15],likes:[1,5],follows:[3,5],replies:[0,0],posts:[0,0],notes:["Likes do nicho","Ler replies e threads"]}},
  {day:4,title:"Engajamento controlado",summary:{observe_minutes:[10,15],likes:[1,5],follows:[0,5],replies:[1,1],posts:[0,0],notes:["1 resposta programada","Evitar ações repetitivas"]}},
  {day:5,title:"Preparação para postagem",summary:{observe_minutes:[10,15],likes:[1,5],follows:[0,5],replies:[1,3],posts:[0,0],notes:["Interação moderada","Ainda sem post"]}},
  {day:6,title:"Primeiro post",summary:{observe_minutes:[10,15],likes:[1,5],follows:[0,3],replies:[1,3],posts:[1,1],notes:["Primeiro post simples","Sem link/venda/spam","Atividade após o post"]}},
  {day:7,title:"Consolidação",summary:{observe_minutes:[10,15],likes:[1,5],follows:[0,3],replies:[1,3],posts:[0,1],notes:["Segundo post opcional","Revisão final","Pronta para aprovação"]}}
];

async function wakeNotificationWorker(admin:any,supabaseUrl:string){
  try{
    const {data:secret,error}=await admin.rpc("get_cloudent_worker_secret");
    if(error||!secret)return false;
    const res=await fetch(supabaseUrl+"/functions/v1/cloudent-notification-worker",{
      method:"POST",
      headers:{"Content-Type":"application/json","x-cloudent-worker-secret":String(secret)},
      body:"{}"
    });
    return res.ok;
  }catch{return false}
}

async function resolveCalendarInstagramAccount(admin:any,requestedId:any){
  const requested=String(requestedId||"").trim();
  let query=admin.from("platform_accounts").select("id").eq("platform","instagram").eq("enabled",true);
  query=requested?query.eq("id",requested):query.order("created_at",{ascending:true}).limit(1);
  const {data:account,error}=await query.maybeSingle();
  if(error)throw error;
  if(requested&&!account)throw new Error("A conta selecionada do Instagram não está disponível.");
  return account?.id||null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ ok: false, error: "authentication_required" }, 401);

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return json({ ok: false, error: "invalid_user_session" }, 401);

    const url = new URL(req.url);
    const resource = url.searchParams.get("resource");
    const action = url.searchParams.get("action");

    if (req.method === "GET" && !resource) {
      const { count, error } = await admin.from("schedules").select("*", { count: "exact", head: true });
      if (error) throw error;
      return json({ ok: true, service: "CloudentFlow Backend", stage: 5, schedules: count ?? 0, user: userData.user.id });
    }

    if (req.method === "GET" && resource === "storage-backend") {
      const cfg=await getCloudentR2Config(admin);
      return json({
        configured:!!cfg,
        provider:cfg?"r2":"supabase",
        bucket:cfg?.bucket||null,
        endpoint:cfg?.endpoint||null,
        account_hint:cfg?.account_id?cfg.account_id.slice(0,6)+"…"+cfg.account_id.slice(-4):null
      });
    }

    if (req.method === "GET" && resource === "media-url") {
      const entity=String(url.searchParams.get("entity")||"video");
      const id=String(url.searchParams.get("id")||"");
      const kind=String(url.searchParams.get("kind")||"video");
      if(!id)return json({error:"id_required"},400);

      let row:any=null;
      if(entity==="trial"){
        const {data,error}=await admin.from("reel_test_publications")
          .select("id,user_id,storage_path,thumbnail_storage_path,storage_provider")
          .eq("id",id).eq("user_id",userData.user.id).maybeSingle();
        if(error)throw error; row=data;
      }else{
        const {data,error}=await admin.from("videos")
          .select("id,storage_path,thumbnail_storage_path,storage_provider")
          .eq("id",id).maybeSingle();
        if(error)throw error; row=data;
        const candidate=String(row?.storage_path||"");
        if(row && !candidate.startsWith(userData.user.id+"/"))return json({error:"media_owner_mismatch"},403);
      }
      if(!row)return json({error:"media_not_found"},404);
      const path=kind==="thumbnail"?String(row.thumbnail_storage_path||""):String(row.storage_path||"");
      if(!path)return json({error:"media_file_not_available"},404);
      const provider=String(row.storage_provider||"supabase");
      const signedUrl=await storageSignedGet(admin,provider,path,3600);
      return json({url:signedUrl,expires_in:3600,provider});
    }

    if (req.method === "POST" && action === "r2-config") {
      const body=await req.json();
      const accountId=String(body.account_id||"").trim();
      const accessKeyId=String(body.access_key_id||"").trim();
      const secretAccessKey=String(body.secret_access_key||"").trim();
      const bucket=String(body.bucket||"").trim();
      const endpoint=String(body.endpoint||("https://"+accountId+".r2.cloudflarestorage.com")).trim().replace(/\/$/,"");
      if(accountId.length<4||accessKeyId.length<8||secretAccessKey.length<16||bucket.length<3){
        return json({error:"r2_config_invalid",user_message:"Preencha Account ID, Access Key, Secret Key e Bucket corretamente."},400);
      }
      const candidate=normalizeR2Config({
        account_id:accountId,access_key_id:accessKeyId,secret_access_key:secretAccessKey,bucket,endpoint
      });
      if(!candidate)return json({error:"r2_config_invalid"},400);

      const testKey=userData.user.id+"/.cloudent-health/"+crypto.randomUUID()+".txt";
      const testBody="cloudentflow-r2-ok";
      const putUrl=await r2PresignedUrl(candidate,"PUT",testKey,300,"text/plain");
      const put=await fetch(putUrl,{method:"PUT",headers:{"Content-Type":"text/plain"},body:testBody});
      if(!put.ok)return json({error:"r2_write_test_failed",user_message:"O R2 recusou a gravação. Confira token, bucket e endpoint.",status:put.status},400);

      const headUrl=await r2PresignedUrl(candidate,"HEAD",testKey,300);
      const head=await fetch(headUrl,{method:"HEAD"});
      const deleteUrl=await r2PresignedUrl(candidate,"DELETE",testKey,300);
      await fetch(deleteUrl,{method:"DELETE"}).catch(()=>null);
      if(!head.ok)return json({error:"r2_read_test_failed",user_message:"Consegui gravar, mas não consegui validar o arquivo no R2.",status:head.status},400);

      const {error:saveError}=await admin.rpc("set_cloudent_r2_config",{
        p_account_id:accountId,
        p_access_key_id:accessKeyId,
        p_secret_access_key:secretAccessKey,
        p_bucket:bucket,
        p_endpoint:endpoint
      });
      if(saveError)throw saveError;
      await admin.from("activity_logs").insert({
        level:"info",event_type:"r2_configured",message:"Cloudflare R2 conectado ao CloudentFlow",
        meta:{user_id:userData.user.id,bucket,endpoint}
      });
      return json({ok:true,configured:true,provider:"r2",bucket,endpoint});
    }

    if (req.method === "GET" && resource === "dashboard") {
      const [{ count: videos }, { count: schedules }, { count: jobs }, { count: comments }] = await Promise.all([
        admin.from("videos").select("*", { count: "exact", head: true }),
        admin.from("schedules").select("*", { count: "exact", head: true }),
        admin.from("job_queue").select("*", { count: "exact", head: true }),
        admin.from("comments").select("*", { count: "exact", head: true })
      ]);
      return json({ videos: videos ?? 0, schedules: schedules ?? 0, jobs: jobs ?? 0, comments: comments ?? 0 });
    }

    if (req.method === "GET" && resource === "queue") {
      const fromParam=String(url.searchParams.get("from")||"").trim();
      const compactQueue=url.searchParams.get("compact")==="1";
      const queueSelect=compactQueue
        ?"id,video_id,scheduled_at,status,smart_mode,smart_strategy,smart_strategy_locked,platform,published_at,videos(id,file_name)"
        :"id,video_id,scheduled_at,status,smart_mode,smart_strategy,smart_strategy_locked,platform,attempt_count,last_error,instagram_media_id,published_at,videos(id,file_name,caption,storage_path,storage_provider,thumbnail_storage_path,size_bytes,mime_type,platform,duration_seconds,cover_offset_ms,cover_strategy)";
      let queueQuery=admin
        .from("schedules")
        .select(queueSelect)
        .neq("status","cancelled")
        .order("scheduled_at", { ascending: true });
      if(fromParam && !Number.isNaN(Date.parse(fromParam))){
        queueQuery=queueQuery.gte("scheduled_at",new Date(fromParam).toISOString());
      }
      const {data,error}=await queueQuery;
      if (error) throw error;

      const schedules=data||[];
      if(compactQueue)return json(schedules);

      const ids=schedules.map((x:any)=>x.id);
      const bySchedule:Record<string,any[]>={};
      const pretrialBySchedule:Record<string,any>={};
      if(ids.length){
        const [{data:snapshots,error:snapError},{data:pretrials,error:pretrialError}]=await Promise.all([
          admin.rpc("get_recent_schedule_metrics",{p_schedule_ids:ids,p_limit:6}),
          admin.from("reel_test_publications")
            .select("id,linked_schedule_id,scheduled_at,status,published_at,published_as_trial,instagram_media_id,last_error,attempt_count,max_attempts")
            .eq("trial_kind","prepost")
            .in("linked_schedule_id",ids)
        ]);
        if(snapError)throw snapError;
        if(pretrialError)throw pretrialError;
        for(const s of snapshots||[]){
          if(!s.schedule_id)continue;
          const list=bySchedule[String(s.schedule_id)]||(bySchedule[String(s.schedule_id)]=[]);
          list.push({
            schedule_id:s.schedule_id,
            collected_at:s.collected_at,
            views:s.views,reach:s.reach,likes:s.likes,comments:s.comments,shares:s.shares,saves:s.saves,
            instagram_media_record_id:s.instagram_media_record_id
          });
        }
        for(const p of pretrials||[]){
          if(p.linked_schedule_id)pretrialBySchedule[String(p.linked_schedule_id)]=p;
        }
      }

      return json(schedules.map((row:any)=>{
        const snaps=bySchedule[String(row.id)]||[];
        return {
          ...row,
          pretrial:pretrialBySchedule[String(row.id)]||null,
          calendar_metrics:{
            latest:snaps[0]||null,
            previous:snaps[1]||null,
            history:snaps
          }
        };
      }));
    }

    if (req.method === "GET" && resource === "automation") {
      const compactAutomation=url.searchParams.get("compact")==="1";
      const [
        { data: workers, error: workerError },
        { data: recs, error: recError },
        { data: settingRows, error: settingError },
        { data: jobs, error: jobsError },
        { data: validations, error: validationError },
        { data: validationHistory, error: historyError }
      ] = await Promise.all([
        admin.from("worker_runtime").select("worker_name,last_heartbeat,last_success_at,last_error,last_jobs,updated_at").order("worker_name"),
        admin.from("smart_recommendations").select("weekday,rank,recommended_time,score,confidence,sample_count,recommendation_type,updated_at").order("weekday").order("rank"),
        admin.from("app_settings").select("key,value").in("key",["automation","smart_scheduler","min_gap_minutes","posts_per_day","timezone","schedule_distribution"]),
        compactAutomation
          ? Promise.resolve({data:[],error:null})
          : admin.from("job_queue").select("id,job_type,platform,status,run_at,attempts,max_attempts,last_error,payload,schedule_id").in("status",["pending","running","failed"]).order("run_at").limit(50),
        admin.from("smart_time_validation")
          .select("id,weekday,rank,state,champion_time,champion_score,champion_confidence,champion_sample_count,candidate_time,candidate_score,candidate_confidence,candidate_sample_count,validation_streak,challenger_streak,challenger_fail_streak,decline_streak,rollback_time,rollback_score,validated_at,revalidate_started_at,last_decision_at,last_evidence_at,updated_at")
          .order("weekday").order("rank"),
        compactAutomation
          ? Promise.resolve({data:[],error:null})
          : admin.from("smart_time_history")
              .select("id,weekday,rank,event_type,from_state,to_state,from_time,to_time,champion_score,candidate_score,confidence,sample_count,reason,meta,created_at")
              .order("created_at",{ascending:false}).limit(120)
      ]);
      if (workerError) throw workerError;
      if (recError) throw recError;
      if (settingError) throw settingError;
      if (jobsError) throw jobsError;
      if (validationError) throw validationError;
      if (historyError) throw historyError;

      const settings=Object.fromEntries((settingRows || []).map((x:any)=>[x.key,x.value]));
      const minGap=Number(settings.min_gap_minutes||60);
      const activePostsPerDay=Math.max(1,Math.min(10,Number(settings.posts_per_day||5)));
      const activeRecs=(recs||[]).filter((x:any)=>Number(x.rank)<=activePostsPerDay);
      const vrows=(validations||[]).filter((x:any)=>Number(x.rank)<=activePostsPerDay);
      const activeValidationHistory=(validationHistory||[]).filter((x:any)=>Number(x.rank)<=activePostsPerDay);

      const effectiveRecommendations=activeRecs.map((rec:any)=>{
        const v=vrows.find((x:any)=>Number(x.weekday)===Number(rec.weekday)&&Number(x.rank)===Number(rec.rank));
        if(!v)return {...rec,model_time:rec.recommended_time,validation_state:"testing"};

        let effectiveTime=rec.recommended_time;
        let effectiveType=rec.recommendation_type||"tested";
        let score=rec.score,confidence=rec.confidence,sampleCount=rec.sample_count;
        let validationConflict=false;

        if(v.state==="validated"&&v.champion_time){
          effectiveTime=v.champion_time;
          effectiveType="validated";
          score=Number(v.champion_score||rec.score);
          confidence=Number(v.champion_confidence||rec.confidence);
          sampleCount=Number(v.champion_sample_count||rec.sample_count);
        }else if(v.state==="revalidate"){
          const challengerTime=v.candidate_time||v.champion_time||rec.recommended_time;
          const cm=String(challengerTime).slice(0,5);
          const cmin=Number(cm.slice(0,2))*60+Number(cm.slice(3,5));
          validationConflict=vrows.some((other:any)=>{
            if(Number(other.weekday)!==Number(rec.weekday)||Number(other.rank)===Number(rec.rank)||!other.champion_time)return false;
            const ot=String(other.champion_time).slice(0,5);
            const omin=Number(ot.slice(0,2))*60+Number(ot.slice(3,5));
            return Math.abs(cmin-omin)<minGap;
          });
          effectiveTime=validationConflict?(v.champion_time||rec.recommended_time):challengerTime;
          effectiveType="revalidate";
          score=validationConflict?Number(v.champion_score||rec.score):Number(v.candidate_score||rec.score);
          confidence=validationConflict?Number(v.champion_confidence||rec.confidence):Number(v.candidate_confidence||rec.confidence);
          sampleCount=validationConflict?Number(v.champion_sample_count||rec.sample_count):Number(v.candidate_sample_count||rec.sample_count);
        }else if(v.state==="testing"){
          effectiveType=rec.recommendation_type==="test"?"test":"testing";
        }else if(v.state==="new"){
          effectiveType="new";
        }

        return {
          ...rec,
          model_time:rec.recommended_time,
          recommended_time:effectiveTime,
          recommendation_type:effectiveType,
          validation_state:v.state,
          champion_time:v.champion_time||null,
          candidate_time:v.candidate_time||null,
          rollback_time:v.rollback_time||null,
          validation_conflict:validationConflict,
          validation_streak:Number(v.validation_streak||0),
          challenger_streak:Number(v.challenger_streak||0),
          challenger_fail_streak:Number(v.challenger_fail_streak||0),
          decline_streak:Number(v.decline_streak||0),
          score,confidence,sample_count:sampleCount,
          validated_at:v.validated_at||null,
          revalidate_started_at:v.revalidate_started_at||null
        };
      });

      const validationSummary={
        total:vrows.length,
        new:vrows.filter((x:any)=>x.state==="new").length,
        testing:vrows.filter((x:any)=>x.state==="testing").length,
        validated:vrows.filter((x:any)=>x.state==="validated").length,
        revalidate:vrows.filter((x:any)=>x.state==="revalidate").length
      };

      const now = Date.now();
      const normalizedWorkers = (workers || []).map((w:any) => ({
        ...w,
        online: !!w.last_heartbeat && new Date(w.last_heartbeat).getTime() > now - 6 * 60 * 1000
      }));
      return json({
        workers: normalizedWorkers,
        recommendations: effectiveRecommendations,
        model_recommendations: activeRecs,
        validation: validationSummary,
        validation_slots: vrows,
        validation_history: activeValidationHistory,
        settings,
        jobs: jobs || []
      });
    }

    if (req.method === "GET" && resource === "system-health") {
      const [
        {data:usage,error:usageError},
        {data:settingRows,error:settingsError},
        {data:integrations,error:integrationsError},
        {data:workers,error:workersError},
        {data:recentCosts,error:costsError},
        {data:egressRows,error:egressError}
      ]=await Promise.all([
        admin.rpc("get_cloudent_system_usage"),
        admin.from("app_settings").select("key,value").in("key",["system_limits","storage_retention","egress_guard"]),
        admin.from("integrations").select("provider,enabled,account_label,config,last_verified_at,updated_at").in("provider",["instagram","runninghub"]),
        admin.from("worker_runtime").select("worker_name,last_heartbeat,last_success_at,last_error,last_jobs,updated_at").order("worker_name"),
        admin.from("production_jobs").select("credits_used,completed_at,status").eq("user_id",userData.user.id).eq("status","ready").not("credits_used","is",null).order("completed_at",{ascending:false}).limit(20),
        admin.from("media_access_daily").select("day,video_preview_requests,trial_preview_requests,thumbnail_requests,estimated_bytes,last_access_at").eq("user_id",userData.user.id).order("day",{ascending:false}).limit(7)
      ]);
      if(usageError)throw usageError;
      if(settingsError)throw settingsError;
      if(integrationsError)throw integrationsError;
      if(workersError)throw workersError;
      if(costsError)throw costsError;
      if(egressError)throw egressError;

      const settings=Object.fromEntries((settingRows||[]).map((x:any)=>[x.key,x.value]));
      const limits=settings.system_limits||{};
      const now=Date.now();
      const normalizedWorkers=(workers||[]).map((w:any)=>{
        const age=w.last_heartbeat?now-new Date(w.last_heartbeat).getTime():Infinity;
        const grace=w.worker_name==="production"||w.worker_name==="followers"?3*60_000:6*60_000;
        return {...w,online:Number.isFinite(age)&&age<=grace,heartbeat_age_seconds:Number.isFinite(age)?Math.max(0,Math.round(age/1000)):null};
      });

      const ig=(integrations||[]).find((x:any)=>x.provider==="instagram")||null;
      const rh=(integrations||[]).find((x:any)=>x.provider==="runninghub")||null;
      const rhCfg:any=rh?.config||{};
      const runninghub:any={
        configured:!!(rhCfg.apiKeyCipher&&rhCfg.apiKeyIv&&rhCfg.workflowId),
        enabled:!!rh?.enabled,
        credits:null,
        active_tasks:null,
        api_type:null,
        workflow_id:rhCfg.workflowId||null,
        concurrency:Number(rhCfg.concurrency||1),
        error:null
      };

      if(runninghub.configured){
        try{
          const {data:master,error:masterError}=await admin.rpc("get_cloudent_worker_secret");
          if(masterError||!master)throw masterError||new Error("worker_secret_missing");
          const apiKey=await runninghubDecrypt(String(rhCfg.apiKeyCipher),String(rhCfg.apiKeyIv),String(master));
          const accountRes=await fetch("https://www.runninghub.ai/uc/openapi/accountStatus",{
            method:"POST",
            headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
            body:JSON.stringify({apikey:apiKey})
          });
          let account:any={};try{account=await accountRes.json()}catch{}
          if(!accountRes.ok||Number(account?.code)!==0)throw new Error(account?.msg||"runninghub_status_failed");
          runninghub.credits=Number(account?.data?.remainCoins ?? 0);
          runninghub.active_tasks=Number(account?.data?.currentTaskCounts ?? 0);
          runninghub.api_type=account?.data?.apiType||null;
        }catch(e:any){
          runninghub.error=e instanceof Error?e.message:String(e);
        }
      }

      const creditSamples=(recentCosts||[]).map((x:any)=>Number(x.credits_used)).filter((n:number)=>Number.isFinite(n)&&n>0);
      const avgCredits=creditSamples.length?creditSamples.reduce((a:number,b:number)=>a+b,0)/creditSamples.length:null;
      runninghub.avg_credits_per_job=avgCredits===null?null:Math.round(avgCredits);
      runninghub.estimated_jobs_remaining=avgCredits&&Number.isFinite(runninghub.credits)
        ? Math.floor(Number(runninghub.credits)/avgCredits)
        : null;

      const storageBytes=Number(usage?.storage_bytes||0);
      const databaseBytes=Number(usage?.database_bytes||0);
      const storageLimit=Number(limits.storage_bytes||0);
      const databaseLimit=Number(limits.database_bytes||0);
      const storagePct=storageLimit?storageBytes/storageLimit*100:null;
      const databasePct=databaseLimit?databaseBytes/databaseLimit*100:null;
      const failed=Number(usage?.counts?.queue_failed||0);
      const egressGuard:any=settings.egress_guard||{};
      const todayKey=new Date().toISOString().slice(0,10);
      const egressToday=(egressRows||[]).find((x:any)=>String(x.day)===todayKey)||null;
      const estimatedEgressToday=Number(egressToday?.estimated_bytes||0);
      const egressWarn=Number(egressGuard.daily_warn_bytes||125829120);
      const egressCritical=Number(egressGuard.daily_critical_bytes||167772160);

      const requiredWorkers=["instagram_publish","automation","followers","production","trial_reels"];
      const workerIssues=requiredWorkers.filter(name=>!normalizedWorkers.find((w:any)=>w.worker_name===name&&w.online));
      const issues:any[]=[];
      if(!ig?.enabled)issues.push({code:"instagram_offline",severity:"critical",label:"Instagram desconectado"});
      if(workerIssues.length)issues.push({code:"workers_offline",severity:"critical",label:"Worker(s) sem heartbeat",workers:workerIssues});
      if(!runninghub.configured||!runninghub.enabled)issues.push({code:"runninghub_unavailable",severity:"warn",label:"RunningHub não está pronto"});
      else if(runninghub.error)issues.push({code:"runninghub_status_error",severity:"warn",label:"Não consegui consultar créditos do RunningHub"});
      else if(Number(runninghub.credits)<=0)issues.push({code:"runninghub_no_credits",severity:"critical",label:"RunningHub sem créditos"});
      else if(avgCredits&&Number(runninghub.credits)<avgCredits*3)issues.push({code:"runninghub_low_credits",severity:"warn",label:"Créditos do RunningHub estão baixos"});
      if(storagePct!==null&&storagePct>=90)issues.push({code:"storage_near_limit",severity:storagePct>=98?"critical":"warn",label:"Storage próximo do limite"});
      if(databasePct!==null&&databasePct>=90)issues.push({code:"database_near_limit",severity:databasePct>=98?"critical":"warn",label:"Banco próximo do limite"});
      if(egressGuard.enabled!==false&&estimatedEgressToday>=egressWarn){
        issues.push({
          code:"egress_estimate_high",
          severity:estimatedEgressToday>=egressCritical?"critical":"warn",
          label:"Egress estimado do CloudentFlow alto hoje"
        });
      }
      if(failed>0)issues.push({code:"failed_jobs",severity:"warn",label:failed+" job(s) falharam"});

      const critical=issues.filter(x=>x.severity==="critical").length;
      const warning=issues.filter(x=>x.severity==="warn").length;
      const status=critical?"critical":warning?"warning":"healthy";

      return json({
        checked_at:new Date().toISOString(),
        status,
        issues,
        limits,
        retention:settings.storage_retention||null,
        egress_guard:{
          config:egressGuard,
          today:egressToday,
          recent:egressRows||[],
          estimated_today_bytes:estimatedEgressToday,
          warn_bytes:egressWarn,
          critical_bytes:egressCritical,
          source:"cloudentflow_media_access_estimate",
          official_supabase_usage:false
        },
        usage:usage||{},
        instagram:ig?{
          enabled:!!ig.enabled,
          account_label:ig.account_label||null,
          last_verified_at:ig.last_verified_at||null,
          updated_at:ig.updated_at||null,
          account_type:ig.config?.account_type||null,
          api_mode:ig.config?.api_mode||null
        }:null,
        runninghub,
        workers:normalizedWorkers
      });
    }


    if (req.method === "GET" && resource === "trial-reels") {
      const [
        {data:rows,error},
        {data:trialRecommendations,error:trialRecError},
        {data:trialSetting,error:trialSettingError}
      ]=await Promise.all([
        admin.from("reel_test_publications")
          .select("id,storage_path,original_storage_path,thumbnail_storage_path,file_name,caption,is_trial,share_to_feed,graduation_strategy,status,container_id,instagram_media_id,last_error,scheduled_at,published_at,published_as_trial,metrics_stage,next_metric_at,metrics_completed_at,storage_deleted_at,created_at,updated_at,attempt_count,max_attempts,slot_index,auto_time,hidden_at,last_auto_adjusted_at,media_clean_status,media_clean_report,media_cleaned_at,media_clean_error,trial_kind,linked_schedule_id,source_video_id,shared_storage,cover_offset_ms,cover_strategy,meta")
          .eq("user_id",userData.user.id)
          .eq("trial_kind","overnight")
          .order("scheduled_at",{ascending:false,nullsFirst:false})
          .limit(160),
        admin.from("trial_time_recommendations")
          .select("weekday,rank,recommended_time,score,confidence,sample_count,updated_at")
          .order("weekday").order("rank"),
        admin.from("app_settings").select("value").eq("key","trial_scheduler").maybeSingle()
      ]);
      if(error)throw error;
      if(trialRecError)throw trialRecError;
      if(trialSettingError)throw trialSettingError;

      const ids=(rows||[]).map((x:any)=>x.id);
      const metricsByTrial:Record<string,any[]>={};
      if(ids.length){
        const {data:snapshots,error:snapError}=await admin.from("metrics_snapshots")
          .select("trial_publication_id,collected_at,views,reach,likes,comments,shares,saves")
          .in("trial_publication_id",ids)
          .order("collected_at",{ascending:false});
        if(snapError)throw snapError;
        for(const s of snapshots||[]){
          if(!s.trial_publication_id)continue;
          const list=metricsByTrial[s.trial_publication_id]||(metricsByTrial[s.trial_publication_id]=[]);
          if(list.length<6)list.push(s);
        }
      }

      return json({
        ok:true,
        settings:trialSetting?.value||{},
        recommendations:trialRecommendations||[],
        items:(rows||[]).map((row:any)=>({
          ...row,
          trial_metrics:{
            latest:(metricsByTrial[row.id]||[])[0]||null,
            history:metricsByTrial[row.id]||[]
          }
        }))
      });
    }

    if (req.method === "POST" && action === "trial-upload-ticket") {
      const body=await req.json();
      const scheduledAt=String(body.scheduled_at||"");
      const trialDay=String(body.trial_day||"").trim();
      const slotIndex=Math.max(0,Math.min(3,Number(body.slot_index||0)));
      const fileName=String(body.file_name||"trial.mp4").slice(0,255);
      const mimeType=String(body.mime_type||"video/mp4").slice(0,120);
      const sizeBytes=Math.max(0,Number(body.size_bytes||0));
      if(!scheduledAt||Number.isNaN(Date.parse(scheduledAt)))return json({error:"scheduled_at_invalid"},400);
      if(Date.parse(scheduledAt)<=Date.now()+30_000)return json({error:"scheduled_at_past",user_message:"Esse horário já passou ou está perto demais. Escolha um horário futuro."},400);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(trialDay))return json({error:"trial_day_invalid"},400);
      if(!sizeBytes)return json({error:"file_size_invalid"},400);

      const {count,error:countError}=await admin.from("reel_test_publications")
        .select("id",{count:"exact",head:true}).eq("user_id",userData.user.id)
        .eq("trial_kind","overnight").is("hidden_at",null).contains("meta",{trial_day:trialDay});
      if(countError)throw countError;
      if(Number(count||0)>=4)return json({error:"trial_night_full",user_message:"Esta madrugada já tem 4 Reels teste agendados."},409);

      const {count:slotCount,error:slotCountError}=await admin.from("reel_test_publications")
        .select("id",{count:"exact",head:true}).eq("user_id",userData.user.id)
        .eq("trial_kind","overnight").is("hidden_at",null).eq("slot_index",slotIndex)
        .contains("meta",{trial_day:trialDay});
      if(slotCountError)throw slotCountError;
      if(Number(slotCount||0)>0)return json({
        error:"trial_slot_occupied",
        user_message:"Esse Reel teste já foi agendado. Atualize a tela."
      },409);

      const cfg=await getCloudentR2Config(admin);
      if(!cfg)return json({ok:true,fallback:true,provider:"supabase"});
      const ext=safeMediaExt(fileName,"mp4");
      const objectPath=userData.user.id+"/trial/"+new Date().toISOString().slice(0,10)+"/"+crypto.randomUUID()+"."+ext;
      const uploadUrl=await r2PresignedUrl(cfg,"PUT",objectPath,900,mimeType);
      return json({ok:true,fallback:false,provider:"r2",object_path:objectPath,upload_url:uploadUrl,content_type:mimeType,expires_in:900,slot_index:slotIndex});
    }

    if (req.method === "POST" && action === "trial-upload-complete") {
      const body=await req.json();
      const objectPath=String(body.object_path||"");
      const scheduledAt=String(body.scheduled_at||"");
      const caption=String(body.caption||"").slice(0,2200);
      const trialDay=String(body.trial_day||"").trim();
      const slotIndex=Math.max(0,Math.min(3,Number(body.slot_index||0)));
      const autoTime=body.auto_time!==false&&String(body.auto_time)!=="false";
      const fileName=String(body.file_name||"trial.mp4").slice(0,255);
      const mimeType=String(body.mime_type||"video/mp4").slice(0,120);
      const sizeBytes=Math.max(0,Number(body.size_bytes||0));
      if(!objectPath.startsWith(userData.user.id+"/trial/"))return json({error:"upload_path_invalid"},403);
      if(!scheduledAt||Number.isNaN(Date.parse(scheduledAt)))return json({error:"scheduled_at_invalid"},400);
      if(Date.parse(scheduledAt)<=Date.now()+30_000)return json({error:"scheduled_at_past",user_message:"Esse horário já passou ou está perto demais. Escolha um horário futuro."},400);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(trialDay))return json({error:"trial_day_invalid"},400);

      const {count,error:countError}=await admin.from("reel_test_publications")
        .select("id",{count:"exact",head:true}).eq("user_id",userData.user.id)
        .eq("trial_kind","overnight").is("hidden_at",null).contains("meta",{trial_day:trialDay});
      if(countError)throw countError;
      if(Number(count||0)>=4){
        await storageDeletePaths(admin,"r2",[objectPath]).catch(()=>null);
        return json({error:"trial_night_full",user_message:"Esta madrugada já tem 4 Reels teste agendados."},409);
      }

      const {count:slotCount,error:slotCountError}=await admin.from("reel_test_publications")
        .select("id",{count:"exact",head:true}).eq("user_id",userData.user.id)
        .eq("trial_kind","overnight").is("hidden_at",null).eq("slot_index",slotIndex)
        .contains("meta",{trial_day:trialDay});
      if(slotCountError)throw slotCountError;
      if(Number(slotCount||0)>0){
        await storageDeletePaths(admin,"r2",[objectPath]).catch(()=>null);
        return json({
          error:"trial_slot_occupied",
          user_message:"Esse Reel teste já foi agendado. Atualize a tela."
        },409);
      }

      const cfg=await getCloudentR2Config(admin);
      if(!cfg)return json({error:"r2_not_configured"},409);
      const headUrl=await r2PresignedUrl(cfg,"HEAD",objectPath,300);
      const head=await fetch(headUrl,{method:"HEAD"});
      if(!head.ok)return json({error:"r2_object_missing",user_message:"O upload do Trial para o R2 não foi confirmado.",status:head.status},409);
      const storedBytes=Number(head.headers.get("content-length")||0);
      if(sizeBytes>0&&storedBytes>0&&storedBytes!==sizeBytes){
        await storageDeletePaths(admin,"r2",[objectPath]).catch(()=>null);
        return json({error:"r2_size_mismatch",user_message:"O arquivo do Trial não terminou de enviar corretamente."},409);
      }

      const {data:row,error:insertError}=await admin.from("reel_test_publications").insert({
        user_id:userData.user.id,storage_path:objectPath,storage_provider:"r2",file_name:fileName,caption,
        share_to_feed:false,is_trial:true,graduation_strategy:"manual",status:"scheduled",
        scheduled_at:scheduledAt,next_attempt_at:scheduledAt,slot_index:slotIndex,auto_time:autoTime,
        hidden_at:null,trial_kind:"overnight",linked_schedule_id:null,source_video_id:null,shared_storage:false,
        cover_offset_ms:3500,cover_strategy:"auto_after_3s",
        meta:{source:"trial_reels_tab",trial_kind:"overnight",true_trial_requested:true,trial_day:trialDay,trial_number:slotIndex+1,
          original_size_bytes:storedBytes||sizeBytes,mime_type:mimeType}
      }).select().single();
      if(insertError){
        await storageDeletePaths(admin,"r2",[objectPath]).catch(()=>null);
        if(String((insertError as any)?.code||"")==="23505"){
          return json({error:"trial_slot_occupied",user_message:"Esse Reel teste já foi agendado. Atualize a tela."},409);
        }
        throw insertError;
      }
      await admin.from("activity_logs").insert({
        level:"info",event_type:"trial_reel_scheduled",message:"Reel teste enviado direto ao R2 e agendado",
        meta:{trial_publication_id:row.id,scheduled_at:scheduledAt,user_id:userData.user.id,storage_provider:"r2"}
      });
      return json({ok:true,item:row},201);
    }

    if (req.method === "POST" && action === "trial-upload") {
      const form=await req.formData();
      const file=form.get("file");
      const scheduledAt=String(form.get("scheduled_at")||"");
      const caption=String(form.get("caption")||"").slice(0,2200);
      const trialDay=String(form.get("trial_day")||"").trim();
      const slotIndex=Math.max(0,Math.min(3,Number(form.get("slot_index")||0)));
      const autoTime=String(form.get("auto_time")||"true")!=="false";

      if(!(file instanceof File))return json({error:"file_required"},400);
      if(!scheduledAt||Number.isNaN(Date.parse(scheduledAt)))return json({error:"scheduled_at_invalid"},400);
      if(Date.parse(scheduledAt)<=Date.now()+30_000)return json({error:"scheduled_at_past",user_message:"Esse horário já passou ou está perto demais. Escolha um horário futuro."},400);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(trialDay))return json({error:"trial_day_invalid"},400);

      const {count:nightCount,error:nightCountError}=await admin.from("reel_test_publications")
        .select("id",{count:"exact",head:true})
        .eq("user_id",userData.user.id)
        .eq("trial_kind","overnight")
        .is("hidden_at",null)
        .contains("meta",{trial_day:trialDay});
      if(nightCountError)throw nightCountError;
      if(Number(nightCount||0)>=4)return json({error:"trial_night_full",user_message:"Esta madrugada já tem 4 Reels teste agendados."},409);

      const {count:slotCount,error:slotCountError}=await admin.from("reel_test_publications")
        .select("id",{count:"exact",head:true})
        .eq("user_id",userData.user.id)
        .eq("trial_kind","overnight")
        .is("hidden_at",null)
        .eq("slot_index",slotIndex)
        .contains("meta",{trial_day:trialDay});
      if(slotCountError)throw slotCountError;
      if(Number(slotCount||0)>0)return json({
        error:"trial_slot_occupied",
        user_message:"Esse Reel teste já foi agendado. Atualize a tela."
      },409);

      const rawExt=file.name.includes(".")?String(file.name.split(".").pop()||"mp4").toLowerCase():"mp4";
      const ext=/^(mp4|mov|m4v|webm)$/.test(rawExt)?rawExt:"mp4";
      const objectPath=userData.user.id+"/trial/"+new Date().toISOString().slice(0,10)+"/"+crypto.randomUUID()+"."+ext;

      const {error:uploadError}=await admin.storage.from("videos").upload(objectPath,file,{
        contentType:file.type||"video/mp4",
        upsert:false
      });
      if(uploadError)throw uploadError;

      const {data:row,error:insertError}=await admin.from("reel_test_publications").insert({
        user_id:userData.user.id,
        storage_path:objectPath,
        file_name:file.name,
        caption,
        share_to_feed:false,
        is_trial:true,
        graduation_strategy:"manual",
        status:"scheduled",
        scheduled_at:scheduledAt,
        next_attempt_at:scheduledAt,
        slot_index:slotIndex,
        auto_time:autoTime,
        hidden_at:null,
        trial_kind:"overnight",
        linked_schedule_id:null,
        source_video_id:null,
        shared_storage:false,
        cover_offset_ms:3500,
        cover_strategy:"auto_after_3s",
        meta:{source:"trial_reels_tab",trial_kind:"overnight",true_trial_requested:true,trial_day:trialDay,trial_number:slotIndex+1}
      }).select().single();

      if(insertError){
        await admin.storage.from("videos").remove([objectPath]);
        if(String((insertError as any)?.code||"")==="23505"){
          return json({error:"trial_slot_occupied",user_message:"Esse Reel teste já foi agendado. Atualize a tela."},409);
        }
        throw insertError;
      }

      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"trial_reel_scheduled",
        message:"Reel teste agendado na aba dedicada",
        meta:{trial_publication_id:row.id,scheduled_at:scheduledAt,user_id:userData.user.id}
      });

      return json({ok:true,item:row},201);
    }

    if (req.method === "PATCH" && action === "trial-retry") {
      const body=await req.json();
      const id=String(body.id||"");
      if(!id)return json({error:"id_required"},400);

      const {data:row,error:readError}=await admin.from("reel_test_publications")
        .select("id,status,scheduled_at").eq("id",id).eq("user_id",userData.user.id).maybeSingle();
      if(readError)throw readError;
      if(!row)return json({error:"trial_reel_not_found"},404);
      if(row.status==="published")return json({error:"trial_reel_already_published"},409);

      const next=new Date(Math.max(Date.now(),Date.parse(row.scheduled_at||new Date().toISOString()))).toISOString();
      const {error:updateError}=await admin.from("reel_test_publications").update({
        status:"scheduled",
        container_id:null,
        attempt_count:0,
        next_attempt_at:next,
        locked_at:null,
        locked_by:null,
        last_error:null,
        updated_at:new Date().toISOString()
      }).eq("id",id).eq("user_id",userData.user.id);
      if(updateError)throw updateError;

      return json({ok:true});
    }

    if (req.method === "DELETE" && action === "trial-reel") {
      const body=await req.json();
      const id=String(body.id||"");
      if(!id)return json({error:"id_required"},400);

      const {data:row,error:readError}=await admin.from("reel_test_publications")
        .select("id,status,storage_path,original_storage_path,storage_provider,storage_deleted_at")
        .eq("id",id).eq("user_id",userData.user.id).maybeSingle();
      if(readError)throw readError;
      if(!row)return json({error:"trial_reel_not_found"},404);
      if(["processing","container_created"].includes(String(row.status)))return json({error:"trial_reel_processing"},409);
      if(row.status==="published")return json({error:"trial_reel_history_preserved"},409);

      if(!row.storage_deleted_at){
        const removePaths=[row.storage_path,row.original_storage_path].filter((x:any,i:number,a:any[])=>x&&a.indexOf(x)===i).map(String);
        if(removePaths.length)await storageDeletePaths(admin,String(row.storage_provider||"supabase"),removePaths);
      }
      const {error:deleteError}=await admin.from("reel_test_publications")
        .delete().eq("id",id).eq("user_id",userData.user.id);
      if(deleteError)throw deleteError;

      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"trial_reel_removed",
        message:"Trial Reel não publicado removido",
        meta:{trial_publication_id:id,user_id:userData.user.id}
      });
      return json({ok:true});
    }


    if (req.method === "GET" && resource === "x-app-config") {
      const {data:integration,error}=await admin.from("integrations")
        .select("enabled,account_label,config,last_verified_at")
        .eq("provider","x").maybeSingle();
      if(error)throw error;
      const cfg:any=integration?.config||{};
      const {count:connectedAccounts,error:countError}=await admin.from("platform_accounts")
        .select("id",{count:"exact",head:true}).eq("platform","x").eq("enabled",true);
      if(countError)throw countError;

      return json({
        ok:true,
        configured:!!(cfg.clientIdCipher&&cfg.clientIdIv&&cfg.clientSecretCipher&&cfg.clientSecretIv),
        callback_url:supabaseUrl+"/functions/v1/cloudent-x-oauth?action=callback",
        connected_accounts:Number(connectedAccounts||0),
        account_label:integration?.account_label||null,
        last_verified_at:integration?.last_verified_at||null,
        oauth_mode:"oauth2_pkce",
        scopes:["tweet.read","tweet.write","users.read","media.write","offline.access"]
      });
    }

    if (req.method === "PATCH" && action === "x-app-config") {
      const body=await req.json();
      const clientId=String(body.client_id||"").trim();
      const clientSecret=String(body.client_secret||"").trim();
      if(clientId.length<8)return json({error:"x_client_id_invalid",user_message:"Cole o Client ID OAuth 2.0 do App X."},400);

      const {data:existing,error:existingError}=await admin.from("integrations")
        .select("config,enabled,account_label,external_account_id,last_verified_at")
        .eq("provider","x").maybeSingle();
      if(existingError)throw existingError;

      const current:any=existing?.config||{};
      const {data:master,error:masterError}=await admin.rpc("get_cloudent_worker_secret");
      if(masterError||!master)throw masterError||new Error("worker_secret_missing");

      const encId=await runninghubEncrypt(clientId,String(master));
      let secretCipher=String(current.clientSecretCipher||"");
      let secretIv=String(current.clientSecretIv||"");
      if(clientSecret){
        if(clientSecret.length<8)return json({error:"x_client_secret_invalid",user_message:"Cole o Client Secret OAuth 2.0 do App X."},400);
        const encSecret=await runninghubEncrypt(clientSecret,String(master));
        secretCipher=encSecret.cipher;
        secretIv=encSecret.iv;
      }
      if(!secretCipher||!secretIv){
        return json({error:"x_client_secret_required",user_message:"Cole o Client Secret na primeira configuração."},400);
      }

      const {count:connectedAccounts}=await admin.from("platform_accounts")
        .select("id",{count:"exact",head:true}).eq("platform","x").eq("enabled",true);

      const now=new Date().toISOString();
      const cfg:any={
        ...current,
        status:Number(connectedAccounts||0)>0?"connected":"configured",
        oauth_mode:"oauth2_pkce",
        clientIdCipher:encId.cipher,
        clientIdIv:encId.iv,
        clientSecretCipher:secretCipher,
        clientSecretIv:secretIv,
        callback_url:supabaseUrl+"/functions/v1/cloudent-x-oauth?action=callback",
        scopes:["tweet.read","tweet.write","users.read","media.write","offline.access"],
        connected_accounts:Number(connectedAccounts||0),
        configured_at:current.configured_at||now,
        updated_at:now
      };

      const {error:upsertError}=await admin.from("integrations").upsert({
        provider:"x",
        enabled:Number(connectedAccounts||0)>0,
        account_label:Number(connectedAccounts||0)>0?("X · "+Number(connectedAccounts||0)+" conta(s)"):"X API configurada",
        external_account_id:Number(connectedAccounts||0)>0?"multi":null,
        config:cfg,
        updated_at:now
      },{onConflict:"provider"});
      if(upsertError)throw upsertError;

      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"x_app_configured",
        message:"App OAuth 2.0 do X configurado",
        meta:{user_id:userData.user.id,oauth_mode:"oauth2_pkce"}
      });

      return json({
        ok:true,
        configured:true,
        callback_url:cfg.callback_url,
        scopes:cfg.scopes
      });
    }

    if (req.method === "GET" && resource === "x-warmup") {
      const [{data:setting,error:settingError},{data:integration,error:intError},{data:accounts,error:accountsError}] = await Promise.all([
        admin.from("app_settings").select("value").eq("key","x_warmup").maybeSingle(),
        admin.from("integrations").select("enabled,account_label,config,last_verified_at").eq("provider","x").maybeSingle(),
        admin.from("x_warmup_accounts")
          .select("id,platform_account_id,label,username,external_user_id,status,current_day,started_at,day_started_at,paused_at,approved_at,last_action_at,last_error,approval_note,settings,created_at,updated_at")
          .eq("user_id",userData.user.id).order("created_at",{ascending:true})
      ]);
      if(settingError)throw settingError;
      if(intError)throw intError;
      if(accountsError)throw accountsError;
      const ids=(accounts||[]).map((x:any)=>x.id);
      let days:any[]=[];
      let actions:any[]=[];
      if(ids.length){
        const [{data:dayRows,error:dayError},{data:actionRows,error:actionError}] = await Promise.all([
          admin.from("x_warmup_days")
            .select("id,warmup_account_id,day_number,status,started_at,completed_at,summary,created_at,updated_at")
            .in("warmup_account_id",ids).order("day_number",{ascending:true}),
          admin.from("x_warmup_actions")
            .select("id,warmup_account_id,day_number,action_type,target_post_id,target_user_id,text_content,scheduled_at,status,attempts,max_attempts,last_error,result,meta,completed_at,created_at,updated_at")
            .in("warmup_account_id",ids).order("created_at",{ascending:true})
        ]);
        if(dayError)throw dayError;
        if(actionError)throw actionError;
        days=dayRows||[];
        actions=actionRows||[];
      }
      return json({
        ok:true,
        settings:setting?.value||{},
        plan:X_WARMUP_PLAN,
        connection:{
          enabled:!!integration?.enabled,
          account_label:integration?.account_label||null,
          configured:!!integration?.config?.clientConfigured,
          last_verified_at:integration?.last_verified_at||null
        },
        accounts:(accounts||[]).map((a:any)=>({
          ...a,
          days:days.filter((d:any)=>d.warmup_account_id===a.id),
          actions:actions.filter((d:any)=>d.warmup_account_id===a.id)
        }))
      });
    }

    if (req.method === "POST" && action === "x-warmup-account") {
      const body=await req.json();
      const {count,error:countError}=await admin.from("x_warmup_accounts")
        .select("id",{count:"exact",head:true}).eq("user_id",userData.user.id);
      if(countError)throw countError;
      if(Number(count||0)>=5)return json({error:"x_warmup_account_limit",user_message:"O aquecimento está limitado a 5 contas por enquanto."},409);

      const label=String(body.label||body.username||("Conta X "+(Number(count||0)+1))).trim().slice(0,80);
      const username=String(body.username||"").trim().replace(/^@/,"").slice(0,50)||null;
      const startImmediately=body.start_immediately!==false;
      const now=new Date().toISOString();
      const {data:account,error:insertError}=await admin.from("x_warmup_accounts").insert({
        user_id:userData.user.id,
        label,
        username,
        status:startImmediately?"warming":"draft",
        current_day:1,
        started_at:startImmediately?now:null,
        day_started_at:startImmediately?now:null,
        settings:{plan_version:"pdf_7_day_v1",auto_execute:true}
      }).select().single();
      if(insertError)throw insertError;

      const days=X_WARMUP_PLAN.map((p:any)=>({
        user_id:userData.user.id,
        warmup_account_id:account.id,
        day_number:p.day,
        status:p.day===1&&startImmediately?"active":"pending",
        started_at:p.day===1&&startImmediately?now:null,
        summary:{title:p.title,...p.summary}
      }));
      const {error:daysError}=await admin.from("x_warmup_days").insert(days);
      if(daysError){
        await admin.from("x_warmup_accounts").delete().eq("id",account.id);
        throw daysError;
      }
      await admin.from("activity_logs").insert({
        level:"info",event_type:"x_warmup_account_created",message:"Conta adicionada à esteira de aquecimento do X",
        meta:{user_id:userData.user.id,warmup_account_id:account.id,username}
      });
      return json({ok:true,account},201);
    }

    if (req.method === "POST" && action === "x-warmup-connect-account") {
      const body=await req.json();
      const id=String(body.id||"");
      const externalUserId=String(body.external_user_id||"").trim();
      const accessToken=String(body.access_token||"").trim();
      const accountLabel=String(body.account_label||body.username||"Conta X").trim().slice(0,80);
      const username=String(body.username||"").trim().replace(/^@/,"").slice(0,50)||null;
      if(!id)return json({error:"id_required"},400);
      if(!/^\d{3,30}$/.test(externalUserId))return json({error:"x_user_id_invalid",user_message:"Informe o User ID numérico da conta X."},400);
      if(accessToken.length<20)return json({error:"x_access_token_invalid",user_message:"Cole um User Access Token válido do X."},400);

      const {data:warm,error:warmError}=await admin.from("x_warmup_accounts")
        .select("id,platform_account_id,label,username").eq("id",id).eq("user_id",userData.user.id).maybeSingle();
      if(warmError)throw warmError;
      if(!warm)return json({error:"x_warmup_account_not_found"},404);

      const {data:master,error:masterError}=await admin.rpc("get_cloudent_worker_secret");
      if(masterError||!master)throw masterError||new Error("worker_secret_missing");
      const encrypted=await runninghubEncrypt(accessToken,String(master));
      const now=new Date().toISOString();

      let current:any=null;
      if(warm.platform_account_id){
        const {data,error}=await admin.from("platform_accounts").select("id,config")
          .eq("id",warm.platform_account_id).eq("platform","x").maybeSingle();
        if(error)throw error;
        current=data;
      }
      if(!current){
        const {data,error}=await admin.from("platform_accounts").select("id,config")
          .eq("platform","x").eq("external_account_id",externalUserId).maybeSingle();
        if(error)throw error;
        current=data;
      }

      const cfg:any={
        ...(current?.config||{}),
        status:"connected",
        api_mode:"oauth2_user_token",
        accessTokenCipher:encrypted.cipher,
        accessTokenIv:encrypted.iv,
        owner_user_id:userData.user.id,
        warmup_account_id:id,
        connected_at:now
      };

      let platformAccount:any=null;
      if(current?.id){
        const {data,error}=await admin.from("platform_accounts").update({
          external_account_id:externalUserId,
          account_label:accountLabel,
          enabled:true,
          config:cfg,
          updated_at:now
        }).eq("id",current.id).select().single();
        if(error)throw error;
        platformAccount=data;
      }else{
        const {data,error}=await admin.from("platform_accounts").insert({
          platform:"x",
          external_account_id:externalUserId,
          account_label:accountLabel,
          enabled:true,
          config:cfg
        }).select().single();
        if(error)throw error;
        platformAccount=data;
      }

      const {error:warmUpdateError}=await admin.from("x_warmup_accounts").update({
        platform_account_id:platformAccount.id,
        external_user_id:externalUserId,
        username:username||warm.username,
        last_error:null,
        updated_at:now
      }).eq("id",id).eq("user_id",userData.user.id);
      if(warmUpdateError)throw warmUpdateError;

      await admin.from("x_warmup_actions").update({status:"queued",updated_at:now})
        .eq("warmup_account_id",id).eq("user_id",userData.user.id).eq("status","waiting_connection");

      const {count:connectedCount}=await admin.from("platform_accounts")
        .select("id",{count:"exact",head:true}).eq("platform","x").eq("enabled",true);
      const {error:intUpsertError}=await admin.from("integrations").upsert({
        provider:"x",
        enabled:true,
        account_label:"X · "+Number(connectedCount||1)+" conta(s)",
        external_account_id:"multi",
        config:{status:"connected",multi_account:true,clientConfigured:true,connected_accounts:Number(connectedCount||1)},
        last_verified_at:now,
        updated_at:now
      },{onConflict:"provider"});
      if(intUpsertError)throw intUpsertError;

      await admin.from("activity_logs").insert({
        level:"info",event_type:"x_account_connected",message:"Conta X conectada à esteira",
        meta:{user_id:userData.user.id,warmup_account_id:id,platform_account_id:platformAccount.id,external_user_id:externalUserId}
      });

      return json({
        ok:true,
        account:{id,platform_account_id:platformAccount.id,external_user_id:externalUserId,username:username||warm.username},
        connection:{enabled:true}
      });
    }

    if (req.method === "POST" && action === "x-warmup-action") {
      const body=await req.json();
      const accountId=String(body.account_id||"");
      const dayNumber=Math.max(1,Math.min(7,Number(body.day_number)||1));
      const actionType=String(body.action_type||"");
      const allowed=["observe","like","follow","reply","post","active_window"];
      if(!accountId)return json({error:"account_id_required"},400);
      if(!allowed.includes(actionType))return json({error:"x_warmup_action_invalid"},400);

      const {data:account,error:accountError}=await admin.from("x_warmup_accounts")
        .select("id,status,current_day").eq("id",accountId).eq("user_id",userData.user.id).maybeSingle();
      if(accountError)throw accountError;
      if(!account)return json({error:"x_warmup_account_not_found"},404);

      const targetPostId=String(body.target_post_id||"").trim()||null;
      const targetUserId=String(body.target_user_id||"").trim()||null;
      const textContent=String(body.text_content||"").trim().slice(0,280)||null;
      if(actionType==="like"&&!targetPostId)return json({error:"target_post_id_required"},400);
      if(actionType==="follow"&&!targetUserId)return json({error:"target_user_id_required"},400);
      if(actionType==="reply"&&(!targetPostId||!textContent))return json({error:"reply_target_and_text_required"},400);
      if(actionType==="post"&&!textContent)return json({error:"post_text_required"},400);

      const scheduledAt=body.scheduled_at?String(body.scheduled_at):new Date().toISOString();
      if(Number.isNaN(Date.parse(scheduledAt)))return json({error:"scheduled_at_invalid"},400);
      const {data:xIntegration,error:intError}=await admin.from("integrations")
        .select("enabled").eq("provider","x").maybeSingle();
      if(intError)throw intError;

      const {data:item,error:insertError}=await admin.from("x_warmup_actions").insert({
        user_id:userData.user.id,
        warmup_account_id:accountId,
        day_number:dayNumber,
        action_type:actionType,
        target_post_id:targetPostId,
        target_user_id:targetUserId,
        text_content:textContent,
        scheduled_at:scheduledAt,
        status:xIntegration?.enabled?"queued":"waiting_connection",
        meta:{source:"x_warmup",programmed:true}
      }).select().single();
      if(insertError)throw insertError;
      return json({ok:true,item},201);
    }

    if (req.method === "PATCH" && action === "x-warmup-account") {
      const body=await req.json();
      const id=String(body.id||"");
      const op=String(body.operation||"");
      if(!id)return json({error:"id_required"},400);
      const {data:account,error:readError}=await admin.from("x_warmup_accounts")
        .select("id,status,current_day,started_at").eq("id",id).eq("user_id",userData.user.id).maybeSingle();
      if(readError)throw readError;
      if(!account)return json({error:"x_warmup_account_not_found"},404);
      const now=new Date().toISOString();

      if(op==="start"){
        await admin.from("x_warmup_accounts").update({
          status:"warming",started_at:account.started_at||now,day_started_at:now,paused_at:null,updated_at:now
        }).eq("id",id).eq("user_id",userData.user.id);
        await admin.from("x_warmup_days").update({status:"active",started_at:now,updated_at:now})
          .eq("warmup_account_id",id).eq("day_number",account.current_day);
      }else if(op==="pause"){
        await admin.from("x_warmup_accounts").update({status:"paused",paused_at:now,updated_at:now})
          .eq("id",id).eq("user_id",userData.user.id);
        await admin.from("x_warmup_days").update({status:"paused",updated_at:now})
          .eq("warmup_account_id",id).eq("day_number",account.current_day).eq("status","active");
      }else if(op==="resume"){
        await admin.from("x_warmup_accounts").update({status:"warming",paused_at:null,day_started_at:now,updated_at:now})
          .eq("id",id).eq("user_id",userData.user.id);
        await admin.from("x_warmup_days").update({status:"active",updated_at:now})
          .eq("warmup_account_id",id).eq("day_number",account.current_day);
      }else if(op==="complete_day"){
        const {data:dayActions,error:actionError}=await admin.from("x_warmup_actions")
          .select("id,status").eq("warmup_account_id",id).eq("day_number",account.current_day);
        if(actionError)throw actionError;
        if(!(dayActions||[]).length)return json({error:"x_warmup_day_without_actions",user_message:"Programe as ações deste dia antes de concluí-lo."},409);
        const pending=(dayActions||[]).filter((x:any)=>!["completed","skipped"].includes(String(x.status)));
        if(pending.length)return json({error:"x_warmup_day_actions_pending",user_message:"Ainda existem ações pendentes neste dia.",pending:pending.length},409);
        await admin.from("x_warmup_days").update({status:"completed",completed_at:now,updated_at:now})
          .eq("warmup_account_id",id).eq("day_number",account.current_day);
        if(account.current_day<7){
          const next=account.current_day+1;
          await admin.from("x_warmup_accounts").update({current_day:next,status:"warming",day_started_at:now,updated_at:now})
            .eq("id",id).eq("user_id",userData.user.id);
          await admin.from("x_warmup_days").update({status:"active",started_at:now,updated_at:now})
            .eq("warmup_account_id",id).eq("day_number",next);
        }else{
          await admin.from("x_warmup_accounts").update({status:"review",updated_at:now})
            .eq("id",id).eq("user_id",userData.user.id);
        }
      }else if(op==="approve"){
        if(account.status!=="review")return json({error:"x_warmup_not_ready_for_approval"},409);
        await admin.from("x_warmup_accounts").update({status:"approved",approved_at:now,approval_note:String(body.note||"").slice(0,500)||null,updated_at:now})
          .eq("id",id).eq("user_id",userData.user.id);
      }else{
        return json({error:"x_warmup_operation_invalid"},400);
      }
      const {data:updated,error:updateReadError}=await admin.from("x_warmup_accounts")
        .select("*").eq("id",id).eq("user_id",userData.user.id).single();
      if(updateReadError)throw updateReadError;
      return json({ok:true,account:updated});
    }

    if (req.method === "PATCH" && action === "x-warmup-action") {
      const body=await req.json();
      const id=String(body.id||"");
      if(!id)return json({error:"id_required"},400);
      const patch:any={updated_at:new Date().toISOString()};
      if(body.scheduled_at!==undefined){
        if(Number.isNaN(Date.parse(String(body.scheduled_at))))return json({error:"scheduled_at_invalid"},400);
        patch.scheduled_at=String(body.scheduled_at);
      }
      if(body.target_post_id!==undefined)patch.target_post_id=String(body.target_post_id||"").trim()||null;
      if(body.target_user_id!==undefined)patch.target_user_id=String(body.target_user_id||"").trim()||null;
      if(body.text_content!==undefined)patch.text_content=String(body.text_content||"").trim().slice(0,280)||null;
      if(body.status!==undefined&&["queued","waiting_connection","skipped"].includes(String(body.status)))patch.status=String(body.status);
      const {data:item,error:updateError}=await admin.from("x_warmup_actions").update(patch)
        .eq("id",id).eq("user_id",userData.user.id).select().maybeSingle();
      if(updateError)throw updateError;
      if(!item)return json({error:"x_warmup_action_not_found"},404);
      return json({ok:true,item});
    }

    if (req.method === "DELETE" && action === "x-warmup-action") {
      const body=await req.json();
      const id=String(body.id||"");
      if(!id)return json({error:"id_required"},400);
      const {error}=await admin.from("x_warmup_actions").delete().eq("id",id).eq("user_id",userData.user.id);
      if(error)throw error;
      return json({ok:true});
    }

    if (req.method === "DELETE" && action === "x-warmup-account") {
      const body=await req.json();
      const id=String(body.id||"");
      if(!id)return json({error:"id_required"},400);
      const {error}=await admin.from("x_warmup_accounts").delete().eq("id",id).eq("user_id",userData.user.id);
      if(error)throw error;
      return json({ok:true});
    }

    if (req.method === "GET" && resource === "notifications") {
      const compactNotifications=url.searchParams.get("compact")==="1";
      if(compactNotifications){
        const [{count:unread,error:unreadError},{count:subscriptions,error:subsCountError},{data:worker,error:workerError}]=await Promise.all([
          admin.from("system_notifications")
            .select("id",{count:"exact",head:true})
            .eq("user_id",userData.user.id).neq("status","read"),
          admin.from("push_subscriptions")
            .select("id",{count:"exact",head:true})
            .eq("user_id",userData.user.id).eq("enabled",true),
          admin.from("worker_runtime")
            .select("worker_name,last_heartbeat,last_success_at,last_error,last_jobs,updated_at")
            .eq("worker_name","notifications").maybeSingle()
        ]);
        if(unreadError)throw unreadError;
        if(subsCountError)throw subsCountError;
        if(workerError)throw workerError;
        const now=Date.now();
        const normalizedWorker=worker?{
          ...worker,
          online:!!worker.last_heartbeat&&new Date(worker.last_heartbeat).getTime()>now-3*60*1000
        }:null;
        return json({
          ok:true,compact:true,settings:{},items:[],
          unread:Number(unread||0),subscriptions:Number(subscriptions||0),
          worker:normalizedWorker
        });
      }

      const [{data:setting,error:settingError},{data:items,error:itemsError},{data:subs,error:subsError},{data:worker,error:workerError},{count:unread,error:unreadError}] = await Promise.all([
        admin.from("app_settings").select("value").eq("key","push_notifications").maybeSingle(),
        admin.from("system_notifications")
          .select("id,severity,category,title,body,status,sent_at,read_at,last_error,meta,created_at,updated_at")
          .eq("user_id",userData.user.id).order("created_at",{ascending:false}).limit(80),
        admin.from("push_subscriptions")
          .select("id,enabled,last_success_at,last_error,created_at,updated_at")
          .eq("user_id",userData.user.id).order("created_at",{ascending:false}),
        admin.from("worker_runtime")
          .select("worker_name,last_heartbeat,last_success_at,last_error,last_jobs,updated_at")
          .eq("worker_name","notifications").maybeSingle(),
        admin.from("system_notifications").select("id",{count:"exact",head:true}).eq("user_id",userData.user.id).neq("status","read")
      ]);
      if(settingError)throw settingError;
      if(itemsError)throw itemsError;
      if(subsError)throw subsError;
      if(workerError)throw workerError;
      const now=Date.now();
      const normalizedWorker=worker?{
        ...worker,
        online:!!worker.last_heartbeat&&new Date(worker.last_heartbeat).getTime()>now-3*60*1000
      }:null;
      if(unreadError)throw unreadError;
      const rows=items||[];
      return json({
        ok:true,
        settings:setting?.value||{},
        items:rows,
        unread:Number(unread||0),
        subscriptions:(subs||[]).filter((x:any)=>x.enabled).length,
        worker:normalizedWorker
      });
    }

    if (req.method === "POST" && action === "push-subscribe") {
      const body=await req.json();
      const endpoint=String(body.endpoint||"").trim();
      const p256dh=String(body.keys?.p256dh||body.p256dh||"").trim();
      const auth=String(body.keys?.auth||body.auth||"").trim();
      const expirationTime=body.expirationTime===null||body.expirationTime===undefined?null:Number(body.expirationTime);
      if(!endpoint.startsWith("https://"))return json({error:"push_endpoint_invalid"},400);
      if(p256dh.length<20||auth.length<8)return json({error:"push_keys_invalid"},400);

      const now=new Date().toISOString();
      const {data:subscription,error:subError}=await admin.from("push_subscriptions").upsert({
        user_id:userData.user.id,
        endpoint,p256dh,auth,
        expiration_time:Number.isFinite(expirationTime)?expirationTime:null,
        user_agent:String(req.headers.get("user-agent")||"").slice(0,500)||null,
        enabled:true,last_error:null,updated_at:now
      },{onConflict:"endpoint"}).select("id,enabled,created_at,updated_at").single();
      if(subError)throw subError;

      const woke=await wakeNotificationWorker(admin,supabaseUrl);
      return json({ok:true,subscription,worker_woken:woke});
    }

    if (req.method === "DELETE" && action === "push-subscribe") {
      const body=await req.json();
      const endpoint=String(body.endpoint||"").trim();
      if(!endpoint)return json({error:"push_endpoint_required"},400);
      const {error}=await admin.from("push_subscriptions").update({
        enabled:false,updated_at:new Date().toISOString()
      }).eq("endpoint",endpoint).eq("user_id",userData.user.id);
      if(error)throw error;
      return json({ok:true});
    }

    if (req.method === "PATCH" && action === "notification-read") {
      const body=await req.json();
      const now=new Date().toISOString();
      let query=admin.from("system_notifications").update({
        status:"read",read_at:now,updated_at:now
      }).eq("user_id",userData.user.id);
      if(body.all===true){
        query=query.neq("status","read");
      }else{
        const id=String(body.id||"");
        if(!id)return json({error:"notification_id_required"},400);
        query=query.eq("id",id);
      }
      const {error}=await query;
      if(error)throw error;
      return json({ok:true});
    }

    if (req.method === "POST" && action === "notification-test") {
      const now=new Date().toISOString();
      const {data:item,error}=await admin.from("system_notifications").insert({
        user_id:userData.user.id,
        severity:"error",
        category:"test",
        title:"Teste de erro",
        body:"Alerta de erro funcionando.",
        dedupe_key:"test:"+crypto.randomUUID(),
        meta:{source:"manual_error_test",requested_at:now}
      }).select("id,status,created_at").single();
      if(error)throw error;
      const woke=await wakeNotificationWorker(admin,supabaseUrl);
      return json({ok:true,item,worker_woken:woke},201);
    }

    if (req.method === "GET" && resource === "platform-accounts") {
      const {data,error}=await admin.from("platform_accounts")
        .select("id,platform,external_account_id,account_label,enabled,config,created_at,updated_at")
        .order("created_at",{ascending:true});
      if(error)throw error;
      return json((data||[]).map((x:any)=>({
        id:x.id,
        platform:x.platform,
        external_account_id:x.external_account_id,
        account_label:x.account_label,
        enabled:!!x.enabled,
        config:{
          status:x.config?.status||null,
          api_mode:x.config?.api_mode||null,
          account_type:x.config?.account_type||null
        },
        created_at:x.created_at,
        updated_at:x.updated_at
      })));
    }

    if (req.method === "GET" && resource === "followers") {
      const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days") || 30)));
      const { data: integration, error: integrationError } = await admin
        .from("integrations")
        .select("external_account_id,account_label,enabled")
        .eq("provider","instagram")
        .maybeSingle();
      if (integrationError) throw integrationError;
      if (!integration?.enabled || !integration.external_account_id) {
        return json({ current:null, daily:[], worker:null });
      }

      const accountId = String(integration.external_account_id);
      const cutoff = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0,10);
      const [{ data: current, error: currentError }, { data: daily, error: dailyError }, { data: worker, error: workerError }] = await Promise.all([
        admin.from("instagram_follower_state")
          .select("account_id,followers_count,previous_count,delta_last,last_checked_at,last_change_at,updated_at")
          .eq("account_id",accountId).maybeSingle(),
        admin.from("instagram_follower_daily")
          .select("day,first_count,current_count,peak_count,low_count,net_change,updated_at")
          .eq("account_id",accountId).gte("day",cutoff).order("day",{ascending:true}),
        admin.from("worker_runtime")
          .select("worker_name,last_heartbeat,last_success_at,last_error,updated_at")
          .eq("worker_name","followers").maybeSingle()
      ]);
      if (currentError) throw currentError;
      if (dailyError) throw dailyError;
      if (workerError) throw workerError;

      const online = !!worker?.last_heartbeat && new Date(worker.last_heartbeat).getTime() > Date.now() - 3 * 60 * 1000;
      return json({
        account_label: integration.account_label || null,
        current: current || null,
        daily: daily || [],
        worker: worker ? { ...worker, online } : null
      });
    }

    if (req.method === "GET" && resource === "reel-detail") {
      const id = String(url.searchParams.get("id") || "").trim();
      if (!id) return json({error:"id_required"},400);

      const isUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
      let mediaQuery=admin.from("instagram_media")
        .select("id,ig_media_id,media_type,media_product_type,caption,permalink,thumbnail_url,media_url,posted_at,like_count,comments_count,raw,created_at,updated_at,platform_account_id");
      mediaQuery=isUuid?mediaQuery.eq("id",id):mediaQuery.eq("ig_media_id",id);
      const {data:media,error:mediaError}=await mediaQuery.maybeSingle();
      if(mediaError)throw mediaError;
      if(!media)return json({error:"reel_not_found"},404);
      const {data:account,error:accountError}=await admin.from("platform_accounts").select("id,account_label,config").eq("id",media.platform_account_id).maybeSingle();
      if(accountError)throw accountError;
      const {data:member,error:memberError}=await admin.from("app_members").select("role,enabled").eq("user_id",userData.user.id).maybeSingle();
      if(memberError)throw memberError;
      if(!account||!member?.enabled||(member.role!=="admin"&&account.config?.owner_user_id!==userData.user.id))return json({error:"reel_not_found"},404);
      media.account_label=account.account_label;


      const [{data:snapshots,error:snapError},{data:schedule,error:scheduleError}]=await Promise.all([
        admin.from("metrics_snapshots")
          .select("id,schedule_id,collected_at,views,reach,likes,comments,shares,saves,raw")
          .eq("instagram_media_record_id",media.id)
          .is("raw->>insights_error",null).order("collected_at",{ascending:true}),
        admin.from("schedules")
          .select("id,video_id,scheduled_at,published_at,status,smart_mode,smart_strategy,platform")
          .eq("instagram_media_id",media.ig_media_id)
          .order("published_at",{ascending:false}).limit(1).maybeSingle()
      ]);
      if(snapError)throw snapError;
      if(scheduleError)throw scheduleError;

      return json({media,schedule:schedule||null,snapshots:snapshots||[]});
    }

    if (req.method === "GET" && resource === "logs") {
      const logLimit=Math.max(10,Math.min(100,Number(url.searchParams.get("limit")||50)));
      const { data, error } = await admin.from("activity_logs")
        .select("id,created_at,level,event_type,message,meta")
        .order("created_at",{ascending:false})
        .limit(logLimit);
      if (error) throw error;
      return json(data || []);
    }


    if (req.method === "GET" && resource === "production") {
      const [{data:jobs,error:jobsError},{data:integration,error:intError},{data:worker,error:workerError}] = await Promise.all([
        admin.from("production_jobs")
          .select("id,storage_provider,original_file_name,original_mime_type,original_size_bytes,frame_file_name,frame_mime_type,frame_size_bytes,status,progress,runninghub_task_id,result_storage_path,result_video_id,credits_used,credits_before,credits_after,runninghub_cost_money,runninghub_third_party_cost_money,runninghub_runtime_seconds,attempt_count,max_attempts,started_at,completed_at,last_error,meta,created_at,updated_at")
          .eq("user_id",userData.user.id).is("hidden_at",null).order("created_at",{ascending:false}).limit(100),
        admin.from("integrations").select("enabled,account_label,config,last_verified_at,updated_at").eq("provider","runninghub").maybeSingle(),
        admin.from("worker_runtime").select("worker_name,last_heartbeat,last_success_at,last_error,last_jobs,updated_at").eq("worker_name","production").maybeSingle()
      ]);
      if(jobsError)throw jobsError;if(intError)throw intError;if(workerError)throw workerError;
      const raw:any=integration?.config||{};
      const config={
        workflowId:String(raw.workflowId||""),
        videoNodeId:String(raw.videoNodeId||""),
        videoFieldName:String(raw.videoFieldName||"video"),
        frameNodeId:String(raw.frameNodeId||""),
        frameFieldName:String(raw.frameFieldName||"image"),
        concurrency:Number(raw.concurrency||1),
        apiKeyConfigured:!!raw.apiKeyCipher
      };
      const online=!!worker?.last_heartbeat && new Date(worker.last_heartbeat).getTime()>Date.now()-3*60*1000;
      return json({
        jobs:jobs||[],
        integration:{enabled:!!integration?.enabled,account_label:integration?.account_label||"RunningHub",config},
        worker:worker?{...worker,online}:null
      });
    }


    if (req.method === "GET" && resource === "production-previews") {
      const {data:rows,error:rowsError}=await admin.from("production_jobs")
        .select("id,storage_provider,original_storage_path,frame_storage_path")
        .eq("user_id",userData.user.id)
        .is("hidden_at",null)
        .order("created_at",{ascending:false})
        .limit(30);
      if(rowsError)throw rowsError;

      const previews:Record<string,any>={};
      await Promise.all((rows||[]).map(async(row:any)=>{
        const provider=String(row.storage_provider||"supabase");
        const [original,frame]=await Promise.all([
          storageSignedGetBucket(admin,provider,row.original_storage_path,3600,"production").catch(()=>null),
          storageSignedGetBucket(admin,provider,row.frame_storage_path,3600,"production").catch(()=>null)
        ]);
        previews[row.id]={original:original||null,frame:frame||null};
      }));
      return json({previews,expires_in:3600});
    }

    if (req.method === "GET" && resource === "production-preview") {
      const id=String(url.searchParams.get("id")||"");
      const kind=String(url.searchParams.get("kind")||"result");
      if(!id)return json({error:"id_required"},400);
      const {data:job,error:jobError}=await admin.from("production_jobs")
        .select("id,user_id,storage_provider,original_storage_path,frame_storage_path,result_storage_path,result_video_id,meta")
        .eq("id",id).eq("user_id",userData.user.id).maybeSingle();
      if(jobError)throw jobError;if(!job)return json({error:"production_job_not_found"},404);

      let provider=String(job.storage_provider||"supabase");
      let bucket="production";
      let path=
        kind==="original"?job.original_storage_path:
        kind==="frame"?job.frame_storage_path:
        kind==="video-thumb"?String(job.meta?.original_thumbnail_path||""):
        kind==="frame-thumb"?String(job.meta?.frame_thumbnail_path||""):
        job.result_storage_path;

      if(kind==="result"&&job.result_video_id){
        const {data:video,error:videoError}=await admin.from("videos")
          .select("id,storage_path,storage_provider").eq("id",job.result_video_id).maybeSingle();
        if(videoError)throw videoError;
        if(video){
          path=video.storage_path;
          provider=String(video.storage_provider||"supabase");
        }
        bucket="videos";
      }
      if(!path)return json({error:"file_not_available"},404);
      const signedUrl=await storageSignedGetBucket(admin,provider,String(path),3600,bucket);
      return json({url:signedUrl,expires_in:3600,provider});
    }

    if (req.method === "GET" && resource === "production-download") {
      const id=String(url.searchParams.get("id")||"");
      const requestedName=String(url.searchParams.get("name")||"video-final.mp4");
      if(!id)return json({error:"id_required"},400);
      const {data:job,error:jobError}=await admin.from("production_jobs")
        .select("id,user_id,storage_provider,result_storage_path,result_video_id,result_url")
        .eq("id",id).eq("user_id",userData.user.id).maybeSingle();
      if(jobError)throw jobError;if(!job)return json({error:"production_job_not_found"},404);

      let provider=String(job.storage_provider||"supabase");
      let bucket="production";
      let path=String(job.result_storage_path||"");
      let mime="video/mp4";

      if(job.result_video_id){
        const {data:video,error:videoError}=await admin.from("videos")
          .select("id,storage_path,storage_provider,file_name,mime_type").eq("id",job.result_video_id).maybeSingle();
        if(videoError)throw videoError;
        if(video){
          path=String(video.storage_path||path);
          provider=String(video.storage_provider||provider);
          mime=String(video.mime_type||mime);
          bucket="videos";
        }
      }
      if(!path&&!job.result_url)return json({error:"file_not_available"},404);

      let upstream:Response|null=null;
      let storageStatus=0;
      if(path){
        try{
          const upstreamUrl=await storageSignedGetBucket(admin,provider,path,900,bucket);
          upstream=await fetch(upstreamUrl,{method:"GET"});
          storageStatus=upstream.status;
        }catch(e){
          console.error("production_download_storage_error",{id,provider,bucket,path,error:readableError(e)});
        }
      }

      // Recovery path: if the persisted object is missing but RunningHub's result
      // URL still works, serve it now and heal the storage copy for future access.
      if((!upstream||!upstream.ok)&&job.result_url){
        try{
          const source=await fetch(String(job.result_url));
          if(source.ok){
            const bytes=await source.arrayBuffer();
            const sourceMime=source.headers.get("content-type")||mime||"video/mp4";
            upstream=new Response(bytes,{status:200,headers:{"Content-Type":sourceMime,"Content-Length":String(bytes.byteLength)}});
            mime=sourceMime;

            if(path&&provider==="r2"){
              try{
                const cfg=await getCloudentR2Config(admin);
                if(cfg){
                  const putUrl=await r2PresignedUrl(cfg,"PUT",path,900);
                  const put=await fetch(putUrl,{method:"PUT",headers:{"Content-Type":sourceMime},body:bytes});
                  if(put.ok){
                    await admin.from("activity_logs").insert({
                      level:"warn",
                      event_type:"production_result_storage_repaired",
                      message:"Resultado do RunningHub foi restaurado no storage",
                      meta:{production_job_id:id,provider,path,previous_storage_status:storageStatus}
                    });
                  }else{
                    console.error("production_download_repair_put_failed",{id,status:put.status,path});
                  }
                }
              }catch(e){
                console.error("production_download_repair_failed",{id,path,error:readableError(e)});
              }
            }else if(path&&provider!=="r2"){
              try{
                const blob=new Blob([bytes],{type:sourceMime});
                await admin.storage.from(bucket).upload(path,blob,{contentType:sourceMime,upsert:true});
              }catch(e){
                console.error("production_download_supabase_repair_failed",{id,path,error:readableError(e)});
              }
            }
          }
        }catch(e){
          console.error("production_download_runninghub_fallback_failed",{id,error:readableError(e)});
        }
      }

      if(!upstream||!upstream.ok){
        let body="";
        try{body=await upstream?.text()||""}catch{}
        console.error("production_download_upstream_failed",{
          id,provider,bucket,path,status:upstream?.status||storageStatus,body:body.slice(0,500)
        });
        return json({
          error:"download_upstream_failed",
          user_message:"O vídeo final não está disponível no armazenamento e a cópia temporária do RunningHub também expirou.",
          status:upstream?.status||storageStatus||0
        },502);
      }

      const fileName=safeDownloadName(requestedName||"video-final.mp4");
      const headers:Record<string,string>={...cors};
      headers["Content-Type"]=upstream.headers.get("content-type")||mime||"video/mp4";
      headers["Content-Disposition"]='attachment; filename="'+fileName+'"';
      headers["Cache-Control"]="private, no-store";
      const length=upstream.headers.get("content-length");
      if(length)headers["Content-Length"]=length;
      return new Response(upstream.body,{status:200,headers});
    }

    if (req.method === "POST" && action === "production-upload-ticket") {
      const body=await req.json();
      const videoName=String(body.video_file_name||"video.mp4").slice(0,255);
      const videoMime=String(body.video_mime_type||"video/mp4").slice(0,120);
      const videoSize=Math.max(0,Number(body.video_size_bytes||0));
      const frameName=String(body.frame_file_name||"frame.jpg").slice(0,255);
      const frameMime=String(body.frame_mime_type||"image/jpeg").slice(0,120);
      const frameSize=Math.max(0,Number(body.frame_size_bytes||0));
      const hasVideoThumb=body.has_video_thumb===true;
      const hasFrameThumb=body.has_frame_thumb===true;
      if(!videoMime.startsWith("video/")||!videoSize)return json({error:"video_invalid"},400);
      if(!frameMime.startsWith("image/")||!frameSize)return json({error:"frame_invalid"},400);

      const cfg=await getCloudentR2Config(admin);
      if(!cfg)return json({ok:true,fallback:true,provider:"supabase"});

      const jobId=crypto.randomUUID();
      const day=new Date().toISOString().slice(0,10);
      const base=userData.user.id+"/production-inputs/"+day+"/"+jobId;
      const videoPath=base+"/original."+safeMediaExt(videoName,"mp4");
      const framePath=base+"/frame."+safeMediaExt(frameName,"jpg");
      const videoThumbPath=base+"/video-thumb.jpg";
      const frameThumbPath=base+"/frame-thumb.jpg";

      const [videoUrl,frameUrl,videoThumbUrl,frameThumbUrl]=await Promise.all([
        r2PresignedUrl(cfg,"PUT",videoPath,900,videoMime),
        r2PresignedUrl(cfg,"PUT",framePath,900,frameMime),
        hasVideoThumb?r2PresignedUrl(cfg,"PUT",videoThumbPath,900,"image/jpeg"):Promise.resolve(""),
        hasFrameThumb?r2PresignedUrl(cfg,"PUT",frameThumbPath,900,"image/jpeg"):Promise.resolve("")
      ]);
      return json({
        ok:true,fallback:false,provider:"r2",job_id:jobId,
        video:{path:videoPath,upload_url:videoUrl,content_type:videoMime},
        frame:{path:framePath,upload_url:frameUrl,content_type:frameMime},
        video_thumb:hasVideoThumb?{path:videoThumbPath,upload_url:videoThumbUrl,content_type:"image/jpeg"}:null,
        frame_thumb:hasFrameThumb?{path:frameThumbPath,upload_url:frameThumbUrl,content_type:"image/jpeg"}:null,
        expires_in:900
      });
    }

    if (req.method === "POST" && action === "production-upload-complete") {
      const body=await req.json();
      const jobId=String(body.job_id||"");
      const videoPath=String(body.video_path||"");
      const framePath=String(body.frame_path||"");
      const videoThumbPath=String(body.video_thumb_path||"");
      const frameThumbPath=String(body.frame_thumb_path||"");
      const videoName=String(body.video_file_name||"video.mp4").slice(0,255);
      const videoMime=String(body.video_mime_type||"video/mp4").slice(0,120);
      const videoSize=Math.max(0,Number(body.video_size_bytes||0));
      const frameName=String(body.frame_file_name||"frame.jpg").slice(0,255);
      const frameMime=String(body.frame_mime_type||"image/jpeg").slice(0,120);
      const frameSize=Math.max(0,Number(body.frame_size_bytes||0));
      const prefix=userData.user.id+"/production-inputs/";
      if(!jobId||!videoPath.startsWith(prefix)||!framePath.startsWith(prefix))return json({error:"production_upload_path_invalid"},403);
      if(!videoPath.includes("/"+jobId+"/")||!framePath.includes("/"+jobId+"/"))return json({error:"production_job_path_mismatch"},400);
      const cfg=await getCloudentR2Config(admin);
      if(!cfg)return json({error:"r2_not_configured"},409);

      const [videoHeadUrl,frameHeadUrl]=await Promise.all([
        r2PresignedUrl(cfg,"HEAD",videoPath,300),
        r2PresignedUrl(cfg,"HEAD",framePath,300)
      ]);
      const [videoHead,frameHead]=await Promise.all([
        fetch(videoHeadUrl,{method:"HEAD"}),fetch(frameHeadUrl,{method:"HEAD"})
      ]);
      if(!videoHead.ok||!frameHead.ok){
        return json({error:"production_r2_objects_missing",user_message:"Vídeo ou frame não terminou de enviar para o R2."},409);
      }
      const actualVideo=Number(videoHead.headers.get("content-length")||0);
      const actualFrame=Number(frameHead.headers.get("content-length")||0);
      if(videoSize&&actualVideo&&videoSize!==actualVideo)return json({error:"production_video_size_mismatch"},409);
      if(frameSize&&actualFrame&&frameSize!==actualFrame)return json({error:"production_frame_size_mismatch"},409);

      const thumbMeta:any={};
      if(videoThumbPath&&videoThumbPath.startsWith(prefix)&&videoThumbPath.includes("/"+jobId+"/")){
        if(await storageObjectExists(admin,"r2",videoThumbPath))thumbMeta.original_thumbnail_path=videoThumbPath;
      }
      if(frameThumbPath&&frameThumbPath.startsWith(prefix)&&frameThumbPath.includes("/"+jobId+"/")){
        if(await storageObjectExists(admin,"r2",frameThumbPath))thumbMeta.frame_thumbnail_path=frameThumbPath;
      }

      const {data:job,error:insertError}=await admin.from("production_jobs").insert({
        id:jobId,user_id:userData.user.id,storage_provider:"r2",
        original_storage_path:videoPath,original_file_name:videoName,original_mime_type:videoMime,original_size_bytes:actualVideo||videoSize,
        frame_storage_path:framePath,frame_file_name:frameName,frame_mime_type:frameMime,frame_size_bytes:actualFrame||frameSize,
        status:"waiting",progress:0,meta:thumbMeta
      }).select().single();
      if(insertError){
        await storageDeletePathsBucket(admin,"r2",[videoPath,framePath,videoThumbPath,frameThumbPath],"production").catch(()=>null);
        throw insertError;
      }
      await admin.from("activity_logs").insert({
        level:"info",event_type:"runninghub_job_created",message:"Par vídeo + frame enviado direto ao R2 e adicionado à produção",
        meta:{production_job_id:jobId,user_id:userData.user.id,storage_provider:"r2"}
      });
      return json({ok:true,job},201);
    }

    if (req.method === "POST" && action === "production-upload") {
      const form=await req.formData();
      const video=form.get("video");
      const frame=form.get("frame");
      const videoThumb=form.get("video_thumb");
      const frameThumb=form.get("frame_thumb");
      if(!(video instanceof File))return json({error:"video_required"},400);
      if(!(frame instanceof File))return json({error:"frame_required"},400);
      if(!String(video.type||"").startsWith("video/"))return json({error:"video_invalid"},400);
      if(!String(frame.type||"").startsWith("image/"))return json({error:"frame_invalid"},400);

      const jobId=crypto.randomUUID();
      const day=new Date().toISOString().slice(0,10);
      const safeExt=(name:string,fallback:string)=>name.includes(".")?String(name.split(".").pop()).replace(/[^a-zA-Z0-9]/g,"").slice(0,8)||fallback:fallback;
      const videoPath=userData.user.id+"/production-inputs/"+day+"/"+jobId+"/original."+safeExt(video.name,"mp4");
      const framePath=userData.user.id+"/production-inputs/"+day+"/"+jobId+"/frame."+safeExt(frame.name,"jpg");
      const videoThumbPath=userData.user.id+"/production-inputs/"+day+"/"+jobId+"/video-thumb.jpg";
      const frameThumbPath=userData.user.id+"/production-inputs/"+day+"/"+jobId+"/frame-thumb.jpg";

      const {error:videoUpload}=await admin.storage.from("production").upload(videoPath,video,{contentType:video.type||"video/mp4",upsert:false});
      if(videoUpload)throw videoUpload;
      const {error:frameUpload}=await admin.storage.from("production").upload(framePath,frame,{contentType:frame.type||"image/jpeg",upsert:false});
      if(frameUpload){
        await admin.storage.from("production").remove([videoPath]);
        throw frameUpload;
      }

      const thumbMeta:any={};
      const thumbPaths:string[]=[];
      if(videoThumb instanceof File&&String(videoThumb.type||"").startsWith("image/")){
        const {error}=await admin.storage.from("production").upload(videoThumbPath,videoThumb,{contentType:"image/jpeg",cacheControl:"2592000",upsert:false});
        if(!error){thumbMeta.original_thumbnail_path=videoThumbPath;thumbPaths.push(videoThumbPath)}
      }
      if(frameThumb instanceof File&&String(frameThumb.type||"").startsWith("image/")){
        const {error}=await admin.storage.from("production").upload(frameThumbPath,frameThumb,{contentType:"image/jpeg",cacheControl:"2592000",upsert:false});
        if(!error){thumbMeta.frame_thumbnail_path=frameThumbPath;thumbPaths.push(frameThumbPath)}
      }

      const {data:job,error:insertError}=await admin.from("production_jobs").insert({
        id:jobId,user_id:userData.user.id,
        original_storage_path:videoPath,original_file_name:video.name,original_mime_type:video.type,original_size_bytes:video.size,
        frame_storage_path:framePath,frame_file_name:frame.name,frame_mime_type:frame.type,frame_size_bytes:frame.size,
        status:"waiting",progress:0,meta:thumbMeta
      }).select().single();
      if(insertError){
        await admin.storage.from("production").remove([videoPath,framePath,...thumbPaths]);
        throw insertError;
      }

      await admin.from("activity_logs").insert({
        level:"info",event_type:"runninghub_job_created",message:"Par vídeo + frame adicionado à fila de produção",
        meta:{production_job_id:jobId,user_id:userData.user.id}
      });
      return json({ok:true,job},201);
    }


    if (req.method === "POST" && action === "production-schedule") {
      const body=await req.json();
      const id=String(body.id||"");
      const scheduledAt=String(body.scheduled_at||"");
      const caption=String(body.caption||"");
      const smartMode=String(body.smart_mode||"manual");
      const smartStrategy=String(body.smart_strategy|| (smartMode==="auto"?"stable":"manual"));
      const platformAccountId=await resolveCalendarInstagramAccount(admin,body.platform_account_id);

      if(!id)return json({error:"id_required"},400);
      if(!scheduledAt||Number.isNaN(Date.parse(scheduledAt)))return json({error:"scheduled_at_invalid"},400);

      const {data:job,error:jobError}=await admin.from("production_jobs")
        .select("id,user_id,status,result_video_id,meta")
        .eq("id",id).eq("user_id",userData.user.id).maybeSingle();
      if(jobError)throw jobError;
      if(!job)return json({error:"production_job_not_found"},404);
      if(job.status!=="ready"||!job.result_video_id)return json({error:"production_job_not_ready"},409);

      const {data:existing,error:existingError}=await admin.from("schedules")
        .select("id,scheduled_at,status").eq("video_id",job.result_video_id)
        .neq("status","cancelled").maybeSingle();
      if(existingError)throw existingError;
      if(existing)return json({error:"production_already_scheduled",schedule:existing},409);

      const {error:videoError}=await admin.from("videos").update({
        caption,status:"scheduled",platform:"instagram",platform_account_id:platformAccountId
      }).eq("id",job.result_video_id);
      if(videoError)throw videoError;

      const {data:schedule,error:scheduleError}=await admin.from("schedules").insert({
        video_id:job.result_video_id,
        scheduled_at:scheduledAt,
        status:"scheduled",
        smart_mode:smartMode==="auto"?"auto":"manual",
        smart_strategy:["stable","tested","test","strong","manual"].includes(smartStrategy)?smartStrategy:(smartMode==="auto"?"stable":"manual"),
        smart_strategy_locked:smartMode!=="auto",
        platform:"instagram",
        platform_account_id:platformAccountId
      }).select().single();
      if(scheduleError)throw scheduleError;

      const {error:queueError}=await admin.from("job_queue").insert({
        job_type:"publish_reel",
        platform:"instagram",
        platform_account_id:platformAccountId,
        schedule_id:schedule.id,
        run_at:scheduledAt,
        payload:{schedule_id:schedule.id,production_job_id:id}
      });
      if(queueError){
        await admin.from("schedules").delete().eq("id",schedule.id);
        throw queueError;
      }

      const scheduledNow=new Date().toISOString();
      await admin.from("production_jobs").update({
        meta:{...(job.meta||{}),scheduled:true,schedule_id:schedule.id,scheduled_at:scheduledAt},
        hidden_at:scheduledNow,
        updated_at:scheduledNow
      }).eq("id",id);

      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"production_result_scheduled",
        message:"Resultado do RunningHub adicionado ao calendário",
        meta:{production_job_id:id,schedule_id:schedule.id,video_id:job.result_video_id,user_id:userData.user.id}
      });

      return json({ok:true,schedule});
    }

    if (req.method === "DELETE" && action === "production-schedule") {
      const body=await req.json();
      const id=String(body.id||"");
      if(!id)return json({error:"id_required"},400);

      const {data:job,error:jobError}=await admin.from("production_jobs")
        .select("id,user_id,status,result_video_id,meta")
        .eq("id",id).eq("user_id",userData.user.id).maybeSingle();
      if(jobError)throw jobError;
      if(!job)return json({error:"production_job_not_found"},404);
      if(!job.result_video_id)return json({error:"production_result_missing"},409);

      const requestedScheduleId=String(body.schedule_id||job.meta?.schedule_id||"");
      let schedule:any=null;
      if(requestedScheduleId){
        const {data,error}=await admin.from("schedules")
          .select("id,video_id,status,scheduled_at")
          .eq("id",requestedScheduleId)
          .eq("video_id",job.result_video_id)
          .maybeSingle();
        if(error)throw error;
        schedule=data;
      }
      if(!schedule){
        const {data,error}=await admin.from("schedules")
          .select("id,video_id,status,scheduled_at")
          .eq("video_id",job.result_video_id)
          .neq("status","cancelled")
          .order("created_at",{ascending:false})
          .limit(1)
          .maybeSingle();
        if(error)throw error;
        schedule=data;
      }

      if(!schedule){
        const now=new Date().toISOString();
        await admin.from("videos").update({status:"ready",updated_at:now}).eq("id",job.result_video_id);
        await admin.from("production_jobs").update({
          meta:{...(job.meta||{}),scheduled:false,schedule_id:null,scheduled_at:null},
          hidden_at:null,
          updated_at:now
        }).eq("id",id).eq("user_id",userData.user.id);
        return json({ok:true,already_removed:true});
      }

      if(["processing","published"].includes(String(schedule.status))){
        return json({error:"production_schedule_already_publishing",schedule},409);
      }

      const now=new Date().toISOString();
      const {error:queueError}=await admin.from("job_queue").update({
        status:"cancelled",locked_at:null,locked_by:null,updated_at:now
      }).eq("schedule_id",schedule.id).in("status",["pending","failed"]);
      if(queueError)throw queueError;

      const {error:trialDeleteError}=await admin.from("reel_test_publications")
        .delete().eq("linked_schedule_id",schedule.id).neq("status","published");
      if(trialDeleteError)throw trialDeleteError;

      const {error:scheduleError}=await admin.from("schedules").update({
        status:"cancelled",updated_at:now
      }).eq("id",schedule.id).neq("status","published");
      if(scheduleError)throw scheduleError;

      const {error:videoError}=await admin.from("videos").update({
        status:"ready",updated_at:now
      }).eq("id",job.result_video_id);
      if(videoError)throw videoError;

      const {error:jobUpdateError}=await admin.from("production_jobs").update({
        meta:{...(job.meta||{}),scheduled:false,schedule_id:null,scheduled_at:null},
        hidden_at:null,
        updated_at:now
      }).eq("id",id).eq("user_id",userData.user.id);
      if(jobUpdateError)throw jobUpdateError;

      return json({ok:true,schedule_id:schedule.id});
    }

    if (req.method === "PATCH" && action === "production-clear-completed") {
      const now=new Date().toISOString();
      const {data:rows,error:readError}=await admin.from("production_jobs")
        .select("id")
        .eq("user_id",userData.user.id)
        .eq("status","ready")
        .is("hidden_at",null);
      if(readError)throw readError;
      const ids=(rows||[]).map((x:any)=>x.id);
      if(ids.length){
        const {error:updateError}=await admin.from("production_jobs")
          .update({hidden_at:now,updated_at:now})
          .in("id",ids)
          .eq("user_id",userData.user.id);
        if(updateError)throw updateError;
        await admin.from("activity_logs").insert({
          level:"info",
          event_type:"production_completed_cleared",
          message:"Jobs concluídos foram limpos da fila sem apagar os vídeos finais",
          meta:{count:ids.length,user_id:userData.user.id}
        });
      }
      return json({ok:true,cleared:ids.length});
    }

    if (req.method === "DELETE" && action === "production-job") {
      const body=await req.json();
      const id=String(body.id||"");
      if(!id)return json({error:"id_required"},400);

      const {data:job,error:jobError}=await admin.from("production_jobs")
        .select("id,user_id,status,storage_provider,original_storage_path,frame_storage_path,result_storage_path,result_video_id,meta")
        .eq("id",id).eq("user_id",userData.user.id).maybeSingle();
      if(jobError)throw jobError;
      if(!job)return json({error:"production_job_not_found"},404);
      if(["uploading","queued","running"].includes(job.status))return json({error:"production_job_active_cancel_first"},409);

      let preserveResult=false;
      if(job.result_video_id){
        const {count,error:countError}=await admin.from("schedules")
          .select("*",{count:"exact",head:true})
          .eq("video_id",job.result_video_id)
          .neq("status","cancelled");
        if(countError)throw countError;
        preserveResult=(count||0)>0;
      }

      const inputPaths=[
        job.original_storage_path,
        job.frame_storage_path,
        job.meta?.original_thumbnail_path,
        job.meta?.frame_thumbnail_path
      ].filter(Boolean);
      if(inputPaths.length)await storageDeletePathsBucket(admin,String(job.storage_provider||"supabase"),inputPaths,"production");

      if(job.result_video_id&&!preserveResult){
        const {data:resultVideo,error:resultVideoError}=await admin.from("videos")
          .select("id,storage_path,original_storage_path,storage_provider").eq("id",job.result_video_id).maybeSingle();
        if(resultVideoError)throw resultVideoError;
        if(resultVideo){
          const resultPaths=[resultVideo.storage_path,resultVideo.original_storage_path]
            .filter(Boolean).map(String).filter((x:string,i:number,a:string[])=>a.indexOf(x)===i);
          if(resultPaths.length)await storageDeletePathsBucket(admin,String(resultVideo.storage_provider||"supabase"),resultPaths,"videos");
        }
        await admin.from("videos").delete().eq("id",job.result_video_id);
      }

      const {error:deleteError}=await admin.from("production_jobs")
        .delete().eq("id",id).eq("user_id",userData.user.id);
      if(deleteError)throw deleteError;

      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"production_job_deleted",
        message:"Job de produção removido",
        meta:{production_job_id:id,preserved_scheduled_result:preserveResult,user_id:userData.user.id}
      });

      return json({ok:true,preserved_scheduled_result:preserveResult});
    }

    if (req.method === "PATCH" && action === "production-job") {
      const body=await req.json();
      const id=String(body.id||"");
      const op=String(body.operation||"");
      if(!id)return json({error:"id_required"},400);
      const {data:job,error:readError}=await admin.from("production_jobs")
        .select("id,user_id,status,meta")
        .eq("id",id).eq("user_id",userData.user.id).maybeSingle();
      if(readError)throw readError;if(!job)return json({error:"production_job_not_found"},404);

      if(op==="run"){
        if(job.status!=="waiting")return json({error:"run_not_allowed"},409);

        const now=new Date().toISOString();
        const {error:enableError}=await admin.from("integrations")
          .update({enabled:true,updated_at:now})
          .eq("provider","runninghub");
        if(enableError)throw enableError;

        const {error:updateError}=await admin.from("production_jobs").update({
          next_attempt_at:now,
          locked_at:null,
          locked_by:null,
          meta:{...(job.meta||{}),manual_run:true},
          updated_at:now
        }).eq("id",id).eq("user_id",userData.user.id);
        if(updateError)throw updateError;

        const [{count:productionActive},{count:faceSwapActive},{data:rhIntegration,error:rhIntError}]=await Promise.all([
          admin.from("production_jobs").select("*",{count:"exact",head:true}).in("status",["uploading","queued","running"]),
          admin.from("face_swap_jobs").select("*",{count:"exact",head:true}).in("status",["uploading","queued","running"]),
          admin.from("integrations").select("config").eq("provider","runninghub").maybeSingle()
        ]);
        const activeCount=Number(productionActive||0)+Number(faceSwapActive||0);
        if(rhIntError)throw rhIntError;
        const concurrency=Math.max(1,Math.min(10,Number(rhIntegration?.config?.concurrency||1)));

        // If all RunningHub slots are already occupied, keep this job prioritized
        // without spawning another worker invocation. The cron worker will pick it next.
        if((activeCount||0)>=concurrency){
          return json({
            ok:true,
            operation:"run",
            queued:true,
            reason:"capacity_busy",
            active:activeCount||0,
            concurrency
          });
        }

        const {data:secret,error:secretError}=await admin.rpc("get_cloudent_worker_secret");
        if(secretError||!secret)throw secretError||new Error("worker_secret_missing");
        const workerRes=await fetch(supabaseUrl+"/functions/v1/cloudent-production-worker",{
          method:"POST",
          headers:{"Content-Type":"application/json","x-cloudent-worker-secret":String(secret)},
          body:JSON.stringify({requested_job_id:id})
        });
        let workerData:any={};try{workerData=await workerRes.json()}catch{}
        if(!workerRes.ok)return json({ok:false,error:"production_worker_failed",details:workerData},500);
        return json({ok:true,operation:"run",queued:false,worker:workerData});
      }

      if(op==="retry"){
        if(!["failed","cancelled"].includes(job.status))return json({error:"retry_not_allowed"},409);
        const {error}=await admin.from("production_jobs").update({
          status:"waiting",progress:0,runninghub_task_id:null,runninghub_video_file:null,runninghub_frame_file:null,
          next_attempt_at:new Date().toISOString(),locked_at:null,locked_by:null,last_error:null,started_at:null,completed_at:null,updated_at:new Date().toISOString()
        }).eq("id",id).eq("user_id",userData.user.id);
        if(error)throw error;
        const wake=await wakeProductionWorkerNow({requested_job_id:id});
        return json({ok:true,operation:"retry",worker_wake:wake.ok});
      }else if(op==="cancel"){
        if(job.status==="ready")return json({error:"cancel_not_allowed"},409);
        const {error}=await admin.from("production_jobs").update({
          status:"cancelled",locked_at:null,locked_by:null,updated_at:new Date().toISOString()
        }).eq("id",id).eq("user_id",userData.user.id);
        if(error)throw error;
      }else{
        return json({error:"operation_invalid"},400);
      }
      return json({ok:true});
    }



    async function wakeProductionWorkerNow(payload:any={}){
      const {data:secret,error:secretError}=await admin.rpc("get_cloudent_worker_secret");
      if(secretError||!secret)return {ok:false,error:"worker_secret_missing"};
      const run=async()=>{
        try{
          const workerRes=await fetch(supabaseUrl+"/functions/v1/cloudent-production-worker",{
            method:"POST",
            headers:{"Content-Type":"application/json","x-cloudent-worker-secret":String(secret)},
            body:JSON.stringify(payload||{})
          });
          let data:any={};try{data=await workerRes.json()}catch{}
          return {ok:workerRes.ok,status:workerRes.status,data};
        }catch(e){
          return {ok:false,error:readableError(e)};
        }
      };
      try{
        const edgeRuntime=(globalThis as any).EdgeRuntime;
        if(edgeRuntime?.waitUntil){
          edgeRuntime.waitUntil(run());
          return {ok:true,queued:true,background:true};
        }
      }catch{}
      return await Promise.race([
        run(),
        new Promise<any>(resolve=>setTimeout(()=>resolve({ok:true,queued:true,timeout:true}),3500))
      ]);
    }

    async function ensureFaceSwapProduction(job:any){
      if(!job?.id||!job?.result_storage_path)throw new Error("face_swap_result_not_ready");
      const {data:existing,error:existingError}=await admin.from("production_jobs")
        .select("id,status").eq("id",job.id).maybeSingle();
      if(existingError)throw existingError;
      if(existing){
        if(job.production_job_id!==existing.id){
          await admin.from("face_swap_jobs").update({
            production_job_id:existing.id,updated_at:new Date().toISOString()
          }).eq("id",job.id);
        }
        return existing.id;
      }

      const frameName=String(job.result_file_name||("face-swap-"+String(job.id).slice(0,8)+".jpg"));
      const frameMime=String(job.result_mime_type||"image/jpeg");
      const {data:created,error:createError}=await admin.from("production_jobs").insert({
        id:job.id,
        user_id:job.user_id,
        storage_provider:String(job.storage_provider||"supabase"),
        original_storage_path:job.original_storage_path,
        original_file_name:job.original_file_name,
        original_mime_type:job.original_mime_type||"video/mp4",
        original_size_bytes:Number(job.original_size_bytes||0),
        frame_storage_path:job.result_storage_path,
        frame_file_name:frameName,
        frame_mime_type:frameMime,
        frame_size_bytes:Number(job.result_size_bytes||0),
        status:"waiting",
        progress:0,
        meta:{
          source:"face_swap",
          face_swap_job_id:job.id,
          manual_run:true,
          auto_chained:job.auto_send===true
        }
      }).select("id").single();
      if(createError)throw createError;

      await admin.from("face_swap_jobs").update({
        production_job_id:created.id,
        updated_at:new Date().toISOString()
      }).eq("id",job.id);

      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"face_swap_sent_to_production",
        message:"Face Swap enviado automaticamente para Produção IA",
        meta:{face_swap_job_id:job.id,production_job_id:created.id,user_id:job.user_id}
      });
      return created.id;
    }

    const characterSettingKey="face_swap_character_"+userData.user.id;
    async function selectedFaceSwapCharacter(){
      const {data:setting,error}=await admin.from("app_settings").select("value").eq("key",characterSettingKey).maybeSingle();
      if(error)throw error;
      if(setting)return setting.value;
      const path=userData.user.id+"/face-swap-characters/default-20261005.png";
      const bytes=Uint8Array.from(atob(defaultCharacterBase64),c=>c.charCodeAt(0));
      const {error:uploadError}=await admin.storage.from("production").upload(path,bytes,{contentType:"image/png",upsert:true});
      if(uploadError)throw uploadError;
      const value={storage_path:path,storage_provider:"supabase",file_name:"1000063243.png",mime_type:"image/png",size_bytes:bytes.length};
      const {error:saveError}=await admin.from("app_settings").upsert({key:characterSettingKey,value},{onConflict:"key",ignoreDuplicates:true});
      if(saveError)throw saveError;
      const {data:saved,error:readError}=await admin.from("app_settings").select("value").eq("key",characterSettingKey).single();
      if(readError)throw readError;
      return saved.value;
    }

    if (req.method === "POST" && action === "face-swap-character") {
      const form=await req.formData();
      const file=form.get("character");
      let character:any={mode:"workflow",file_name:"Folha original do workflow"};
      if(String(form.get("mode")||"")!=="workflow"){
        if(!(file instanceof File)||!file.size||file.size>10*1024*1024)return json({error:"Escolha uma imagem de até 10 MB."},400);
        const bytes=new Uint8Array(await file.arrayBuffer());
        const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10;
        const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
        const webp=String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP";
        if(!png&&!jpg&&!webp)return json({error:"Use uma imagem PNG, JPG ou WebP."},400);
        const mime=png?"image/png":jpg?"image/jpeg":"image/webp";
        const path=userData.user.id+"/face-swap-characters/"+crypto.randomUUID()+(png?".png":jpg?".jpg":".webp");
        const {error:uploadError}=await admin.storage.from("production").upload(path,bytes,{contentType:mime,upsert:false});
        if(uploadError)throw uploadError;
        character={storage_path:path,storage_provider:"supabase",file_name:file.name.slice(0,255),mime_type:mime,size_bytes:bytes.length};
      }
      const {error:saveError}=await admin.from("app_settings").upsert({key:characterSettingKey,value:character},{onConflict:"key"});
      if(saveError){
        if(character.storage_path)await admin.storage.from("production").remove([character.storage_path]);
        throw saveError;
      }
      return json({ok:true,character});
    }

    if (req.method === "GET" && resource === "face-swap") {
      const [
        {data:jobs,error:jobsError},
        {data:integration,error:intError},
        {data:worker,error:workerError},
        {count:faceSwapActive,error:faceActiveError},
        {count:productionActive,error:productionActiveError},
        {count:productionWaiting,error:productionWaitingError}
      ] = await Promise.all([
        admin.from("face_swap_jobs")
          .select("id,storage_provider,original_file_name,original_mime_type,original_size_bytes,frame_storage_path,frame_file_name,frame_mime_type,frame_size_bytes,status,progress,auto_send,runninghub_task_id,result_storage_path,result_file_name,result_mime_type,result_size_bytes,production_job_id,credits_before,credits_after,credits_used,runninghub_cost_money,runninghub_third_party_cost_money,runninghub_runtime_seconds,attempt_count,max_attempts,started_at,completed_at,last_error,meta,created_at,updated_at")
          .eq("user_id",userData.user.id).is("hidden_at",null).order("created_at",{ascending:false}).limit(100),
        admin.from("integrations").select("enabled,config,last_verified_at,updated_at").eq("provider","runninghub").maybeSingle(),
        admin.from("worker_runtime").select("worker_name,last_heartbeat,last_success_at,last_error,last_jobs,updated_at").eq("worker_name","production").maybeSingle(),
        admin.from("face_swap_jobs").select("*",{count:"exact",head:true}).eq("user_id",userData.user.id).in("status",["uploading","queued","running"]),
        admin.from("production_jobs").select("*",{count:"exact",head:true}).eq("user_id",userData.user.id).in("status",["uploading","queued","running"]),
        admin.from("production_jobs").select("*",{count:"exact",head:true}).eq("user_id",userData.user.id).eq("status","waiting")
      ]);
      if(jobsError)throw jobsError;if(intError)throw intError;if(workerError)throw workerError;
      if(faceActiveError)throw faceActiveError;if(productionActiveError)throw productionActiveError;if(productionWaitingError)throw productionWaitingError;
      const cfg:any=integration?.config||{};
      const character=await selectedFaceSwapCharacter();
      const characterUrl=character?.storage_path?await storageSignedGetBucket(admin,"supabase",character.storage_path,3600,"production"):null;
      const linkedIds=(jobs||[]).map((j:any)=>j.production_job_id).filter(Boolean);
      const productionById:Record<string,any>={};
      if(linkedIds.length){
        const {data:linked,error:linkedError}=await admin.from("production_jobs")
          .select("id,status,progress,result_video_id,result_storage_path,credits_used,runninghub_cost_money,runninghub_third_party_cost_money,runninghub_runtime_seconds,started_at,completed_at,last_error,updated_at")
          .in("id",linkedIds);
        if(linkedError)throw linkedError;
        for(const row of linked||[])productionById[String(row.id)]=row;
      }
      const enrichedJobs=(jobs||[]).map((j:any)=>({
        ...j,
        production:j.production_job_id?productionById[String(j.production_job_id)]||null:null
      }));
      const online=!!worker?.last_heartbeat && new Date(worker.last_heartbeat).getTime()>Date.now()-3*60*1000;
      return json({
        jobs:enrichedJobs,
        runninghub:{
          concurrency:Math.max(1,Math.min(10,Number(cfg.concurrency||1))),
          face_swap_active:Number(faceSwapActive||0),
          production_active:Number(productionActive||0),
          total_active:Number(faceSwapActive||0)+Number(productionActive||0),
          production_waiting:Number(productionWaiting||0)
        },
        workflow:{
          enabled:integration?.enabled!==false&&cfg.faceSwapEnabled!==false,
          configured:!!(cfg.apiKeyCipher&&cfg.apiKeyIv&&cfg.faceSwapWorkflowId&&cfg.faceSwapReferenceNodeId),
          workflow_id:String(cfg.faceSwapWorkflowId||""),
          character_node_id:String(cfg.faceSwapCharacterNodeId||"23"),
          reference_node_id:String(cfg.faceSwapReferenceNodeId||"17"),
          output_node_id:String(cfg.faceSwapOutputNodeId||"240"),
          fixed_character:!character?.storage_path,
          character:{file_name:character?.file_name||"Folha original do workflow",preview_url:characterUrl}
        },
        worker:worker?{...worker,online}:null
      });
    }

    if (req.method === "GET" && resource === "face-swap-preview") {
      const id=String(url.searchParams.get("id")||"");
      const kind=String(url.searchParams.get("kind")||"result");
      if(!id)return json({error:"id_required"},400);
      const {data:job,error:jobError}=await admin.from("face_swap_jobs")
        .select("id,user_id,storage_provider,original_storage_path,frame_storage_path,result_storage_path")
        .eq("id",id).eq("user_id",userData.user.id).maybeSingle();
      if(jobError)throw jobError;if(!job)return json({error:"face_swap_job_not_found"},404);
      const path=kind==="original"?job.original_storage_path:kind==="frame"?job.frame_storage_path:job.result_storage_path;
      if(!path)return json({error:"file_not_available"},404);
      const signedUrl=await storageSignedGetBucket(admin,String(job.storage_provider||"supabase"),String(path),3600,"production");
      return json({url:signedUrl,expires_in:3600,provider:String(job.storage_provider||"supabase")});
    }

    if (req.method === "POST" && action === "face-swap-upload-ticket") {
      const body=await req.json();
      const videoName=String(body.video_file_name||"video.mp4").slice(0,255);
      const videoMime=String(body.video_mime_type||"video/mp4").slice(0,120);
      const videoSize=Math.max(0,Number(body.video_size_bytes||0));
      const frameName=String(body.frame_file_name||"frame.jpg").slice(0,255);
      const frameMime=String(body.frame_mime_type||"image/jpeg").slice(0,120);
      const frameSize=Math.max(0,Number(body.frame_size_bytes||0));
      const autoSend=body.auto_send!==false;
      if(!videoMime.startsWith("video/")||!videoSize)return json({error:"video_invalid"},400);
      if(!frameMime.startsWith("image/")||!frameSize)return json({error:"frame_invalid"},400);

      const cfg=await getCloudentR2Config(admin);
      if(!cfg)return json({ok:true,fallback:true,provider:"supabase",auto_send:autoSend});

      const jobId=crypto.randomUUID();
      const day=new Date().toISOString().slice(0,10);
      const base=userData.user.id+"/face-swap-inputs/"+day+"/"+jobId;
      const videoPath=base+"/original."+safeMediaExt(videoName,"mp4");
      const framePath=base+"/first-frame."+safeMediaExt(frameName,"jpg");
      // Face Swap uploads come from multiple browsers/devices. Do not sign
      // Content-Type into the presigned URL; browsers may normalize that header
      // and Backblaze B2 then rejects the request with HTTP 400.
      const [videoUrl,frameUrl]=await Promise.all([
        r2PresignedUrl(cfg,"PUT",videoPath,900),
        r2PresignedUrl(cfg,"PUT",framePath,900)
      ]);
      return json({
        ok:true,fallback:false,provider:"r2",job_id:jobId,auto_send:autoSend,
        video:{path:videoPath,upload_url:videoUrl,content_type:videoMime},
        frame:{path:framePath,upload_url:frameUrl,content_type:frameMime},
        expires_in:900
      });
    }

    if (req.method === "POST" && action === "face-swap-upload-complete") {
      const body=await req.json();
      const jobId=String(body.job_id||"");
      const videoPath=String(body.video_path||"");
      const framePath=String(body.frame_path||"");
      const videoName=String(body.video_file_name||"video.mp4").slice(0,255);
      const videoMime=String(body.video_mime_type||"video/mp4").slice(0,120);
      const videoSize=Math.max(0,Number(body.video_size_bytes||0));
      const frameName=String(body.frame_file_name||"first-frame.jpg").slice(0,255);
      const frameMime=String(body.frame_mime_type||"image/jpeg").slice(0,120);
      const frameSize=Math.max(0,Number(body.frame_size_bytes||0));
      const autoSend=body.auto_send!==false;
      const prefix=userData.user.id+"/face-swap-inputs/";
      if(!jobId||!videoPath.startsWith(prefix)||!framePath.startsWith(prefix))return json({error:"face_swap_upload_path_invalid"},403);
      if(!videoPath.includes("/"+jobId+"/")||!framePath.includes("/"+jobId+"/"))return json({error:"face_swap_job_path_mismatch"},400);
      const cfg=await getCloudentR2Config(admin);
      if(!cfg)return json({error:"r2_not_configured"},409);

      const [videoHeadUrl,frameHeadUrl]=await Promise.all([
        r2PresignedUrl(cfg,"HEAD",videoPath,300),r2PresignedUrl(cfg,"HEAD",framePath,300)
      ]);
      const [videoHead,frameHead]=await Promise.all([
        fetch(videoHeadUrl,{method:"HEAD"}),fetch(frameHeadUrl,{method:"HEAD"})
      ]);
      if(!videoHead.ok||!frameHead.ok)return json({error:"face_swap_objects_missing",user_message:"Vídeo ou primeiro frame não terminou de enviar."},409);
      const actualVideo=Number(videoHead.headers.get("content-length")||0);
      const actualFrame=Number(frameHead.headers.get("content-length")||0);
      if(videoSize&&actualVideo&&videoSize!==actualVideo)return json({error:"face_swap_video_size_mismatch"},409);
      if(frameSize&&actualFrame&&frameSize!==actualFrame)return json({error:"face_swap_frame_size_mismatch"},409);

      const {data:job,error:insertError}=await admin.from("face_swap_jobs").insert({
        id:jobId,user_id:userData.user.id,storage_provider:"r2",
        original_storage_path:videoPath,original_file_name:videoName,original_mime_type:videoMime,original_size_bytes:actualVideo||videoSize,
        frame_storage_path:framePath,frame_file_name:frameName,frame_mime_type:frameMime,frame_size_bytes:actualFrame||frameSize,
        status:"waiting",progress:0,auto_send:autoSend,
        meta:{source:"face_swap_tab",character_node_id:"23",reference_node_id:"17",output_node_id:"240",character:await selectedFaceSwapCharacter()}
      }).select().single();
      if(insertError){
        await storageDeletePathsBucket(admin,"r2",[videoPath,framePath],"production").catch(()=>null);
        throw insertError;
      }
      await admin.from("activity_logs").insert({
        level:"info",event_type:"face_swap_job_created",message:"Vídeo adicionado ao Face Swap",
        meta:{face_swap_job_id:jobId,user_id:userData.user.id,auto_send:autoSend,storage_provider:"r2"}
      });
      const wake=await wakeProductionWorkerNow({requested_face_swap_job_id:jobId});
      return json({ok:true,job,worker_wake:wake.ok},201);
    }

    if (req.method === "POST" && action === "face-swap-upload") {
      const form=await req.formData();
      const video=form.get("video");
      const frame=form.get("frame");
      const autoSend=String(form.get("auto_send")||"true")!=="false";
      if(!(video instanceof File))return json({error:"video_required"},400);
      if(!(frame instanceof File))return json({error:"frame_required"},400);
      if(!String(video.type||"").startsWith("video/"))return json({error:"video_invalid"},400);
      if(!String(frame.type||"").startsWith("image/"))return json({error:"frame_invalid"},400);

      const jobId=crypto.randomUUID();
      const day=new Date().toISOString().slice(0,10);
      const base=userData.user.id+"/face-swap-inputs/"+day+"/"+jobId;
      const videoPath=base+"/original."+safeMediaExt(video.name,"mp4");
      const framePath=base+"/first-frame."+safeMediaExt(frame.name,"jpg");
      const [uv,uf]=await Promise.all([
        admin.storage.from("production").upload(videoPath,video,{contentType:video.type||"video/mp4",upsert:false}),
        admin.storage.from("production").upload(framePath,frame,{contentType:frame.type||"image/jpeg",upsert:false})
      ]);
      if(uv.error||uf.error){
        await admin.storage.from("production").remove([videoPath,framePath]).catch(()=>null);
        throw uv.error||uf.error;
      }
      const {data:job,error:insertError}=await admin.from("face_swap_jobs").insert({
        id:jobId,user_id:userData.user.id,storage_provider:"supabase",
        original_storage_path:videoPath,original_file_name:video.name,original_mime_type:video.type||"video/mp4",original_size_bytes:video.size,
        frame_storage_path:framePath,frame_file_name:frame.name,frame_mime_type:frame.type||"image/jpeg",frame_size_bytes:frame.size,
        status:"waiting",progress:0,auto_send:autoSend,
        meta:{source:"face_swap_tab",character_node_id:"23",reference_node_id:"17",output_node_id:"240",character:await selectedFaceSwapCharacter()}
      }).select().single();
      if(insertError){
        await admin.storage.from("production").remove([videoPath,framePath]).catch(()=>null);
        throw insertError;
      }
      await admin.from("activity_logs").insert({
        level:"info",event_type:"face_swap_job_created",message:"Vídeo adicionado ao Face Swap",
        meta:{face_swap_job_id:jobId,user_id:userData.user.id,auto_send:autoSend,storage_provider:"supabase"}
      });
      const wake=await wakeProductionWorkerNow({requested_face_swap_job_id:jobId});
      return json({ok:true,job,worker_wake:wake.ok},201);
    }

    if (req.method === "PATCH" && action === "face-swap-job") {
      const body=await req.json();
      const id=String(body.id||"");
      const op=String(body.operation||"");
      if(!id)return json({error:"id_required"},400);
      const {data:job,error:readError}=await admin.from("face_swap_jobs")
        .select("*").eq("id",id).eq("user_id",userData.user.id).maybeSingle();
      if(readError)throw readError;if(!job)return json({error:"face_swap_job_not_found"},404);

      if(op==="retry"||op==="run"){
        if(op==="retry"&&!["failed","cancelled"].includes(job.status))return json({error:"retry_not_allowed"},409);
        if(op==="run"&&job.status!=="waiting")return json({error:"run_not_allowed"},409);
        const now=new Date().toISOString();
        const {error:updateError}=await admin.from("face_swap_jobs").update({
          status:"waiting",progress:0,runninghub_task_id:null,runninghub_frame_file:null,
          next_attempt_at:now,locked_at:null,locked_by:null,last_error:null,
          started_at:null,completed_at:null,
          meta:{...(job.meta||{}),manual_run:true},
          updated_at:now
        }).eq("id",id).eq("user_id",userData.user.id);
        if(updateError)throw updateError;
        const wake=await wakeProductionWorkerNow({requested_face_swap_job_id:id});
        return json({ok:true,operation:op,worker_wake:wake.ok});
      }

      if(op==="cancel"){
        if(job.status==="ready")return json({error:"cancel_not_allowed"},409);
        const {error}=await admin.from("face_swap_jobs").update({
          status:"cancelled",locked_at:null,locked_by:null,updated_at:new Date().toISOString()
        }).eq("id",id).eq("user_id",userData.user.id);
        if(error)throw error;
        return json({ok:true,operation:op});
      }

      if(op==="send-production"){
        if(job.status!=="ready"||!job.result_storage_path)return json({error:"face_swap_result_not_ready"},409);
        const productionJobId=await ensureFaceSwapProduction(job);
        const wake=await wakeProductionWorkerNow({requested_job_id:productionJobId});
        return json({ok:true,operation:op,production_job_id:productionJobId,worker_wake:wake.ok});
      }

      return json({error:"operation_invalid"},400);
    }

    if (req.method === "DELETE" && action === "face-swap-job") {
      const body=await req.json();
      const id=String(body.id||"");
      if(!id)return json({error:"id_required"},400);
      const {data:job,error:readError}=await admin.from("face_swap_jobs")
        .select("*").eq("id",id).eq("user_id",userData.user.id).maybeSingle();
      if(readError)throw readError;if(!job)return json({error:"face_swap_job_not_found"},404);
      if(["uploading","queued","running"].includes(job.status))return json({error:"face_swap_job_active_cancel_first"},409);

      if(job.production_job_id){
        const {error}=await admin.from("face_swap_jobs").update({
          hidden_at:new Date().toISOString(),updated_at:new Date().toISOString()
        }).eq("id",id).eq("user_id",userData.user.id);
        if(error)throw error;
        return json({ok:true,hidden:true,preserved_for_production:true});
      }

      const paths=[job.original_storage_path,job.frame_storage_path,job.result_storage_path].filter(Boolean);
      if(paths.length)await storageDeletePathsBucket(admin,String(job.storage_provider||"supabase"),paths,"production");
      const {error:deleteError}=await admin.from("face_swap_jobs").delete().eq("id",id).eq("user_id",userData.user.id);
      if(deleteError)throw deleteError;
      return json({ok:true,deleted:true});
    }


    if (req.method === "GET" && resource === "runninghub-status") {
      const {data:integration,error:intError}=await admin.from("integrations")
        .select("enabled,config,last_verified_at").eq("provider","runninghub").maybeSingle();
      if(intError)throw intError;
      const cfg:any=integration?.config||{};
      const workflowId=String(cfg.workflowId||"").trim();
      const configured=!!(cfg.apiKeyCipher&&cfg.apiKeyIv&&workflowId);

      if(!configured){
        return json({
          configured:false,
          enabled:!!integration?.enabled,
          credits:null,
          activeTasks:null,
          apiType:null,
          workflowId:workflowId||null
        });
      }

      const {data:master,error:masterError}=await admin.rpc("get_cloudent_worker_secret");
      if(masterError||!master)throw masterError||new Error("worker_secret_missing");

      let apiKey="";
      try{
        apiKey=await runninghubDecrypt(String(cfg.apiKeyCipher),String(cfg.apiKeyIv),String(master));
      }catch{
        return json({configured:true,enabled:!!integration?.enabled,error:"runninghub_api_key_decrypt_failed"},400);
      }

      const accountRes=await fetch("https://www.runninghub.ai/uc/openapi/accountStatus",{
        method:"POST",
        headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
        body:JSON.stringify({apikey:apiKey})
      });
      let account:any={};try{account=await accountRes.json()}catch{}
      if(!accountRes.ok||Number(account?.code)!==0){
        return json({
          configured:true,
          enabled:!!integration?.enabled,
          error:"runninghub_status_failed",
          message:account?.msg||"Não consegui consultar o RunningHub."
        },400);
      }

      return json({
        configured:true,
        enabled:!!integration?.enabled,
        credits:Number(account?.data?.remainCoins ?? 0),
        activeTasks:Number(account?.data?.currentTaskCounts ?? 0),
        apiType:account?.data?.apiType||null,
        workflowId
      });
    }

    if (req.method === "PATCH" && action === "runninghub-control") {
      const body=await req.json();
      const op=String(body.operation||"");
      if(!["run","pause","resume"].includes(op))return json({error:"operation_invalid"},400);

      if(op==="pause"||op==="resume"||op==="run"){
        const {error:updateError}=await admin.from("integrations")
          .update({enabled:op!=="pause",updated_at:new Date().toISOString()})
          .eq("provider","runninghub");
        if(updateError)throw updateError;
      }

      if(op==="run"||op==="resume"){
        const {data:secret,error:secretError}=await admin.rpc("get_cloudent_worker_secret");
        if(secretError||!secret)throw secretError||new Error("worker_secret_missing");
        const workerRes=await fetch(supabaseUrl+"/functions/v1/cloudent-production-worker",{
          method:"POST",
          headers:{"Content-Type":"application/json","x-cloudent-worker-secret":String(secret)},
          body:"{}"
        });
        let workerData:any={};try{workerData=await workerRes.json()}catch{}
        if(!workerRes.ok)return json({ok:false,error:"production_worker_failed",details:workerData},500);
        return json({ok:true,operation:op,worker:workerData});
      }

      return json({ok:true,operation:op});
    }


    if (req.method === "GET" && resource === "instagram-web-session") {
      const {data:cookie,error}=await admin.rpc("get_instagram_web_session",{p_user_id:userData.user.id});
      if(error)throw error;
      return json({
        ok:true,
        configured:!!String(cookie||"").trim(),
        mode:"browser_session",
        secret_exposed:false
      });
    }

    if (req.method === "PATCH" && action === "instagram-web-session") {
      const body=await req.json();
      let raw=String(body.session||body.sessionid||"").trim();
      if(!raw||raw.length<12)return json({error:"instagram_web_session_required",user_message:"Cole o sessionid da sua própria sessão do Instagram."},400);
      if(/[\r\n]/.test(raw)||raw.length>8192)return json({error:"instagram_web_session_invalid",user_message:"Sessão do Instagram inválida."},400);

      let cookie="";
      if(raw.includes("=")){
        const pairs=raw.split(";").map((x:string)=>x.trim()).filter(Boolean);
        const allowed=new Set(["sessionid","csrftoken","ds_user_id","mid","ig_did","rur","datr"]);
        const safePairs=pairs.filter((pair:string)=>{
          const key=pair.split("=",1)[0]?.trim();
          return !!key&&allowed.has(key);
        });
        cookie=safePairs.join("; ");
      }else{
        cookie="sessionid="+raw;
      }
      if(!/(^|;\s*)sessionid=/.test(cookie)){
        return json({error:"instagram_web_session_missing_sessionid",user_message:"Não encontrei o sessionid nessa sessão."},400);
      }

      const sessionHeaders={
        "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        "Accept":"*/*",
        "Accept-Language":"pt-BR,pt;q=0.9,en-US;q=0.7,en;q=0.6",
        "Referer":"https://www.instagram.com/",
        "X-IG-App-ID":"936619743392459",
        "X-ASBD-ID":"129477",
        "X-Requested-With":"XMLHttpRequest",
        "Cookie":cookie
      };

      const verifyRes=await fetch("https://www.instagram.com/api/v1/accounts/current_user/?edit=true",{
        headers:sessionHeaders,
        redirect:"follow"
      });
      let verify:any={};try{verify=await verifyRes.json()}catch{}
      const username=String(verify?.user?.username||verify?.username||"");
      if(!verifyRes.ok||!username){
        return json({
          error:"instagram_web_session_invalid",
          user_message:"Essa sessão não está válida no Instagram. Gere um sessionid novo na sua própria conta.",
          status:verifyRes.status
        },422);
      }

      const {error:saveError}=await admin.rpc("set_instagram_web_session",{p_user_id:userData.user.id,p_cookie:cookie});
      if(saveError)throw saveError;
      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"instagram_web_session_connected",
        message:"Sessão web do Instagram conectada ao Extrator",
        meta:{user_id:userData.user.id,username}
      });

      return json({ok:true,configured:true,username,mode:"browser_session",secret_exposed:false});
    }

    if (req.method === "DELETE" && action === "instagram-web-session") {
      const {error}=await admin.rpc("clear_instagram_web_session",{p_user_id:userData.user.id});
      if(error)throw error;
      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"instagram_web_session_removed",
        message:"Sessão web do Instagram removida do Extrator",
        meta:{user_id:userData.user.id}
      });
      return json({ok:true,configured:false});
    }


    if (req.method === "POST" && action === "frame-source") {
      const body=await req.json();
      const rawUrl=String(body.url||"").trim();
      if(!rawUrl)return json({error:"url_required"},400);

      let parsed:URL;
      try{parsed=new URL(rawUrl)}catch{return json({error:"url_invalid"},400)}
      const host=parsed.hostname.toLowerCase().replace(/^www\./,"");
      if(!(host==="instagram.com"||host.endsWith(".instagram.com")||host==="instagr.am")){
        return json({error:"instagram_url_required"},400);
      }

      const pathMatch=parsed.pathname.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
      const shortcode=pathMatch?.[1]||"";
      if(!shortcode)return json({error:"instagram_shortcode_invalid"},400);

      const browserUa="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
      const crawlerUa="facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
      const canonical="https://www.instagram.com/reel/"+shortcode+"/";
      const embed="https://www.instagram.com/p/"+shortcode+"/embed/captioned/";

      const decodeInstagramUrl=(s:string)=>{
        let out=String(s||"").trim();
        for(let i=0;i<3;i++){
          out=out
            .replace(/&amp;|&#38;|&#x26;/gi,"&")
            .replace(/&quot;|&#34;|&#x22;/gi,'"')
            .replace(/&#39;|&#x27;/gi,"'")
            .replace(/\\u0026/gi,"&")
            .replace(/\\u003d/gi,"=")
            .replace(/\\u0025/gi,"%")
            .replace(/\\u002f/gi,"/")
            .replace(/\\\//g,"/");
        }
        return out;
      };

      const shortcodeToMediaId=(code:string)=>{
        const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let value=0n;
        for(const ch of code){
          const n=alphabet.indexOf(ch);
          if(n<0)return "";
          value=value*64n+BigInt(n);
        }
        return value.toString();
      };
      const mediaId=shortcodeToMediaId(shortcode);
      let webSessionCookie="";
      let webSessionInvalid=false;
      try{
        const {data:sessionCookie}=await admin.rpc("get_instagram_web_session",{p_user_id:userData.user.id});
        webSessionCookie=String(sessionCookie||"").trim();
      }catch{}
      const instagramSessionHeaders=()=>({
        "User-Agent":browserUa,
        "Accept":"*/*",
        "Accept-Language":"pt-BR,pt;q=0.9,en-US;q=0.7,en;q=0.6",
        "Referer":canonical,
        "X-IG-App-ID":"936619743392459",
        "X-ASBD-ID":"129477",
        "X-Requested-With":"XMLHttpRequest",
        ...(webSessionCookie?{"Cookie":webSessionCookie}:{})
      });
      const shortcodeFromUrl=(value:string)=>{
        try{
          const u=new URL(decodeInstagramUrl(value));
          const m=u.pathname.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
          return m?.[1]||"";
        }catch{return ""}
      };
      const mediaIdentityMatches=(media:any)=>{
        if(!media||typeof media!=="object")return false;
        const code=String(media.shortcode||media.code||"");
        if(code)return code===shortcode;
        const id=String(media.id||media.pk||"");
        if(id&&mediaId)return id===mediaId;
        const linked=String(media.permalink||media.webpage_url||"");
        const linkedCode=shortcodeFromUrl(linked);
        return !!linkedCode&&linkedCode===shortcode;
      };

      const extractContextMedia=(html:string)=>{
        const key='"contextJSON":';
        let from=0;
        while(true){
          const k=html.indexOf(key,from);
          if(k<0)break;
          const quote=html.indexOf('"',k+key.length);
          if(quote<0)break;
          let i=quote+1,esc=false;
          for(;i<html.length;i++){
            const ch=html[i];
            if(esc)esc=false;
            else if(ch==="\\")esc=true;
            else if(ch==='"')break;
          }
          from=i+1;
          if(i>=html.length)break;
          try{
            const inner=JSON.parse(html.slice(quote,i+1));
            const obj=JSON.parse(inner);
            const media=obj?.gql_data?.shortcode_media||obj?.context?.media||null;
            if(media&&mediaIdentityMatches(media))return media;
          }catch{}
        }
        return null;
      };

      const mediaFromObject=(media:any)=>{
        if(!media||typeof media!=="object")return {video:"",thumbnail:""};
        let video="",thumbnail="";
        const choose=(node:any)=>{
          if(!node||typeof node!=="object")return;
          if(!thumbnail){
            thumbnail=String(node.display_url||node.thumbnail_src||node.image_versions2?.candidates?.[0]?.url||"");
          }
          if(!video){
            video=String(
              node.video_url||
              node.video_versions?.[0]?.url||
              node.clips_metadata?.original_sound_info?.progressive_download_url||
              ""
            );
          }
        };
        choose(media);
        const children=media.edge_sidecar_to_children?.edges;
        if(Array.isArray(children)){
          for(const e of children){ choose(e?.node); if(video)break; }
        }
        return {video:decodeInstagramUrl(video),thumbnail:decodeInstagramUrl(thumbnail)};
      };

      const extractMeta=(text:string)=>{
        const variants=[text];
        const unescaped=text.replace(/\\"/g,'"').replace(/\\\//g,"/");
        if(unescaped!==text)variants.push(unescaped);

        let video="",thumbnail="";
        for(const source of variants){
          const videoPatterns=[
            /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url)?["']/i,
            /<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["']([^"']+)["']/i,
            /<video[^>]+src=["']([^"']+)["']/i,
            /<source[^>]+src=["']([^"']+)["']/i,
            /"video_url"\s*:\s*"([^"]+)"/i,
            /"video_versions"[\s\S]{0,2200}?"url"\s*:\s*"([^"]+)"/i,
            /"contentUrl"\s*:\s*"([^"]+)"/i,
            /"url"\s*:\s*"([^"]+\.mp4[^"]*)"/i
          ];
          const imagePatterns=[
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
            /"thumbnail_src"\s*:\s*"([^"]+)"/i,
            /"display_url"\s*:\s*"([^"]+)"/i
          ];
          if(!video){
            for(const re of videoPatterns){const m=source.match(re);if(m?.[1]){video=decodeInstagramUrl(m[1]);break}}
          }
          if(!thumbnail){
            for(const re of imagePatterns){const m=source.match(re);if(m?.[1]){thumbnail=decodeInstagramUrl(m[1]);break}}
          }
          if(video)break;
        }
        return {video,thumbnail};
      };

      const extractExactPageThumbnail=(html:string)=>{
        const identityPatterns=[
          /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i,
          /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
          /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i
        ];
        let pageCode="";
        for(const re of identityPatterns){
          const m=html.match(re);
          if(m?.[1]){
            pageCode=shortcodeFromUrl(m[1]);
            if(pageCode)break;
          }
        }
        if(pageCode!==shortcode)return "";
        const imagePatterns=[
          /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
        ];
        for(const re of imagePatterns){
          const m=html.match(re);
          if(m?.[1])return decodeInstagramUrl(m[1]);
        }
        return "";
      };

      const extractExactPageVideo=(html:string)=>{
        const identityPatterns=[
          /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i,
          /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
          /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i
        ];
        let pageCode="";
        for(const re of identityPatterns){
          const m=html.match(re);
          if(m?.[1]){
            pageCode=shortcodeFromUrl(m[1]);
            if(pageCode)break;
          }
        }
        if(pageCode!==shortcode)return "";
        const videoPatterns=[
          /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url)?["']/i,
          /<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:player:stream["']/i
        ];
        for(const re of videoPatterns){
          const m=html.match(re);
          if(m?.[1])return decodeInstagramUrl(m[1]);
        }
        return "";
      };

      const extractCrawlerThumbnail=(html:string)=>{
        const anchors=[
          mediaId?('"pk":"'+mediaId+'"'):"",
          mediaId?('\\\"pk\\\":\\\"'+mediaId+'\\\"'):"",
          '"code":"'+shortcode+'"',
          '\\\"code\\\":\\\"'+shortcode+'\\\"',
          '"shortcode":"'+shortcode+'"'
        ].filter(Boolean);
        for(const anchor of anchors){
          const pos=html.indexOf(anchor);
          if(pos<0)continue;
          const slice=html.slice(Math.max(0,pos-1600),Math.min(html.length,pos+12000));
          const imagePatterns=[
            /"thumbnail_src"\s*:\s*"([^"]+)"/i,
            /"display_url"\s*:\s*"([^"]+)"/i
          ];
          for(const re of imagePatterns){
            const m=slice.match(re);
            if(m?.[1])return decodeInstagramUrl(m[1]);
          }
        }
        return "";
      };

      const extractAnchoredMedia=(html:string)=>{
        const anchors=[
          mediaId?('"pk":"'+mediaId+'"'):"",
          mediaId?('\\\"pk\\\":\\\"'+mediaId+'\\\"'):"",
          '"shortcode":"'+shortcode+'"',
          '\\\"shortcode\\\":\\\"'+shortcode+'\\\"',
          '"code":"'+shortcode+'"',
          '\\\"code\\\":\\\"'+shortcode+'\\\"'
        ].filter(Boolean);
        for(const anchor of anchors){
          const start=html.indexOf(anchor);
          if(start<0)continue;

          const nextMarkers=['"shortcode":"','\\\"shortcode\\\":\\\"','"code":"','\\\"code\\\":\\\"'];
          let end=Math.min(html.length,start+70000);
          for(const nextMarker of nextMarkers){
            const next=html.indexOf(nextMarker,start+anchor.length);
            if(next>start&&next<end)end=next;
          }

          const slice=html.slice(start,end);
          const variants=[slice,slice.replace(/\\\"/g,'"').replace(/\\\//g,"/")];
          let video="",thumbnail="";
          for(const source of variants){
            if(!video){
              const patterns=[
                /"video_url"\s*:\s*"([^"]+)"/i,
                /"video_versions"[\s\S]{0,5000}?"url"\s*:\s*"([^"]+)"/i,
                /<video[^>]+src=["']([^"']+)["']/i,
                /<source[^>]+src=["']([^"']+)["']/i
              ];
              for(const re of patterns){
                const m=source.match(re);
                if(m?.[1]){video=decodeInstagramUrl(m[1]);break}
              }
            }
            if(!thumbnail){
              const imagePatterns=[
                /"thumbnail_src"\s*:\s*"([^"]+)"/i,
                /"display_url"\s*:\s*"([^"]+)"/i
              ];
              for(const re of imagePatterns){
                const m=source.match(re);
                if(m?.[1]){thumbnail=decodeInstagramUrl(m[1]);break}
              }
            }
            if(video)break;
          }
          if(video||thumbnail)return {video,thumbnail};
        }
        return {video:"",thumbnail:""};
      };

      let videoUrl="";
      let thumbnailUrl="";
      let resolver="";
      const attempts:any[]=[];

      // 1) Media already synchronized from the connected professional account.
      try{
        const {data:known}=await admin.from("instagram_media")
          .select("media_url,thumbnail_url,permalink")
          .ilike("permalink","%"+shortcode+"%")
          .order("updated_at",{ascending:false})
          .limit(1)
          .maybeSingle();
        const knownCode=shortcodeFromUrl(String(known?.permalink||""));
        if(known?.media_url&&knownCode===shortcode){
          videoUrl=String(known.media_url);
          thumbnailUrl=String(known.thumbnail_url||"");
          resolver="instagram_graph_cache";
        }
      }catch{}

      // 2) Authenticated browser-session route. It resolves by exact media id,
      // so it can handle public content that Instagram blocks for logged-out
      // datacenter requests and content the connected account is authorized to view.
      if(!videoUrl&&webSessionCookie&&mediaId){
        try{
          const sessionRes=await fetch("https://www.instagram.com/api/v1/media/"+mediaId+"/info/",{
            headers:instagramSessionHeaders(),
            redirect:"follow"
          });
          let sessionJson:any={};try{sessionJson=await sessionRes.json()}catch{}
          attempts.push({resolver:"instagram_web_session",status:sessionRes.status});
          if([401,403].includes(sessionRes.status))webSessionInvalid=true;
          const item=sessionJson?.items?.[0]||null;
          if(sessionRes.ok&&item&&mediaIdentityMatches(item)){
            const resolved=mediaFromObject(item);
            if(resolved.video){
              videoUrl=resolved.video;
              thumbnailUrl=thumbnailUrl||resolved.thumbnail;
              resolver="instagram_web_session";
              webSessionInvalid=false;
            }
          }
        }catch(e){attempts.push({resolver:"instagram_web_session",error:readableError(e)})}
      }

      // 3) Public embed surface. This is the lightest logged-out route and works
      // for most public posts when browser navigation headers are present.
      if(!videoUrl){
        try{
          const res=await fetch(embed,{
            headers:{
              "User-Agent":browserUa,
              "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language":"en-US,en;q=0.9",
              "Sec-Fetch-Dest":"document",
              "Sec-Fetch-Mode":"navigate",
              "Sec-Fetch-Site":"none",
              "Upgrade-Insecure-Requests":"1"
            },
            redirect:"follow"
          });
          const textBody=res.ok?await res.text():"";
          attempts.push({resolver:"instagram_embed",status:res.status,bytes:textBody.length});
          if(textBody){
            const media=extractContextMedia(textBody);
            if(media){
              const m=mediaFromObject(media);
              videoUrl=m.video;
              thumbnailUrl=thumbnailUrl||m.thumbnail;
            }
            if(!videoUrl){
              const anchored=extractAnchoredMedia(textBody);
              videoUrl=anchored.video;
              thumbnailUrl=thumbnailUrl||anchored.thumbnail;
              if(videoUrl)resolver="instagram_embed_anchored";
            }
            if(!videoUrl){
              const exactMetaVideo=extractExactPageVideo(textBody);
              if(exactMetaVideo){
                videoUrl=exactMetaVideo;
                resolver="instagram_embed_meta";
              }
            }
            if(!thumbnailUrl){
              thumbnailUrl=extractExactPageThumbnail(textBody)||extractCrawlerThumbnail(textBody)||"";
            }
            if(videoUrl&&!resolver)resolver="instagram_embed";
          }
        }catch(e){attempts.push({resolver:"instagram_embed",error:readableError(e)})}
      }

      // 4) Public crawler view. Instagram often gives link crawlers a richer
      // payload (video_versions) than the normal logged-out browser shell.
      if(!videoUrl){
        try{
          const res=await fetch(canonical,{
            headers:{
              "User-Agent":crawlerUa,
              "Accept":"text/html,application/xhtml+xml",
              "Accept-Language":"en-US,en;q=0.9"
            },
            redirect:"follow"
          });
          const textBody=res.ok?await res.text():"";
          attempts.push({resolver:"instagram_crawler",status:res.status,bytes:textBody.length});
          if(textBody){
            const anchored=extractAnchoredMedia(textBody);
            if(!videoUrl&&anchored.video){
              videoUrl=anchored.video;
              resolver="instagram_crawler_anchored";
            }
            if(!videoUrl){
              const exactMetaVideo=extractExactPageVideo(textBody);
              if(exactMetaVideo){
                videoUrl=exactMetaVideo;
                resolver="instagram_crawler_meta";
              }
            }
            if(!thumbnailUrl)thumbnailUrl=anchored.thumbnail||extractCrawlerThumbnail(textBody)||extractExactPageThumbnail(textBody)||"";
          }
        }catch(e){attempts.push({resolver:"instagram_crawler",error:readableError(e)})}
      }

      // 5) Browser page variants as a compatibility fallback.
      if(!videoUrl){
        const candidatePages=[
          canonical,
          "https://www.instagram.com/reels/"+shortcode+"/",
          "https://www.instagram.com/p/"+shortcode+"/",
          "https://www.instagram.com/reel/"+shortcode+"/embed/",
          embed,
          canonical+"?__a=1&__d=dis"
        ];
        for(const candidate of candidatePages){
          try{
            const pageRes=await fetch(candidate,{
              headers:{
                "User-Agent":browserUa,
                "Accept":"text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
                "Accept-Language":"pt-BR,pt;q=0.9,en-US;q=0.7,en;q=0.6",
                "Referer":"https://www.instagram.com/",
                "Sec-Fetch-Dest":"document",
                "Sec-Fetch-Mode":"navigate",
                "Sec-Fetch-Site":"same-origin"
              },
              redirect:"follow"
            });
            const bodyText=pageRes.ok?await pageRes.text():"";
            attempts.push({resolver:"instagram_page",status:pageRes.status,bytes:bodyText.length,path:new URL(candidate).pathname});
            if(!bodyText)continue;
            const context=extractContextMedia(bodyText);
            const meta=context?mediaFromObject(context):{video:"",thumbnail:""};
            if(meta.thumbnail&&!thumbnailUrl)thumbnailUrl=meta.thumbnail;
            if(meta.video){
              videoUrl=meta.video;
              resolver=candidate.includes("/embed/")?"instagram_embed_fallback":"instagram_context";
              break;
            }
            const anchored=extractAnchoredMedia(bodyText);
            if(anchored.thumbnail&&!thumbnailUrl)thumbnailUrl=anchored.thumbnail;
            if(anchored.video){
              videoUrl=anchored.video;
              resolver=candidate.includes("/embed/")?"instagram_embed_anchored":"instagram_page_anchored";
              break;
            }
            const exactMetaVideo=extractExactPageVideo(bodyText);
            if(exactMetaVideo){
              videoUrl=exactMetaVideo;
              resolver=candidate.includes("/embed/")?"instagram_embed_meta":"instagram_page_meta";
              break;
            }
            if(!thumbnailUrl)thumbnailUrl=extractExactPageThumbnail(bodyText)||extractCrawlerThumbnail(bodyText)||"";
          }catch(e){attempts.push({resolver:"instagram_page",error:readableError(e)})}
        }
      }

      if(!videoUrl){
        const rateLimited=attempts.some((x:any)=>Number(x.status)===429);
        if(webSessionCookie&&webSessionInvalid){
          return json({
            error:"instagram_web_session_expired",
            user_message:"Sua sessão do Instagram expirou. Atualize o sessionid em Configurações > Integrações.",
            thumbnail_url:thumbnailUrl||null,
            shortcode,
            retryable:false,
            attempts:attempts.slice(-8)
          },422);
        }
        return json({
          error:rateLimited?"instagram_rate_limited":"instagram_video_not_resolved",
          user_message:rateLimited
            ?"O Instagram está limitando temporariamente o servidor. Tente novamente em alguns minutos."
            :webSessionCookie
              ?"O Instagram não liberou esse Reel para a sessão conectada. Verifique se sua conta consegue abrir o Reel normalmente."
              :"Conecte sua sessão do Instagram em Configurações > Integrações para o Extrator acessar Reels que o Instagram bloqueia quando não há login.",
          message:rateLimited
            ?"O Instagram está limitando temporariamente o servidor."
            :"Não consegui obter o arquivo desse Reel.",
          thumbnail_url:thumbnailUrl||null,
          shortcode,
          session_configured:!!webSessionCookie,
          retryable:rateLimited,
          attempts:attempts.slice(-8)
        },rateLimited?429:422);
      }

      const fetchMedia=async(url:string)=>{
        return await fetch(url,{
          headers:{
            "User-Agent":browserUa,
            "Referer":"https://www.instagram.com/",
            "Accept":"video/av1,video/mp4,video/*,*/*;q=0.8",
            ...(webSessionCookie?{"Cookie":webSessionCookie}:{})
          },
          redirect:"follow"
        });
      };

      let mediaRes=await fetchMedia(videoUrl);
      if(!mediaRes.ok||!mediaRes.body){
        return json({
          error:"instagram_video_fetch_failed",
          status:mediaRes.status,
          resolver,
          retryable:[403,429,500,502,503,504].includes(mediaRes.status)
        },422);
      }

      const remoteType=(mediaRes.headers.get("content-type")||"").toLowerCase();
      if(remoteType.includes("text/html")||remoteType.startsWith("image/")){
        await mediaRes.body.cancel().catch(()=>{});
        return json({error:"instagram_video_wrong_type",content_type:remoteType,resolver},422);
      }

      const length=Number(mediaRes.headers.get("content-length")||0);
      if(length>190*1024*1024)return json({error:"video_too_large"},413);

      const blob=await mediaRes.blob();
      if(blob.size>190*1024*1024)return json({error:"video_too_large"},413);
      const contentType=mediaRes.headers.get("content-type")||blob.type||"video/mp4";
      const ext=contentType.includes("webm")?"webm":contentType.includes("quicktime")?"mov":"mp4";
      const id=crypto.randomUUID();
      const path=userData.user.id+"/sources/"+new Date().toISOString().slice(0,10)+"/"+id+"."+ext;

      const {error:uploadError}=await admin.storage.from("frame-extractor").upload(path,blob,{
        contentType,
        upsert:false
      });
      if(uploadError)throw uploadError;

      const {data:signed,error:signError}=await admin.storage.from("frame-extractor").createSignedUrl(path,1200);
      if(signError||!signed?.signedUrl){
        await admin.storage.from("frame-extractor").remove([path]);
        throw signError||new Error("signed_url_failed");
      }

      return json({
        ok:true,
        id,
        shortcode,
        source_url:rawUrl,
        video_url:signed.signedUrl,
        thumbnail_url:thumbnailUrl||null,
        content_type:contentType,
        extension:ext,
        resolver,
        identity_verified:true,
        cleanup_path:path,
        expires_in:1200
      });
    }

    if (req.method === "DELETE" && action === "frame-source") {
      const body=await req.json();
      const path=String(body.path||"");
      const prefix=userData.user.id+"/";
      if(!path||!path.startsWith(prefix))return json({error:"path_invalid"},400);
      const {error}=await admin.storage.from("frame-extractor").remove([path]);
      if(error)throw error;
      return json({ok:true});
    }

    if (req.method === "GET" && resource === "settings") {
      const { data, error } = await admin.from("app_settings").select("key,value").order("key");
      if (error) throw error;
      return json(data);
    }

    if (req.method === "POST" && action === "media-clean-ticket") {
      const body=await req.json();
      const entityType=String(body.entity_type||"video");
      const id=String(body.id||"");
      if(!["video","trial"].includes(entityType))return json({error:"media_clean_entity_invalid"},400);
      if(!id)return json({error:"id_required"},400);

      const {data:setting,error:settingError}=await admin.from("app_settings").select("value").eq("key","media_cleaner").maybeSingle();
      if(settingError)throw settingError;
      const cfg:any=setting?.value||{};
      if(cfg.enabled===false)return json({ok:true,disabled:true});

      let row:any=null;
      if(entityType==="video"){
        const {data,error}=await admin.from("videos")
          .select("id,storage_path,original_storage_path,thumbnail_storage_path,storage_provider,file_name,mime_type,size_bytes,cover_offset_ms,media_clean_status,media_clean_report")
          .eq("id",id).maybeSingle();
        if(error)throw error;
        row=data;
      }else{
        const {data,error}=await admin.from("reel_test_publications")
          .select("id,user_id,storage_path,original_storage_path,thumbnail_storage_path,storage_provider,file_name,cover_offset_ms,media_clean_status,media_clean_report")
          .eq("id",id).eq("user_id",userData.user.id).maybeSingle();
        if(error)throw error;
        row=data;
      }
      if(!row)return json({error:"media_clean_entity_not_found"},404);

      const sourcePath=String(row.original_storage_path||row.storage_path||"");
      const userPrefix=userData.user.id+"/";
      if(!sourcePath.startsWith(userPrefix))return json({error:"media_clean_owner_mismatch"},403);

      if(row.media_clean_status==="ready"&&String(row.storage_path||"").includes("/cleaned/")){
        return json({
          ok:true,already_ready:true,status:"ready",
          report:row.media_clean_report||{},
          target_path:row.storage_path||null,
          thumbnail_path:row.thumbnail_storage_path||null
        });
      }

      const targetPath=userData.user.id+"/cleaned/"+entityType+"/"+id+".mp4";
      const thumbnailPath=userData.user.id+"/thumbnails/"+entityType+"/"+id+".jpg";
      const provider=String(row.storage_provider||"supabase");
      let sourceUrl="",uploadToken="",thumbnailUploadToken="",targetUploadUrl="",thumbnailUploadUrl="";
      if(provider==="r2"){
        const r2=await getCloudentR2Config(admin);
        if(!r2)throw new Error("r2_not_configured");
        [sourceUrl,targetUploadUrl,thumbnailUploadUrl]=await Promise.all([
          r2PresignedUrl(r2,"GET",sourcePath,7200),
          r2PresignedUrl(r2,"PUT",targetPath,7200,"video/mp4"),
          r2PresignedUrl(r2,"PUT",thumbnailPath,7200,"image/jpeg")
        ]);
      }else{
        const [
          {data:signed,error:signError},
          {data:upload,error:uploadError},
          {data:thumbUpload,error:thumbUploadError}
        ]=await Promise.all([
          admin.storage.from("videos").createSignedUrl(sourcePath,7200),
          admin.storage.from("videos").createSignedUploadUrl(targetPath,{upsert:true}),
          admin.storage.from("videos").createSignedUploadUrl(thumbnailPath,{upsert:true})
        ]);
        if(signError||!signed?.signedUrl)throw signError||new Error("media_clean_source_sign_failed");
        if(uploadError||!upload?.token)throw uploadError||new Error("media_clean_upload_sign_failed");
        if(thumbUploadError||!thumbUpload?.token)throw thumbUploadError||new Error("thumbnail_upload_sign_failed");
        sourceUrl=signed.signedUrl;
        uploadToken=upload.token;
        thumbnailUploadToken=thumbUpload.token;
      }

      const patch={
        original_storage_path:sourcePath,
        media_clean_status:"processing",
        media_clean_error:null,
        updated_at:new Date().toISOString()
      };
      if(entityType==="video"){
        const {error}=await admin.from("videos").update(patch).eq("id",id);
        if(error)throw error;
      }else{
        const {error}=await admin.from("reel_test_publications").update(patch).eq("id",id).eq("user_id",userData.user.id);
        if(error)throw error;
      }

      return json({
        ok:true,
        entity_type:entityType,
        id,
        source_url:sourceUrl,
        target_path:targetPath,
        upload_token:uploadToken,
        target_upload_url:targetUploadUrl,
        thumbnail_path:thumbnailPath,
        thumbnail_upload_token:thumbnailUploadToken,
        thumbnail_upload_url:thumbnailUploadUrl,
        storage_provider:provider,
        cover_offset_ms:Number(row.cover_offset_ms||3500),
        bucket:"videos",
        supabase_url:supabaseUrl,
        anon_key:Deno.env.get("SUPABASE_ANON_KEY")||"",
        config:{
          max_input_bytes:Number(cfg.max_input_bytes||262144000),
          crf:Number(cfg.crf||19),
          preset:String(cfg.preset||"veryfast"),
          audio_bitrate_kbps:Number(cfg.audio_bitrate_kbps||128),
          audio_sample_rate:Number(cfg.audio_sample_rate||48000)
        }
      });
    }

    if (req.method === "POST" && action === "media-clean-complete") {
      const body=await req.json();
      const entityType=String(body.entity_type||"video");
      const id=String(body.id||"");
      const targetPath=String(body.target_path||"");
      const thumbnailPath=String(body.thumbnail_path||"");
      let report=(body.report&&typeof body.report==="object")?body.report:{};
      if(!["video","trial"].includes(entityType)||!id)return json({error:"media_clean_entity_invalid"},400);
      const expected=userData.user.id+"/cleaned/"+entityType+"/"+id+".mp4";
      const expectedThumb=userData.user.id+"/thumbnails/"+entityType+"/"+id+".jpg";
      if(targetPath!==expected)return json({error:"media_clean_target_invalid"},400);
      if(thumbnailPath&&thumbnailPath!==expectedThumb)return json({error:"thumbnail_target_invalid"},400);

      let verifyRow:any=null;
      if(entityType==="video"){
        const {data,error}=await admin.from("videos").select("id,storage_provider,storage_path,original_storage_path").eq("id",id).maybeSingle();
        if(error)throw error;verifyRow=data;
      }else{
        const {data,error}=await admin.from("reel_test_publications").select("id,user_id,storage_provider,storage_path,original_storage_path")
          .eq("id",id).eq("user_id",userData.user.id).maybeSingle();
        if(error)throw error;verifyRow=data;
      }
      if(!verifyRow)return json({error:"media_clean_entity_not_found"},404);
      const verifyProvider=String(verifyRow.storage_provider||"supabase");
      if(!(await storageObjectExists(admin,verifyProvider,targetPath)))return json({error:"media_clean_output_missing"},409);
      const thumbnailReady=thumbnailPath?await storageObjectExists(admin,verifyProvider,thumbnailPath):false;

      const inputHash=String(report.input_sha256||"");
      if(inputHash){
        const [{count:videoMatches},{count:trialMatches}]=await Promise.all([
          admin.from("videos").select("id",{count:"exact",head:true})
            .contains("media_clean_report",{input_sha256:inputHash}).neq("id",id),
          admin.from("reel_test_publications").select("id",{count:"exact",head:true})
            .contains("media_clean_report",{input_sha256:inputHash}).neq("id",id)
        ]);
        report={...report,exact_duplicate_matches:Number(videoMatches||0)+Number(trialMatches||0)};
      }

      const now=new Date().toISOString();
      if(entityType==="video"){
        const {data:row,error:readError}=await admin.from("videos")
          .select("id,storage_path,original_storage_path").eq("id",id).maybeSingle();
        if(readError)throw readError;
        if(!row)return json({error:"media_clean_entity_not_found"},404);
        const original=String(row.original_storage_path||row.storage_path||"");
        if(!original.startsWith(userData.user.id+"/"))return json({error:"media_clean_owner_mismatch"},403);
        const patch:any={
          original_storage_path:original,
          storage_path:targetPath,
          thumbnail_storage_path:thumbnailReady?thumbnailPath:null,
          mime_type:"video/mp4",
          media_clean_status:"ready",
          media_clean_report:report,
          media_cleaned_at:now,
          media_clean_error:null,
          updated_at:now
        };
        if(Number.isFinite(Number(report.output_bytes)))patch.size_bytes=Number(report.output_bytes);
        if(Number.isFinite(Number(report.width)))patch.width=Number(report.width);
        if(Number.isFinite(Number(report.height)))patch.height=Number(report.height);
        if(Number.isFinite(Number(report.duration_seconds)))patch.duration_seconds=Number(report.duration_seconds);
        const {error}=await admin.from("videos").update(patch).eq("id",id);
        if(error)throw error;
      }else{
        const {data:row,error:readError}=await admin.from("reel_test_publications")
          .select("id,user_id,storage_path,original_storage_path").eq("id",id).eq("user_id",userData.user.id).maybeSingle();
        if(readError)throw readError;
        if(!row)return json({error:"media_clean_entity_not_found"},404);
        const original=String(row.original_storage_path||row.storage_path||"");
        const {error}=await admin.from("reel_test_publications").update({
          original_storage_path:original,
          storage_path:targetPath,
          thumbnail_storage_path:thumbnailReady?thumbnailPath:null,
          media_clean_status:"ready",
          media_clean_report:report,
          media_cleaned_at:now,
          media_clean_error:null,
          updated_at:now
        }).eq("id",id).eq("user_id",userData.user.id);
        if(error)throw error;
      }

      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"media_clean_ready",
        message:"Vídeo normalizado antes da publicação",
        meta:{
          user_id:userData.user.id,entity_type:entityType,entity_id:id,
          input_sha256:report.input_sha256||null,output_sha256:report.output_sha256||null,
          input_bytes:report.input_bytes||null,output_bytes:report.output_bytes||null
        }
      });
      return json({ok:true,status:"ready",thumbnail_path:thumbnailReady?thumbnailPath:null});
    }

    if (req.method === "POST" && action === "media-clean-fail") {
      const body=await req.json();
      const entityType=String(body.entity_type||"video");
      const id=String(body.id||"");
      const message=String(body.error||"Falha ao normalizar o vídeo.").slice(0,700);
      if(!["video","trial"].includes(entityType)||!id)return json({error:"media_clean_entity_invalid"},400);

      const {data:setting}=await admin.from("app_settings").select("value").eq("key","media_cleaner").maybeSingle();
      const cfg:any=setting?.value||{};
      const failOpen=cfg.fail_open!==false;
      const workerEnabled=cfg.worker_enabled!==false;
      const maxAttempts=Math.max(1,Math.min(5,Number(cfg.max_attempts||3)));
      const permanent=/video_too_large|source_not_allowed|target_invalid|upload_token_invalid/i.test(message);

      let attempts=0;
      let original="";
      if(entityType==="video"){
        const {data:row,error:readError}=await admin.from("videos")
          .select("id,storage_path,original_storage_path,media_clean_attempts").eq("id",id).maybeSingle();
        if(readError)throw readError;
        if(!row)return json({error:"media_clean_entity_not_found"},404);
        original=String(row.original_storage_path||row.storage_path||"");
        attempts=Number(row.media_clean_attempts||0);
        if(!original.startsWith(userData.user.id+"/"))return json({error:"media_clean_owner_mismatch"},403);
      }else{
        const {data:row,error:readError}=await admin.from("reel_test_publications")
          .select("id,storage_path,original_storage_path,media_clean_attempts")
          .eq("id",id).eq("user_id",userData.user.id).maybeSingle();
        if(readError)throw readError;
        if(!row)return json({error:"media_clean_entity_not_found"},404);
        original=String(row.original_storage_path||row.storage_path||"");
        attempts=Number(row.media_clean_attempts||0);
      }

      const retry=workerEnabled&&!permanent&&attempts<maxAttempts;
      const status=retry?"pending":(failOpen?"skipped":"failed");
      const now=new Date();
      const patch:any={
        storage_path:original,
        media_clean_status:status,
        media_clean_error:message,
        media_clean_next_attempt_at:retry?new Date(now.getTime()+60_000).toISOString():now.toISOString(),
        updated_at:now.toISOString()
      };

      if(entityType==="video"){
        const {error}=await admin.from("videos").update(patch).eq("id",id);
        if(error)throw error;
      }else{
        const {error}=await admin.from("reel_test_publications").update(patch)
          .eq("id",id).eq("user_id",userData.user.id);
        if(error)throw error;
      }

      await admin.from("activity_logs").insert({
        level:retry?"warn":"error",
        event_type:"media_clean_error",
        message:retry?"Media Cleaner vai tentar novamente: "+message:"Media Cleaner deu erro: "+message,
        meta:{
          user_id:userData.user.id,entity_type:entityType,entity_id:id,fail_open:failOpen,
          retry,attempts,max_attempts:maxAttempts,permanent
        }
      });
      return json({ok:true,status,fail_open:failOpen,retry});
    }

    if (req.method === "POST" && action === "media-access-audit") {
      const body=await req.json();
      const kind=String(body.kind||"video_preview");
      const videoId=String(body.video_id||"");
      const estimatedClient=Math.max(0,Math.min(500*1024*1024,Number(body.estimated_bytes||0)||0));
      let estimatedBytes=estimatedClient;
      let countsTowardSupabaseEgress=true;

      if(videoId){
        const {data:v,error:vError}=await admin.from("videos")
          .select("id,size_bytes,storage_provider").eq("id",videoId).maybeSingle();
        if(vError)throw vError;
        if(v?.size_bytes)estimatedBytes=Math.max(estimatedBytes,Number(v.size_bytes||0));
        // CloudentFlow egress guard tracks Supabase Storage only.
        // R2-backed previews must not inflate the Supabase egress estimate.
        countsTowardSupabaseEgress=String(v?.storage_provider||"supabase")!=="r2";
      }
      const estimatedSupabaseBytes=countsTowardSupabaseEgress
        ? (kind==="thumbnail"?Math.min(estimatedBytes,250000):estimatedBytes)
        : 0;

      const day=new Date().toISOString().slice(0,10);
      const {data:current,error:readError}=await admin.from("media_access_daily")
        .select("*").eq("user_id",userData.user.id).eq("day",day).maybeSingle();
      if(readError)throw readError;

      const next:any={
        user_id:userData.user.id,
        day,
        video_preview_requests:Number(current?.video_preview_requests||0)+(kind==="video_preview"||kind==="production_preview"?1:0),
        trial_preview_requests:Number(current?.trial_preview_requests||0)+(kind==="trial_preview"?1:0),
        thumbnail_requests:Number(current?.thumbnail_requests||0)+(kind==="thumbnail"?1:0),
        estimated_bytes:Number(current?.estimated_bytes||0)+estimatedSupabaseBytes,
        last_access_at:new Date().toISOString()
      };
      const {data:saved,error:saveError}=await admin.from("media_access_daily")
        .upsert(next,{onConflict:"user_id,day"}).select().single();
      if(saveError)throw saveError;

      const {data:guardRow,error:guardError}=await admin.from("app_settings").select("value").eq("key","egress_guard").maybeSingle();
      if(guardError)throw guardError;
      const guard:any=guardRow?.value||{};
      const warn=Number(guard.daily_warn_bytes||125829120);
      const critical=Number(guard.daily_critical_bytes||167772160);
      const total=Number(saved?.estimated_bytes||0);

      if(guard.enabled!==false&&total>=critical){
        await admin.from("system_notifications").upsert({
          user_id:userData.user.id,
          severity:"error",
          category:"system",
          title:"Egress diário alto",
          body:"O CloudentFlow estimou "+Math.round(total/1048576)+" MB de mídia lida hoje. Previews continuam sob demanda.",
          source_event_type:"egress_guard_critical",
          source_ref:day,
          dedupe_key:"egress_guard:"+userData.user.id+":"+day+":critical",
          status:"pending",
          meta:{estimated_bytes:total,critical_bytes:critical,official_supabase_usage:false}
        },{onConflict:"dedupe_key"});
        wakeNotificationWorker(admin,supabaseUrl).catch(()=>{});
      }else if(guard.enabled!==false&&total>=warn){
        await admin.from("system_notifications").upsert({
          user_id:userData.user.id,
          severity:"warn",
          category:"system",
          title:"Egress em atenção",
          body:"O CloudentFlow estimou "+Math.round(total/1048576)+" MB de mídia lida hoje.",
          source_event_type:"egress_guard_warn",
          source_ref:day,
          dedupe_key:"egress_guard:"+userData.user.id+":"+day+":warn",
          status:"pending",
          meta:{estimated_bytes:total,warn_bytes:warn,official_supabase_usage:false}
        },{onConflict:"dedupe_key"});
      }

      return json({ok:true,day,estimated_bytes:total,warn_bytes:warn,critical_bytes:critical});
    }

    if (req.method === "POST" && action === "upload-ticket") {
      const body=await req.json();
      const scheduledAt=String(body.scheduled_at||"");
      const fileName=String(body.file_name||"video.mp4").slice(0,255);
      const mimeType=String(body.mime_type||"video/mp4").slice(0,120);
      const sizeBytes=Math.max(0,Number(body.size_bytes||0));
      if(!scheduledAt||Number.isNaN(Date.parse(scheduledAt)))return json({error:"scheduled_at_invalid"},400);
      if(!sizeBytes)return json({error:"file_size_invalid"},400);
      const cfg=await getCloudentR2Config(admin);
      if(!cfg)return json({ok:true,fallback:true,provider:"supabase"});
      const ext=safeMediaExt(fileName,"mp4");
      const objectPath=userData.user.id+"/uploads/"+new Date().toISOString().slice(0,10)+"/"+crypto.randomUUID()+"."+ext;
      const uploadUrl=await r2PresignedUrl(cfg,"PUT",objectPath,900,mimeType);
      return json({ok:true,fallback:false,provider:"r2",object_path:objectPath,upload_url:uploadUrl,content_type:mimeType,expires_in:900});
    }

    if (req.method === "POST" && action === "upload-complete") {
      const body=await req.json();
      const objectPath=String(body.object_path||"");
      const scheduledAt=String(body.scheduled_at||"");
      const caption=String(body.caption||"");
      const smartMode=String(body.smart_mode||"manual");
      const smartStrategy=String(body.smart_strategy||(smartMode==="auto"?"tested":"manual"));
      const platformRaw=String(body.platform||"instagram").toLowerCase();
      const platform=platformRaw==="x"?"x":"instagram";
      const fileName=String(body.file_name||"video.mp4").slice(0,255);
      const mimeType=String(body.mime_type||"video/mp4").slice(0,120);
      const sizeBytes=Math.max(0,Number(body.size_bytes||0));
      if(!objectPath.startsWith(userData.user.id+"/uploads/"))return json({error:"upload_path_invalid"},403);
      if(!scheduledAt||Number.isNaN(Date.parse(scheduledAt)))return json({error:"scheduled_at_invalid"},400);
      const cfg=await getCloudentR2Config(admin);
      if(!cfg)return json({error:"r2_not_configured"},409);

      const headUrl=await r2PresignedUrl(cfg,"HEAD",objectPath,300);
      const head=await fetch(headUrl,{method:"HEAD"});
      if(!head.ok)return json({error:"r2_object_missing",user_message:"O upload para o R2 não foi confirmado.",status:head.status},409);
      const storedBytes=Number(head.headers.get("content-length")||0);
      if(sizeBytes>0&&storedBytes>0&&storedBytes!==sizeBytes){
        return json({error:"r2_size_mismatch",user_message:"O arquivo enviado não terminou corretamente. Tente novamente."},409);
      }

      let platformAccountId:string|null=null;
      if(platform==="instagram"){
        platformAccountId=await resolveCalendarInstagramAccount(admin,body.platform_account_id);
      }

      const {data:video,error:videoError}=await admin.from("videos").insert({
        storage_path:objectPath,storage_provider:"r2",file_name:fileName,mime_type:mimeType,
        size_bytes:storedBytes||sizeBytes,caption,status:"scheduled",platform,platform_account_id:platformAccountId,
        cover_offset_ms:3500,cover_strategy:"auto_after_3s"
      }).select().single();
      if(videoError){
        await storageDeletePaths(admin,"r2",[objectPath]).catch(()=>null);
        throw videoError;
      }

      const {data:schedule,error:scheduleError}=await admin.from("schedules").insert({
        video_id:video.id,scheduled_at:scheduledAt,status:"scheduled",smart_mode:smartMode,
        smart_strategy:["tested","test","manual"].includes(smartStrategy)?smartStrategy:(smartMode==="auto"?"tested":"manual"),
        platform,platform_account_id:platformAccountId
      }).select().single();
      if(scheduleError){
        await admin.from("videos").delete().eq("id",video.id);
        await storageDeletePaths(admin,"r2",[objectPath]).catch(()=>null);
        throw scheduleError;
      }

      await admin.from("job_queue").insert({
        job_type:platform==="x"?"publish_x_video":"publish_reel",platform,platform_account_id:platformAccountId,
        schedule_id:schedule.id,run_at:scheduledAt,payload:{schedule_id:schedule.id}
      });
      await admin.from("activity_logs").insert({
        level:"info",event_type:"schedule_created",message:"Vídeo enviado direto ao R2 e agendado",
        meta:{schedule_id:schedule.id,video_id:video.id,user_id:userData.user.id,storage_provider:"r2"}
      });
      return json({ok:true,video,schedule},201);
    }

    if (req.method === "POST" && action === "upload") {
      const form = await req.formData();
      const file = form.get("file");
      const scheduledAt = String(form.get("scheduled_at") || "");
      const caption = String(form.get("caption") || "");
      const smartMode = String(form.get("smart_mode") || "manual");
      const smartStrategy = String(form.get("smart_strategy") || (smartMode==="auto"?"tested":"manual"));
      const platformRaw=String(form.get("platform")||"instagram").toLowerCase();
      const platform=platformRaw==="x"?"x":"instagram";
      let platformAccountId:string|null=null;
      if(platform==="instagram"){
        platformAccountId=await resolveCalendarInstagramAccount(admin,form.get("platform_account_id"));
      }

      if (!(file instanceof File)) return json({ error: "file_required" }, 400);
      if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) return json({ error: "scheduled_at_invalid" }, 400);

      const ext = file.name.includes(".") ? file.name.split(".").pop() : "mp4";
      const objectPath = `${userData.user.id}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await admin.storage.from("videos").upload(objectPath, file, {
        contentType: file.type || "video/mp4",
        upsert: false
      });
      if (uploadError) throw uploadError;

      const { data: video, error: videoError } = await admin.from("videos").insert({
        storage_path: objectPath,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        caption,
        status: "scheduled",
        platform,
        platform_account_id: platformAccountId,
        cover_offset_ms:3500,
        cover_strategy:"auto_after_3s"
      }).select().single();

      if (videoError) {
        await admin.storage.from("videos").remove([objectPath]);
        throw videoError;
      }

      const { data: schedule, error: scheduleError } = await admin.from("schedules").insert({
        video_id: video.id,
        scheduled_at: scheduledAt,
        status: "scheduled",
        smart_mode: smartMode,
        smart_strategy: ["tested","test","manual"].includes(smartStrategy) ? smartStrategy : (smartMode==="auto"?"tested":"manual"),
        platform,
        platform_account_id: platformAccountId
      }).select().single();

      if (scheduleError) {
        await admin.from("videos").delete().eq("id", video.id);
        await admin.storage.from("videos").remove([objectPath]);
        throw scheduleError;
      }

      await admin.from("job_queue").insert({
        job_type: platform==="x" ? "publish_x_video" : "publish_reel",
        platform,
        platform_account_id: platformAccountId,
        schedule_id: schedule.id,
        run_at: scheduledAt,
        payload: { schedule_id: schedule.id }
      });

      await admin.from("activity_logs").insert({
        level: "info",
        event_type: "schedule_created",
        message: "Vídeo enviado e agendado",
        meta: { schedule_id: schedule.id, video_id: video.id, user_id: userData.user.id }
      });

      return json({ ok: true, video, schedule }, 201);
    }


    if (req.method === "PATCH" && action === "runninghub-config") {
      const body=await req.json();
      const {data:current,error:readError}=await admin.from("integrations").select("config,enabled").eq("provider","runninghub").maybeSingle();
      if(readError)throw readError;
      const cfg:any={...(current?.config||{})};
      if(body.workflowId!==undefined){
        const rawWorkflow=String(body.workflowId||"").trim();
        const match=rawWorkflow.match(/(\d{10,})/);
        cfg.workflowId=match?match[1]:rawWorkflow;
      }
      if(body.videoNodeId!==undefined)cfg.videoNodeId=String(body.videoNodeId||"").trim();
      if(body.videoFieldName!==undefined)cfg.videoFieldName=String(body.videoFieldName||"video").trim()||"video";
      if(body.frameNodeId!==undefined)cfg.frameNodeId=String(body.frameNodeId||"").trim();
      if(body.frameFieldName!==undefined)cfg.frameFieldName=String(body.frameFieldName||"image").trim()||"image";
      if(body.concurrency!==undefined)cfg.concurrency=Math.max(1,Math.min(10,Number(body.concurrency)||1));
      if(body.apiKey!==undefined && String(body.apiKey||"").trim()){
        const plain=String(body.apiKey).trim();
        if(plain.length<8)return json({error:"runninghub_api_key_invalid"},400);
        const {data:master,error:masterError}=await admin.rpc("get_cloudent_worker_secret");
        if(masterError||!master)throw masterError||new Error("worker_secret_missing");
        const encrypted=await runninghubEncrypt(plain,String(master));
        cfg.apiKeyCipher=encrypted.cipher;
        cfg.apiKeyIv=encrypted.iv;
        cfg.apiKeyConfigured=true;
      }
      cfg.baseUrl="https://www.runninghub.ai";
      const enabled=body.enabled!==undefined?!!body.enabled:!!current?.enabled;
      const {error:updateError}=await admin.from("integrations").update({config:cfg,enabled,updated_at:new Date().toISOString()}).eq("provider","runninghub");
      if(updateError)throw updateError;
      await admin.from("activity_logs").insert({
        level:"info",event_type:"runninghub_config_updated",message:"Configuração do workflow RunningHub atualizada",
        meta:{user_id:userData.user.id,workflow_configured:!!cfg.workflowId}
      });
      return json({ok:true});
    }


    if (req.method === "PATCH" && action === "runninghub-test") {
      const {data:integration,error:intError}=await admin.from("integrations")
        .select("enabled,config").eq("provider","runninghub").maybeSingle();
      if(intError)throw intError;
      const cfg:any=integration?.config||{};
      const workflowId=String(cfg.workflowId||"").trim();
      const videoNodeId=String(cfg.videoNodeId||"336").trim();
      const frameNodeId=String(cfg.frameNodeId||"338").trim();

      if(!cfg.apiKeyCipher||!cfg.apiKeyIv)return json({ok:false,error:"runninghub_api_key_missing"},400);
      if(!/^\d{10,}$/.test(workflowId))return json({ok:false,error:"runninghub_workflow_id_invalid"},400);

      const {data:master,error:masterError}=await admin.rpc("get_cloudent_worker_secret");
      if(masterError||!master)throw masterError||new Error("worker_secret_missing");

      let apiKey="";
      try{
        apiKey=await runninghubDecrypt(String(cfg.apiKeyCipher),String(cfg.apiKeyIv),String(master));
      }catch{
        return json({ok:false,error:"runninghub_api_key_decrypt_failed"},400);
      }

      const accountRes=await fetch("https://www.runninghub.ai/uc/openapi/accountStatus",{
        method:"POST",
        headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
        body:JSON.stringify({apikey:apiKey})
      });
      let account:any={};try{account=await accountRes.json()}catch{}
      if(!accountRes.ok||Number(account?.code)!==0){
        return json({ok:false,error:"runninghub_api_key_rejected",message:account?.msg||"API Key recusada"},400);
      }

      async function fetchWorkflowInfo(base:string){
        const r=await fetch(base+"/api/openapi/getJsonApiFormat",{
          method:"POST",
          headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
          body:JSON.stringify({apiKey,workflowId})
        });
        let j:any={};try{j=await r.json()}catch{}
        return {r,j};
      }

      let wf=await fetchWorkflowInfo("https://www.runninghub.ai");
      if(!wf.r.ok||Number(wf.j?.code)!==0)wf=await fetchWorkflowInfo("https://www.runninghub.cn");
      if(!wf.r.ok||Number(wf.j?.code)!==0){
        return json({
          ok:false,
          error:"runninghub_workflow_not_accessible",
          message:wf.j?.msg||"Workflow não encontrado ou sem acesso.",
          account:{apiType:account?.data?.apiType||null,currentTaskCounts:account?.data?.currentTaskCounts||null}
        },400);
      }

      let prompt:any={};
      try{
        const rawPrompt=wf.j?.data?.prompt;
        prompt=typeof rawPrompt==="string"?JSON.parse(rawPrompt):(rawPrompt||{});
      }catch{}

      const videoNode=prompt?.[videoNodeId]||null;
      const frameNode=prompt?.[frameNodeId]||null;
      const videoField=String(cfg.videoFieldName||"video");
      const frameField=String(cfg.frameFieldName||"image");
      const videoFieldFound=!!videoNode?.inputs && Object.prototype.hasOwnProperty.call(videoNode.inputs,videoField);
      const frameFieldFound=!!frameNode?.inputs && Object.prototype.hasOwnProperty.call(frameNode.inputs,frameField);

      const result={
        ok:!!videoNode&&!!frameNode,
        api_key:true,
        workflow:true,
        workflowId,
        nodes:{
          video:{id:videoNodeId,found:!!videoNode,class_type:videoNode?.class_type||null,field:videoField,field_found:videoFieldFound},
          frame:{id:frameNodeId,found:!!frameNode,class_type:frameNode?.class_type||null,field:frameField,field_found:frameFieldFound}
        },
        account:{
          apiType:account?.data?.apiType||null,
          currentTaskCounts:account?.data?.currentTaskCounts||null,
          remainCoins:account?.data?.remainCoins||null
        }
      };

      await admin.from("integrations").update({
        last_verified_at:new Date().toISOString(),
        config:{...cfg,lastTestAt:new Date().toISOString(),lastTestOk:result.ok}
      }).eq("provider","runninghub");

      return json(result,result.ok?200:409);
    }

    if (req.method === "PATCH" && action === "automation-settings") {
      const body = await req.json();
      const { data: rows, error: readError } = await admin.from("app_settings")
        .select("key,value")
        .in("key",["automation","smart_scheduler","min_gap_minutes","posts_per_day"]);
      if (readError) throw readError;
      const current = Object.fromEntries((rows || []).map((x:any)=>[x.key,x.value]));
      const automation = { ...(current.automation || {}) };
      const smart = { ...(current.smart_scheduler || {}) };

      if (body.enabled !== undefined) automation.enabled = !!body.enabled;
      if (body.autoOptimizeCalendar !== undefined) automation.autoOptimizeCalendar = !!body.autoOptimizeCalendar;
      if (body.lockWindowMinutes !== undefined) automation.lockWindowMinutes = Math.max(30, Math.min(1440, Number(body.lockWindowMinutes) || 120));
      if (body.smartEnabled !== undefined) smart.enabled = !!body.smartEnabled;
      if (body.lookbackDays !== undefined) smart.lookbackDays = Math.max(7, Math.min(180, Number(body.lookbackDays) || 60));
      if (body.minSamples !== undefined) smart.minSamples = Math.max(1, Math.min(20, Number(body.minSamples) || 3));

      const updates:any[] = [
        { key:"automation", value:automation },
        { key:"smart_scheduler", value:smart }
      ];
      if (body.minGapMinutes !== undefined) updates.push({key:"min_gap_minutes",value:Math.max(30,Math.min(360,Number(body.minGapMinutes)||60))});
      if (body.postsPerDay !== undefined) updates.push({key:"posts_per_day",value:Math.max(1,Math.min(10,Number(body.postsPerDay)||5))});

      const { error: upError } = await admin.from("app_settings").upsert(updates,{onConflict:"key"});
      if (upError) throw upError;

      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"automation_settings_updated",
        message:"Configurações de automação atualizadas",
        meta:{user_id:userData.user.id}
      });

      return json({ok:true});
    }

    if (req.method === "PATCH" && action === "cover-offset") {
      const body=await req.json();
      const videoId=String(body.video_id||"").trim();
      const trialId=String(body.trial_id||"").trim();
      const requested=Math.round(Number(body.offset_ms||0));
      if(!videoId&&!trialId)return json({error:"cover_target_required"},400);
      if(!Number.isFinite(requested)||requested<3000)return json({error:"cover_offset_must_be_after_3s",user_message:"A capa precisa ser escolhida depois dos 3 segundos iniciais."},400);

      let finalOffset=Math.min(60000,requested);
      let effectiveVideoId=videoId||null;

      if(videoId){
        const {data:video,error:videoError}=await admin.from("videos")
          .select("id,duration_seconds").eq("id",videoId).maybeSingle();
        if(videoError)throw videoError;
        if(!video)return json({error:"video_not_found"},404);
        const durationMs=Number(video.duration_seconds||0)*1000;
        if(durationMs>0){
          if(durationMs<=3100)return json({error:"video_too_short_for_cover_rule",user_message:"Este vídeo é curto demais para escolher uma capa após 3 segundos."},409);
          finalOffset=Math.min(finalOffset,Math.max(3000,Math.floor(durationMs-120)));
        }
        const {error:updateVideoError}=await admin.from("videos").update({
          cover_offset_ms:finalOffset,
          cover_strategy:"manual_after_3s",
          updated_at:new Date().toISOString()
        }).eq("id",videoId);
        if(updateVideoError)throw updateVideoError;

        const {error:linkedTrialError}=await admin.from("reel_test_publications").update({
          cover_offset_ms:finalOffset,
          cover_strategy:"manual_after_3s",
          updated_at:new Date().toISOString()
        }).eq("source_video_id",videoId).neq("status","published");
        if(linkedTrialError)throw linkedTrialError;
      }

      if(trialId){
        const {data:trial,error:trialError}=await admin.from("reel_test_publications")
          .select("id,source_video_id,status").eq("id",trialId).eq("user_id",userData.user.id).maybeSingle();
        if(trialError)throw trialError;
        if(!trial)return json({error:"trial_not_found"},404);
        if(trial.status==="published")return json({error:"trial_already_published"},409);
        effectiveVideoId=trial.source_video_id||effectiveVideoId;
        const {error:updateTrialError}=await admin.from("reel_test_publications").update({
          cover_offset_ms:finalOffset,
          cover_strategy:"manual_after_3s",
          updated_at:new Date().toISOString()
        }).eq("id",trialId).eq("user_id",userData.user.id);
        if(updateTrialError)throw updateTrialError;

        if(trial.source_video_id){
          const {data:video,error:videoError}=await admin.from("videos")
            .select("id,duration_seconds").eq("id",trial.source_video_id).maybeSingle();
          if(videoError)throw videoError;
          const durationMs=Number(video?.duration_seconds||0)*1000;
          if(durationMs>3100)finalOffset=Math.min(finalOffset,Math.max(3000,Math.floor(durationMs-120)));
          const {error:updateVideoError}=await admin.from("videos").update({
            cover_offset_ms:finalOffset,
            cover_strategy:"manual_after_3s",
            updated_at:new Date().toISOString()
          }).eq("id",trial.source_video_id);
          if(updateVideoError)throw updateVideoError;
        }
      }

      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"cover_frame_updated",
        message:"Capa manual atualizada",
        meta:{user_id:userData.user.id,video_id:effectiveVideoId,trial_id:trialId||null,cover_offset_ms:finalOffset}
      });

      return json({ok:true,cover_offset_ms:finalOffset,cover_strategy:"manual_after_3s"});
    }

    if (req.method === "PATCH" && action === "schedule") {
      const body = await req.json();
      const id = String(body.id || "");
      if (!id) return json({ error: "id_required" }, 400);

      const schedulePatch: Record<string, unknown> = {};
      for (const key of ["scheduled_at","status","smart_mode","smart_strategy","smart_strategy_locked","last_error"]) {
        if (body[key] !== undefined) schedulePatch[key] = body[key];
      }

      const { data: current, error: currentError } = await admin
        .from("schedules").select("id,video_id,scheduled_at,status").eq("id", id).single();
      if (currentError) throw currentError;

      if (Object.keys(schedulePatch).length) {
        const { error } = await admin.from("schedules").update(schedulePatch).eq("id", id);
        if (error) throw error;
      }

      if (body.caption !== undefined) {
        const { error } = await admin.from("videos").update({ caption: String(body.caption) }).eq("id", current.video_id);
        if (error) throw error;
      }

      const { data: updated, error: updatedError } = await admin
        .from("schedules")
        .select("id,video_id,scheduled_at,status,smart_mode,smart_strategy,smart_strategy_locked,videos(file_name,caption,storage_path,size_bytes,mime_type)")
        .eq("id", id).single();
      if (updatedError) throw updatedError;

      if (schedulePatch.scheduled_at || schedulePatch.status === "scheduled") {
        await admin.from("job_queue")
          .update({ status: "cancelled" })
          .eq("schedule_id", id)
          .eq("job_type", "publish_reel")
          .eq("status", "pending");

        if (updated.status === "scheduled") {
          await admin.from("job_queue").insert({
            job_type: "publish_reel",
            schedule_id: id,
            run_at: updated.scheduled_at,
            payload: { schedule_id: id }
          });
        }
      }

      return json({ ok: true, schedule: updated });
    }

    if (req.method === "DELETE" && action === "schedule") {
      const body = await req.json();
      const id = String(body.id || "");
      if (!id) return json({ error: "id_required" }, 400);

      const { data: sched, error: readError } = await admin
        .from("schedules")
        .select("video_id,videos(storage_path,original_storage_path,storage_provider)")
        .eq("id", id)
        .single();
      if (readError) throw readError;

      const storagePath = (sched as any)?.videos?.storage_path;
      const originalPath = (sched as any)?.videos?.original_storage_path;
      const provider=String((sched as any)?.videos?.storage_provider||"supabase");
      const removePaths=[storagePath,originalPath].filter((x:any,i:number,a:any[])=>x&&a.indexOf(x)===i);
      if (removePaths.length) await storageDeletePaths(admin,provider,removePaths);

      const { error } = await admin.from("videos").delete().eq("id", sched.video_id);
      if (error) throw error;

      return json({ ok: true });
    }

    return json({ error: "route_not_found" }, 404);
  } catch (error) {
    const message = readableError(error);
    try {
      await admin.from("activity_logs").insert({
        level: "error",
        event_type: "backend_error",
        message,
        meta: { method: req.method }
      });
    } catch {}
    return json({ ok: false, error: message }, 500);
  }
});
