import {genjutsuDisplay} from './genjutsu-display.ts';
import {genjutsuContentBlockMessage} from './genjutsu-diagnostics.ts';
import {cancelPipelineMotion,stopGenjutsuMotion} from './image-pipeline-cancel.ts';
import {retryPipelineMotion,knownGenjutsu503} from './image-pipeline-retry.ts';
import {ROOT_IMAGE_B64,ROOT_IMAGE_SHA} from './image-pipeline-root.ts';
import {PIPELINE_CHARACTERS} from './image-pipeline-characters.ts';
import {PIPELINE_VIDEO_WORKFLOWS,pipelineVideoWorkflow} from './image-pipeline-workflows.ts';
const JOB_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function uploadedObjectMatches(address:string,size:number){
  // A presigned GET URL cannot be reused for HEAD: S3 signs the HTTP method.
  const r=await fetch(address,{method:'GET',headers:{Range:'bytes=0-0'},signal:AbortSignal.timeout(15000)});
  const range=r.headers.get('content-range')||'';
  const actual=r.status===206?Number(range.match(/\/(\d+)$/)?.[1]):Number(r.headers.get('content-length'));
  try{await r.body?.cancel();}catch{}
  return r.ok&&Number.isSafeInteger(actual)&&actual===Number(size)&&actual>0;
}
function genjutsuMedia(job:any,userId:string,kind:string){
  if(job?.meta?.video_workflow?.key!=='genjutsu'||job.meta.stage==='upload')return [];
  const original={path:job.original_storage_path,name:job.meta.source_file_name||job.original_file_name,mime:job.original_mime_type,size:job.original_size_bytes};
  const frame={path:job.frame_storage_path,name:job.frame_file_name,mime:job.frame_mime_type,size:job.frame_size_bytes};
  const candidates=kind==='original'?[original]:[job.meta.prepared_frame,job.meta.upscale_result,job.meta.face_swap_result,frame];
  return candidates.filter((asset:any,index:number)=>asset&&typeof asset.path==='string'&&asset.path.startsWith(userId+'/')&&
    typeof asset.name==='string'&&Number.isSafeInteger(asset.size)&&asset.size>0&&
    (kind==='original'?['video/mp4','video/webm','video/quicktime']:['image/jpeg','image/png','image/webp']).includes(asset.mime)&&
    candidates.findIndex((other:any)=>other?.path===asset.path)===index);
}
export async function imagePipelineApi(d:any){
  const {req,url,admin,user,json,signGet,objectConfig,signPut,removePaths,wake,stopGenjutsu,copyObject}=d;
  const action=url.searchParams.get('action'),resource=url.searchParams.get('resource');
  if(['face-swap-upload-ticket','face-swap-upload-complete','face-swap-upload'].includes(action||''))return json({error:'Atualize a página para usar o novo Face Swap Natural.'},409);
  if(!String(action||resource).startsWith('image-pipeline'))return null;
  const check=(r:any)=>{if(r.error)throw r.error;return r.data;};
  const owner=async(id:string)=>check(await admin.from('face_swap_jobs').select('*').eq('id',id).eq('user_id',user.id).contains('meta',{pipeline_version:2}).maybeSingle());
  const retryJob=async(j:any,failedOnly=false):Promise<{ok:boolean;status?:number;error?:string}>=>{
    if(j.meta.stage==='control_motion')return retryPipelineMotion(admin,user.id,j.id,j,failedOnly);
    if(j.status!=='failed'||j.meta.dispatch_uncertain||!j.meta.provider_failed)return {ok:false,error:'A tarefa ainda está ativa ou exige reconciliação com o provedor. Nenhuma geração foi repetida.',status:409};
    const m={...j.meta,dispatch_intent:null,provider_failed:false,error_stage:null};
    let retry=admin.from('face_swap_jobs').update({status:'waiting',runninghub_task_id:null,last_error:null,meta:m}).eq('id',j.id).eq('user_id',user.id).eq('status','failed').is('hidden_at',null);
    retry=j.runninghub_task_id?retry.eq('runninghub_task_id',j.runninghub_task_id):retry.is('runninghub_task_id',null);
    const updated=check(await retry.select('id'));
    return updated?.length?{ok:true}:{ok:false,error:'O estado do vídeo mudou. Atualize a fila.',status:409};
  };
  const retryQueue=(j:any)=>j.meta?.stage==='control_motion'&&j.meta?.video_workflow?.key==='genjutsu'?'genjutsu':'image_pipeline';
  const wakeAfterRetry=async(queues:Iterable<string>)=>{
    const pending=Promise.all([...new Set(queues)].map(queue=>Promise.resolve().then(()=>wake(queue))
      .catch(error=>console.error('image_pipeline_retry_wake',error))));
    const runtime=(globalThis as any).EdgeRuntime;
    if(runtime?.waitUntil)runtime.waitUntil(pending);
    else await pending;
  };
  if(req.method==='GET'&&resource==='image-pipeline-characters'){
    if(url.searchParams.get('metadata')==='1')return json({characters:PIPELINE_CHARACTERS.map(c=>({id:c.id,name:c.name}))});
    return json({characters:PIPELINE_CHARACTERS.map(({base64,...c})=>({...c,preview_url:'data:'+c.mime_type+';base64,'+base64}))});
  }
  if(req.method==='GET'&&resource==='image-pipeline-model'){
    const path=user.id+'/face-swap-characters/fixed-'+ROOT_IMAGE_SHA+'.jpg';
    const bytes=Uint8Array.from(atob(ROOT_IMAGE_B64),c=>c.charCodeAt(0));
    const upload=await admin.storage.from('production').upload(path,bytes,{contentType:'image/jpeg',upsert:false});
    if(upload.error&&!/already exists|duplicate/i.test(upload.error.message))throw upload.error;
    return json({url:await signGet('supabase',path),name:'modelo_raiz.jpg',type:'image/jpeg',sha256:ROOT_IMAGE_SHA});
  }
  if(req.method==='GET'&&resource==='image-pipeline'){
    let query=admin.from('face_swap_jobs').select('*').eq('user_id',user.id).contains('meta',{pipeline_version:2}).is('hidden_at',null);
    if(url.searchParams.get('workflow')==='genjutsu')query=query.contains('meta',{video_workflow:{key:'genjutsu'}});
    const rows=check(await query.order('created_at',{ascending:false}).limit(100));
    const childIds=[...new Set((rows||[]).map((j:any)=>j.production_job_id).filter(Boolean))];
    const children=childIds.length?check(await admin.from('production_jobs')
      .select('id,status,progress,result_video_id,last_error,runninghub_task_id,meta,hidden_at,started_at,completed_at,runninghub_runtime_seconds,created_at,updated_at')
      .in('id',childIds).eq('user_id',user.id)):[];
    const childrenById=new Map<string,any>((children||[]).map((p:any)=>[p.id,p]));
    for(const j of rows||[]){
      if(j.meta?.video_workflow?.key==='genjutsu'){
        const original=genjutsuMedia(j,user.id,'original'),frames=genjutsuMedia(j,user.id,'frame');
        j.media={original:!!original.length,frame:!!frames.length,
          reuseOriginal:j.storage_provider==='r2'&&original.some((asset:any)=>asset.size<=30*1024*1024),
          reuseFrame:j.storage_provider==='r2'&&frames.some((asset:any)=>asset.size<=12*1024*1024)};
        delete j.meta.manual_prompt;
        delete j.meta.reused_inputs;
      }
      if(j.production_job_id){
        const child=childrenById.get(j.production_job_id);
        j.production=child?{...child}:null;
        if(j.production){
          if(j.meta?.video_workflow?.key==='genjutsu'){
            const p=j.production,m=p.meta||{},prompt=m.genjutsu_prompt,task=p.runninghub_task_id;
            p.execution_confirmed=!!p.started_at&&!!p.runninghub_task_id&&String(m.provider_status_task_id)===String(p.runninghub_task_id);
            const canRetryPrompt=!genjutsuContentBlockMessage(prompt?.verifiedProviderFinishReason)&&!m.pipeline_dispatch_intent&&
              (prompt?.status!=='generating'||!!prompt.interactionId||knownGenjutsu503(p));
            p.genjutsu={display:genjutsuDisplay(p,j),phase:prompt?.status||null,promptSource:prompt?.source==='manual'?'manual':prompt?'automatic':null,retryAt:prompt?.retryAt||null,
              providerStatus:m.provider_status||null,providerPending:!!m.provider_task_pending,
              stopRequested:!!task&&String(m.genjutsu_stop_requested_task_id||'')===String(task),
              canRetry:p.status==='failed'&&!m.pipeline_dispatch_uncertain&&!p.result_video_id&&
                (task?m.provider_status==='FAILED':canRetryPrompt)};
          }
          delete j.production.meta;
        }
      }
    }
    // Scheduled children are hidden by the native calendar transfer.
    return json({jobs:(rows||[]).filter((j:any)=>!j.production?.hidden_at)});
  }
  if(req.method==='GET'&&resource==='image-pipeline-prompt'){
    const j=await owner(url.searchParams.get('id')||'');
    if(!j||j.meta?.video_workflow?.key!=='genjutsu')return json({error:'Job não encontrado'},404);
    const p=check(await admin.from('production_jobs').select('meta').eq('id',j.production_job_id||j.id).eq('user_id',user.id).maybeSingle());
    if(p?.meta?.workflow_key!=='genjutsu')return json({error:'Prompt indisponível'},404);
    const prompt=p.meta.genjutsu_prompt;
    if(prompt?.status!=='complete'||typeof prompt.prompt!=='string'||!prompt.prompt.trim())return json({error:'O prompt ainda não foi concluído.'},409);
    // Return only generated text, never Files URIs, credentials or checkpoints.
    const response=json({prompt:prompt.prompt,source:prompt.source==='manual'?'manual':'automatic'});response.headers.set('Cache-Control','private, no-store');return response;
  }
  if(req.method==='GET'&&resource==='image-pipeline-preview'){
    const j=await owner(url.searchParams.get('id')||'');if(!j)return json({error:'Job não encontrado'},404);
    const original=url.searchParams.get('kind')==='original';
    if(url.searchParams.get('verified')==='1'){
      const kind=original?'original':'frame';
      for(const asset of genjutsuMedia(j,user.id,kind)){
        let address:string;
        try{address=await signGet(j.storage_provider,asset.path);}
        catch(error){if([404,'404','not_found'].includes((error as any)?.statusCode))continue;throw error;}
        if(!await uploadedObjectMatches(address,asset.size))continue;
        const response=json({url:address,name:asset.name,mime:asset.mime,size:asset.size,asset:asset.path,
          reusable:j.storage_provider==='r2'&&asset.size<=(original?30:12)*1024*1024,
          ...(original?{duration:j.meta.source_duration_seconds}:{})});
        response.headers?.set('Cache-Control','private, no-store');
        return response;
      }
      return json({error:original?'Vídeo original indisponível.':'Frame indisponível.'},404);
    }
    const result=j.meta?.upscale_result||j.meta?.face_swap_result;
    const path=original?j.original_storage_path:result?.path||j.frame_storage_path;
    if(!path||!String(path).startsWith(user.id+'/'))return json({error:'Prévia indisponível'},404);
    const provider=original&&j.meta?.source==='face_swap_photo'?'supabase':j.storage_provider;
    return json({url:await signGet(provider,path),type:original&&j.original_mime_type?.startsWith('video/')?'video':'image',label:original?'Vídeo original':j.meta?.upscale_result?'Upscale pronto':j.meta?.face_swap_result?'Face Swap pronto':j.meta?.source==='face_swap_natural'?'Primeiro frame':'Referência'});
  }
  if(req.method==='GET'&&resource==='image-pipeline-result'){
    if(url.searchParams.get('workflow')==='genjutsu'){
      const id=url.searchParams.get('id')||'';
      if(!JOB_ID.test(id))return json({error:'Job não encontrado'},404);
      const p=check(await admin.from('production_jobs').select('result_storage_path,storage_provider,meta')
        .eq('id',id).eq('user_id',user.id).contains('meta',{image_pipeline_version:2,workflow_key:'genjutsu'}).is('hidden_at',null).maybeSingle());
      if(!p)return json({error:'Job não encontrado'},404);
      if(!p.result_storage_path?.startsWith(user.id+'/'))return json({error:'Vídeo ainda não disponível'},409);
      const response=json({url:await signGet(p.meta?.result_storage_provider||p.storage_provider,p.result_storage_path),type:'video'});
      response.headers.set('Cache-Control','private, no-store');
      return response;
    }
    const j=await owner(url.searchParams.get('id')||'');if(!j)return json({error:'Job não encontrado'},404);
    if(j.meta.source==='face_swap_natural'){
      const p=check(await admin.from('production_jobs').select('result_storage_path,storage_provider,meta').eq('id',j.id).eq('user_id',user.id).maybeSingle());
      if(!p?.result_storage_path)return json({error:'Vídeo ainda não disponível'},409);
      return json({url:await signGet(p.meta?.result_storage_provider||p.storage_provider,p.result_storage_path),type:'video'});
    }
    if(!j.result_storage_path)return json({error:'Imagem ainda não disponível'},409);
    return json({url:await signGet(j.storage_provider,j.result_storage_path),type:'image'});
  }
  if(req.method==='POST'&&action==='image-pipeline-ticket'){
    const b=await req.json();
    if(!['face_swap_natural','face_swap_photo','upscale_manual'].includes(b.source))return json({error:'Origem inválida'},400);
    const id=String(b.job_id||'');if(!JOB_ID.test(id))return json({error:'Job inválido'},400);
    const image=(p:any)=>p&&['image/jpeg','image/png','image/webp'].includes(p.type)&&Number.isSafeInteger(p.size)&&p.size>0&&p.size<=10*1024*1024;
    const photo=b.source==='face_swap_photo',natural=b.source==='face_swap_natural';
    const directFrame=natural&&b.workflow_key==='genjutsu'&&b.input_mode==='manual_frame';
    if(b.manual_prompt!=null&&(!directFrame||typeof b.manual_prompt!=='string'||b.manual_prompt.length>64000||b.manual_prompt.includes('\0')))return json({error:'Prompt manual inválido. Use até 64.000 caracteres.'},400);
    const manualPrompt=typeof b.manual_prompt==='string'&&b.manual_prompt.trim()?b.manual_prompt:null;
    if(b.reuse!=null&&(!directFrame||typeof b.reuse!=='object'||Array.isArray(b.reuse)||Object.keys(b.reuse).some(key=>!['original','reference'].includes(key))))return json({error:'Mídia para reutilizar inválida.'},400);
    if(b.input_mode&&b.input_mode!=='manual_frame'||b.input_mode==='manual_frame'&&!directFrame)return json({error:'Modo de entrada inválido.'},400);
    const selected=!directFrame&&(natural||photo)?PIPELINE_CHARACTERS.find(c=>c.id===b.character_id&&(natural||['jujuh','sahry_japah'].includes(c.id))):null;
    const manual=photo&&b.character_id==='custom';
    const old=await owner(id);
    if(old&&directFrame&&(old.meta.manual_prompt??null)!==manualPrompt)return json({error:'O prompt deste envio já foi fixado. Crie um novo envio para trocar.'},409);
    const reuse:any={};
    for(const key of ['original','reference']){
      const requested=b.reuse?.[key];
      const previous=old?.meta?.reused_inputs?.[key];
      if(!requested&&!previous)continue;
      if(!requested||typeof requested.id!=='string'||!JOB_ID.test(requested.id)||requested.id===id||typeof requested.asset!=='string'||
        old&&(previous?.id!==requested.id||previous?.path!==requested.asset))return json({error:'Os arquivos deste envio já foram fixados.'},409);
      if(previous){reuse[key]=previous;continue;}
      const source=await owner(requested.id);
      const asset=genjutsuMedia(source,user.id,key==='original'?'original':'frame').find((candidate:any)=>candidate.path===requested.asset);
      if(source?.storage_provider!=='r2'||!asset)return json({error:key==='original'?'Vídeo original indisponível.':'Frame indisponível.'},404);
      reuse[key]={...asset,id:source.id};
    }
    if(old&&(old.meta.input_mode==='manual_frame')!==directFrame)return json({error:'O modo deste envio já foi fixado. Crie um novo envio.'},409);
    if((natural||photo)&&!selected&&!manual&&!directFrame&&!old)return json({error:photo?'Escolha uma folha salva ou Outra modelo antes de gerar.':'Escolha Jujuh, Sahry japah ou Sahry grávida antes de gerar.'},400);
    if(photo&&b.character_id&&!selected&&!manual)return json({error:'Modelo inválida.'},400);
    const workflowKey=String(b.workflow_key||old?.meta?.video_workflow?.key||'motion_control');
    if(natural&&!PIPELINE_VIDEO_WORKFLOWS.some(w=>w.key===workflowKey))return json({error:'Workflow de vídeo inválido.'},400);
    if(old&&natural&&old.meta.video_workflow&&old.meta.video_workflow.key!==workflowKey)return json({error:'O workflow deste envio já foi fixado. Crie um novo envio para mudar.'},409);
    const descriptor=(asset:any)=>({name:asset.name,type:asset.mime,size:asset.size});
    const first=reuse.original?descriptor(reuse.original):photo&&selected?{name:selected.file_name,type:selected.mime_type,size:selected.size_bytes}:b.original;
    const ref=reuse.reference?descriptor(reuse.reference):b.reference;
    if(natural&&workflowKey==='genjutsu_v3'&&(!['video/mp4','video/webm','video/quicktime'].includes(first?.type)||!Number.isSafeInteger(first?.size)||first.size<1||first.size>30*1024*1024))
      return json({error:'GENJUTSU V3: use MP4, WebM ou MOV de até 30 MiB.'},400);
    if(natural&&workflowKey==='genjutsu'){
      const readiness=check(await admin.from('app_settings').select('value').eq('key','genjutsu_readiness').maybeSingle());
      if(!(manualPrompt?(readiness?.value?.runninghub?.available??readiness?.value?.ready):readiness?.value?.ready)||readiness.value.workflowId!=='2117411301344411649')return json({error:'Genjutsu ainda não está validado no servidor.'},409);
      if(!['video/mp4','video/webm','video/quicktime'].includes(first?.type)||Number(first?.size)>30*1024*1024||!Number.isFinite(b.duration_seconds)||b.duration_seconds<=0)return json({error:'Genjutsu: envie um vídeo válido de até 30 MiB, com duração identificável.'},400);
      if(old&&Number(old.meta.source_duration_seconds)!==b.duration_seconds)return json({error:'A duração deste envio já foi fixada. Crie outro envio.'},409);
    }
    if(b.source==='face_swap_natural'?!first?.type?.startsWith('video/')||!Number.isSafeInteger(first.size)||first.size<=0||first.size>500*1024*1024:!image(first))return json({error:'Arquivo de entrada inválido'},400);
    if(b.source!=='upscale_manual'&&!(reuse.reference?ref.size<=12*1024*1024:image(ref)))return json({error:'Referência inválida'},400);
    if(old&&old.meta.source!==b.source)return json({error:'Job já utilizado'},409);
    if(old&&(natural||photo)&&b.character_id&&(old.meta.character_id||(photo?'custom':null))!==b.character_id)return json({error:'A personagem deste envio já foi fixada. Crie um novo envio para mudar.'},409);
    if(old&&old.meta.stage!=='upload')return json({ok:true,registered:true,job_id:id});
    if(old&&directFrame&&(['name','type','size'].some(k=>first?.[k]!==({name:old.original_file_name,type:old.original_mime_type,size:old.original_size_bytes} as any)[k])||['name','type','size'].some(k=>ref?.[k]!==({name:old.frame_file_name,type:old.frame_mime_type,size:old.frame_size_bytes} as any)[k])))return json({error:'Os arquivos deste envio já foram fixados. Crie outro envio para trocar.'},409);
    const cfg=await objectConfig();
    if(!cfg)return json({error:'Configure o Backblaze B2 antes de enviar mídia para este fluxo.'},409);
    const provider=old?.storage_provider||'r2';
    if(provider==='supabase'&&first.size>48*1024*1024)return json({error:'Configure o armazenamento principal para vídeos maiores que 48 MB.'},409);
    let character:any=old?.meta.character||null;
    if((natural||photo)&&!character&&selected){
      const path=user.id+'/face-swap-characters/'+selected.id+'-'+selected.sha256+(selected.mime_type==='image/jpeg'?'.jpg':'.webp');
      const bytes=Uint8Array.from(atob(selected.base64),c=>c.charCodeAt(0));
      const r=await admin.storage.from('production').upload(path,bytes,{contentType:selected.mime_type,upsert:false});
      if(r.error&&!/already exists|duplicate/i.test(r.error.message))throw r.error;
      character={id:selected.id,name:selected.name,storage_path:path,file_name:selected.file_name,mime_type:selected.mime_type,sha256:selected.sha256};
    }
    const prefix=user.id+'/face-swap-inputs/pipeline/'+id;
    const originalPath=photo?(character?.storage_path||old?.original_storage_path||user.id+'/face-swap-characters/'+id+'/manual-root'):prefix+'/original';
    const framePath=b.source==='upscale_manual'?originalPath:prefix+'/reference';
    const originalName=String(photo&&selected?ref.name:first.name||'entrada');
    const taggedName=selected?selected.name+' · '+originalName.slice(0,200):originalName;
    if(!old){check(await admin.from('face_swap_jobs').insert({id,user_id:user.id,storage_provider:provider,original_storage_path:originalPath,original_file_name:taggedName.slice(0,255),original_mime_type:first.type,original_size_bytes:first.size,frame_storage_path:framePath,frame_file_name:String(ref?.name||first.name||'referencia').slice(0,255),frame_mime_type:ref?.type||first.type,frame_size_bytes:ref?.size||first.size,status:'cancelled',auto_send:false,max_attempts:1,meta:{pipeline_version:2,source:b.source,stage:'upload',pipeline_status:'UPLOADING',character,manual_run:true,...(directFrame?{input_mode:'manual_frame',source_file_name:originalName.slice(0,255),...(manualPrompt?{manual_prompt:manualPrompt}:{}),...(Object.keys(reuse).length?{reused_inputs:reuse}:{})}:{}),...(natural?{video_workflow:pipelineVideoWorkflow(workflowKey),...(workflowKey==='genjutsu'?{source_duration_seconds:b.duration_seconds}:{})}:{}),...(selected?{character_id:selected.id,character_name:selected.name,tags:[selected.name],source_file_name:originalName.slice(0,255)}:{})}}));}
    else if(old.meta.stage!=='upload')return json({ok:true,registered:true,job_id:id});
    const parts:any={};
    for(const [key,path,type,p] of [['original',originalPath,first.type,provider],['reference',framePath,ref?.type||first.type,provider]] as any[]){
      if(photo&&character&&key==='original')continue;
      if(reuse[key]){
        const asset=reuse[key];
        const copied=await uploadedObjectMatches(await signGet(provider,path),asset.size);
        if(!copied){
          if(!await uploadedObjectMatches(await signGet(provider,asset.path),asset.size))
            return json({error:key==='original'?'Vídeo original indisponível.':'Frame indisponível.'},404);
          await copyObject(cfg,asset.path,path);
        }
        continue;
      }
      // Manual models must remain in private Supabase, independently of the reference provider.
      const actual=b.source==='face_swap_photo'&&key==='original'?'supabase':p;
      if(actual==='r2')parts[key]={path,upload_url:await signPut(cfg,path),content_type:type,provider:actual};
      else{const signed=check(await admin.storage.from('production').createSignedUploadUrl(path,{upsert:true}));parts[key]={path,upload_url:signed.signedUrl,content_type:type,provider:actual};}
    }
    return json({ok:true,job_id:id,...parts,model_selected:photo&&!!character,same_input:originalPath===framePath});
  }
  if(req.method==='POST'&&action==='image-pipeline-complete'){
    const b=await req.json(),j=await owner(String(b.job_id||''));if(!j)return json({error:'Job não encontrado'},404);
    if(j.meta.stage!=='upload')return json({ok:true,job:j});
    for(const [path,size,provider] of [[j.original_storage_path,j.original_size_bytes,j.meta.source==='face_swap_photo'?'supabase':j.storage_provider],[j.frame_storage_path,j.frame_size_bytes,j.storage_provider]]){
      const address=await signGet(provider,path);
      if(!await uploadedObjectMatches(address,Number(size)))return json({error:'Upload incompleto; selecione novamente os arquivos.'},409);
    }
    const m={...j.meta,stage:j.meta.input_mode==='manual_frame'?'frame_ready':j.meta.source==='upscale_manual'?'upscale':'face_swap',pipeline_status:'UPLOADED'};
    if(m.source==='face_swap_photo'&&!m.character_id){
      const blob=check(await admin.storage.from('production').download(j.original_storage_path));
      const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
      m.character={storage_path:j.original_storage_path,file_name:j.original_file_name,mime_type:j.original_mime_type,sha256:sha};
    }
    const updated=await admin.from('face_swap_jobs').update({status:'waiting',meta:m,next_attempt_at:new Date().toISOString()}).eq('id',j.id).eq('status','cancelled').contains('meta',{stage:'upload'}).select('id');check(updated);
    await wake();return json({ok:true,job_id:j.id});
  }
  if(req.method==='PATCH'&&action==='image-pipeline-stop'){
    const b=await req.json();const r=await stopGenjutsuMotion(admin,user.id,String(b.id||''),stopGenjutsu);return json(r,r.status||200);
  }
  if(req.method==='PATCH'&&action==='image-pipeline-cancel'){
    const b=await req.json();const r=await cancelPipelineMotion(admin,user.id,String(b.id||''));return json(r,r.status||200);
  }
  if(req.method==='PATCH'&&action==='image-pipeline-retry'){
    const b=await req.json(),j=await owner(String(b.id||''));if(!j||j.hidden_at)return json({error:'Job não encontrado'},404);
    const result=await retryJob(j);
    if(result.ok)await wakeAfterRetry([retryQueue(j)]);
    return json(result,result.status||200);
  }
  if(req.method==='PATCH'&&action==='image-pipeline-retry-genjutsu'){
    const {ids}=await req.json();
    if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!JOB_ID.test(id)))return json({error:'Seleção de vídeos inválida.'},400);
    const selected=[...new Set<string>(ids)];
    const rows=check(await admin.from('face_swap_jobs').select('*').eq('user_id',user.id)
      .contains('meta',{pipeline_version:2,video_workflow:{key:'genjutsu'}}).is('hidden_at',null).in('id',selected));
    const byId=new Map<string,any>((rows||[]).map((j:any)=>[j.id,j]));
    const results=[];
    for(let i=0;i<selected.length;i+=8){
      results.push(...await Promise.all(selected.slice(i,i+8).map(async id=>{
        const j=byId.get(id);
        if(!j)return {id,ok:false,error:'Job não encontrado'};
        try{
          const result=await retryJob(j,true);
          return {id,ok:result.ok,error:result.error};
        }catch(error){
          console.error('image_pipeline_batch_retry',id,error);
          return {id,ok:false,error:'Não foi possível confirmar a retomada deste vídeo.'};
        }
      })));
    }
    if(results.some(result=>result.ok))await wakeAfterRetry(results.filter(result=>result.ok).map(result=>retryQueue(byId.get(result.id))));
    return json({results});
  }
  if(req.method==='DELETE'&&action==='image-pipeline-job'){
    const b=await req.json(),j=await owner(String(b.id||''));if(!j)return json({error:'Job não encontrado'},404);
    let child:any=null;
    if(j.production_job_id){
      child=check(await admin.from('production_jobs').select('id,status,meta').eq('id',j.production_job_id).eq('user_id',user.id).maybeSingle());
      // A parent may be terminal while its external task is still active.
      if(child&&(!['ready','failed','cancelled'].includes(child.status)||child.meta?.provider_task_pending||child.meta?.pipeline_dispatch_uncertain))return json({error:'Aguarde o encerramento da tarefa antes de excluir.'},409);
    }
    // Once handed off, the video child owns execution state. The image parent may
    // still say waiting even after the child has failed.
    const handedOff=j.meta.stage==='control_motion'&&!!child;
    if(j.meta.dispatch_uncertain||!handedOff&&(['waiting','uploading','queued','running'].includes(j.status)||j.meta.stage==='control_motion'&&!['ready','failed','cancelled'].includes(j.status)))return json({error:'Aguarde a conclusão da tarefa antes de excluir.'},409);
    if(!j.production_job_id){
      const paths=[j.frame_storage_path,j.result_storage_path,j.meta.face_swap_result?.path,j.meta.upscale_result?.path,...(j.meta.source==='face_swap_photo'?[]:[j.original_storage_path])].filter(Boolean);
      await removePaths(j.storage_provider,[...new Set(paths)]);
      if(j.meta.source==='face_swap_photo'&&!j.meta.character_id)check(await admin.storage.from('production').remove([j.original_storage_path]));
      check(await admin.from('face_swap_jobs').delete().eq('id',j.id).eq('user_id',user.id));return json({ok:true});
    }
    // Native retention owns files shared with production/calendar. Hide without destroying references.
    check(await admin.from('face_swap_jobs').update({hidden_at:new Date().toISOString(),status:j.status==='waiting'?'cancelled':j.status}).eq('id',j.id).eq('user_id',user.id));
    return json({ok:true});
  }
  return json({error:'Operação inválida'},400);
}

