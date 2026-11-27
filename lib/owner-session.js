import { supabaseConfig } from "./supabase-config.js";

export const OWNER_ID="8ab89cf8-699e-4ae8-833f-1f215f1d4d69";
const OPTIONS="; Path=/; HttpOnly; Secure; SameSite=Lax";
export const clearOwnerCookies=["cf_access="+OPTIONS+"; Max-Age=0","cf_owner_refresh="+OPTIONS+"; Max-Age=0"];
export const isOwner=access=>access?.ok===true&&access.role==="admin"&&(access.user_id||access.session?.user?.id)===OWNER_ID;
export function ownerCookies(session){
  return ["cf_access="+encodeURIComponent(session.access_token)+OPTIONS+"; Max-Age=3600",
    "cf_owner_refresh="+encodeURIComponent(session.refresh_token)+OPTIONS+"; Max-Age=2592000"];
}
function cookie(req,name){
  const raw=String(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1)||"";
  try{return raw.length<=20000?decodeURIComponent(raw):"";}catch{return "";}
}
export async function verifySession(token,authRecovery){
  let status=503,access=null;
  try{await authRecovery({method:"POST",url:"/api/auth-recovery?action=session",headers:{authorization:"Bearer "+token},body:{}},{statusCode:503,setHeader(){},end(raw){status=this.statusCode;try{access=JSON.parse(raw)}catch{}}});}catch{}
  return {status,access};
}
export async function restoreOwner(req,authRecovery){
  const token=cookie(req,"cf_access"),refresh=cookie(req,"cf_owner_refresh");
  if(!token&&!refresh)return null;
  if(token){
    const proof=await verifySession(token,authRecovery);
    if(proof.status===200){
      if(!isOwner(proof.access))return null;
      const expiry=Date.parse(proof.access.expires_at||"");
      if(!refresh&&!(expiry>Date.now()+60000))return null;
      if(!refresh||expiry>Date.now()+60000)return {access:proof.access,session:{access_token:token,expires_at:expiry/1000,user:{id:proof.access.user_id,email:proof.access.email}}};
    }else if(proof.status!==401){
      return proof.status===403?{invalid:true}:{unavailable:true};
    }
  }
  if(!refresh)return null;
  try{
    const cfg=supabaseConfig();
    const response=await fetch(cfg.url+"/auth/v1/token?grant_type=refresh_token",{method:"POST",headers:{apikey:cfg.key,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:refresh}),signal:AbortSignal.timeout(10000)});
    const session=await response.json();
    if(!response.ok)return [400,401,403].includes(response.status)?{invalid:true}:{unavailable:true};
    if(!session?.access_token||!session.refresh_token)return {unavailable:true};
    if(session.user?.id!==OWNER_ID)return {invalid:true};
    const proof=await verifySession(session.access_token,authRecovery);
    if(proof.status!==200)return [401,403].includes(proof.status)?{invalid:true}:{unavailable:true,cookie:ownerCookies(session)};
    if(!isOwner(proof.access))return {invalid:true};
    return {session,access:proof.access,cookie:ownerCookies(session)};
  }catch{return {unavailable:true};}
}
