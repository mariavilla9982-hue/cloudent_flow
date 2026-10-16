import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"content-type, apikey, x-client-info, x-cloudent-x-session, x-cloudent-worker-secret",
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
  "Content-Type":"application/json",
  "Cache-Control":"no-store"
};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
const row=(value:any)=>Array.isArray(value)?value[0]||null:value||null;

async function recoverSupabaseSession(admin:any,email:string){
  const {data:link,error:linkError}=await admin.auth.admin.generateLink({type:"magiclink",email});
  if(linkError)return {ok:false,stage:"generate_link",error:String(linkError.message||linkError)};
  const hash=String((link as any)?.properties?.hashed_token||(link as any)?.properties?.hashedToken||"");
  if(!hash)return {ok:false,stage:"generate_link",error:"missing_hash"};
  const {data:verified,error:verifyError}=await admin.auth.verifyOtp({token_hash:hash,type:"email"});
  if(verifyError||!verified?.session?.access_token)return {ok:false,stage:"verify_otp",error:String(verifyError?.message||"session_missing")};
  return {ok:true,session:verified.session};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  const url=new URL(req.url),action=url.searchParams.get("action")||"session";
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    if(action==="health"&&req.method==="GET"){
      const {error}=await admin.from("workspaces").select("id",{count:"exact",head:true});
      return json({ok:!error,service:"cloudent-x-local-auth",database:!error?"reachable":"unavailable"},error?503:200);
    }
    if(action==="session-diagnostic"&&req.method==="POST"){
      const supplied=String(req.headers.get("x-cloudent-worker-secret")||"");
      const {data:expected,error:secretError}=await admin.rpc("get_cloudent_worker_secret");
      if(secretError||!expected||supplied!==String(expected))return json({ok:false,error:"forbidden"},403);
      const body=await req.json().catch(()=>({}));
      const email=String(body.email||"").trim().toLowerCase();
      if(!email)return json({ok:false,error:"missing_email"},400);
      const recovered=await recoverSupabaseSession(admin,email);
      if(!recovered.ok)return json({ok:false,stage:recovered.stage,error:recovered.error},503);
      return json({ok:true,stage:"session_created"});
    }
    if(action==="login"&&req.method==="POST"){
      const body=await req.json().catch(()=>({}));
      const email=String(body.email||"").trim().toLowerCase(),password=String(body.password||"");
      if(!email||!password)return json({ok:false,error:"invalid_credentials"},401);
      const {data,error}=await admin.rpc("cloudent_x_local_login",{p_email:email,p_password:password});
      if(error)throw error;
      const local=row(data);
      if(!local?.session_token)return json({ok:false,error:"invalid_credentials"},401);
      if(local.role==="admin"){
        const recovered=await recoverSupabaseSession(admin,local.email);
        if(recovered.ok)return json({ok:true,mode:"supabase",session:recovered.session,role:local.role,workspace_id:local.workspace_id});
        console.warn("supabase_session_recovery_unavailable",recovered.stage,recovered.error);
      }
      return json({ok:true,mode:"local",token:local.session_token,expires_at:local.expires_at,user_id:local.user_id,workspace_id:local.workspace_id,role:local.role,email:local.email});
    }
    const token=String(req.headers.get("x-cloudent-x-session")||"").trim();
    if(!token)return json({ok:false,error:"authentication_required"},401);
    if(action==="session"&&(req.method==="GET"||req.method==="POST")){
      const {data,error}=await admin.rpc("cloudent_x_local_session",{p_token:token});
      if(error)throw error;
      const session=row(data);
      if(!session?.user_id)return json({ok:false,error:"invalid_session"},401);
      return json({ok:true,...session});
    }
    if(action==="logout"&&req.method==="POST"){
      const {data,error}=await admin.rpc("cloudent_x_local_logout",{p_token:token});
      if(error)throw error;
      return json({ok:true,revoked:Boolean(data)});
    }
    return json({ok:false,error:"not_found"},404);
  }catch(error:any){
    console.error("local-auth",error?.message||error);
    return json({ok:false,error:"auth_service_error"},500);
  }
});
