import assert from 'node:assert/strict';
import {runImagePipeline} from '../supabase/functions/_shared/image-pipeline.ts';

async function scenario(child, legacy=false){
 const parent={id:'job',user_id:'owner',status:'waiting',locked_by:null,
  original_storage_path:'owner/original',result_storage_path:'owner/frame',
  meta:{pipeline_version:2,stage:'control_motion',pipeline_status:'CONTROL_MOTION_RUNNING',
   video_workflow:{key:legacy?'genjutsu_v3':'genjutsu'},control_motion_task_id:'retained-task'}};
 let leases=0,dispatches=0;
 const admin={from(table){let predicates=[],patch=null,limit=50;const q={
  select(){return q},contains(k,v){predicates.push(r=>Object.entries(v).every(([key,value])=>r[k]?.[key]===value));return q},
  is(k,v){predicates.push(r=>(r[k]??null)===v);return q},in(k,v){predicates.push(r=>v.includes(r[k]));return q},
  eq(k,v){predicates.push(r=>r[k]===v);return q},order(){return q},limit(n){limit=n;return q},
  update(v){patch=v;return q},
  maybeSingle(){assert.ok(['production_jobs','genjutsu_v3_jobs'].includes(table));return Promise.resolve({data:child&&predicates.every(f=>f(child))?structuredClone(child):null})},
  then(resolve){assert.equal(table,'face_swap_jobs');const match=predicates.every(f=>f(parent));
   if(match&&patch)Object.assign(parent,structuredClone(patch));return Promise.resolve({data:match?[structuredClone(parent)].slice(0,limit):[]}).then(resolve)}
 };return q},async rpc(name,args){assert.equal(name,'lease_image_pipeline');leases++;parent.locked_by=args.p_worker;return {data:structuredClone(parent)}}};
 const deps={admin,workerId:'worker',concurrency:1,rhJson(){dispatches++;throw Error('provider call forbidden')},prepareInput(){throw Error('media read forbidden')},saveBlob(){throw Error('media write forbidden')},wakeMotion(){throw Error('generation wake forbidden')}};
 await runImagePipeline(deps);
 const firstLeases=leases;
 await runImagePipeline(deps);
 return {parent,leases,firstLeases,dispatches};
}
for(const legacy of [false,true]){
 const r=await scenario(null,legacy);
 assert.equal(r.parent.status,'failed');assert.equal(r.parent.meta.pipeline_status,'CONTROL_MOTION_MISSING');
 assert.equal(r.parent.meta.auto_retry_disabled,true);assert.equal(r.parent.meta.dispatch_uncertain,true);
 assert.equal(r.leases,r.firstLeases,'missing child must stop consuming polling leases');
 assert.equal(r.parent.result_storage_path,'owner/frame');assert.equal(r.parent.original_storage_path,'owner/original');
 assert.equal(r.parent.meta.control_motion_task_id,'retained-task');assert.equal(r.dispatches,0);
}
const child={id:'job',user_id:'owner',status:'running',meta:{},runninghub_task_id:'task'};
assert.equal((await scenario(child)).parent.status,'waiting','active child must remain untouched');
assert.equal((await scenario({...child,status:'ready',result_video_id:'video'})).parent.status,'ready');
assert.equal((await scenario({...child,status:'failed',last_error:'provider error'})).parent.status,'failed');
const cancelled=await scenario({...child,status:'cancelled'});
assert.equal(cancelled.parent.status,'cancelled');assert.equal(cancelled.leases,cancelled.firstLeases);
for(const meta of [{provider_task_pending:true},{pipeline_dispatch_uncertain:true}]){
 assert.equal((await scenario({...child,status:'cancelled',meta})).parent.status,'waiting','unconfirmed remote work must remain reconciled');
}
assert.equal((await scenario({...child,user_id:'stranger'})).parent.meta.pipeline_status,'CONTROL_MOTION_MISSING');
console.log('PASS orphan polling stops, cancellation propagates, active/uncertain children and artifacts stay preserved without provider calls');
