import {runGenjutsuReadiness,GENJUTSU_WORKFLOW_ID} from './genjutsu-readiness.ts';
import {GENJUTSU_MODEL} from './genjutsu-gemini.ts';
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Cache-Control':'no-store'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
// Product setup/status API. It never returns credentials, accepts arbitrary URLs or starts a generation.
export async function genjutsuApi(req:Request,{admin,apiKey,supabaseUrl,fetcher=fetch,now=Date.now}:any){
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(!['GET','POST'].includes(req.method))return json({error:'method_not_allowed'},405);
  try{
    const supplied=req.headers.get('x-cloudent-worker-secret')||'';
    let master:string;
    if(supplied){
      const {data,error}=await admin.rpc('get_cloudent_worker_secret');
      if(error||!data||supplied!==String(data))return json({error:'unauthorized'},401);
      master=String(data);
    }else{
      const auth=req.headers.get('authorization')||'',token=auth.startsWith('Bearer ')?auth.slice(7):'';
      if(!token)return json({error:'authentication_required'},401);
      const {data,error}=await admin.auth.getUser(token);
      if(error||!data?.user)return json({error:'invalid_user_session'},401);
      let claims:any;try{claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{return json({error:'invalid_user_session'},401);}
      if(claims.iss!==supabaseUrl+'/auth/v1'||!claims.session_id)return json({error:'invalid_user_session'},401);
      const session=await admin.rpc('cloudent_auth_session_active',{p_session_id:claims.session_id,p_user_id:data.user.id});
      if(session.error||!session.data)return json({error:'invalid_user_session'},401);
      const member=await admin.from('app_members').select('role,enabled').eq('user_id',data.user.id).maybeSingle();
      if(member.error||!member.data?.enabled||member.data.role!=='admin')return json({error:'forbidden'},403);
      const secret=await admin.rpc('get_cloudent_worker_secret');
      if(secret.error||!secret.data)return json({error:'configuration_unavailable'},503);
      master=String(secret.data);
    }
    const cached=await admin.from('app_settings').select('value').eq('key','genjutsu_readiness').maybeSingle();
    if(cached.error)return json({error:'status_unavailable'},503);
    if(req.method==='GET')return json({ok:true,active:true,readiness:cached.data?.value??null,workflowId:GENJUTSU_WORKFLOW_ID,model:GENJUTSU_MODEL});
    let body:any;try{body=await req.json();}catch{return json({error:'invalid_request'},400);}
    if(body?.action!=='preflight')return json({error:'operation_not_available'},409);
    const previous=cached.data?.value;
    if(previous?.checkedAt&&Date.parse(previous.checkedAt)>now()-60000)
      return json({ok:true,active:true,readiness:previous,cached:true});
    const readiness=await runGenjutsuReadiness({admin,master,apiKey,fetcher,now});
    const saved=await admin.from('app_settings').upsert({key:'genjutsu_readiness',value:readiness,updated_at:new Date(now()).toISOString()},{onConflict:'key'});
    if(saved.error)return json({error:'status_save_failed'},503);
    return json({ok:true,active:true,readiness});
  }catch{return json({error:'genjutsu_configuration_unavailable'},503);}
}
