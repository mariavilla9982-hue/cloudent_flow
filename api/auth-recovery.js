import { supabaseConfig } from "../lib/supabase-config.js";

function send(res,status,body){
  res.statusCode=status;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req,res){
  if(req.method==="OPTIONS"){
    res.statusCode=204;
    res.setHeader("Cache-Control","no-store");
    return res.end();
  }

  const action=String(new URL(req.url||"/","https://cloudent.invalid").searchParams.get("action")||"").trim();
  if(!["health","login","logout","session","recover","password"].includes(action))return send(res,404,{ok:false,error:"not_found"});
  if(action==="health"&&req.method!=="GET")return send(res,405,{ok:false,error:"method_not_allowed"});
  if(action!=="health"&&req.method!=="POST")return send(res,405,{ok:false,error:"method_not_allowed"});

  let config;
  try{config=supabaseConfig()}catch{return send(res,503,{ok:false,error:"auth_configuration_missing_or_invalid"})}
  const headers={
    apikey:config.key,
    "Content-Type":"application/json"
  };
  const authorization=String(req.headers.authorization||"").trim();
  if(authorization)headers.Authorization=authorization;
  const localSession=String(req.headers["x-cloudent-x-session"]||"").trim();
  if(localSession)headers["x-cloudent-x-session"]=localSession;

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const upstream=await fetch(config.url+"/functions/v1/cloudent-x-local-auth"+"?action="+encodeURIComponent(action),{
      method:req.method,
      headers,
      body:req.method==="POST"?JSON.stringify(req.body||{}):undefined,
      signal:controller.signal
    });
    const text=await upstream.text();
    let payload=null;
    try{payload=text?JSON.parse(text):{}}catch{payload={ok:false,error:"invalid_upstream_response"};}
    if(upstream.ok){
      const access=action==="login"?payload?.session?.access_token:action==="session"?authorization.replace(/^Bearer\s+/i,""):null;
      if(access)res.setHeader("Set-Cookie","cf_access="+access+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600");
      if(action==="logout")res.setHeader("Set-Cookie","cf_access=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    }
    return send(res,upstream.status,payload);
  }catch(error){
    console.error("auth-recovery-proxy",error?.name==="AbortError"?"upstream_timeout":"upstream_network_error");
    return send(res,503,{ok:false,error:"auth_recovery_unreachable"});
  }finally{
    clearTimeout(timeout);
  }
}
