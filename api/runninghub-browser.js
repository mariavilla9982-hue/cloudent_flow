import {runninghubBrowser} from '../lib/runninghub-browser.js';
import {supabaseConfig} from '../lib/supabase-config.js';
const cfg=supabaseConfig();
function send(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));}
async function authorize(req,body){
  const r=await fetch(cfg.url+'/functions/v1/cloudent-runninghub-ui',{method:'POST',headers:{'Content-Type':'application/json',apikey:cfg.key,...(req.headers.authorization?{Authorization:String(req.headers.authorization)}:{}),...(req.headers['x-cloudent-worker-secret']?{'x-cloudent-worker-secret':String(req.headers['x-cloudent-worker-secret'])}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const value=await r.json();return {status:r.status,value};
}
export default async function handler(req,res){
  if(req.method==='GET'){
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
    return res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar RunningHub · CloudentFlow</title><style>body{background:#0b0b0c;color:#eee;font:16px system-ui;max-width:680px;margin:60px auto;padding:24px}button,a{font:inherit;color:inherit}button{background:#fff;color:#111;border:0;border-radius:12px;padding:14px 20px;margin:8px 8px 8px 0;cursor:pointer}.muted{color:#aaa}#state{white-space:pre-wrap}</style><h1>Conectar RunningHub</h1><p>Entre no navegador dedicado usando a conta do RunningHub que gera seus vídeos. O CloudentFlow não recebe nem salva sua senha.</p><p class="muted">A fila continua pausada. Conectar a sessão não comprova o cancelamento.</p><button id="setup">Abrir navegador seguro</button><button id="probe">Verificar conexão</button><p id="state"></p><p><a href="/">Voltar ao CloudentFlow</a></p><script>
const key='cloudentflow-user-session';
let busy=false;
async function accessToken(force=false){
 let session;try{session=JSON.parse(localStorage.getItem(key)||'null')}catch{}
 if(!session?.access_token)throw Error('login_required');
 if(force||(session.expires_at&&Number(session.expires_at)*1000<Date.now()+60000)){
  if(!session.refresh_token)throw Error('login_required');
  const r=await fetch('${cfg.url}/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:${JSON.stringify(cfg.key)},'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});
  if(!r.ok)throw Error('login_required');
  const refreshed=await r.json();if(!refreshed.access_token)throw Error('login_required');
  session={...session,...refreshed};localStorage.setItem(key,JSON.stringify(session));
 }
 return session.access_token;
}
async function request(operation){
 let token=await accessToken();
 for(let attempt=0;attempt<2;attempt++){
  const r=await fetch('/api/runninghub-browser',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({operation})});
  const j=await r.json();
  if(r.status===401&&attempt===0){token=await accessToken(true);continue;}
  if(r.status===401)throw Error('login_required');
  if(r.status===403)throw Error('admin_required');
  return j;
 }
}
async function run(operation){
 if(busy)return;busy=true;
 const state=document.getElementById('state');state.textContent='Preparando…';
 try{
  const j=await request(operation);
  if(j.url){const a=document.createElement('a');a.href=j.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Abrir navegador dedicado';state.replaceChildren(a)}
  else state.textContent=j.ready?'Sessão conectada. Cancelamento real ainda precisa ser validado.':j.error==='authentication_required'?'Entre no RunningHub pelo navegador dedicado e depois verifique novamente.':j.error||'Conexão não confirmada.';
 }catch(e){state.textContent=e.message==='login_required'?'Sua sessão expirou. Toque em Voltar ao CloudentFlow, entre novamente e volte a esta página.':e.message==='admin_required'?'Conecte usando sua conta de administradora do CloudentFlow.':'Não foi possível acessar o navegador. Tente novamente.'}
 finally{busy=false;}
}
document.getElementById('setup').onclick=()=>run('setup');document.getElementById('probe').onclick=()=>run('probe');</script></html>`);
  }
  if(req.method!=='POST')return send(res,405,{ok:false,error:'method_not_allowed'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    if(!['setup','probe','prepare','cancel','reset_batch_session','arm_budget_watch'].includes(body.operation))return send(res,400,{ok:false,error:'invalid_operation'});
    const auth=await authorize(req,body);if(!auth.value.ok)return send(res,auth.status,auth.value);
    const result=await runninghubBrowser(body.operation,String(body.task_id||''),auth.value.account_id,auth.value);
    if(body.operation==='probe')await authorize(req,{operation:'record_probe',ready:result.ready===true,account_id:result.account_id});
    return send(res,200,result);
  }catch{return send(res,503,{ok:false,error:'ui_browser_unavailable'});}
}
