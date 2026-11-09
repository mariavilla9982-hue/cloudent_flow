import assert from 'node:assert/strict';
import {imagePipelineApi} from '../supabase/functions/_shared/image-pipeline-api.ts';
import {prepareGenjutsuStage,genjutsuInputs} from '../supabase/functions/_shared/genjutsu-stage.ts';
import {runImagePipeline} from '../supabase/functions/_shared/image-pipeline.ts';
import {retryPipelineMotion} from '../supabase/functions/_shared/image-pipeline-retry.ts';
const db={face_swap_jobs:[],production_jobs:[],app_settings:[{key:'genjutsu_readiness',value:{ready:true,workflowId:'2117411301344411649'}}]};
let storageWrites=0,wakes=0,mediaCreates=0,failUpload=false;
const contains=(row,value)=>Object.entries(value).every(([key,expected])=>typeof expected==="object"&&expected!==null?contains(row?.[key],expected):row?.[key]===expected);
const admin={storage:{from(){storageWrites++;throw Error('manual inputs must use B2');}},from(table){let filters=[],op='select',values,single=false;const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},is(k,v){filters.push(r=>(r[k]??null)===v);return q;},contains(k,v){filters.push(r=>contains(r[k],v));return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},order(){return q;},limit(){return q;},insert(v){op='insert';values=v;return q;},update(v){op='update';values=v;return q;},maybeSingle(){single=true;return q;},then(resolve,reject){try{let rows=db[table].filter(r=>filters.every(f=>f(r)));if(op==='insert'){assert(!db[table].some(r=>r.id===values.id),'duplicate insert');const r=structuredClone(values);r.created_at=new Date().toISOString();db[table].push(r);rows=[r];}if(op==='update')for(const r of rows)Object.assign(r,structuredClone(values));return Promise.resolve({data:structuredClone(single?rows[0]||null:rows),error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject);}}};return q;},async rpc(name,{p_id,p_worker}){assert.equal(name,'lease_image_pipeline');const j=db.face_swap_jobs.find(r=>r.id===p_id);if(j.locked_by)return {data:[]};j.locked_by=p_worker;return {data:[structuredClone(j)]};}};
const original={name:'test.mp4',type:'video/mp4',size:500},reference={name:'any-model.webp',type:'image/webp',size:100};
const body={source:'face_swap_natural',workflow_key:'genjutsu',input_mode:'manual_frame',job_id:'10000000-0000-4000-8000-000000000001',original,reference,duration_seconds:10};
const copies=[];
async function call(action,body,user='owner'){const url=new URL('https://api.test/?action='+action);return imagePipelineApi({req:new Request(url,{method:'POST',body:JSON.stringify(body)}),url,admin,user:{id:user},json:(body,status=200)=>({body,status}),objectConfig:async()=>({}),signPut:async(_,path)=>'https://b2.test/'+path,signGet:async(_,path)=>'https://b2.test/'+path,copyObject:async(_,source,dest)=>{copies.push([source,dest]);objects.set(dest,objects.get(source));},wake:async()=>wakes++});}
const ticket=await call('image-pipeline-ticket',body);assert.equal(ticket.status,200);assert.equal(ticket.body.original.provider,'r2');assert.equal(ticket.body.reference.provider,'r2');assert.equal(storageWrites,0);assert.equal(db.face_swap_jobs[0].meta.character,null);assert.equal(db.face_swap_jobs[0].meta.input_mode,'manual_frame');assert.equal(db.face_swap_jobs[0].status,'cancelled');
for(const changed of [{...body,input_mode:undefined,character_id:'jujuh'},{...body,reference:{...reference,size:101}},{...body,duration_seconds:11}])assert.equal((await call('image-pipeline-ticket',changed)).status,409);
for(const changed of [{...body,job_id:'20000000-0000-4000-8000-000000000001',workflow_key:'motion_control'},{...body,job_id:'20000000-0000-4000-8000-000000000002',reference:null},{...body,job_id:'20000000-0000-4000-8000-000000000003',reference:{...reference,size:10*1024*1024+1}}])assert.equal((await call('image-pipeline-ticket',changed)).status,400);
assert.equal((await call('image-pipeline-ticket',body)).body.reference.path,ticket.body.reference.path);assert.equal(db.face_swap_jobs.length,1);
const savedFetch=globalThis.fetch;globalThis.fetch=async url=>{const row=db.face_swap_jobs[0],size=String(url).endsWith('/reference')?row.frame_size_bytes:row.original_size_bytes;return new Response('x',{status:206,headers:{'Content-Range':'bytes 0-0/'+(failUpload?size+1:size)}});};
try{
 failUpload=true;assert.equal((await call('image-pipeline-complete',{job_id:body.job_id})).status,409);assert.equal(db.face_swap_jobs[0].meta.stage,'upload');assert.equal(wakes,0);
 failUpload=false;assert.equal((await call('image-pipeline-complete',{job_id:body.job_id})).status,200);assert.equal(db.face_swap_jobs[0].meta.stage,'frame_ready');assert.equal(wakes,1);
 assert.equal((await call('image-pipeline-complete',{job_id:body.job_id},'stranger')).status,404);
 await call('image-pipeline-complete',{job_id:body.job_id});assert.equal(wakes,1,'complete replay cannot requeue');
}finally{globalThis.fetch=savedFetch;}
const deps={admin,workerId:'w',concurrency:1,hasProviderCapacity:async()=>{throw Error('no image GPU needed');},validateStage:async()=>{throw Error('must skip image stages');},prepareInput:async()=>{throw Error('no image RH uploads');},saveBlob:async()=>{throw Error('no image outputs');},rhJson:async()=>{mediaCreates++;throw Error('no image generations');},wakeMotion:async key=>{assert.equal(key,'genjutsu');wakes++;}};
await runImagePipeline(deps);assert.equal(db.production_jobs.length,1);const p=db.production_jobs[0],j=db.face_swap_jobs[0];assert.equal(p.frame_storage_path,ticket.body.reference.path);assert.equal(p.original_storage_path,ticket.body.original.path);assert.equal(p.meta.workflow_nodes.frame,'496');assert.equal(p.meta.workflow_nodes.video,'970');assert.equal(p.meta.workflow_nodes.output,'482');assert.equal(p.meta.input_mode,'manual_frame');assert.equal(j.meta.prepared_frame.path,p.frame_storage_path);assert.equal(j.meta.upscale_result,undefined);assert.equal(p.status,'motion_waiting');assert.equal(mediaCreates,0);
await runImagePipeline(deps);assert.equal(db.production_jobs.length,1);assert.equal(wakes,2);
p.status='failed';p.runninghub_task_id='failed-task';Object.assign(p.meta,{provider_status:'FAILED',provider_status_task_id:'failed-task'});j.status='failed';
assert.equal((await retryPipelineMotion(admin,'owner',p.id)).reused_inputs,true);assert.equal(p.frame_storage_path,ticket.body.reference.path);assert.equal(p.status,'motion_waiting');
console.log('PASS manual Genjutsu: arbitrary frame/no saved model, B2 only, size/readiness/immutable-mode guards, upload verification, replay/owner, exact media handoff without Face/Upscale, saved-frame retry');

