const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),{stripTypeScriptTypes}=require('node:module');
const text=fs.readFileSync(process.env.FAILURE_HELPER||'supabase/functions/_shared/motion-failure-repair.ts','utf8');
const original={id:'j',user_id:'owner',status:'failed',runninghub_task_id:'task',last_error:'工作流运行失败',updated_at:'old',meta:{workflow_key:'motion_control'}};
let row=structuredClone(original),calls=0;const updates=[];
const admin={from(table){let patch=null,single=false,filters=[];const b={
 select(){return b},eq(k,v){filters.push([k,v]);return b},contains(k,v){if(patch)filters.push([k,v]);return b},not(){return b},in(){return b},order(){return b},limit(){return b},update(p){patch=p;return b},maybeSingle(){single=true;return b},
 then(resolve,reject){let data=null;
  if(table==='face_swap_jobs')data=single?{id:'j',meta:{pipeline_version:2,stage:'control_motion'}}:null;
  else if(!patch)data=[structuredClone(row)];
  if(patch){
   const match=table==='face_swap_jobs'||filters.every(([k,v])=>typeof v==='object'?Object.entries(v).every(([a,z])=>row[k]?.[a]===z):row[k]===v);
   if(match){updates.push({table,patch,filters});if(table==='production_jobs')Object.assign(row,patch);data={id:'j'};}
  }
  return Promise.resolve({data,error:null}).then(resolve,reject);
 }};return b}};
const c={Date,crypto:globalThis.crypto,AbortSignal,admin,fetch:async url=>{assert(url.endsWith('/task/openapi/outputs'));calls++;return Response.json({code:805,data:{failedReason:{node_id:'367',exception_type:'torch.OutOfMemoryError'}}})}};
vm.createContext(c);vm.runInContext(stripTypeScriptTypes(text.replace(/export /g,''),{mode:'transform'})+';globalThis.repair=enrichFailedMotionJobs;',c);
(async()=>{
 await c.repair(admin,'https://example.test','key');
 assert.equal(calls,1);assert.equal(row.status,'failed');assert.equal(row.runninghub_task_id,'task');assert.match(row.last_error,/VRAM/);
 const n=updates.length;await c.repair(admin,'https://example.test','key');assert.equal(calls,1);assert.equal(updates.length,n);
 assert(updates.every(x=>!('status' in x.patch)&&!('runninghub_task_id' in x.patch)&&!('attempt_count' in x.patch)));
 console.log('PASS failure repair: output-only request, lease dedupe, owner and same task guards, status/task/attempts preserved');
})().catch(e=>{console.error(e);process.exit(1)});
