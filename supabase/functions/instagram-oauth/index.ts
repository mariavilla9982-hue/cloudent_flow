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
  const r=await fetch(url,{headers:{Authorization:"Bearer "+token}});let j:any={};try{j=await r.json()}catch{}
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
    if(reconnectId){
      const {data:target,error:targetErr}=await admin.from("platform_accounts").select("id").eq("id",reconnectId).eq("platform","instagram").eq("enabled",true).maybeSingle();
      if(targetErr||!target)return out({error:"reconnect_account_not_found"},400);
    }
    const {count,error:countErr}=await admin.from("platform_accounts").select("id",{count:"exact",head:true}).eq("platform","instagram").eq("enabled",true);
    if(countErr)return out({error:"account_count_failed"},500);
    if((count||0)>=3&&!reconnectId)return out({error:"instagram_account_limit",user_message:"O limite atual do CloudentFlow é 3 contas do Instagram."},409);
    if(!cfg.id.value||!cfg.secret.value)return out({error:"instagram_oauth_not_configured",user_message:"O login oficial do Instagram ainda precisa do Instagram App ID e App Secret no servidor."},503);

    const state=await makeState({uid:a.user.id,exp:Date.now()+10*60*1000,nonce:crypto.randomUUID(),reconnect_account_id:reconnectId||null});
    const auth=new URL("https://www.instagram.com/oauth/authorize");
    auth.searchParams.set("client_id",cfg.id.value);
    auth.searchParams.set("redirect_uri",redirectUri());
    auth.searchParams.set("response_type","code");
    auth.searchParams.set("scope","instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_insights");
    auth.searchParams.set("state",state);
    auth.searchParams.set("enable_fb_login","0");
    auth.searchParams.set("force_authentication","1");
    return out({ok:true,url:auth.toString(),redirect_uri:redirectUri()});
  }

  if(req.method!=="GET")return out({error:"method_not_allowed"},405);
  const oauthError=url.searchParams.get("error")||url.searchParams.get("error_reason")||"";
  if(oauthError)return redirect("cancelled",{reason:oauthError});
  const code=String(url.searchParams.get("code")||"").replace(/#_$/g,"");
  const state=await readState(String(url.searchParams.get("state")||""));
  if(!state)return redirect("error",{reason:"invalid_state"});
  if(!code)return redirect("error",{reason:"missing_code"});
  if(!cfg.id.value||!cfg.secret.value)return redirect("error",{reason:"oauth_not_configured"});

  try{
    const {data:member}=await admin.from("app_members").select("role,enabled").eq("user_id",state.uid).maybeSingle();
    if(!member?.enabled||member.role!=="admin")return redirect("error",{reason:"forbidden"});

    const form=new URLSearchParams({client_id:cfg.id.value,client_secret:cfg.secret.value,grant_type:"authorization_code",redirect_uri:redirectUri(),code});
    const tokenRes=await fetch("https://api.instagram.com/oauth/access_token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
    let short:any={};try{short=await tokenRes.json()}catch{}
    if(!tokenRes.ok)throw new Error(short?.error_message||short?.error?.message||"Falha ao trocar o código do Instagram.");
    let shortToken=String(short?.access_token||"");
    if(!shortToken&&Array.isArray(short?.data)&&short.data.length===1)shortToken=String(short.data[0]?.access_token||"");
    if(!shortToken)throw new Error("O Instagram não retornou um access token.");

    const longUrl=new URL("https://graph.instagram.com/access_token");
    longUrl.searchParams.set("grant_type","ig_exchange_token");longUrl.searchParams.set("client_secret",cfg.secret.value);longUrl.searchParams.set("access_token",shortToken);
    const longRes=await fetch(longUrl.toString());let longData:any={};try{longData=await longRes.json()}catch{}
    const token=String(longData?.access_token||shortToken);
    if(!longRes.ok&&!shortToken)throw new Error(longData?.error?.message||"Falha ao gerar token de longa duração.");

    const profileRaw=await getJson("https://graph.instagram.com/me?fields=id,user_id,username,name,account_type,profile_picture_url",token);
    const externalId=String(profileRaw.user_id||profileRaw.id||"");
    if(!externalId)throw new Error("Não consegui identificar a conta do Instagram.");
    const profile={id:externalId,username:profileRaw.username||null,name:profileRaw.name||null,account_type:profileRaw.account_type||null,profile_picture_url:profileRaw.profile_picture_url||null};

    const {data:existing,error:existingErr}=await admin.from("platform_accounts").select("id,config").eq("platform","instagram").eq("external_account_id",externalId).maybeSingle();
    if(existingErr)throw existingErr;
    if(state.reconnect_account_id&&String(existing?.id||"")!==String(state.reconnect_account_id))return redirect("error",{reason:"reconnect_account_mismatch"});
    if(!existing?.id){
      const {count,error:countErr}=await admin.from("platform_accounts").select("id",{count:"exact",head:true}).eq("platform","instagram").eq("enabled",true);
      if(countErr)throw countErr;if((count||0)>=3)return redirect("error",{reason:"account_limit"});
    }

    const config={...(existing?.config||{}),status:"connected",api_mode:"instagram_login",source:"instagram-oauth",connection:"oauth_login",username:profile.username,instagram_user_id:externalId,account_type:profile.account_type,profile_picture_url:profile.profile_picture_url,profile_picture_updated_at:new Date().toISOString(),token_expires_in:Number(longData?.expires_in||0)||null};
    const {data:platformAccount,error:accountErr}=await admin.from("platform_accounts").upsert({platform:"instagram",external_account_id:externalId,account_label:profile.username||profile.name||"Instagram",enabled:true,config,updated_at:new Date().toISOString()},{onConflict:"platform,external_account_id"}).select("id,platform,external_account_id,account_label,enabled,config").single();
    if(accountErr)throw accountErr;
    const {error:vaultErr}=await admin.rpc("set_instagram_page_token_for_account",{p_account_id:platformAccount.id,p_token:token});if(vaultErr)throw vaultErr;
    if(state.reconnect_account_id){
      const {data:blocked,error:blockedErr}=await admin.from("reel_test_publications").select("id,meta,linked_schedule_id")
        .eq("status","failed").is("instagram_media_id",null)
        .contains("meta",{failure_reason:"instagram_reconnect_required",platform_account_id:platformAccount.id});
      if(blockedErr)throw blockedErr;
      for(const trial of blocked||[]){
        if(trial.linked_schedule_id){
          const {data:schedule,error:se}=await admin.from("schedules").select("status,instagram_media_id,platform_account_id").eq("id",trial.linked_schedule_id).single();
          if(se)throw se;
          if(!schedule||schedule.instagram_media_id||!['scheduled','queued','failed'].includes(schedule.status)||schedule.platform_account_id!==platformAccount.id)continue;
        }
        const {error:retryErr}=await admin.from("reel_test_publications").update({status:"scheduled",attempt_count:0,last_error:null,next_attempt_at:new Date().toISOString(),locked_at:null,locked_by:null,
          meta:{...(trial.meta||{}),failure_reason:null,retry_blocked:false},updated_at:new Date().toISOString()}).eq("id",trial.id).eq("status","failed");
        if(retryErr)throw retryErr;
      }
    }
    await admin.from("integrations").upsert({provider:"instagram",enabled:true,account_label:profile.username||profile.name||"Instagram",external_account_id:externalId,config:{...config,platform_account_id:platformAccount.id},last_verified_at:new Date().toISOString()},{onConflict:"provider"});
    await admin.from("activity_logs").insert({level:"info",event_type:"instagram_connected",message:"Instagram conectado via login oficial",meta:{platform_account_id:platformAccount.id,instagram_user_id:externalId,username:profile.username||null,api_mode:"instagram_login",connected_by:state.uid}});
    return redirect("success",{username:String(profile.username||profile.name||"Instagram"),account_id:String(platformAccount.id)});
  }catch(e){
    console.error("instagram-oauth callback",e);
    return redirect("error",{reason:"connect_failed"});
  }
});

