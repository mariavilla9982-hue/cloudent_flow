import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const H={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
  "Content-Type":"application/json; charset=utf-8"
};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const te=new TextEncoder();
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const requiredScopes=["instagram_business_basic","instagram_business_content_publish"];
const returnPages=new Set(["calendar","accounts","settings"]);
const oauthFailureCodes=[
  "instagram_scope_denied","instagram_already_connected","instagram_already_linked",
  "instagram_daughter_limit","instagram_mother_unavailable","reconnect_account_mismatch"
];

async function activeSession(admin:any,userId:string,sessionId:string){
  if(!uuid.test(sessionId))return false;
  const {data,error}=await admin.rpc("cloudent_auth_session_active",{p_session_id:sessionId,p_user_id:userId});
  if(error)throw error;
  return data===true;
}

function envFirst(...names:string[]){
  for(const name of names){const value=String(Deno.env.get(name)||"").trim();if(value)return {name,value}}
  return {name:"",value:""};
}
function b64url(bytes:Uint8Array){
  let s="";for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function unb64url(value:string){
  const base=value.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((value.length+3)%4);
  const raw=atob(base);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;
}
async function hmacKey(){
  const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  return crypto.subtle.importKey("raw",te.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
}
async function makeState(payload:any){
  const body=b64url(te.encode(JSON.stringify(payload)));
  const sig=new Uint8Array(await crypto.subtle.sign("HMAC",await hmacKey(),te.encode(body)));
  return body+"."+b64url(sig);
}
async function readState(state:string){
  try{
    const [body,sig]=String(state||"").split(".");if(!body||!sig)return null;
    const ok=await crypto.subtle.verify("HMAC",await hmacKey(),unb64url(sig),te.encode(body));if(!ok)return null;
    const payload=JSON.parse(new TextDecoder().decode(unb64url(body)));
    if(!payload?.uid||!payload?.exp||Date.now()>Number(payload.exp))return null;
    return payload;
  }catch{return null}
}
function frontendUrl(){return String(Deno.env.get("CLOUDENT_FRONTEND_URL")||"https://cloudent-flow.vercel.app").replace(/\/$/,"")}
function redirectUri(){return String(Deno.env.get("SUPABASE_URL")||"").replace(/\/$/,"")+"/functions/v1/instagram-oauth"}
function oauthConfig(){
  const id=envFirst("INSTAGRAM_APP_ID","IG_APP_ID","META_INSTAGRAM_APP_ID");
  const secret=envFirst("INSTAGRAM_APP_SECRET","IG_APP_SECRET","META_INSTAGRAM_APP_SECRET");
  return {id,secret};
}
function redirect(status:string,extra:Record<string,string>={}){
  const u=new URL(frontendUrl()+"/");u.searchParams.set("instagram_oauth",status);
  for(const [k,v] of Object.entries(extra))if(v)u.searchParams.set(k,v);
  return Response.redirect(u.toString(),302);
}
async function getJson(url:string,token:string){
  const r=await fetch(url,{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(12000)});let j:any={};try{j=await r.json()}catch{}
  if(!r.ok||j?.error)throw new Error(j?.error?.message||("Instagram API "+r.status));return j;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  const url=new URL(req.url);const cfg=oauthConfig();
  if(req.method==="GET"&&url.searchParams.get("health")==="1"){
    return out({ok:true,configured:Boolean(cfg.id.value&&cfg.secret.value),app_id_configured:Boolean(cfg.id.value),app_secret_configured:Boolean(cfg.secret.value),app_id_env:cfg.id.name||null,app_secret_env:cfg.secret.name||null,redirect_uri:redirectUri()});
  }

  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});

  if(req.method==="POST"){
    const bearer=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"")||"";
    const {data:a}=await admin.auth.getUser(bearer);
    if(!a.user)return out({error:"unauthorized",user_message:"Entre no CloudentFlow primeiro."},401);
    const {data:member,error:memberErr}=await admin.from("app_members").select("role,enabled").eq("user_id",a.user.id).maybeSingle();
    if(memberErr)return out({error:"membership_check_failed"},500);
    if(!member?.enabled||member.role!=="admin")return out({error:"forbidden",user_message:"Somente o administrador pode conectar contas do Instagram."},403);
    let body:any={};try{body=await req.json()}catch{}
    const reconnectId=String(body.platform_account_id||"").trim();
    const motherId=String(body.mother_id||"").trim();
    const destination=returnPages.has(body.return_page)?body.return_page:"settings";
    if((reconnectId&&!uuid.test(reconnectId))||(motherId&&!uuid.test(motherId))||(reconnectId&&motherId)){
      return out({error:"invalid_account_id"},400);
    }
    let sessionId="";
    try{sessionId=JSON.parse(new TextDecoder().decode(unb64url(bearer.split(".")[1]))).session_id||""}catch{}
    if(!await activeSession(admin,a.user.id,sessionId))return out({error:"invalid_user_session"},401);
    if(reconnectId||motherId){
      const {data:accounts,error:scopeError}=await admin.rpc("instagram_scale_accounts",{p_actor:a.user.id});
      if(scopeError)return out({error:"account_check_failed"},503);
      const target=accounts?.find((account:any)=>account.id===(reconnectId||motherId));
      if(!target)return out({error:"account_not_found"},404);
      if(motherId){
        const [{data:pilot,error:pilotError},{count,error:countError}]=await Promise.all([
          admin.from("app_settings").select("value").eq("key","instagram_scale_pilot").maybeSingle(),
          admin.from("instagram_scale_links").select("child_id",{count:"exact",head:true}).eq("mother_id",motherId)
        ]);
        if(pilotError||countError)return out({error:"account_check_failed"},503);
        if(!target.enabled||pilot?.value?.mother_id!==motherId)return out({error:"instagram_mother_unavailable"},409);
        if((count||0)>=2)return out({error:"instagram_daughter_limit",user_message:"As duas vagas de contas filhas já estão vinculadas."},409);
      }
    }
    if(!cfg.id.value||!cfg.secret.value)return out({error:"instagram_oauth_not_configured",user_message:"Configure o Instagram App ID e App Secret no servidor."},503);

    const state=await makeState({uid:a.user.id,sid:sessionId,exp:Date.now()+10*60*1000,nonce:crypto.randomUUID(),reconnect_account_id:reconnectId||null,mother_id:motherId||null,destination});
    const auth=new URL("https://www.instagram.com/oauth/authorize");
    auth.searchParams.set("client_id",cfg.id.value);
    auth.searchParams.set("redirect_uri",redirectUri());
    auth.searchParams.set("response_type","code");
    auth.searchParams.set("scope",[...requiredScopes,"instagram_business_manage_comments","instagram_business_manage_insights"].join(","));
    auth.searchParams.set("state",state);
    auth.searchParams.set("enable_fb_login","0");
    auth.searchParams.set("force_authentication","1");
    return out({ok:true,url:auth.toString(),redirect_uri:redirectUri()});
  }

  if(req.method!=="GET")return out({error:"method_not_allowed"},405);
  const code=String(url.searchParams.get("code")||"").replace(/#_$/g,"");
  const state=await readState(String(url.searchParams.get("state")||""));
  if(!state)return redirect("error",{reason:"invalid_state"});
  const complete=(status:string,extra:Record<string,string>={})=>redirect(status,{...extra,destination:returnPages.has(state.destination)?state.destination:"settings"});
  if(url.searchParams.has("error")||url.searchParams.has("error_reason"))return complete("cancelled");
  if(!code)return complete("error",{reason:"missing_code"});
  if(!cfg.id.value||!cfg.secret.value)return complete("error",{reason:"oauth_not_configured"});

  try{
    const {data:member}=await admin.from("app_members").select("role,enabled").eq("user_id",state.uid).maybeSingle();
    if(!member?.enabled||member.role!=="admin"||!await activeSession(admin,state.uid,state.sid||""))return complete("error",{reason:"forbidden"});

    const form=new URLSearchParams({client_id:cfg.id.value,client_secret:cfg.secret.value,grant_type:"authorization_code",redirect_uri:redirectUri(),code});
    const tokenRes=await fetch("https://api.instagram.com/oauth/access_token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(12000)});
    let short:any={};try{short=await tokenRes.json()}catch{}
    if(!tokenRes.ok)return complete("error",{reason:"meta_authorization_required"});
    const shortData=Array.isArray(short?.data)?short.data[0]:short;
    const shortToken=String(shortData?.access_token||"");
    if(!shortToken)return complete("error",{reason:"meta_authorization_required"});
    const scopes=shortData?.permissions;
    const granted=Array.isArray(scopes)?scopes:typeof scopes==="string"?scopes.split(/[ ,]+/):null;
    if(granted&&!requiredScopes.every(scope=>granted.includes(scope)))return complete("error",{reason:"meta_authorization_required"});

    const longUrl=new URL("https://graph.instagram.com/access_token");
    longUrl.searchParams.set("grant_type","ig_exchange_token");
    longUrl.searchParams.set("client_secret",cfg.secret.value);
    longUrl.searchParams.set("access_token",shortToken);
    const longRes=await fetch(longUrl,{signal:AbortSignal.timeout(12000)});
    const longData=await longRes.json().catch(()=>({}));
    const token=String(longData?.access_token||"");
    const expiresIn=Number(longData?.expires_in);
    if(!longRes.ok||!token||!Number.isFinite(expiresIn)||expiresIn<86400)return complete("error",{reason:"meta_long_token_required"});

    let profileRaw:any;
    try{profileRaw=await getJson("https://graph.instagram.com/me?fields=id,user_id,username,name,account_type,profile_picture_url",token)}
    catch{return complete("error",{reason:"meta_authorization_required"})}
    const externalId=String(profileRaw.user_id||profileRaw.id||"");
    const username=String(profileRaw.username||"");
    if(!/^\d+$/.test(externalId)||!username||!["BUSINESS","CREATOR","MEDIA_CREATOR"].includes(String(profileRaw.account_type||"").toUpperCase())){
      return complete("error",{reason:"instagram_professional_required"});
    }
    // Verify publication access with a read-only official endpoint, without creating a container.
    try{
      const quota=await getJson("https://graph.instagram.com/v26.0/"+externalId+"/content_publishing_limit?fields=quota_usage,config",token);
      if(!Array.isArray(quota?.data)||!quota.data.length)return complete("error",{reason:"meta_authorization_required"});
    }catch{return complete("error",{reason:"meta_authorization_required"})}

    const config={status:"connected",api_mode:"instagram_login",source:"instagram-oauth",connection:"oauth_login",username,instagram_user_id:externalId,account_type:profileRaw.account_type,profile_picture_url:profileRaw.profile_picture_url||null,profile_picture_updated_at:new Date().toISOString(),token_expires_in:expiresIn,token_expires_at:new Date(Date.now()+expiresIn*1000).toISOString()};
    const {data:accountId,error:accountErr}=await admin.rpc("instagram_scale_connect",{
      p_actor:state.uid,p_external_id:externalId,p_username:username,p_config:config,p_token:token,
      p_reconnect_id:state.reconnect_account_id||null,p_mother_id:state.mother_id||null
    });
    if(accountErr){
      const reason=oauthFailureCodes.find(code=>accountErr.message===code)||"connect_failed";
      return complete("error",{reason});
    }
    if(state.reconnect_account_id)try{
      const {data:blocked,error:blockedErr}=await admin.from("reel_test_publications").select("id,meta,linked_schedule_id")
        .eq("status","failed").is("instagram_media_id",null)
        .contains("meta",{failure_reason:"instagram_reconnect_required",platform_account_id:accountId});
      if(blockedErr)throw blockedErr;
      for(const trial of blocked||[]){
        if(trial.linked_schedule_id){
          const {data:schedule,error:se}=await admin.from("schedules").select("status,instagram_media_id,platform_account_id").eq("id",trial.linked_schedule_id).single();
          if(se)throw se;
          if(!schedule||schedule.instagram_media_id||!['scheduled','queued','failed'].includes(schedule.status)||schedule.platform_account_id!==accountId)continue;
        }
        const {error:retryErr}=await admin.from("reel_test_publications").update({status:"scheduled",attempt_count:0,last_error:null,next_attempt_at:new Date().toISOString(),locked_at:null,locked_by:null,
          meta:{...(trial.meta||{}),failure_reason:null,retry_blocked:false},updated_at:new Date().toISOString()}).eq("id",trial.id).eq("status","failed");
        if(retryErr)throw retryErr;
      }
    }catch{console.error("instagram-oauth: calendar trial recovery pending")}
    if(!state.mother_id){
      const {data:integration}=await admin.from("integrations").select("external_account_id,enabled").eq("provider","instagram").maybeSingle();
      if(!integration?.enabled||integration.external_account_id===externalId){
        await admin.from("integrations").upsert({provider:"instagram",enabled:true,account_label:username,external_account_id:externalId,config:{...config,platform_account_id:accountId},last_verified_at:new Date().toISOString()},{onConflict:"provider"});
      }
    }
    await admin.from("activity_logs").insert({level:"info",event_type:"instagram_connected",message:"Instagram conectado via login oficial",meta:{platform_account_id:accountId,username,mother_id:state.mother_id||null,connected_by:state.uid}});
    return complete("success",{username,account_id:String(accountId)});
  }catch{
    console.error("instagram-oauth: callback failed");
    return complete("error",{reason:"connect_failed"});
  }
});
