import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {runImagePipeline,stageInputs,exactOutput} from '../supabase/functions/_shared/image-pipeline.ts';
const job=(id,source='face_swap_photo')=>({id,user_id:'owner',status:'waiting',storage_provider:'supabase',frame_storage_path:id+'/ref',original_storage_path:id+'/video',original_file_name:id+'.mp4',meta:{pipeline_version:2,source,stage:source==='upscale_manual'?'upscale':'face_swap',character:{storage_path:'owner/face-swap-characters/'+id,mime_type:'image/jpeg'}}});
function harness(rows){
 const production=[],creates=[],saves=[],reads=[];let failCreate=false;const failure=new Set();
 const admin={from(table){let filters=[],op='select',values;const q={select(){return q},contains(k,v){filters.push(r=>Object.entries(v).every(([x,y])=>r[k]?.[x]===y));return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},eq(k,v){filters.push(r=>r[k]===v);return q},order(){return q},limit(){return q},maybeSingle(){return q.then(r=>({...r,data:r.data[0]||null}))},update(v){op='update';values=v;return q},insert(v){op='insert';values=v;return q},then(resolve,reject){try{const arr=table==='face_swap_jobs'?rows:production;let found=arr.filter(r=>filters.every(f=>f(r)));if(op==='insert'){arr.push(structuredClone(values));found=[values];}if(op==='update')for(const r of found)Object.assign(r,structuredClone(values));return Promise.resolve({data:structuredClone(found),error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject)}}};return q;},async rpc(name,{p_id,p_worker}){assert.equal(name,'lease_image_pipeline');const j=rows.find(j=>j.id===p_id);if(j.locked_by)return {data:[]};j.locked_by=p_worker;return {data:[structuredClone(j)]}}};
 const deps={admin,workerId:'w',concurrency:2,hasProviderCapacity:async()=>true,validateStage:async()=>{},prepareInput:async(path)=>{reads.push(path);return path;},wakeMotion:async()=>{},saveBlob:async(j,stage)=>{saves.push([j.id,stage]);return {path:j.id+'/'+stage,name:stage+'.png',mime:'image/png',size:50}},rhJson:async(path,b)=>{if(path.endsWith('create')){creates.push(structuredClone(b));if(failCreate)throw new Error('timeout');return {code:0,data:{taskId:'task-'+creates.length}};}if(failure.has(b.taskId))return {code:805,msg:'failed'};return {code:0,data:[{nodeId:rows.find(j=>j.runninghub_task_id===b.taskId)?.meta.stage==='face_swap'?'240':'131',fileUrl:'https://example.test/result.png'}]};}};
 return {deps,rows,production,creates,saves,reads,setFailCreate:()=>failCreate=true,failure};
}

assert.throws(()=>exactOutput([{nodeId:'999',fileUrl:'https://example.test/a.png'}],'240'));
assert.equal(stageInputs(job('a'),'ref','model').nodeInfoList[0].nodeId,'23');
const photos=harness([job('a'),job('b')]);
for(let i=0;i<4;i++)await runImagePipeline(photos.deps);
assert(photos.rows.every(j=>j.status==='ready'));assert.equal(photos.creates.length,2);assert.equal(photos.production.length,0);
assert.equal(photos.rows[0].result_storage_path,'a/face_swap');assert(photos.rows.every(j=>j.meta.upscale_skipped));
for(const key of ['genjutsu','motion_control','standard']){
 const id=key;const h=harness([{...job(id,'face_swap_natural'),meta:{...job(id,'face_swap_natural').meta,video_workflow:{key},source_duration_seconds:10.7}}]);
 for(let i=0;i<4;i++)await runImagePipeline(h.deps);
 assert.equal(h.creates.length,1);assert.equal(h.production.length,1);assert.equal(h.production[0].frame_storage_path,id+'/face_swap');assert.equal(h.production[0].original_storage_path,id+'/video');
 assert.equal(h.production[0].meta.workflow_key,key);
}
const retired=harness([job('retired','upscale_manual')]);await runImagePipeline(retired.deps);assert.equal(retired.creates.length,0);assert.equal(retired.rows[0].status,'cancelled');
const buffered=job('buffered','face_swap_natural');buffered.meta.stage='upscale';buffered.meta.face_swap_result={path:'buffered/face_swap',name:'frame.png',mime:'image/png',size:50};
const b=harness([buffered]);await runImagePipeline(b.deps);assert.equal(b.creates.length,0);assert.equal(b.production[0].frame_storage_path,'buffered/face_swap');
const active=job('active','upscale_manual');active.meta.stage='upscale';active.status='running';active.runninghub_task_id='existing-upscale';
const a=harness([active]);await runImagePipeline(a.deps);assert.equal(a.creates.length,0);assert.equal(a.rows[0].status,'ready');assert.equal(a.rows[0].result_storage_path,'active/upscale');
const uncertain=harness([job('uncertain')]);uncertain.setFailCreate();await runImagePipeline(uncertain.deps);await runImagePipeline(uncertain.deps);assert.equal(uncertain.creates.length,1);assert(uncertain.rows[0].meta.dispatch_uncertain);
const blocked=harness([job('blocked')]);blocked.deps.hasProviderCapacity=async()=>false;await runImagePipeline(blocked.deps);assert.equal(blocked.creates.length,0);assert.equal(blocked.rows[0].status,'waiting');
for(const file of ['cloudent-api/index.ts','cloudent-production-worker/index.ts','cloudent-motion-control-worker/index.ts']){
 const source=fs.readFileSync('supabase/functions/'+file,'utf8');new vm.Script(stripTypeScriptTypes(source).replace(/^import .*;\n/gm,''));
}
console.log('PASS no Upscale dispatch: photos finish at Face Swap, all video workflows reuse original/frame, retired queued tasks stop, existing task reconciles, buffered handoff, ambiguity and capacity guards');
