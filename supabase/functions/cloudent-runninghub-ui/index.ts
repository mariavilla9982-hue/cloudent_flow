import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'https://cloudent-flow.vercel.app','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-cloudent-worker-secret','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
export function eligibleUICancel(job:any,video:any,taskId:string,lease:string,owner:string){
  const m=job?.meta||{};
  return !!job&&job.user_id===owner&&job.runninghub_task_id===taskId&&job.locked_by===lease&&lease.startsWith('genjutsu-provider-stop-')
    &&['queued','running'].includes(job.status)&&m.workflow_key==='genjutsu'&&String(m.result_node_id)==='482'
    &&m.motion_preview_file?.task_id===taskId&&String(m.motion_preview_file?.node_id)==='482'
    &&!!m.motion_preview_verified_at&&/^[a-f0-9]{64}$/.test(m.motion_preview_sha256||'')&&m.motion_preview_source_sha256===m.motion_preview_sha256
    &&!!video&&video.status==='ready'&&video.user_id===owner&&video.id===job.result_video_id&&video.storage_path===job.result_storage_path
    &&String(video.storage_path).startsWith(owner+'/production-results/')
    &&Number(video.size_bytes)>0&&Number(video.size_bytes)===Number(m.motion_preview_verified_bytes);
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  try{
    const body=await req.json(),operation=String(body.operation||'');
    if(!['setup','probe','record_probe','prepare','cancel'].includes(operation))return json({ok:false,error:'invalid_operation'},400);
    const {data:config,error:ce}=await admin.from('app_settings').select('value').eq('key','genjutsu_ui_cancel').maybeSingle();
    if(ce)throw ce;
    const cfg=config?.value;
    if(!cfg?.owner_user_id||!/^\d{15,25}$/.test(cfg.account_id||''))return json({ok:false,error:'ui_cancel_not_configured'},409);
    const {data:expected,error:se}=await admin.rpc('get_cloudent_worker_secret');if(se)throw se;
    const worker=!!expected&&req.headers.get('x-cloudent-worker-secret')===expected;
    if(!worker){
      const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
      const {data:auth,error:ae}=await admin.auth.getUser(token);
      if(ae||auth?.user?.id!==cfg.owner_user_id)return json({ok:false,error:'unauthorized'},401);
      const {data:member}=await admin.from('app_members').select('role,enabled').eq('user_id',auth.user.id).maybeSingle();
      if(!member?.enabled||member.role!=='admin')return json({ok:false,error:'forbidden'},403);
      if(['prepare','cancel'].includes(operation))return json({ok:false,error:'worker_required'},403);
    }else if(['setup','record_probe'].includes(operation))return json({ok:false,error:'admin_required'},403);
    if(operation==='record_probe'){
      const ready=body.ready===true&&body.account_id===cfg.account_id;
      const {error}=await admin.from('app_settings').update({value:{...cfg,enabled:ready,browser_ready:ready,probed_at:new Date().toISOString()},updated_at:new Date().toISOString()}).eq('key','genjutsu_ui_cancel');
      if(error)throw error;
      // Never unpause the queue or mark cancellation proven from a login probe.
      return json({ok:true,browser_ready:ready,cancellation_proven:cfg.cancellation_proven===true});
    }
    if(['prepare','cancel'].includes(operation)){
      if(cfg.enabled!==true)return json({ok:false,error:'ui_session_not_ready'},409);
      const taskId=String(body.task_id||''),jobId=String(body.job_id||'');
      if(!/^\d{15,25}$/.test(taskId)||!/^[a-f0-9-]{36}$/i.test(jobId))return json({ok:false,error:'invalid_task'},400);
      const {data:job,error:je}=await admin.from('production_jobs').select('*').eq('id',jobId).eq('user_id',cfg.owner_user_id).eq('runninghub_task_id',taskId).maybeSingle();if(je)throw je;
      if(!job||job.meta?.workflow_key!=='genjutsu'||!['queued','running'].includes(job.status))return json({ok:false,error:'task_not_eligible'},409);
      if(operation==='cancel'){
        const {data:video}=await admin.from('videos').select('id,user_id,status,size_bytes,storage_path').eq('id',job.result_video_id).eq('user_id',cfg.owner_user_id).maybeSingle();
        if(!eligibleUICancel(job,video,taskId,String(body.lease||''),cfg.owner_user_id))return json({ok:false,error:'unverified_video_or_lease'},409);
      }
    }
    return json({ok:true,operation,account_id:cfg.account_id});
  }catch{return json({ok:false,error:'ui_authorization_unavailable'},503);}
});
