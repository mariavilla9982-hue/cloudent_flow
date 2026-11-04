import {createHash} from 'node:crypto';

// Hash bounded chunks: never materialize another full video ArrayBuffer.
export async function motionVideoDigest(stream:ReadableStream<Uint8Array>,limit=40*1024*1024){
  const reader=stream.getReader(),hash=createHash('sha256');let size=0,prefix=new Uint8Array(16),prefixSize=0;
  try{
    while(true){const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>limit)throw new Error('Motion: vídeo acima do limite de verificação.');
      if(prefixSize<16){const part=value.subarray(0,16-prefixSize);prefix.set(part,prefixSize);prefixSize+=part.length;}
      hash.update(value);
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const mp4=prefixSize>=8&&new TextDecoder().decode(prefix.subarray(4,8))==='ftyp';
  const webm=prefixSize>=4&&prefix[0]===0x1a&&prefix[1]===0x45&&prefix[2]===0xdf&&prefix[3]===0xa3;
  if(!size||!mp4&&!webm)throw new Error('Motion: cópia do vídeo inválida.');
  return {sha256:hash.digest('hex'),size_bytes:size};
}
export async function motionBlobDigest(blob:Blob,limit=40*1024*1024){
  if(blob.size>limit)throw new Error('Motion: vídeo acima do limite de verificação.');
  return motionVideoDigest(blob.stream(),limit);
}

export function validMotionCheckpoint(job:any){
  const c=job.meta?.motion_capture_checkpoint,f=job.meta?.motion_preview_file;
  return job.meta?.workflow_key==='genjutsu'&&job.meta?.workflow_id==='2117411301344411649'&&
    c?.task_id===String(job.runninghub_task_id)&&f?.task_id===c.task_id&&f.node_id==='482'&&c.node_id==='482'&&
    c.provider==='r2'&&c.path===job.user_id+'/production-results/'+c.date+'/'+job.id+'.mp4'&&/^\d{4}-\d{2}-\d{2}$/.test(c.date)&&
    /^[a-f0-9]{64}$/.test(c.sha256)&&Number.isSafeInteger(c.size_bytes)&&c.size_bytes>0&&c.size_bytes<=40*1024*1024;
}

// Recovery only adopts a path/hash recorded from this exact task before upload.
export async function recoverMotionCheckpoint(admin:any,job:any,read:any){
  if(job.hidden_at||job.result_video_id||!validMotionCheckpoint(job))return null;
  if(job.locked_by&&(!Number.isFinite(Date.parse(job.locked_at||''))||Date.now()-Date.parse(job.locked_at)<130000))return null;
  const c=job.meta.motion_capture_checkpoint,lease='motion-recover-'+crypto.randomUUID(),originalStatus=job.status;
  let claim=admin.from('production_jobs').update({status:'running',locked_by:lease,locked_at:new Date().toISOString(),updated_at:new Date().toISOString()})
    .eq('id',job.id).eq('user_id',job.user_id).eq('runninghub_task_id',job.runninghub_task_id).eq('updated_at',job.updated_at).is('result_video_id',null).in('status',['queued','running','failed']);
  claim=job.locked_by?claim.eq('locked_by',job.locked_by).eq('locked_at',job.locked_at):claim.is('locked_by',null);
  const {data:claimed,error:claimError}=await claim.select('*').maybeSingle();if(claimError)throw claimError;if(!claimed)return null;
  job={...job,...claimed};
  let linked=false;
  try{
    const response=await read(c.path);
    if(response.status===404){await response.body?.cancel();return null;}
    if(!response.ok||!response.body)throw new Error('Genjutsu: não foi possível verificar a cópia salva.');
    const digest=await motionVideoDigest(response.body);
    if(digest.size_bytes!==c.size_bytes||digest.sha256!==c.sha256)throw new Error('Genjutsu: cópia salva não coincide com a saída desta tarefa.');
    const {error:ve}=await admin.from('videos').upsert({id:job.id,storage_path:c.path,storage_provider:'r2',file_name:(job.meta.character_name?job.meta.character_name+' · ':'')+'runninghub-'+job.id.slice(0,8)+'.mp4',mime_type:'video/mp4',size_bytes:c.size_bytes,status:'ready',platform:'instagram'},{onConflict:'id'});
    if(ve)throw ve;
    const now=new Date().toISOString();
    const meta={...job.meta,motion_preview_available:true,motion_preview_source_sha256:c.sha256,motion_preview_sha256:c.sha256,motion_preview_verified_bytes:c.size_bytes,motion_preview_verified_at:now,motion_preview_saved_at:job.meta.motion_preview_saved_at||now,result_node_id:'482',result_storage_provider:'r2',provider_task_pending:true,motion_capture_checkpoint:{...c,state:'recovered',recovered_at:now}};
    delete meta.genjutsu_capture_recovery;
    const {data,error}=await admin.from('production_jobs').update({status:'running',progress:99,result_video_id:job.id,result_storage_path:c.path,meta,last_error:null,completed_at:null,locked_by:null,locked_at:null,updated_at:now})
      .eq('id',job.id).eq('user_id',job.user_id).eq('runninghub_task_id',job.runninghub_task_id).eq('locked_by',lease).eq('updated_at',job.updated_at).is('result_video_id',null).in('status',['queued','running']).select('*').maybeSingle();
    if(error)throw error;linked=!!data;return data;
  }finally{
    if(!linked)await admin.from('production_jobs').update({locked_by:null,locked_at:null,...(originalStatus==='failed'?{status:'failed'}:{})}).eq('id',job.id).eq('runninghub_task_id',job.runninghub_task_id).eq('locked_by',lease).is('result_video_id',null);
  }
}
