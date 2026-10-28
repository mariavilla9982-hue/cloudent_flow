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
const h=harness([job('a'),job('b')]);
for(let i=0;i<4;i++)await runImagePipeline(h.deps);
assert(h.rows.every(j=>j.status==='ready'));assert.equal(h.creates.length,4);assert.equal(h.production.length,0);
assert.deepEqual(h.creates[0].nodeInfoList.map(x=>x.fieldValue),['owner/face-swap-characters/a','a/ref']);
assert.equal(h.creates[2].nodeInfoList[0].fieldValue,'a/face_swap');
await runImagePipeline(h.deps);assert.equal(h.creates.length,4);
const u=harness([job('u','upscale_manual')]);await runImagePipeline(u.deps);await runImagePipeline(u.deps);assert.equal(u.creates.length,1);assert.equal(u.production.length,0);
const n=harness([job('n','face_swap_natural')]);for(let i=0;i<4;i++)await runImagePipeline(n.deps);assert.equal(n.production.length,1);assert.equal(n.production[0].original_storage_path,'n/video');assert.equal(n.production[0].frame_storage_path,'n/upscale');assert.equal(n.production[0].status,'motion_waiting');assert.equal(n.production[0].meta.workflow_key,'motion_control');await runImagePipeline(n.deps);assert.equal(n.production.length,1);
const uncertain=harness([job('x')]);uncertain.setFailCreate();await runImagePipeline(uncertain.deps);await runImagePipeline(uncertain.deps);assert.equal(uncertain.creates.length,1);assert(uncertain.rows[0].meta.dispatch_uncertain);
const r=harness([job('retry')]);await runImagePipeline(r.deps);await runImagePipeline(r.deps);r.failure.add(r.rows[0].runninghub_task_id);await runImagePipeline(r.deps);assert.equal(r.rows[0].status,'failed');assert.equal(r.rows[0].meta.stage,'upscale');assert(r.rows[0].meta.face_swap_result);assert.equal(r.creates.filter(x=>x.workflowId==='2111452526003380225').length,1);
const blocked=harness([job('blocked')]);blocked.deps.hasProviderCapacity=async()=>false;await runImagePipeline(blocked.deps);assert.equal(blocked.creates.length,0);assert.equal(blocked.rows[0].status,'waiting');
for(const file of ['cloudent-api/index.ts','cloudent-production-worker/index.ts','cloudent-motion-control-worker/index.ts']){
 const s=fs.readFileSync('supabase/functions/'+file,'utf8');new vm.Script(stripTypeScriptTypes(s).replace(/^import .*;\n/gm,''));
}
console.log('PASS: strict nodes, 2 independent photo jobs, manual upscale, original video handoff, stage retry, uncertain create, replay, capacity, worker/API syntax');

// Explicit queue rejection is safe to resume, while ambiguous replies remain blocked.
const full=harness([job('queue-first'),job('queue-second')]);
const createNormally=full.deps.rhJson;let rejects=true,attempts=0;
full.deps.rhJson=async(path,b)=>{if(path.endsWith('create')){attempts++;if(rejects)return {code:999,msg:'TASK_QUEUE_MAXED',data:null};}return createNormally(path,b);};
await runImagePipeline(full.deps);
assert.equal(attempts,1,'stop dispatching remaining waiting jobs on full queue');
assert.equal(full.rows[0].status,'waiting');assert.equal(full.rows[0].last_error,null);
assert.equal(full.rows[0].meta.dispatch_intent,null);assert.equal(full.rows[0].meta.dispatch_uncertain,false);
assert.equal(full.rows[0].meta.provider_queue_waiting,true);assert.equal(full.rows[0].started_at,null);
rejects=false;await runImagePipeline(full.deps);
assert.equal(full.rows[0].runninghub_task_id,'task-1');assert.equal(full.creates.length,2);
// Existing queued task is polled, never dispatched again; timer starts only on RUNNING.
const tracked=harness([job('tracked')]);await runImagePipeline(tracked.deps);
const existingId=tracked.rows[0].runninghub_task_id;let provider='QUEUED';
tracked.deps.rhJson=async(path,b)=>{assert.equal(b.taskId,existingId);assert(!path.endsWith('create'));return path.endsWith('status')?{code:0,data:provider}:{code:813,msg:'waiting'};};
await runImagePipeline(tracked.deps);assert.equal(tracked.rows[0].status,'queued');assert.equal(tracked.rows[0].started_at,null);
tracked.deps.rhJson=async(path,b)=>{assert.equal(b.taskId,existingId);return path.endsWith('status')?{code:0,data:provider}:{code:804};};
provider='RUNNING';await runImagePipeline(tracked.deps);const firstStart=tracked.rows[0].started_at;assert(firstStart);await runImagePipeline(tracked.deps);assert.equal(tracked.rows[0].started_at,firstStart);
provider='UNKNOWN';await runImagePipeline(tracked.deps);assert.equal(tracked.rows[0].status,'running');assert.equal(tracked.creates.length,1);
// One full dispatch must not prevent reconciliation of an already-created task.
const mixed=harness([job('waiting-one'),{...job('existing'),status:'queued',runninghub_task_id:'existing-task'}]);
mixed.deps.hasProviderCapacity=async()=>false;let polled=0;
mixed.deps.rhJson=async(path)=>{polled++;return path.endsWith('status')?{code:0,data:'QUEUED'}:{code:813};};
await runImagePipeline(mixed.deps);assert.equal(polled,2);assert.equal(mixed.reads.length,0);assert.equal(mixed.rows[1].runninghub_task_id,'existing-task');
console.log('PASS: explicit queue rejection resumes; no duplicate task; full queue still polls; true QUEUED/RUNNING and stable started_at');