// Historical explicit 503 may resume; ambiguous generation must remain blocked.
p.status='failed';p.runninghub_task_id=null;p.last_error='Gemini recusou a operação (HTTP 503).';
p.meta.pipeline_dispatch_intent=null;p.meta.genjutsu_prompt={status:'generating',transientAttempts:6};
assert.equal((await retryPipelineMotion(admin,'owner',p.id)).reused_inputs,true);
assert.equal(p.meta.genjutsu_prompt.status,'preparing');assert.equal(p.meta.genjutsu_prompt.transientAttempts,undefined);
p.status='failed';p.last_error='Falha de comunicação com Gemini.';p.meta.genjutsu_prompt={status:'generating'};
assert.equal((await retryPipelineMotion(admin,'owner',p.id)).status,409);
console.log('PASS historical explicit 503 resumes same job, ambiguous timeout stays blocked');

p.meta.genjutsu_prompt={status:'generating',interactionId:'existing-background',video:{state:'ACTIVE',expirationTime:'2020-01-01'},image:{state:'ACTIVE',expirationTime:'2020-01-01'}};
assert.equal((await retryPipelineMotion(admin,'owner',p.id)).reused_inputs,true);
assert.equal(p.meta.genjutsu_prompt.interactionId,'existing-background');
assert(p.meta.genjutsu_prompt.video&&p.meta.genjutsu_prompt.image,'background retrieval retains file identity even after media expiry');
console.log('PASS retry recovers the same accepted background analysis without creating a new request');

