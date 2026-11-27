import { randomBytes } from "node:crypto";
import authRecovery from "./auth-recovery.js";

const ORIGIN="https://cloudent-flow.vercel.app";
const escape=value=>String(value||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safeJSON=value=>JSON.stringify(value).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");

function page(res,status,{message="",email="",session=null,cookie=null}={}){
  const nonce=randomBytes(18).toString("base64");
  res.statusCode=status;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.setHeader("Cache-Control","no-store, max-age=0");
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Content-Security-Policy",`default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
  if(cookie)res.setHeader("Set-Cookie",cookie);
  const content=session
    ?`<h1>Acesso confirmado</h1><p id="message">Abrindo seu workspace…</p><script nonce="${nonce}">try{localStorage.setItem("cloudentflow-user-session",JSON.stringify(${safeJSON(session)}));localStorage.setItem("cloudentflow-login-audit-pending","1");location.replace("/");}catch{document.getElementById("message").textContent="O navegador bloqueou o armazenamento da sessão. Permita dados deste site para continuar.";}</script><noscript>Ative JavaScript para abrir o workspace.</noscript>`
    :`<h1>Entrar no CloudentFlow</h1><p>Use a conta vinculada ao seu workspace.</p><p role="alert">${escape(message)}</p><form method="post" action="/api/login"><label>Email<input name="email" type="email" autocomplete="username" required maxlength="320" value="${escape(email)}"></label><label>Senha<input name="password" type="password" autocomplete="current-password" required maxlength="4096"></label><button type="submit">Entrar</button></form><p><a href="/recuperar-acesso.html">Recuperar acesso / definir senha</a></p>`;
  res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acesso · CloudentFlow</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080808;color:#eee;font:16px system-ui}main{width:min(400px,90vw);padding:28px;border:1px solid #303030;border-radius:16px}h1{font-size:24px}p{line-height:1.5;color:#bbb}form,label{display:grid;gap:10px}form{gap:20px}input,button{width:100%;padding:13px;border:1px solid #444;border-radius:8px;font:inherit}input{background:#171717;color:#fff}button{background:#fff;color:#080808;cursor:pointer}a{color:#ddd}[role=alert]{color:#ffaaaa}</style></head><body><main>${content}</main></body></html>`);
}

export default async function handler(req,res){
  if(req.method==="GET")return page(res,200);
  if(req.method!=="POST"){res.setHeader("Allow","GET, POST");return page(res,405,{message:"Método não permitido."});}
  if(req.headers.origin!==ORIGIN)return page(res,403,{message:"Abra o acesso pelo endereço oficial do CloudentFlow."});
  let body=req.body;
  if(typeof body==="string"){
    if(body.length>20000)return page(res,413,{message:"Dados de acesso inválidos."});
    body=Object.fromEntries(new URLSearchParams(body));
  }
  const email=typeof body?.email==="string"?body.email.trim():"";
  const password=typeof body?.password==="string"?body.password:"";
  if(!email||!password||email.length>320||password.length>4096)return page(res,400,{message:"Informe email e senha válidos.",email:email.slice(0,320)});
  let payload=null,status=503;
  const headers={};
  try{
    // Same verifier and membership checks as the SPA, without browser fetch.
    await authRecovery({method:"POST",url:"/api/auth-recovery?action=login",headers:{},body:{email,password}},{
      statusCode:503,
      setHeader(name,value){headers[name.toLowerCase()]=value;},
      end(raw){status=this.statusCode;try{payload=JSON.parse(raw)}catch{payload=null;}}
    });
  }catch{/* Do not log credentials, tokens or upstream bodies. */}
  if(status===200&&payload?.ok===true&&payload.session?.access_token&&["admin","x_user"].includes(payload.role)&&payload.workspace_id){
    return page(res,200,{session:payload.session,cookie:headers["set-cookie"]});
  }
  const message=status===401?"Email ou senha incorretos.":status===403?"Sua conta não tem acesso ativo ao workspace.":status===429?"Muitas tentativas. Aguarde alguns minutos.":"O servidor de acesso não respondeu. Tente novamente em instantes.";
  return page(res,[401,403,429].includes(status)?status:503,{message,email});
}
