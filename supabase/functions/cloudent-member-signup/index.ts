import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const base=String(Deno.env.get("SUPABASE_URL")||"");
const service=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const out=(x:any,status=200)=>new Response(JSON.stringify(x),{status,headers});
async function call(path:string,method="GET",body:any=undefined,bearer=service){
 const r=await fetch(base+path,{method,headers:{apikey:service,Authorization:"Bearer "+bearer,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
 return {ok:r.ok,status:r.status,data:await r.json().catch(()=>null)};
}
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,"0")).join("");}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return out({error:"method_not_allowed"},405);
 let createdId="";
 try{
  if(Number(req.headers.get("content-length")||0)>8192)return out({error:"invalid_request"},400);
  const p=await req.json(),email=String(p.email||"").trim().toLowerCase(),password=String(p.password||"");
  if(!/^\S+@\S+\.\S+$/.test(email)||password.length<8||password.length>1024)return out({error:"invalid_email_or_password"},400);
  const bearer=String(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  const raw=String(p.invite_token||"");let uid="",digest:string|null=null;
  const query=new URLSearchParams({email:"eq."+email,role:"eq.x_user",enabled:"eq.true",claimed_by:"is.null",signup_token_expires_at:"gte."+new Date().toISOString(),select:"email,workspace_id,auth_user_id,signup_token_hash",limit:"1"});
  const lookup=await call("/rest/v1/member_invites?"+query);if(!lookup.ok)return out({error:"invite_lookup_failed"},503);
  const invite=lookup.data?.[0];if(!invite)return out({error:"invite_not_valid"},403);
  if(bearer){
   const current=await call("/auth/v1/user","GET",undefined,bearer);
   if(!current.ok||String(current.data?.email||"").toLowerCase()!==email||current.data.id!==invite.auth_user_id)return out({error:"invite_not_valid"},403);
   uid=current.data.id;
   let claims:any;try{claims=JSON.parse(atob(bearer.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))}catch{return out({error:"unauthorized"},401);}
   const active=await call("/rest/v1/rpc/cloudent_auth_session_active","POST",{p_session_id:claims.session_id,p_user_id:uid});
   if(claims.iss!==base+"/auth/v1"||!active.ok||active.data!==true)return out({error:"unauthorized"},401);
   const updated=await call("/auth/v1/user","PUT",{password},bearer);if(!updated.ok)return out({error:"password_update_failed"},updated.status);
  }else{
   if(raw.length<40||await hash(raw)!==invite.signup_token_hash)return out({error:"invite_not_valid"},403);
   digest=await hash(raw);
   if(invite.auth_user_id){
    const existing=await call("/auth/v1/admin/users/"+encodeURIComponent(invite.auth_user_id));
    const user=existing.data;
    // Only an unused native invitation may complete through the admin's fallback link.
    if(!existing.ok||String(user?.email||"").toLowerCase()!==email||!user.invited_at||user.last_sign_in_at)return out({error:"account_already_exists"},409);
    const membership=await call("/rest/v1/app_members?select=user_id&user_id=eq."+encodeURIComponent(user.id));
    if(!membership.ok||membership.data?.length)return out({error:"account_already_exists"},409);
    const updated=await call("/auth/v1/admin/users/"+encodeURIComponent(user.id),"PUT",{password,email_confirm:true});if(!updated.ok)return out({error:"password_update_failed"},updated.status);
    uid=user.id;
   }else{
    const created=await call("/auth/v1/admin/users","POST",{email,password,email_confirm:true,app_metadata:{cloudent_role:"x_user"}});
    if(!created.ok||!created.data?.id)return out({error:created.status===422?"account_already_exists":"account_creation_failed"},created.status>=400&&created.status<500?created.status:500);
    uid=createdId=created.data.id;
   }
  }
  const accepted=await call("/rest/v1/rpc/accept_x_invite","POST",{p_user:uid,p_email:email,p_hash:digest});
  if(!accepted.ok){if(createdId)await call("/auth/v1/admin/users/"+encodeURIComponent(createdId),"DELETE");return out({error:"invite_not_valid"},403);}
  return out({ok:true,role:"x_user",workspace_id:accepted.data},201);
 }catch{
  if(createdId)await call("/auth/v1/admin/users/"+encodeURIComponent(createdId),"DELETE").catch(()=>null);
  return out({error:"signup_unavailable"},503);
 }
});