const prompt='  My own prompt <with symbols>\n\nSecond line.  ';
const objects=new Map([[j.original_storage_path,j.original_size_bytes],[j.frame_storage_path,j.frame_size_bytes]]);
db.app_settings[0].value={ready:false,runninghub:{available:true},workflowId:'2117411301344411649'};
j.status='failed';
const reused={...body,job_id:'10000000-0000-4000-8000-000000000002',manual_prompt:prompt,reuse:{
  original:{id:j.id,asset:j.original_storage_path},reference:{id:j.id,asset:j.frame_storage_path}}};
async function media(resource,id,query='',user='owner'){
  const url=new URL('https://api.test/?resource='+resource+'&id='+id+query);
  return imagePipelineApi({req:new Request(url),url,admin,user:{id:user},json:(body,status=200)=>Response.json(body,{status}),signGet:async(_,path)=>'https://b2.test/'+path});
}
globalThis.fetch=async url=>{
  const size=objects.get(new URL(url).pathname.slice(1));
  return size?new Response('x',{status:206,headers:{'Content-Range':'bytes 0-0/'+size}}):new Response(null,{status:404});
};
try{
  for(const status of ['ready','failed','cancelled']){
    j.status=status;
    const response=await media('image-pipeline-preview',j.id,'&verified=1');
    assert.equal(response.status,200);
    assert.equal((await response.json()).asset,j.frame_storage_path);
  }
  assert.equal((await media('image-pipeline-preview',j.id,'&verified=1','stranger')).status,404);
  j.meta.upscale_result={path:'owner/expired-upscale.png',name:'expired.png',mime:'image/png',size:500};
  assert.equal((await (await media('image-pipeline-preview',j.id,'&verified=1')).json()).asset,j.frame_storage_path,'missing preferred result falls back to the preserved frame');
  objects.delete(j.frame_storage_path);
  assert.equal((await media('image-pipeline-preview',j.id,'&verified=1')).status,404);
  objects.set(j.frame_storage_path,j.frame_size_bytes);
  assert.equal((await call('image-pipeline-ticket',reused,'stranger')).status,404);
  assert.equal((await call('image-pipeline-ticket',{...reused,reuse:{original:{id:j.id,asset:j.frame_storage_path}}})).status,404,'frame cannot be used as the original');
  assert.equal((await call('image-pipeline-ticket',{...reused,manual_prompt:' \n '})).status,409,'blank prompt requires Gemini readiness');
  assert.equal((await call('image-pipeline-ticket',reused)).status,200,'manual entry needs RunningHub only');
  assert.equal((await call('image-pipeline-ticket',{...reused,manual_prompt:'Changed text'})).status,409);
  assert.equal((await call('image-pipeline-ticket',reused)).status,200);
  assert.equal(copies.length,2,'retry does not copy already verified inputs again');
  assert.equal((await call('image-pipeline-complete',{job_id:reused.job_id})).status,200);
  await runImagePipeline(deps);
  const newJob=db.production_jobs.find(row=>row.id===reused.job_id);
  assert(newJob);
  assert.equal(newJob.meta.genjutsu_prompt.source,'manual');
  assert.equal(newJob.meta.genjutsu_prompt.status,'complete');
  assert.equal(newJob.meta.genjutsu_prompt.prompt,prompt);
  assert.equal(await prepareGenjutsuStage({admin,job:newJob,workerId:'w',key:'',readBlob:()=>assert.fail('manual prompt must skip media analysis')}),true);
  const inputs=await genjutsuInputs('original-file','frame-file',newJob);
  assert.deepEqual(inputs.nodeInfoList.at(-1),{nodeId:'910',fieldName:'value',fieldValue:prompt});
  const view=await media('image-pipeline-prompt',newJob.id);
  assert.deepEqual(await view.json(),{prompt,source:'manual'});
  newJob.status='failed';
  assert.equal((await retryPipelineMotion(admin,'owner',newJob.id)).ok,true);
  assert.equal(newJob.meta.genjutsu_prompt.prompt,prompt);
  const tampered=structuredClone(newJob);tampered.meta.genjutsu_prompt.prompt='changed';
  await assert.rejects(genjutsuInputs('original-file','frame-file',tampered),/hash/);
  assert(objects.has(j.original_storage_path)&&objects.has(j.frame_storage_path),'reusing preserves the source objects');
}finally{globalThis.fetch=savedFetch;}
console.log('PASS manual prompt and failed-job media: exact node text, no LLM, retry, download, fallback, owner isolation and idempotent Backblaze copies');

