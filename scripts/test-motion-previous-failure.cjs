const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),{stripTypeScriptTypes}=require('node:module');
const text=fs.readFileSync(process.env.FAILURE_HELPER||'supabase/functions/_shared/motion-failure-repair.ts','utf8');
const original={id:'j',user_id:'owner',status:'motion_waiting',runninghub_task_id:null,last_error:null,updated_at:'old',meta:{workflow_key:'motion_control',previous_motion_task_id:'task'}};
let row=structuredClone(original),calls=0;const updates=[];
const admin={from(table){let patch=null,single=false,filters=[];const b={
 select(){return b},eq(k,v){filters.push([k,v]);return b},is(k,v){if(patch)filters.push([k,v]);return b},contains(k,v){if(patch)filters.push([k,v]);return b},not(){return b},in(){return b},order(){return b},limit(){return b},update(p){patch=p;return b},maybeSingle(){single=true;return b},
 then(resolve,reject){let data=null;
  if(table==='face_swap_jobs')data=single?{id:'j',meta:{pipeline_version:2,stage:'control_motion'}}:null;
  else if(!patch)data=single?{meta:structuredClone(row.meta)}:row.meta.previous_motion_failure?[]:[structuredClone(row)];
  if(patch){
   const match=table==='face_swap_jobs'||filters.every(([k,v])=>v!==null&&typeof v==='object'?Object.entries(v).every(([a,z])=>row[k]?.[a]===z):row[k]===v);
   if(match){updates.push({table,patch,filters});if(table==='production_jobs')Object.assign(row,patch);data={id:'j'};}
  }
  return Promise.resolve({data,error:null}).then(resolve,reject);
 }};return b}};
const c={Date,crypto:globalThis.crypto,AbortSignal,admin,fetch:async url=>{assert(url.endsWith('/openapi/v2/query'));calls++;return Response.json({taskId:'task',status:'FAILED',errorCode:'x',failedReason:{node_id:'367',exception_type:'torch.OutOfMemoryError'}})}};
vm.createContext(c);vm.runInContext(stripTypeScriptTypes(text.replace(/export /g,''),{mode:'transform'})+';globalThis.repair=enrichPreviousMotionFailure;',c);
(async()=>{
 await c.repair(admin,'https://example.test','key');
 assert.equal(calls,1);assert.equal(row.status,'motion_waiting');assert.equal(row.runninghub_task_id,null);assert.equal(row.last_error,null);assert.match(row.meta.previous_motion_failure.detail.message,/VRAM/);
 const n=updates.length;await c.repair(admin,'https://example.test','key');assert.equal(calls,1);assert.equal(updates.length,n);
 assert(updates.every(x=>!('status' in x.patch)&&!('runninghub_task_id' in x.patch)&&!('attempt_count' in x.patch)));
 console.log('PASS previous failure: exact previous task queried once, status/input/current ID preserved, no generation');
})().catch(e=>{console.error(e);process.exit(1)});

