import {prepareGenjutsuStage,genjutsuPromptWait} from './genjutsu-stage.ts';
import {safeGenjutsuError} from './genjutsu-diagnostics.ts';
// One bounded pass per invocation, independent of RunningHub slots. SQL owns global prompt concurrency.
export async function runGenjutsuPreparation({admin,key,readBlob,now=Date.now}:any){
 const workerId='genjutsu-prompt-'+crypto.randomUUID();
 const claimed=await admin.rpc('claim_genjutsu_prompt_job',{p_worker:workerId,p_limit:1});
 if(claimed.error)throw claimed.error;
 const job=claimed.data?.[0];if(!job)return {ok:true,phase:'prepare',processed:0};
 let ready=false,error:string|null=null;
 try{ready=await prepareGenjutsuStage({admin,job,workerId,key,readBlob:(path:string)=>readBlob(job,path),now});}
 catch(e){
  if(!genjutsuPromptWait(e,job))error=safeGenjutsuError(e instanceof Error?e.message:String(e));
  else if(['network_error','invalid_response'].includes((e as any)?.code)){
   job.meta.prompt_transport_failures=Number(job.meta.prompt_transport_failures||0)+1;
   if(job.meta.genjutsu_prompt)job.meta.genjutsu_prompt.retryAt=new Date(now()+Math.min(3600000,60000*2**(job.meta.prompt_transport_failures-1))).toISOString();
   if(job.meta.prompt_transport_failures>=6)error='Falha de comunicação persistente ao preparar prompt. Arquivos preservados.';
  }
 }
 const stamp=new Date(now()).toISOString();
 const patch={status:error?'failed':'motion_waiting',meta:job.meta,last_error:error,
   next_attempt_at:job.meta.genjutsu_prompt?.retryAt||new Date(now()+ (ready?0:60000)).toISOString(),
   locked_by:null,locked_at:null,updated_at:stamp,...(error?{completed_at:stamp}:{})};
 const saved=await admin.from('production_jobs').update(patch).eq('id',job.id).eq('user_id',job.user_id).eq('locked_by',workerId)
  .eq('status','motion_waiting').is('runninghub_task_id',null).is('result_video_id',null).select('id').maybeSingle();
 if(saved.error||!saved.data)throw new Error('Genjutsu: reserva da preparação perdida.');
 console.info(JSON.stringify({event:'genjutsu_preparation',job_id:job.id,ready,status:patch.status,prompt_status:job.meta.genjutsu_prompt?.status,error}));
 // Schedules the next fresh prompt or ready video; no synchronous recursive invocation.
 await admin.rpc('wake_genjutsu_queue');
 return {ok:true,phase:'prepare',processed:1,ready,failed:!!error};
}
