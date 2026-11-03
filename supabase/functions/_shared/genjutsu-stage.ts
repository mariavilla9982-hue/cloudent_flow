import {prepareGenjutsuPrompt,GenjutsuPromptError,genjutsuExecutionInputs} from './genjutsu-gemini.ts';
import {GENJUTSU_WORKFLOW_ID,validateGenjutsuGraph} from './genjutsu-readiness.ts';
export const isGenjutsuJob=(job:any)=>job?.meta?.workflow_key==='genjutsu'&&job?.meta?.workflow_id===GENJUTSU_WORKFLOW_ID;
export const GENJUTSU_CONFIG={workflowId:GENJUTSU_WORKFLOW_ID,videoNodeId:'970',videoFieldName:'video',frameNodeId:'496',frameFieldName:'image',outputNodeId:'482',executionInstanceType:'ultra',executionVramGb:84,hardwarePolicy:'genjutsu_default_84gb'};
export async function validateGenjutsuWorkflow(base:string,key:string){
  if(base!=='https://www.runninghub.ai')throw new Error('Genjutsu: provedor incompatível.');
  const r=await fetch(base+'/api/openapi/getJsonApiFormat',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({apiKey:key,workflowId:GENJUTSU_WORKFLOW_ID}),signal:AbortSignal.timeout(15000),redirect:'error'});
  const data=await r.json();if(!r.ok||Number(data.code)!==0)throw new Error('Genjutsu: workflow indisponível.');
  return validateGenjutsuGraph(data);
}
async function boundedBlob(response:Response,mime:string,limit:number){
  if(!response.ok||!response.body||Number(response.headers.get('content-length')||0)>limit)throw new Error('Genjutsu: mídia indisponível ou acima do limite.');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new Error('Genjutsu: mídia acima do limite.');parts.push(value);}}
  finally{try{await reader.cancel();}catch{}}
  return new Blob(parts,{type:mime});
}
export async function genjutsuResultBlob(response:Response){return boundedBlob(response,'video/mp4',40*1024*1024);}
// The caller owns the existing provider/job lease. No RH create is performed here.
export async function prepareGenjutsuStage({admin,job,workerId,key,readBlob,now=Date.now}:any){
  if(!isGenjutsuJob(job)||job.runninghub_task_id||job.meta.pipeline_dispatch_intent)throw new Error('Genjutsu: envio já realizado ou identidade inválida.');
  if(!key)throw new Error('Genjutsu: chave Gemini ausente no servidor.');
  if(![job.original_storage_path,job.frame_storage_path].every(path=>String(path||'').startsWith(job.user_id+'/')))throw new Error('Genjutsu: mídia não pertence ao trabalho.');
  const previous=job.meta.genjutsu_prompt;
  if(previous?.status==='complete'){await genjutsuInputs('saved-video','saved-image',job);return true;}
  if(previous?.status==='quota_waiting'&&Date.parse(previous.retryAt||'')>now())return false;
  if(previous?.status==='generating')throw new GenjutsuPromptError('generation_uncertain','Análise sem confirmação; não será repetida automaticamente.');
  const checkpoint=async(state:any)=>{
    const meta={...job.meta,genjutsu_prompt:state};
    const {data,error}=await admin.from('production_jobs').update({meta,locked_at:new Date(now()).toISOString(),updated_at:new Date(now()).toISOString()})
      .eq('id',job.id).eq('user_id',job.user_id).eq('locked_by',workerId).is('runninghub_task_id',null).select('id').maybeSingle();
    if(error||!data)throw new Error('Genjutsu: reserva da análise perdida.');job.meta=meta;
  };
  const read=async(path:string,mime:string,limit:number)=>{
    if(!String(path||'').startsWith(job.user_id+'/'))throw new Error('Genjutsu: mídia não pertence ao trabalho.');
    return boundedBlob(await readBlob(path),mime,limit);
  };
  const resumeUploadedFiles=!!(previous?.video&&previous?.image);
  const video=resumeUploadedFiles?new Blob(['saved'],{type:previous.video.mimeType}):await read(job.original_storage_path,job.original_mime_type||'video/mp4',30*1024*1024);
  const image=resumeUploadedFiles?new Blob(['saved'],{type:previous.image.mimeType}):await read(job.frame_storage_path,job.frame_mime_type||'image/jpeg',10*1024*1024);
  const result=await prepareGenjutsuPrompt({apiKey:key,video,image,resumeUploadedFiles,durationSeconds:Number(job.meta.source_duration_seconds),state:job.meta.genjutsu_prompt,checkpoint,now});
  return result.ready;
}
export function genjutsuPromptWait(error:any,job:any){
  return error instanceof GenjutsuPromptError&&(error.code==='quota_waiting'||error.code==='network_error'&&job.meta?.genjutsu_prompt?.status!=='generating');
}
export async function genjutsuInputs(video:string,image:string,job:any){return genjutsuExecutionInputs(GENJUTSU_WORKFLOW_ID,video,image,job.meta.genjutsu_prompt);}
export async function applyGenjutsuStatus(admin:any,job:any,state:any){
  if(!isGenjutsuJob(job)||!job.runninghub_task_id)return null;
  const status=String(state.status||'UNKNOWN'),known=['QUEUED','RUNNING','SUCCESS','FAILED','CANCELLED','CANCELED'].includes(status);
  const hasOutput=!!(job.result_video_id||job.meta?.motion_preview_file);
  const patch:any={meta:{...job.meta,provider_status:status,provider_status_task_id:job.runninghub_task_id,provider_status_error:known?null:'Status indisponível; aguardando nova consulta.'},updated_at:new Date().toISOString()};
  if(status==='QUEUED'){patch.status='queued';patch.progress=38;}
  if(status==='RUNNING'){patch.status='running';patch.progress=Math.max(62,Number(job.progress||0));patch.started_at=job.started_at||new Date().toISOString();}
  if(['FAILED','CANCELLED','CANCELED'].includes(status)&&!hasOutput){patch.status='failed';patch.last_error='Genjutsu: o provedor encerrou a geração sem vídeo capturado.';patch.completed_at=new Date().toISOString();}
  const {data,error}=await admin.from('production_jobs').update(patch).eq('id',job.id).eq('user_id',job.user_id).eq('runninghub_task_id',job.runninghub_task_id).in('status',['queued','running']).select('*').maybeSingle();
  if(error)throw error;return data;
}
