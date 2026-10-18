// New jobs only. Legacy face-swap jobs keep their original executor.
export const FACE_WORKFLOW='2111452526003380225';
export const UPSCALE_WORKFLOW='2111453733402390530';
export const isPipeline=(j:any)=>j?.meta?.pipeline_version===2;
export function exactOutput(items:any[],node:string){
  const item=(items||[]).find(x=>String(x.nodeId??x.node_id??x.nodeInfoId??x.nodeInfo?.nodeId??'')===node && /^(https):/.test(String(x.fileUrl||x.url||'')));
  if(!item)throw new Error('Saída obrigatória #'+node+' ausente. A tarefa foi preservada para nova consulta.');
  return item;
}
export function stageInputs(j:any,reference:string,model?:string){
  if(j.meta.stage==='upscale')return {workflowId:UPSCALE_WORKFLOW,nodeInfoList:[{nodeId:'130',fieldName:'image',fieldValue:reference}]};
  if(!model)throw new Error('Modelo raiz ausente');
  return {workflowId:FACE_WORKFLOW,nodeInfoList:[{nodeId:'23',fieldName:'image',fieldValue:model},{nodeId:'17',fieldName:'image',fieldValue:reference}]};
}
export async function runImagePipeline(d:any){
  const {admin,workerId,rhJson,prepareInput,saveBlob,concurrency}=d;
  const check=(r:any)=>{if(r.error)throw r.error;return r.data;};
  const patch=async(j:any,values:any)=>{check(await admin.from('face_swap_jobs').update({...values,updated_at:new Date().toISOString()}).eq('id',j.id).eq('locked_by',workerId));Object.assign(j,values);};
  // Lease only serializes polling/storage; dispatch intent is durable and never expires.
  // Independent bounded stage queues: a backlog in Motion cannot hide waiting images.
  const read=(stage?:string)=>{
    const q=admin.from('face_swap_jobs').select('*').contains('meta',stage?{pipeline_version:2,stage}:{pipeline_version:2});
    return (stage?q.in('status',['waiting']):q.in('status',['uploading','queued','running'])).order('created_at',{ascending:true}).order('id',{ascending:true}).limit(50);
  };
  const batches=await Promise.all([read(),read('face_swap'),read('upscale'),read('control_motion')]);
  const rows=batches.flatMap(r=>check(r)||[]);
  const priority=(j:any)=>j.runninghub_task_id||j.meta.stage==='control_motion'?0:j.meta.stage==='face_swap'?1:2;
  rows.sort((a:any,b:any)=>priority(a)-priority(b)||String(a.created_at||'').localeCompare(String(b.created_at||''))||a.id.localeCompare(b.id));
  let providerFull=false;
  for(const row of rows||[]){
    // Continue reconciling existing tasks even when dispatch is paused.
    if(providerFull&&!row.runninghub_task_id&&row.meta.stage!=='control_motion')continue;
    const claim=check(await admin.rpc('lease_image_pipeline',{p_id:row.id,p_worker:workerId,p_limit:concurrency}));
    const j=Array.isArray(claim)?claim[0]:claim;if(!j)continue;
    try{
      let m={...j.meta};
      if(m.stage==='control_motion'){
        const p=check(await admin.from('production_jobs').select('id,status,result_video_id,last_error,runninghub_task_id,meta').eq('id',j.id).eq('user_id',j.user_id).maybeSingle());
        if(p?.status==='ready'&&p.result_video_id)await patch(j,{status:'ready',progress:100,completed_at:new Date().toISOString(),meta:{...m,pipeline_status:'COMPLETED',control_motion_task_id:p.runninghub_task_id}});
        else if(p?.status==='failed')await patch(j,{status:'failed',last_error:p.last_error,meta:{...m,error_stage:'control_motion',provider_failed:p.meta?.provider_status==='FAILED',dispatch_uncertain:!!p.meta?.pipeline_dispatch_uncertain,pipeline_status:'CONTROL_MOTION_FAILED'}});
        continue;
      }
      const stage=m.stage;
      if(!['face_swap','upscale'].includes(stage))throw new Error('Etapa inválida');
      if(!j.runninghub_task_id){
        // Ambiguous network outcome MUST NOT cause another billable create.
        if(m.dispatch_intent){await patch(j,{status:'failed',last_error:'Envio sem confirmação. Reconcilie a tarefa no provedor antes de tentar novamente.',meta:{...m,dispatch_uncertain:true,error_stage:stage,pipeline_status:stage.toUpperCase()+'_FAILED'}});continue;}
        if(!await d.hasProviderCapacity()){providerFull=true;await patch(j,{status:'waiting',started_at:null,last_error:null,meta:{...m,provider_queue_waiting:true,queue_reason:'provider_capacity',pipeline_status:stage.toUpperCase()+'_WAITING'}});continue;}
        await d.validateStage(stage);
        const path=stage==='upscale'?(m.face_swap_result?.path||j.frame_storage_path):j.frame_storage_path;
        const input=stage==='upscale'&&m.face_swap_result?m.face_swap_result:{name:j.frame_file_name,mime:j.frame_mime_type};
        const reference=await prepareInput(path,input.name||stage+'.jpg',input.mime||'image/jpeg',j.storage_provider);
        let model;
        if(stage==='face_swap'){
          const c=m.character;
          if(!c?.storage_path||!String(c.storage_path).startsWith(j.user_id+'/face-swap-characters/'))throw new Error('Modelo raiz inválida');
          model=await prepareInput(c.storage_path,'modelo.jpg',c.mime_type||'image/jpeg','supabase',{expected_sha256:c.sha256});
        }
        m={...m,dispatch_intent:crypto.randomUUID(),provider_queue_waiting:false,queue_reason:null,pipeline_status:stage.toUpperCase()+'_SUBMITTING'};
        await patch(j,{status:'uploading',meta:m}); // durable BEFORE create
        let created;
        try{created=await rhJson('/task/openapi/create',{...stageInputs(j,reference,model),addMetadata:true});}
        catch{await patch(j,{status:'failed',meta:{...m,dispatch_uncertain:true,error_stage:stage},last_error:'Resposta de criação incerta; tarefa não será repetida automaticamente.'});continue;}
        if(Number(created?.code)!==0||!created?.data?.taskId){
          // Only an explicit rejection without any task ID permits automatic dispatch later.
          if(Number(created?.code)!==0&&String(created?.msg||'').trim()==='TASK_QUEUE_MAXED'&&!created?.data?.taskId){
            providerFull=true;
            await patch(j,{status:'waiting',started_at:null,last_error:null,meta:{...m,dispatch_intent:null,dispatch_uncertain:false,provider_failed:false,error_stage:null,provider_queue_waiting:true,queue_reason:'provider_capacity',last_dispatch_rejection:'TASK_QUEUE_MAXED',pipeline_status:stage.toUpperCase()+'_WAITING'}});
            continue;
          }
          // Unknown/ambiguous outcomes still block another create.
          await patch(j,{status:'failed',meta:{...m,dispatch_uncertain:true,error_stage:stage},last_error:String(created?.msg||'Criação sem taskId; verificar no provedor.')});continue;
        }
        const id=String(created.data.taskId);
        await patch(j,{status:'queued',started_at:null,runninghub_task_id:id,meta:{...m,[stage+'_task_id']:id,provider_status:'QUEUED',provider_queue_waiting:true,pipeline_status:stage.toUpperCase()+'_QUEUED'},last_error:null});
        continue;
      }
      const result=await rhJson('/task/openapi/outputs',{taskId:j.runninghub_task_id});
      if(Number(result?.code)===805){await patch(j,{status:'failed',last_error:String(result?.msg||'Workflow falhou'),meta:{...m,dispatch_uncertain:false,provider_failed:true,error_stage:stage,pipeline_status:stage.toUpperCase()+'_FAILED'}});continue;}
      if(Number(result?.code)!==0||!Array.isArray(result.data)||!result.data.length){
        // Never infer RUNNING from an arbitrary API error or empty outputs.
        const response=await rhJson('/task/openapi/status',{taskId:j.runninghub_task_id});
        const provider=Number(response?.code)===0?String(response.data?.status||response.data||'').toUpperCase():'';
        if(provider==='QUEUED'||!['RUNNING','SUCCESS','FAILED'].includes(provider)&&Number(result?.code)===813){
          await patch(j,{status:'queued',started_at:null,last_error:null,meta:{...m,provider_status:'QUEUED',provider_queue_waiting:true,pipeline_status:stage.toUpperCase()+'_QUEUED'}});
        }else if(provider==='RUNNING'){
          await patch(j,{status:'running',started_at:j.started_at||new Date().toISOString(),last_error:null,meta:{...m,provider_status:'RUNNING',provider_queue_waiting:false,pipeline_status:stage.toUpperCase()+'_RUNNING'}});
        }else if(provider==='FAILED'){
          await patch(j,{status:'failed',last_error:String(result?.msg||'Workflow falhou'),meta:{...m,provider_status:'FAILED',provider_queue_waiting:false,dispatch_uncertain:false,provider_failed:true,error_stage:stage,pipeline_status:stage.toUpperCase()+'_FAILED'}});
        }
        continue;
      }
      const item=exactOutput(result.data,stage==='face_swap'?'240':'131');
      const saved=await saveBlob(j,stage,item);
      m={...m,[stage+'_result']:saved,[stage+'_completed_at']:new Date().toISOString(),dispatch_intent:null,provider_failed:false,dispatch_uncertain:false,error_stage:null,provider_queue_waiting:false,provider_status:'SUCCESS'};
      if(stage==='face_swap'){
        await patch(j,{status:'waiting',started_at:null,runninghub_task_id:null,progress:45,meta:{...m,stage:'upscale',pipeline_status:'UPSCALE_WAITING'},last_error:null});
      }else if(m.source==='face_swap_natural'){
        // Reuse exactly the production_jobs contract consumed by the existing Motion V7 worker.
        const existing=check(await admin.from('production_jobs').select('id,user_id').eq('id',j.id).maybeSingle());
        if(existing&&existing.user_id!==j.user_id)throw new Error('Motion owner mismatch');
        if(!existing){
          check(await admin.from('production_jobs').insert({id:j.id,user_id:j.user_id,storage_provider:j.storage_provider,
            original_storage_path:j.original_storage_path,original_file_name:j.original_file_name,original_mime_type:j.original_mime_type,original_size_bytes:j.original_size_bytes,
            frame_storage_path:saved.path,frame_file_name:saved.name,frame_mime_type:saved.mime,frame_size_bytes:saved.size,
            status:'motion_waiting',progress:0,max_attempts:1,attempt_count:0,
            meta:{workflow_key:'motion_control',workflow_label:'Motion Control V7',workflow_nodes:{video:'275',frame:'299',output:'285'},manual_run:true,auto_chained:true,image_pipeline_version:2,face_swap_job_id:j.id}}));
        }
        await patch(j,{status:'waiting',started_at:null,production_job_id:j.id,result_storage_path:saved.path,result_file_name:saved.name,result_mime_type:saved.mime,result_size_bytes:saved.size,runninghub_task_id:null,progress:75,meta:{...m,stage:'control_motion',pipeline_status:'CONTROL_MOTION_WAITING'},last_error:null});
        await d.wakeMotion();
      }else{
        await patch(j,{status:'ready',result_storage_path:saved.path,result_file_name:saved.name,result_mime_type:saved.mime,result_size_bytes:saved.size,progress:100,completed_at:new Date().toISOString(),meta:{...m,pipeline_status:'COMPLETED'},last_error:null});
      }
    }catch(e){
      // Completed provider tasks remain attached: a storage/poll error retries without create.
      await patch(j,{last_error:e instanceof Error?e.message:String(e),...(!j.runninghub_task_id&&!j.meta.dispatch_intent?{status:'failed',meta:{...j.meta,provider_failed:true,error_stage:j.meta.stage,pipeline_status:j.meta.stage.toUpperCase()+'_FAILED'}}:{})});
    }finally{
      await admin.from('face_swap_jobs').update({locked_by:null,locked_at:null}).eq('id',j.id).eq('locked_by',workerId);
    }
  }
}
