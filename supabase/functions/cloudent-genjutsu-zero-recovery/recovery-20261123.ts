import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {recoverGenjutsuDirect} from '../_shared/genjutsu-direct-recovery.ts';
import {missingMotionTaskPatch} from '../_shared/motion-missing-task.ts';
import {readMotionProviderStatus} from '../cloudent-motion-control-worker/motion-provider-state.ts';
const OWNER='8ab89cf8-699e-4ae8-833f-1f215f1d4d69',JOB='d0ee0ef7-6f3d-491c-9495-fd4ec4a2e83a';
const expires=Date.parse('2026-11-23T03:00:00Z');
const out=(value:any,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
Deno.serve(async(req)=>{
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try{
  const {data:secret,error}=await admin.rpc('get_cloudent_worker_secret');
  if(error||!secret||req.headers.get('x-cloudent-worker-secret')!==secret)return out({error:'unauthorized'},401);
  if(Date.now()>expires||req.method!=='POST')return out({error:'closed'},410);
  const body=await req.json();
  if(['inspect_v7','reconcile_v7'].includes(body.operation)){
   const taskId='2124650658800164865';
   const {data:j}=await admin.from('production_jobs').select('*').eq('id','caedddea-f232-42ad-8e14-30d3a757c328').eq('user_id',OWNER).eq('runninghub_task_id',taskId).single();
   if(!j)return out({error:'task_mismatch'},409);
   const {data:i}=await admin.from('integrations').select('enabled,config').eq('provider','runninghub').single();
   if(!i?.enabled||String(i.config.baseUrl).replace(/\/$/,'')!=='https://www.runninghub.ai')return out({error:'integration_unavailable'},409);
   const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
   const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),{name:'AES-GCM'},false,['decrypt']);
   const apiKey=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(i.config.apiKeyIv)},key,bytes(i.config.apiKeyCipher)));
   const state=await readMotionProviderStatus('https://www.runninghub.ai',apiKey,taskId);
   const r=await fetch('https://www.runninghub.ai/task/openapi/outputs',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({apiKey,taskId}),signal:AbortSignal.timeout(10000)});
   const d=await r.json();
   if(body.operation==='reconcile_v7'){
    const observations=[];
    for(let n=0;n<2;n++){
     const status=await readMotionProviderStatus('https://www.runninghub.ai',apiKey,taskId);
     const outputs=await fetch('https://www.runninghub.ai/task/openapi/outputs',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({apiKey,taskId}),signal:AbortSignal.timeout(10000)}).then(r=>r.json());
     const capacity=await fetch('https://www.runninghub.ai/openapi/v2/queue/status',{headers:{Authorization:'Bearer '+apiKey},signal:AbortSignal.timeout(10000)}).then(r=>r.json());
     observations.push({task_id:taskId,status:status.status,status_code:status.error?.endsWith('807')?807:null,outputs_code:outputs.code,capacity,checked_at:Date.now()});
    }
    const {data:fresh}=await admin.from('production_jobs').select('*').eq('id',j.id).eq('user_id',OWNER).eq('runninghub_task_id',taskId).single();
    const patch=missingMotionTaskPatch(fresh,observations);
    if(!patch)return out({quarantined:false,observations:observations.map(o=>({status:o.status,outputs_code:o.outputs_code,capacity:o.capacity?.data?{running:o.capacity.data.runningCount,queued:o.capacity.data.queuedCount,total:o.capacity.data.totalCurrentTasks}:null}))});
    const {data:saved,error}=await admin.from('production_jobs').update(patch).eq('id',j.id).eq('user_id',OWNER).eq('runninghub_task_id',taskId).eq('updated_at',fresh.updated_at).eq('status','running').is('locked_by',null).is('result_video_id',null).select('id').maybeSingle();
    return out({quarantined:!error&&!!saved,task_id:taskId,retry_blocked:true,database_error_code:error?.code||null});
   }
   return out({task_id:taskId,status:state.status,error:state.error,source:state.source,outputs_code:d.code,output_count:Array.isArray(d.data)?d.data.length:null});
  }
  if(body.operation!=='recover_prompt')return out({error:'invalid_operation'},400);
  const {data:job}=await admin.from('production_jobs').select('*').eq('id',JOB).eq('user_id',OWNER).single();
  if(!job||job.meta?.workflow_id!=='2124648844280733698'||job.runninghub_task_id||job.result_video_id||job.meta.pipeline_dispatch_intent||job.locked_by||job.hidden_at||!['motion_waiting','failed'].includes(job.status)||job.meta.genjutsu_prompt?.directRecovery)return out({error:'not_eligible'},409);
  const lease='genjutsu-direct-recovery-'+crypto.randomUUID();
  const {data:claimed,error:ce}=await admin.from('production_jobs').update({locked_by:lease,locked_at:new Date().toISOString(),updated_at:new Date().toISOString(),status:'uploading'}).eq('id',JOB).eq('user_id',OWNER).eq('updated_at',job.updated_at).is('locked_by',null).is('runninghub_task_id',null).select('id').maybeSingle();
  if(ce||!claimed)return out({error:'lease_lost'},409);
  EdgeRuntime.waitUntil((async()=>{
   let meta=job.meta,reason:string|null=null;
   const checkpoint=async(state:any)=>{
    const next={...meta,genjutsu_prompt:state,preparation_status:state.status==='complete'?'READY_FOR_VIDEO':'PREPARING',...(state.status==='complete'?{prompt_completed_at:new Date().toISOString()}: {})};
    const {data,error}=await admin.from('production_jobs').update({meta:next,locked_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',JOB).eq('user_id',OWNER).eq('locked_by',lease).is('runninghub_task_id',null).select('id').maybeSingle();
    if(error||!data)throw Error('lease_lost');meta=next;
   };
   try{await recoverGenjutsuDirect({state:meta.genjutsu_prompt,duration:Number(meta.source_duration_seconds),key:Deno.env.get('GEMINI_API_KEY')||'',checkpoint});}
   catch(e){const allowed=['inputs_changed','recovery_not_eligible','invalid_media_reference','generation_uncertain','content_blocked','direct_provider_failed','invalid_prompt'];reason=allowed.includes(e.message)?e.message:'recovery_unavailable';}
   const complete=meta.genjutsu_prompt?.status==='complete';
   const uncertain=meta.genjutsu_prompt?.status==='generating';
   await admin.from('production_jobs').update({status:complete?'motion_waiting':'failed',...(complete?{next_attempt_at:new Date().toISOString()}:{}),meta:{...meta,genjutsu_direct_recovery_audit:{at:new Date().toISOString(),result:complete?'complete':reason,uncertain}},last_error:complete?null:reason==='content_blocked'?'Gemini bloqueou este conteúdo. Envie outro vídeo ou foto de referência.':uncertain?'Gemini não confirmou a resposta; repetição automática bloqueada.':'Gemini: falha na recuperação direta ('+reason+').',locked_by:null,locked_at:null,updated_at:new Date().toISOString()}).eq('id',JOB).eq('locked_by',lease).is('runninghub_task_id',null);
  })());
  return out({accepted:true,job_id:JOB});
 }catch{return out({error:'recovery_unavailable'},503);}
});
