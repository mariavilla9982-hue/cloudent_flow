import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS"
};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const enc=new TextEncoder();
const APP_URL="https://cloudent-flow.vercel.app/";

const toB64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const fromB64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const b64url=(bytes:Uint8Array)=>toB64(bytes).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const randomToken=(n=48)=>b64url(crypto.getRandomValues(new Uint8Array(n)));

async function hashHex(value:string){
  const h=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(value)));
  return Array.from(h).map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function pkceChallenge(verifier:string){
  const h=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(verifier)));
  return b64url(h);
}
async function encryptSecret(value:string,master:string){
  const hash=await crypto.subtle.digest("SHA-256",enc.encode(master));
  const key=await crypto.subtle.importKey("raw",hash,{name:"AES-GCM"},false,["encrypt"]);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,enc.encode(value));
  return {cipher:toB64(new Uint8Array(encrypted)),iv:toB64(iv)};
}
async function decryptSecret(cipher:string,iv:string,master:string){
  const hash=await crypto.subtle.digest("SHA-256",enc.encode(master));
  const key=await crypto.subtle.importKey("raw",hash,{name:"AES-GCM"},false,["decrypt"]);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(iv)},key,fromB64(cipher));
  return new TextDecoder().decode(plain);
}
function redirectBack(params:Record<string,string>){
  const u=new URL(APP_URL);
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  u.hash="xStudio";
  return Response.redirect(u.toString(),302);
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});

  const supabaseUrl=Deno.env.get("SUPABASE_URL")!;
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const url=new URL(req.url);
  const action=String(url.searchParams.get("action")||"");

  try{
    let userRes:any,member:any;
    if(req.method==="POST"&&action==="start"){
      const authHeader=String(req.headers.get("authorization")||"");
      const token=authHeader.replace(/^Bearer\s+/i,"").trim();
      if(!token)return json({error:"unauthorized"},401);
      const {data:verified,error:userError}=await admin.auth.getUser(token);
      if(userError||!verified?.user)return json({error:"unauthorized"},401);

      userRes=verified;
      let claims:any;try{claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{return json({error:"unauthorized"},401);}
      if(claims.iss!==supabaseUrl+"/auth/v1"||!claims.session_id)return json({error:"unauthorized"},401);
      const {data:active,error:sessionError}=await admin.rpc("cloudent_auth_session_active",{p_session_id:claims.session_id,p_user_id:userRes.user.id});if(sessionError||!active)return json({error:"unauthorized"},401);
      const {data:membership}=await admin.from("app_members").select("role,enabled,workspace_id").eq("user_id",userRes.user.id).maybeSingle();
      member=membership;
      if(!member?.enabled||member.role!=="admin")return json({error:"forbidden"},403);
    }
    const {data:master,error:masterError}=await admin.rpc("get_cloudent_worker_secret");
    if(masterError||!master)throw masterError||new Error("worker_secret_missing");

    const {data:integration,error:intError}=await admin.from("integrations")
      .select("config,enabled,account_label,last_verified_at")
      .eq("provider","x").maybeSingle();
    if(intError)throw intError;
    const cfg:any=integration?.config||{};
    if(!cfg.clientIdCipher||!cfg.clientIdIv||!cfg.clientSecretCipher||!cfg.clientSecretIv){
      if(action==="callback")return redirectBack({x_error:"app_not_configured"});
      return json({error:"x_app_not_configured",user_message:"Configure Client ID e Client Secret do App X primeiro."},409);
    }

    const clientId=await decryptSecret(String(cfg.clientIdCipher),String(cfg.clientIdIv),String(master));
    const clientSecret=await decryptSecret(String(cfg.clientSecretCipher),String(cfg.clientSecretIv),String(master));
    const callbackUrl=supabaseUrl+"/functions/v1/cloudent-x-oauth?action=callback";

    if(req.method==="POST"&&action==="start"){
      const {data:allowed}=await admin.rpc("cloudent_rate_limit",{p_user:userRes.user.id,p_bucket:"x-oauth",p_limit:10});if(!allowed)return json({error:"rate_limit"},429);
      await admin.from("x_oauth_states").delete().lt("expires_at",new Date().toISOString());

      const state=randomToken(32);
      const verifier=randomToken(64);
      const challenge=await pkceChallenge(verifier);
      const stateHash=await hashHex(state);
      const encryptedVerifier=await encryptSecret(verifier,String(master));
      const expiresAt=new Date(Date.now()+10*60_000).toISOString();

      const {error:insertError}=await admin.from("x_oauth_states").insert({
        user_id:userRes.user.id,
        state_hash:stateHash,
        verifier_cipher:encryptedVerifier.cipher,
        verifier_iv:encryptedVerifier.iv,
        return_to:APP_URL,
        expires_at:expiresAt
      });
      if(insertError)throw insertError;

      const authUrl=new URL("https://x.com/i/oauth2/authorize");
      authUrl.searchParams.set("response_type","code");
      authUrl.searchParams.set("client_id",clientId);
      authUrl.searchParams.set("redirect_uri",callbackUrl);
      authUrl.searchParams.set("scope","tweet.read tweet.write users.read media.write offline.access");
      authUrl.searchParams.set("state",state);
      authUrl.searchParams.set("code_challenge",challenge);
      authUrl.searchParams.set("code_challenge_method","S256");

      return json({ok:true,auth_url:authUrl.toString(),callback_url:callbackUrl,expires_at:expiresAt});
    }

    if(req.method==="GET"&&action==="callback"){
      const state=String(url.searchParams.get("state")||"");
      const code=String(url.searchParams.get("code")||"");
      const oauthError=String(url.searchParams.get("error")||"");
      if(oauthError)return redirectBack({x_error:oauthError});
      if(!state||!code)return redirectBack({x_error:"oauth_callback_invalid"});

      const stateHash=await hashHex(state);
      const {data:row,error:stateError}=await admin.from("x_oauth_states")
        .select("id,user_id,verifier_cipher,verifier_iv,expires_at,return_to")
        .eq("state_hash",stateHash).maybeSingle();
      if(stateError)throw stateError;
      if(!row)return redirectBack({x_error:"oauth_state_invalid"});
      if(new Date(row.expires_at).getTime()<Date.now()){
        await admin.from("x_oauth_states").delete().eq("id",row.id);
        return redirectBack({x_error:"oauth_state_expired"});
      }

      const {data:member}=await admin.from("app_members").select("role,enabled,workspace_id").eq("user_id",row.user_id).maybeSingle();
      if(!member?.enabled||member.role!=="admin")return redirectBack({x_error:"forbidden"});
      const {data:consumed,error:consumeError}=await admin.from("x_oauth_states").delete().eq("id",row.id).select("id").maybeSingle();
      if(consumeError||!consumed)return redirectBack({x_error:"oauth_state_invalid"});
      const verifier=await decryptSecret(String(row.verifier_cipher),String(row.verifier_iv),String(master));
      const tokenParams=new URLSearchParams({
        grant_type:"authorization_code",
        code,
        redirect_uri:callbackUrl,
        code_verifier:verifier
      });
      const basic=btoa(clientId+":"+clientSecret);
      const tokenRes=await fetch("https://api.x.com/2/oauth2/token",{
        method:"POST",
        headers:{
          "Authorization":"Basic "+basic,
          "Content-Type":"application/x-www-form-urlencoded"
        },
        body:tokenParams.toString()
      });
      let tokenData:any={};try{tokenData=await tokenRes.json()}catch{}
      if(!tokenRes.ok||!tokenData.access_token){
        await admin.from("x_oauth_states").delete().eq("id",row.id);
        await admin.from("activity_logs").insert({
          level:"error",event_type:"x_oauth_token_failed",message:"Falha ao trocar código OAuth do X por token",
          meta:{user_id:row.user_id,status:tokenRes.status,details:{status:tokenRes.status}}
        });
        return redirectBack({x_error:"token_exchange_failed"});
      }

      const meRes=await fetch("https://api.x.com/2/users/me?user.fields=username,name,profile_image_url",{
        headers:{"Authorization":"Bearer "+String(tokenData.access_token)}
      });
      let me:any={};try{me=await meRes.json()}catch{}
      if(!meRes.ok||!me?.data?.id){
        await admin.from("x_oauth_states").delete().eq("id",row.id);
        return redirectBack({x_error:"x_user_lookup_failed"});
      }

      const xUser=me.data;
      const now=new Date().toISOString();
      const access=await encryptSecret(String(tokenData.access_token),String(master));
      const refresh=tokenData.refresh_token?await encryptSecret(String(tokenData.refresh_token),String(master)):null;
      const expiresAt=new Date(Date.now()+Math.max(60,Number(tokenData.expires_in||7200))*1000).toISOString();
      const scopes=String(tokenData.scope||"tweet.read tweet.write users.read media.write offline.access").split(/\s+/).filter(Boolean);

      const {data:existing,error:existingError}=await admin.from("platform_accounts")
        .select("id,config,owner_user_id,workspace_id").eq("platform","x").eq("external_account_id",String(xUser.id)).maybeSingle();
      if(existingError)throw existingError;

      if(existing&&(existing.owner_user_id!==row.user_id||existing.workspace_id!==member.workspace_id))return redirectBack({x_error:"account_owned_by_another_user"});
      const accountConfig:any={
        ...(existing?.config||{}),
        status:"connected",
        api_mode:"oauth2_pkce",
        accessTokenCipher:access.cipher,
        accessTokenIv:access.iv,
        refreshTokenCipher:refresh?.cipher||null,
        refreshTokenIv:refresh?.iv||null,
        tokenExpiresAt:expiresAt,
        token_type:String(tokenData.token_type||"bearer"),
        scopes,
        owner_user_id:row.user_id,
        username:String(xUser.username||""),
        profile_image_url:String(xUser.profile_image_url||""),
        connected_at:existing?.config?.connected_at||now,
        last_verified_at:now,
        last_refresh_at:now
      };

      let platformAccount:any=null;
      if(existing?.id){
        const {data,error}=await admin.from("platform_accounts").update({
          account_label:String(xUser.username||xUser.name||"Conta X"),
          enabled:true,
          config:accountConfig,
          updated_at:now
        }).eq("id",existing.id).select().single();
        if(error)throw error;
        platformAccount=data;
      }else{
        const {data,error}=await admin.from("platform_accounts").insert({
          platform:"x",
          workspace_id:member.workspace_id,owner_user_id:row.user_id,
          external_account_id:String(xUser.id),
          account_label:String(xUser.username||xUser.name||"Conta X"),
          enabled:true,
          config:accountConfig
        }).select().single();
        if(error)throw error;
        platformAccount=data;
      }

      const {error:configError}=await admin.from("x_account_configs").upsert({platform_account_id:platformAccount.id,user_id:row.user_id,workspace_id:member.workspace_id},{onConflict:"platform_account_id",ignoreDuplicates:true});
      if(configError)throw configError;
      await admin.from("x_audit_log").insert({workspace_id:member.workspace_id,user_id:row.user_id,platform_account_id:platformAccount.id,event_type:existing?"account_reconnected":"account_added"});
      if(xUser.username){
        await admin.from("x_warmup_accounts").update({
          platform_account_id:platformAccount.id,
          external_user_id:String(xUser.id),
          username:String(xUser.username),
          last_error:null,
          updated_at:now
        }).eq("user_id",row.user_id).ilike("username",String(xUser.username));
      }

      const {count:connectedCount}=await admin.from("platform_accounts")
        .select("id",{count:"exact",head:true}).eq("platform","x").eq("enabled",true);

      const mergedIntegrationConfig:any={
        ...cfg,
        status:"connected",
        oauth_mode:"oauth2_pkce",
        connected_accounts:Number(connectedCount||1),
        last_connected_at:now
      };
      await admin.from("integrations").update({
        enabled:true,
        account_label:"X · "+Number(connectedCount||1)+" conta(s)",
        external_account_id:"multi",
        config:mergedIntegrationConfig,
        last_verified_at:now,
        updated_at:now
      }).eq("provider","x");

      await admin.from("x_oauth_states").delete().eq("id",row.id);
      await admin.from("activity_logs").insert({
        level:"info",event_type:"x_oauth_connected",message:"Conta X conectada via OAuth 2.0",
        meta:{user_id:row.user_id,platform_account_id:platformAccount.id,external_user_id:String(xUser.id),username:String(xUser.username||"")}
      });

      return redirectBack({x_connected:"1",x_username:String(xUser.username||"")});
    }

    return json({error:"not_found"},404);
  }catch(e){
    const message=e instanceof Error?e.message:String(e);
    if(action==="callback")return redirectBack({x_error:"oauth_internal_error"});
    return json({error:"x_oauth_failed",message},500);
  }
});