const priority=harness([{...job('older-up','upscale_manual'),created_at:'2026-10-17'}, {...job('new-face'),created_at:'2026-10-18'}]);
priority.deps.hasProviderCapacity=async()=>priority.creates.length<1;
await runImagePipeline(priority.deps);
assert.equal(priority.creates.length,1);assert.equal(priority.creates[0].workflowId,'2111452526003380225','Face Swap queue has priority over older Upscale');
assert.equal(priority.rows[0].status,'waiting');assert.equal(priority.rows[1].status,'queued');
console.log('PASS stage queues: newer Face Swap uses available slot before older Upscale; completed images remain buffered');

const immediate=harness([job('immediate')]);
await runImagePipeline(immediate.deps);
await runImagePipeline(immediate.deps);
assert.equal(immediate.creates.length,2,'Face output is handed to Upscale without a third cron tick');
assert.equal(immediate.creates[1].nodeInfoList[0].fieldValue,'immediate/face_swap');
assert.equal(immediate.rows[0].meta.stage,'upscale');
assert.equal(immediate.rows[0].status,'queued');
await runImagePipeline(immediate.deps);
assert.equal(immediate.rows[0].status,'ready');
assert.equal(immediate.creates.length,2,'handoff never duplicates either stage');
const noSlot=harness([job('full-after-face')]);
await runImagePipeline(noSlot.deps);
noSlot.deps.hasProviderCapacity=async()=>false;
await runImagePipeline(noSlot.deps);
assert.equal(noSlot.creates.length,1);
assert.equal(noSlot.rows[0].meta.stage,'upscale');
assert.equal(noSlot.rows[0].status,'waiting');
assert(noSlot.rows[0].meta.face_swap_result);
console.log('PASS: same-invocation Face→Upscale handoff, one dispatch only, no capacity bypass and saved Face retained when full');

const standard=harness([{...job('standard','face_swap_natural'),meta:{...job('standard','face_swap_natural').meta,video_workflow:{key:'standard'},character_id:'jujuh',character_name:'Jujuh',tags:['Jujuh']}}]);
let motionWakes=0;standard.deps.wakeMotion=async()=>motionWakes++;
for(let i=0;i<4;i++)await runImagePipeline(standard.deps);
assert.equal(standard.production.length,1);assert.equal(standard.production[0].status,'waiting');assert.equal(standard.production[0].meta.workflow_key,'standard');assert.equal(standard.production[0].meta.video_workflow.workflowId,'2100995504908824578');assert.equal(standard.production[0].frame_storage_path,'standard/upscale');assert.equal(standard.production[0].original_storage_path,'standard/video');assert.equal(motionWakes,0);assert.equal(standard.production[0].meta.character_id,'jujuh');
standard.production[0].status='ready';standard.production[0].result_video_id='video';await runImagePipeline(standard.deps);assert.equal(standard.rows[0].status,'ready');assert.equal(standard.production.length,1);
console.log('PASS: chosen standard workflow handoff, saved Upscale frame, original video, character TAG, no Motion dispatch, completion reconciliation');
