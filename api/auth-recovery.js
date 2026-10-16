const UPSTREAM="https://dxrhvudvutmgrmfkmzxo.supabase.co/functions/v1/cloudent-x-local-auth";
const PUBLISHABLE_KEY="sb_publishable_eu6EGnAw7H-Y5q6w6pmSKQ_88GUR9HI";

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

  const action=String(req.query?.action||"").trim();
  if(!["health","login","logout","session"].includes(action))return send(res,404,{ok:false,error:"not_found"});
  if(action==="health"&&req.method!=="GET")return send(res,405,{ok:false,error:"method_not_allowed"});
  if(action!=="health"&&req.method!=="POST")return send(res,405,{ok:false,error:"method_not_allowed"});

  const headers={
    apikey:PUBLISHABLE_KEY,
    "Content-Type":"application/json"
  };
  const localSession=String(req.headers["x-cloudent-x-session"]||"").trim();
  if(localSession)headers["x-cloudent-x-session"]=localSession;

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const upstream=await fetch(UPSTREAM+"?action="+encodeURIComponent(action),{
      method:req.method,
      headers,
      body:req.method==="POST"?JSON.stringify(req.body||{}):undefined,
      signal:controller.signal
    });
    const text=await upstream.text();
    let payload=null;
    try{payload=text?JSON.parse(text):{}}catch{payload={ok:false,error:"invalid_upstream_response"};}
    return send(res,upstream.status,payload);
  }catch(error){
    console.error("auth-recovery-proxy",String(error?.message||error).slice(0,180));
    return send(res,503,{ok:false,error:"auth_recovery_unreachable"});
  }finally{
    clearTimeout(timeout);
  }
}
