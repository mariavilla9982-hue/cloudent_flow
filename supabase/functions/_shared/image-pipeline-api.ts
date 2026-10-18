import {ROOT_IMAGE_B64,ROOT_IMAGE_SHA} from './image-pipeline-root.ts';
export async function imagePipelineApi(d:any){
  const {req,url,admin,user,json,signGet,objectConfig,signPut,removePaths,wake}=d;
  const action=url.searchParams.get('action'),resource=url.searchParams.get('resource');
  if(['face-swap-upload-ticket','face-swap-upload-complete','face-swap-upload'].includes(action||''))return json({error:'Atualize a página para usar o novo Face Swap Natural.'},409);
  if(!String(action||resource).startsWith('image-pipeline'))return null;
  const check=(r:any)=>{if(r.error)throw r.error;return r.data;};
  const owner=async(id:string)=>check(await admin.from('face_swap_jobs').select('*').eq('id',id).eq('user_id',user.id).contains('meta',{pipeline_version:2}).maybeSingle());
  if(req.method==='GET'&&resource==='image-pipeline-model'){
    const path=user.id+'/face-swap-characters/fixed-'+ROOT_IMAGE_SHA+'.jpg';
    const bytes=Uint8Array.from(atob(ROOT_IMAGE_B64),c=>c.charCodeAt(0));
    const upload=await admin.storage.from('production').upload(path,bytes,{contentType:'image/jpeg',upsert:false});
    if(upload.error&&!/already exists|duplicate/i.test(upload.error.message))throw upload.error;
    return json({url:await signGet('supabase',path),name:'modelo_raiz.jpg',type:'image/jpeg',sha256:ROOT_IMAGE_SHA});
  }
  if(req.method==='GET'&&resource==='image-pipeline'){
    const rows=check(await admin.from('face_swap_jobs').select('*').eq('user_id',user.id).contains('meta',{pipeline_version:2}).is('hidden_at',null).order('created_at',{ascending:false}).limit(100));
    for(const j of rows||[]){
      if(j.production_job_id)j.production=check(await admin.from('production_jobs').select('id,status,progress,result_video_id,last_error').eq('id',j.production_job_id).eq('user_id',user.id).maybeSingle());
    }
    return json({jobs:rows});
  }
  if(req.method==='GET'&&resource==='image-pipeline-result'){
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
    const id=String(b.job_id||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return json({error:'Job inválido'},400);
    const image=(p:any)=>p&&['image/jpeg','image/png','image/webp'].includes(p.type)&&Number.isSafeInteger(p.size)&&p.size>0&&p.size<=10*1024*1024;
    const first=b.original,ref=b.reference;
    if(b.source==='face_swap_natural'?!first?.type?.startsWith('video/')||!Number.isSafeInteger(first.size)||first.size<=0||first.size>500*1024*1024:!image(first))return json({error:'Arquivo de entrada inválido'},400);
    if(b.source!=='upscale_manual'&&!image(ref))return json({error:'Referência inválida'},400);
    const old=await owner(id);
    if(old&&old.meta.source!==b.source)return json({error:'Job já utilizado'},409);
    const cfg=await objectConfig();
    if(!cfg)return json({error:'Configure o Backblaze B2 antes de enviar mídia para este fluxo.'},409);
    const provider=old?.storage_provider||'r2';
    if(provider==='supabase'&&first.size>48*1024*1024)return json({error:'Configure o armazenamento principal para vídeos maiores que 48 MB.'},409);
    let character:any=null;
    if(b.source==='face_swap_natural'){
      const path=user.id+'/face-swap-characters/fixed-'+ROOT_IMAGE_SHA+'.jpg';
      const bytes=Uint8Array.from(atob(ROOT_IMAGE_B64),c=>c.charCodeAt(0));
      const r=await admin.storage.from('production').upload(path,bytes,{contentType:'image/jpeg',upsert:false});
      if(r.error&&!/already exists|duplicate/i.test(r.error.message))throw r.error;
      character={storage_path:path,file_name:'modelo_raiz.jpg',mime_type:'image/jpeg',sha256:ROOT_IMAGE_SHA};
    }
    const prefix=user.id+'/face-swap-inputs/pipeline/'+id;
    const originalPath=b.source==='face_swap_photo'?user.id+'/face-swap-characters/'+id+'/manual-root':prefix+'/original';
    const framePath=b.source==='upscale_manual'?originalPath:prefix+'/reference';
    if(!old){check(await admin.from('face_swap_jobs').insert({id,user_id:user.id,storage_provider:provider,original_storage_path:originalPath,original_file_name:String(first.name||'entrada').slice(0,255),original_mime_type:first.type,original_size_bytes:first.size,frame_storage_path:framePath,frame_file_name:String(ref?.name||first.name||'referencia').slice(0,255),frame_mime_type:ref?.type||first.type,frame_size_bytes:ref?.size||first.size,status:'cancelled',auto_send:false,max_attempts:1,meta:{pipeline_version:2,source:b.source,stage:'upload',pipeline_status:'UPLOADING',character,manual_run:true}}));}
    else if(old.meta.stage!=='upload')return json({ok:true,registered:true,job_id:id});
    const parts:any={};
    for(const [key,path,type,p] of [['original',originalPath,first.type,provider],['reference',framePath,ref?.type||first.type,provider]] as any[]){
      // Manual models must remain in private Supabase, independently of the reference provider.
      const actual=b.source==='face_swap_photo'&&key==='original'?'supabase':p;
      if(actual==='r2')parts[key]={path,upload_url:await signPut(cfg,path),content_type:type,provider:actual};
      else{const signed=check(await admin.storage.from('production').createSignedUploadUrl(path,{upsert:true}));parts[key]={path,upload_url:signed.signedUrl,content_type:type,provider:actual};}
    }
    return json({ok:true,job_id:id,...parts,same_input:originalPath===framePath});
  }
  if(req.method==='POST'&&action==='image-pipeline-complete'){
    const b=await req.json(),j=await owner(String(b.job_id||''));if(!j)return json({error:'Job não encontrado'},404);
    if(j.meta.stage!=='upload')return json({ok:true,job:j});
    for(const [path,size,provider] of [[j.original_storage_path,j.original_size_bytes,j.meta.source==='face_swap_photo'?'supabase':j.storage_provider],[j.frame_storage_path,j.frame_size_bytes,j.storage_provider]]){
      const address=await signGet(provider,path),r=await fetch(address,{method:'HEAD'});
      if(!r.ok||Number(r.headers.get('content-length'))!==Number(size))return json({error:'Upload incompleto; selecione novamente os arquivos.'},409);
    }
    const m={...j.meta,stage:j.meta.source==='upscale_manual'?'upscale':'face_swap',pipeline_status:'UPLOADED'};
    if(m.source==='face_swap_photo'){
      const blob=check(await admin.storage.from('production').download(j.original_storage_path));
      const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
      m.character={storage_path:j.original_storage_path,file_name:j.original_file_name,mime_type:j.original_mime_type,sha256:sha};
    }
    const updated=await admin.from('face_swap_jobs').update({status:'waiting',meta:m,next_attempt_at:new Date().toISOString()}).eq('id',j.id).eq('status','cancelled').contains('meta',{stage:'upload'}).select('id');check(updated);
    await wake();return json({ok:true,job_id:j.id});
  }
  if(req.method==='PATCH'&&action==='image-pipeline-retry'){
    const b=await req.json(),j=await owner(String(b.id||''));if(!j)return json({error:'Job não encontrado'},404);
    if(j.status!=='failed'||j.meta.dispatch_uncertain||!j.meta.provider_failed)return json({error:'A tarefa ainda está ativa ou exige reconciliação com o provedor. Nenhuma geração foi repetida.'},409);
    if(j.meta.stage==='control_motion'){
      const p=check(await admin.from('production_jobs').select('*').eq('id',j.id).eq('user_id',user.id).maybeSingle());
      if(!p||p.status!=='failed'||p.meta?.provider_status!=='FAILED'||p.meta?.provider_status_task_id!==p.runninghub_task_id||p.meta?.pipeline_dispatch_uncertain)return json({error:'Motion exige confirmação da falha no provedor.'},409);
      check(await admin.from('production_jobs').update({status:'motion_waiting',runninghub_task_id:null,attempt_count:0,last_error:null,meta:{...p.meta,pipeline_dispatch_intent:null,pipeline_dispatch_uncertain:false}}).eq('id',j.id).eq('status','failed').eq('runninghub_task_id',p.runninghub_task_id));
      check(await admin.from('face_swap_jobs').update({status:'waiting',last_error:null,meta:{...j.meta,provider_failed:false,error_stage:null}}).eq('id',j.id).eq('status','failed'));
      await wake();return json({ok:true});
    }
    const m={...j.meta,dispatch_intent:null,provider_failed:false,error_stage:null};
    let retry=admin.from('face_swap_jobs').update({status:'waiting',runninghub_task_id:null,last_error:null,meta:m}).eq('id',j.id).eq('status','failed');
    retry=j.runninghub_task_id?retry.eq('runninghub_task_id',j.runninghub_task_id):retry.is('runninghub_task_id',null);check(await retry);
    await wake();return json({ok:true});
  }
  if(req.method==='DELETE'&&action==='image-pipeline-job'){
    const b=await req.json(),j=await owner(String(b.id||''));if(!j)return json({error:'Job não encontrado'},404);
    if(['waiting','uploading','queued','running'].includes(j.status)||j.meta.dispatch_uncertain||j.meta.stage==='control_motion'&&j.status!=='ready')return json({error:'Aguarde a conclusão da tarefa antes de excluir.'},409);
    if(!j.production_job_id){
      const paths=[j.frame_storage_path,j.result_storage_path,j.meta.face_swap_result?.path,j.meta.upscale_result?.path,...(j.meta.source==='face_swap_photo'?[]:[j.original_storage_path])].filter(Boolean);
      await removePaths(j.storage_provider,[...new Set(paths)]);
      if(j.meta.source==='face_swap_photo')check(await admin.storage.from('production').remove([j.original_storage_path]));
      check(await admin.from('face_swap_jobs').delete().eq('id',j.id).eq('user_id',user.id));return json({ok:true});
    }
    // Native retention owns files shared with production/calendar. Hide without destroying references.
    check(await admin.from('face_swap_jobs').update({hidden_at:new Date().toISOString(),status:j.status==='waiting'?'cancelled':j.status}).eq('id',j.id).eq('user_id',user.id));
    return json({ok:true});
  }
  return json({error:'Operação inválida'},400);
}
