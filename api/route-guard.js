import { supabaseConfig } from "../lib/supabase-config.js";
const ORIGIN="https://cloudent-flow.vercel.app";
const paths=new Set(["/x-studio","/calendar","/production","/face-swap","/settings","/dashboard","/instagram","/extraction","/metrics"]);
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const path=String(new URL(req.url,"https://cloudent.invalid").searchParams.get("path")||"");
  if(!paths.has("/"+path)){res.statusCode=404;return res.end();}
  const token=String(req.headers.cookie||"").split(";").map(s=>s.trim()).find(s=>s.startsWith("cf_access="))?.slice(10)||"";
  try{
    let role=null;
    if(token){
      const cfg=supabaseConfig();
      const check=await fetch(cfg.url+"/functions/v1/cloudent-x-local-auth?action=session",{method:"POST",headers:{apikey:cfg.key,Authorization:"Bearer "+token,"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(10000)});
      const access=await check.json();if(check.ok&&access.ok)role=access.role;
    }
    if(role==="x_user"&&path!=="x-studio"){res.statusCode=302;res.setHeader("Location",ORIGIN+"/x-studio");return res.end();}
    if(!role&&path!=="x-studio"){res.statusCode=302;res.setHeader("Location",ORIGIN+"/");return res.end();}
    const page=await fetch(ORIGIN+"/index.html",{cache:"no-store",signal:AbortSignal.timeout(10000)});
    if(!page.ok)throw new Error("shell_unavailable");
    res.statusCode=200;res.setHeader("Content-Type","text/html; charset=utf-8");return res.end(await page.text());
  }catch{res.statusCode=503;res.end("Acesso temporariamente indisponível. Tente novamente.");}
}
