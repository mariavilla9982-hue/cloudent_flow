// The legacy route name remains for frontend compatibility. All credentials and
// sessions are verified by Supabase Auth in this function's own project.
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,content-type,apikey,x-cloudent-x-session","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
const base=String(Deno.env.get("SUPABASE_URL")||"").replace(/\/$/,"");
const anon=String(Deno.env.get("SUPABASE_ANON_KEY")||"");
const service=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");
async function call(path:string,method="GET",body?:unknown,token?:string,privileged=false){
  const response=await fetch(base+path,{method,headers:{apikey:privileged?service:anon,Authorization:"Bearer "+(token||(privileged?service:anon)),"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const data=await response.json().catch(()=>null);
  return {response,data};
}
async function member(token:string){
  const {response,data:user}=await call("/auth/v1/user","GET",undefined,token);
  if(!response.ok||!user?.id)return null;
  let claims;
  try{claims=JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")))}catch{return null;}
  if(claims.iss!==base+"/auth/v1"||!claims.session_id)return null;
  const active=await call("/rest/v1/rpc/cloudent_auth_session_active","POST",{p_session_id:claims.session_id,p_user_id:user.id},undefined,true);
  if(!active.response.ok)throw new Error("session_check_unavailable");
  if(active.data!==true)return null;
  const m=await call("/rest/v1/app_members?select=user_id,role,enabled,workspace_id&user_id=eq."+encodeURIComponent(user.id),"GET",undefined,undefined,true);
  if(!m.response.ok)throw new Error("membership_check_unavailable");
  const access=m.data?.[0];
  if(!access?.enabled||!["admin","x_user"].includes(access.role)||!access.workspace_id)return {forbidden:true};
  return {user_id:user.id,email:user.email,role:access.role,workspace_id:access.workspace_id,expires_at:new Date(claims.exp*1000).toISOString()};
}
export async function handler(req:Request){
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(!base||!anon||!service)return json({ok:false,error:"auth_configuration_missing_or_invalid"},503);
  const action=new URL(req.url).searchParams.get("action")||"session";
  if(!["health","login","session","logout","recover","password"].includes(action))return json({ok:false,error:"not_found"},404);
  if((action==="health"&&req.method!=="GET")||(action!=="health"&&req.method!=="POST"&&!(action==="session"&&req.method==="GET")))return json({ok:false,error:"method_not_allowed"},405);
  try{
    if(action==="health"){
      const [db,auth]=await Promise.all([call("/rest/v1/workspaces?select=id&limit=0","GET",undefined,undefined,true),call("/auth/v1/settings")]);
      const ok=db.response.ok&&auth.response.ok;
      return json({ok,service:"cloudent-x-local-auth",database:db.response.ok?"reachable":"unavailable",auth:auth.response.ok?"reachable":"unavailable",project_ref:new URL(base).hostname.split(".")[0]},ok?200:503);
    }
    const body=req.method==="POST"?await req.json().catch(()=>({})):{};
    if(action==="login"){
      const email=String(body.email||"").trim().toLowerCase(),password=String(body.password||"");
      if(!email||!password||email.length>320||password.length>4096)return json({ok:false,error:"invalid_credentials"},401);
      const login=await call("/auth/v1/token?grant_type=password","POST",{email,password});
      if(!login.response.ok||!login.data?.access_token)return json({ok:false,error:login.response.status===429?"rate_limited":"invalid_credentials"},login.response.status===429?429:401);
      const access=await member(login.data.access_token);
      if(!access||access.forbidden){
        await call("/auth/v1/logout?scope=local","POST",{},login.data.access_token);
        return json({ok:false,error:"forbidden"},403);
      }
      return json({ok:true,mode:"supabase",session:login.data,role:access.role,workspace_id:access.workspace_id});
    }
    if(action==="recover"){
      const email=String(body.email||"").trim().toLowerCase();
      if(!/^\S+@\S+\.\S+$/.test(email)||email.length>320)return json({ok:false,error:"invalid_email"},400);
      const result=await call("/auth/v1/recover?redirect_to="+encodeURIComponent("https://cloudent-flow.vercel.app/recuperar-acesso.html"),"POST",{email});
      return result.response.ok?json({ok:true}):json({ok:false,error:result.response.status===429?"rate_limited":"recovery_email_unavailable"},result.response.status===429?429:503);
    }
    const token=String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim()||String(req.headers.get("x-cloudent-x-session")||"").trim();
    if(!token)return json({ok:false,error:"authentication_required"},401);
    const access=await member(token);
    if(!access)return json({ok:false,error:"invalid_session"},401);
    if(access.forbidden)return json({ok:false,error:"forbidden"},403);
    if(action==="session")return json({ok:true,...access});
    if(action==="logout"){
      const out=await call("/auth/v1/logout?scope=local","POST",{},token);
      return out.response.ok?json({ok:true,revoked:true}):json({ok:false,error:"logout_failed"},502);
    }
    if(action==="password"){
      const password=String(body.password||"");
      if(password.length<8||password.length>4096)return json({ok:false,error:"password_too_short"},400);
      const update=await call("/auth/v1/user","PUT",{password},token);
      return update.response.ok?json({ok:true}):json({ok:false,error:"password_update_failed"},400);
    }
  }catch{
    // Never log passwords, bodies, JWTs, refresh tokens or upstream messages.
    console.error("auth-service","upstream_or_membership_unavailable");
    return json({ok:false,error:"auth_service_unavailable"},503);
  }
}
Deno.serve(handler);