// One request queues the eligible jobs and wakes the serial dispatcher only once.
const second=db.production_jobs.find(row=>row.id===reused.job_id);
const secondParent=db.face_swap_jobs.find(row=>row.id===second.id);
for(const row of [p,second]){row.status='failed';row.runninghub_task_id=null;}
p.meta.genjutsu_prompt={status:'failed',interactionId:'retry-me'};
second.meta.genjutsu_prompt={status:'failed',verifiedProviderFinishReason:'PROHIBITED_CONTENT'};
const copy=(id,overrides)=>db.face_swap_jobs.push({...structuredClone(secondParent),id,...overrides});
const foreign='10000000-0000-4000-8000-000000000003',otherWorkflow='10000000-0000-4000-8000-000000000004';
copy(foreign,{user_id:'stranger'});
copy(otherWorkflow,{meta:{pipeline_version:2,video_workflow:{key:'motion_control'},provider_failed:true,stage:'face_swap'},status:'failed'});
const url=new URL('https://api.test/?action=image-pipeline-retry-genjutsu');
const queueWakes=[];
const batch=ids=>imagePipelineApi({req:new Request(url,{method:'PATCH',body:JSON.stringify({ids})}),url,admin,user:{id:'owner'},json:(body,status=200)=>({body,status}),wake:async key=>queueWakes.push(key)});
assert.equal((await batch(['invalid'])).status,400);
const results=(await batch([p.id,second.id,p.id,foreign,otherWorkflow])).body.results;
assert.deepEqual(results.map(x=>[x.id,x.ok]),[[p.id,true],[second.id,false],[foreign,false],[otherWorkflow,false]]);
assert.match(results[1].error,/filtro de conteúdo/);
assert.equal(p.status,'motion_waiting');
assert.equal(second.status,'failed');
assert.equal((await batch([p.id])).body.results[0].ok,false,'a stale batch does not retry an already queued video');
assert.deepEqual(queueWakes,['genjutsu']);
const outputUrl=new URL('https://api.test/?resource=image-pipeline-result&workflow=genjutsu&id='+p.id);
p.result_storage_path='owner/production-results/video.mp4';
p.meta.result_storage_provider='r2';
const result=async(user='owner')=>imagePipelineApi({req:new Request(outputUrl),url:outputUrl,admin,user:{id:user},json:(body,status=200)=>Response.json(body,{status}),signGet:async(provider,path)=>'https://'+provider+'.test/'+path});
assert.equal((await result('stranger')).status,404);
assert.deepEqual(await (await result()).json(),{url:'https://r2.test/owner/production-results/video.mp4',type:'video'});
p.hidden_at=new Date().toISOString();
assert.equal((await result()).status,404);
console.log('PASS batch retry: dedupe, partial results, content block, ownership, workflow isolation, single wake and protected result URL');
