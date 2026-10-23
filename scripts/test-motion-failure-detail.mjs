import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
const folders=['cloudent-production-worker','cloudent-motion-control-worker','cloudent-motion-status-worker'];
const source=fs.readFileSync(`supabase/functions/${folders[0]}/motion-provider-state.ts`,'utf8');
for(const folder of folders)assert.equal(fs.readFileSync(`supabase/functions/${folder}/motion-provider-state.ts`,'utf8'),source);
async function run(status,{legacy=false,detailFails=false,detail={exception_type:'torch.OutOfMemoryError',exception_message:'VRAM OOM Alert',node_id:'367'}}={}){
 const calls=[];
 const c=vm.createContext({AbortSignal,Date,String,Number,fetch:async(url)=>{
  calls.push(url);
  if(url.endsWith('/outputs')){if(detailFails)throw Error('network');return Response.json({code:805,data:{failedReason:detail}})}
  if(url.endsWith('/status'))return Response.json({code:0,data:status});
  return Response.json(legacy?{}:{taskId:'task',status,errorMessage:status==='FAILED'?'工作流运行失败':null});
 }});
 vm.runInContext(stripTypeScriptTypes(source).replaceAll('export ',''),c);
 return {result:await c.readMotionProviderStatus('https://provider','fixture','task'),calls};
}
for(const legacy of [false,true]){const {result,calls}=await run('FAILED',{legacy});assert.equal(result.status,'FAILED');assert.match(result.error,/VRAM.*node 367/);assert.equal(calls.filter(x=>x.endsWith('/outputs')).length,1)}
for(const status of ['RUNNING','QUEUED','SUCCESS']){const {result,calls}=await run(status);assert.equal(result.status,status);assert.equal(calls.length,1)}
let r=await run('FAILED',{detailFails:true});assert.equal(r.result.status,'FAILED');assert.equal(r.result.error,'工作流运行失败');
r=await run('FAILED',{detail:{exception_type:'ValueError',exception_message:'invalid frame',node_id:'299'}});assert.match(r.result.error,/ValueError.*invalid frame.*299/);
console.log('PASS: v2/legacy OOM details, generic fallback on network failure, other exceptions and no extra calls for active/success tasks; three worker copies match');
