import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {motionVideoDigest,motionBlobDigest} from '../supabase/functions/_shared/motion-video-integrity.ts';
import {genjutsuExecutionEvent,safeGenjutsuError} from '../supabase/functions/_shared/genjutsu-diagnostics.ts';
const source=fs.readFileSync('supabase/functions/cloudent-production-worker/index.ts','utf8');
const functions=stripTypeScriptTypes(source.slice(source.indexOf('const MOTION_PREVIEW_WORKFLOW'),source.indexOf('Deno.serve')));
const bytes=new Uint8Array(64);bytes.set(new TextEncoder().encode('ftyp'),4);const blob=new Blob([bytes],{type:'video/mp4'});
const originalDigest=await motionBlobDigest(blob,64);
function harness(options={}){
  let row={id:'job',user_id:'owner',status:'running',storage_provider:'r2',runninghub_task_id:'task',result_video_id:'job',result_storage_path:'owner/production-results/job.mp4',
    meta:{workflow_key:'genjutsu',workflow_id:'2117411301344411649',motion_preview_available:true,motion_preview_saved_at:new Date(Date.now()-1000).toISOString(),result_node_id:options.wrongNode?'384':'482',motion_preview_file:{task_id:options.wrongTask?'other':'task',node_id:'482'}}};
  if(options.zero)row.meta.workflow_id='2124648844280733698';
  if(options.priorMeta)Object.assign(row.meta,options.priorMeta);
  const events=[],writes=[];let status=0,cancels=0;
  const queue={paused:false,prompt_concurrency:1};
  const video={id:options.wrongOwner?'foreign-job':'job',status:'ready',storage_path:row.result_storage_path,storage_provider:'r2',size_bytes:64,mime_type:'video/mp4'};
  if(options.cleaned){row.meta.motion_preview_source_sha256=originalDigest.sha256;row.meta.motion_capture_checkpoint={path:row.result_storage_path,task_id:options.wrongCheckpoint?'other':'task',node_id:'482',provider:'r2',size_bytes:64,sha256:originalDigest.sha256};Object.assign(video,{original_storage_path:row.result_storage_path,storage_path:'owner/cleaned/video/job.mp4',size_bytes:32});}
  const admin={rpc:async name=>{assert.equal(name,'wake_genjutsu_queue');return {data:true};},from(table){let value;const q={select(){return q;},eq(){return q;},in(){return q;},is(){return q;},update(v){value=v;return q;},async maybeSingle(){if(table==='app_settings')return {data:{value:structuredClone(queue)}};if(value){writes.push(structuredClone(value));Object.assign(row,value);events.push('verify-saved');return {data:{id:row.id}};}return {data:table==='production_jobs'?structuredClone(row):video};},then(resolve){if(value){writes.push(structuredClone(value));if(table==='app_settings')Object.assign(queue,value.value);else Object.assign(row,value);}return Promise.resolve({error:null}).then(resolve);}};return q;}};
  const c=vm.createContext({Date,Number,String,Array,Uint8Array,TextDecoder,crypto,Blob,URL,AbortSignal,Error,Promise,JSON,setTimeout,clearTimeout,setInterval,clearInterval,
    motionVideoDigest,motionBlobDigest,Deno:{env:{get:()=>''}},EdgeRuntime:{waitUntil(){}},genjutsuExecutionEvent,safeGenjutsuError,console,
    getCloudentR2Config:async()=>({}),requireMotionStorage:async()=>{if(options.storageBlocked)throw Error('storage blocked');},
    motionStorageRead:async()=>{events.push('download-copy');return new Response(options.corrupt?new Blob(['bad']):blob);},
    fetch:async()=>Response.json({data:{netWssUrl:'wss://www.runninghub.ai/ws?Rh-Comfy-Auth=private-token'}})
  });vm.runInContext(functions,c);
  const rhJson=async(path,{taskId},signal)=>{assert.equal(taskId,'task');assert(signal instanceof AbortSignal);events.push(path);
    if(path.endsWith('cancel')){cancels++;assert.equal(row.meta.provider_cancel_audit.at(-1).outcome,'sending');if(options.httpDenied)throw Object.assign(Error('APIKEY_TASK_CANCEL_NOT_ALLOWED'),{httpStatus:500,providerCode:817});if(options.sessionExpired)throw Object.assign(Error('session expired'),{httpStatus:401});if(options.cancelResponse)return options.cancelResponse;if(options.cancelError||options.cancelTransient&&cancels===1)throw Error('network unavailable');if(options.cancelRejected)return {code:503,msg:'rejected'};return {code:0,msg:'success'};}
    if(options.statusError)throw Error('provider unreachable');if(options.nativeMissing)return {code:807};return {code:0,data:options.nativeStatus|| (options.naturalSuccess?'SUCCESS':++status===1||options.keepRunning?'RUNNING':'CANCELLED')};
  };
  if(options.uiResponse){rhJson.cancelUIAccountId='2093283289942581250';rhJson.cancelUI=async payload=>{assert.equal(payload.task_id,'task');assert(payload.lease.startsWith('genjutsu-provider-stop-'));events.push('/ui/cancel');return {method:'authenticated_ui',account_id:'2093283289942581250',observed_at:new Date().toISOString(),...options.uiResponse};};}
  if(options.passiveResponse){rhJson.cancelUIAccountId='2093283289942581250';rhJson.prepareUI=async payload=>{assert.equal(payload.task_id,'task');events.push('/ui/passive');return {method:'authenticated_ui',account_id:'2093283289942581250',observed_at:new Date().toISOString(),...options.passiveResponse};};}
  return {c,admin,rhJson,events,writes,queue,get row(){return row;}};
}
const h=harness();assert.equal(h.c.isMotionPreviewJob(h.row),true);assert.equal(h.c.motionOutputNode(h.row),'482');
const event=(node,task='task')=>({type:'executed',data:{node,prompt_id:task,output:{videos:[{filename:'video.mp4',subfolder:'',type:'output'}]}}});
assert.equal(h.c.motionPreviewFile(event('384'),'task','482'),null);
assert.equal(h.c.motionPreviewFile(event('482','other'),'task','482'),null);
assert.equal(h.c.motionPreviewFile(event('482'),'task','482').node_id,'482');
const routed=h.c.motionPreviewViewUrl('https://www.runninghub.ai','wss://www.runninghub.ai/ws/c_instance?Rh-Comfy-Auth=private-token&c_host=10.1.2.3&c_port=80&clientId=client&workflowId=2117411301344411649&target=https%3A%2F%2Fworker.runninghub.ai',{filename:'video.mp4',subfolder:'',node_id:'482'});
const routedUrl=new URL(routed);assert.equal(routedUrl.origin,'https://www.runninghub.ai');assert.equal(routedUrl.searchParams.get('c_host'),'10.1.2.3');assert.equal(routedUrl.searchParams.get('target'),'https://worker.runninghub.ai');
assert.throws(()=>h.c.motionPreviewViewUrl('https://www.runninghub.ai','wss://other.test/ws?Rh-Comfy-Auth=secret',{filename:'video.mp4',node_id:'482'}));
assert.equal(h.c.isMotionPreviewJob({meta:{workflow_key:'genjutsu',workflow_id:'other'}}),false);
assert.equal(await h.c.cancelMotionAfterSave(h.admin,'job',h.rhJson),true);
assert(h.events.indexOf('download-copy')<h.events.indexOf('/task/openapi/cancel'));
assert(h.events.indexOf('verify-saved')<h.events.indexOf('/task/openapi/cancel'));
assert(h.events.indexOf('/task/openapi/cancel')<h.events.indexOf('/task/openapi/status'));
assert(h.row.meta.provider_cancel_lag_ms>=0&&h.row.meta.provider_cancel_lag_ms<10000);
assert.equal(h.row.meta.genjutsu_cancel_phase,'PROVIDER_STOPPED');
assert.equal(h.row.status,'ready');assert.equal(h.row.result_video_id,'job');assert.equal(h.row.meta.motion_preview_verified_bytes,64);
for(const options of [{wrongNode:true},{wrongTask:true},{wrongOwner:true},{corrupt:true},{storageBlocked:true}]){const h=harness(options);await assert.rejects(()=>h.c.cancelMotionAfterSave(h.admin,'job',h.rhJson));assert(!h.events.includes('/task/openapi/cancel'));}
const pending=harness({keepRunning:true});assert.equal(await pending.c.cancelMotionAfterSave(pending.admin,'job',pending.rhJson),false);assert.equal(pending.row.status,'running');assert.equal(pending.row.meta.provider_task_pending,true);assert.equal(pending.row.result_video_id,'job');
assert.equal(pending.row.meta.genjutsu_cancel_phase,'CANCELLING_PROVIDER');
const recovered=harness({cancelTransient:true});assert.equal(await recovered.c.cancelMotionAfterSave(recovered.admin,'job',recovered.rhJson),true);
assert.equal(recovered.events.filter(x=>x==='/task/openapi/cancel').length,2);
for(const options of [{cancelRejected:true,keepRunning:true},{cancelError:true,keepRunning:true},{statusError:true}]){
  const h=harness(options);assert.equal(await h.c.cancelMotionAfterSave(h.admin,'job',h.rhJson),false);
  assert.equal(h.row.result_video_id,'job');assert.equal(h.row.status,'running');assert.equal(h.row.meta.provider_task_pending,true);
  assert(h.row.meta.provider_cancel_error);assert(h.events.includes('/task/openapi/cancel'));
}
console.log('PASS 482 capture checksum before bounded cancellation, immediate request before status, retry, pending, provider errors');
const cleaned=harness({cleaned:true});assert.equal(await cleaned.c.cancelMotionAfterSave(cleaned.admin,'job',cleaned.rhJson),true);assert.equal(cleaned.row.meta.motion_preview_verified_bytes,64);
const wrongCheckpoint=harness({cleaned:true,wrongCheckpoint:true});await assert.rejects(()=>wrongCheckpoint.c.cancelMotionAfterSave(wrongCheckpoint.admin,'job',wrongCheckpoint.rhJson));assert(!wrongCheckpoint.events.includes('/task/openapi/cancel'));
console.log('PASS actual videos schema has no user_id; cleaner path/size race verifies original checkpoint; foreign job/task rejected');

for(const options of [{cancelResponse:{code:817,msg:'APIKEY_TASK_CANCEL_NOT_ALLOWED'}},{httpDenied:true},{sessionExpired:true},{cancelResponse:{unexpected:true}},{cancelResponse:{code:false}}]){
  const h=harness({...options,keepRunning:true});
  assert.equal(await h.c.cancelMotionAfterSave(h.admin,'job',h.rhJson),false);
  assert.equal(h.events.filter(x=>x.endsWith('/cancel')).length,1);
  assert.equal(h.row.meta.provider_cancel_permanent,true);
  assert.equal(h.row.meta.provider_cancel_confirmed,false);
  assert.equal(h.row.meta.genjutsu_cancel_phase,'CANCEL_REFUSED');
  assert.equal(h.queue.paused,true);
  assert.equal(h.row.result_video_id,'job');
  const count=h.events.length;
  await h.c.cancelMotionAfterSave(h.admin,'job',h.rhJson);
  assert(!h.events.slice(count).includes('/task/openapi/cancel'));
}
for(const priorMeta of [{provider_cancel_accepted:true},{provider_cancel_audit:[{task_id:'task',outcome:'sending'}]},{provider_cancel_attempts:3}]){
  const h=harness({priorMeta,keepRunning:true});
  await h.c.cancelMotionAfterSave(h.admin,'job',h.rhJson);
  assert(!h.events.includes('/task/openapi/cancel'));
  assert(h.queue.paused);
}
const natural=harness({naturalSuccess:true});
assert.equal(await natural.c.cancelMotionAfterSave(natural.admin,'job',natural.rhJson),true);
assert.equal(natural.row.meta.provider_cancel_confirmed,false);
assert.equal(natural.row.meta.genjutsu_cancel_phase,'PROVIDER_FINISHED_NOT_CANCELLED');
assert(natural.queue.paused);
assert(natural.writes.some(x=>x.meta?.provider_cancel_audit?.at(-1)?.outcome==='sending'));
console.log('PASS 817/401/unexpected response stop immediately; restart reconciles intent/acceptance; lifetime retry cap; SUCCESS never confirms cancel');
for(const scenario of [
  {uiResponse:{ok:true,task_id:'task',accepted:true,confirmed:true,status:'CANCEL'},nativeStatus:'FAILED',confirmed:true},
  {uiResponse:{ok:true,task_id:'task',accepted:true,confirmed:true,status:'CANCEL'},nativeStatus:'SUCCESS',confirmed:false},
  {uiResponse:{ok:true,task_id:'task',accepted:true,confirmed:true,status:'CANCEL'},nativeStatus:'RUNNING',confirmed:false},
  {uiResponse:{ok:true,task_id:'task',accepted:true,confirmed:true,status:'CANCEL'},nativeMissing:true,confirmed:true},
  {uiResponse:{ok:true,task_id:'task',accepted:true,confirmed:true,status:'CANCEL',account_id:'1234567890123456789'},nativeMissing:true,confirmed:false},
  {uiResponse:{ok:true,task_id:'task',accepted:true,confirmed:false,status:'UNKNOWN'},nativeMissing:true,confirmed:false},
  {uiResponse:{ok:false,task_id:'task',error:'authentication_required'},keepRunning:true,confirmed:false},
  {uiResponse:{ok:true,task_id:'task',accepted:true,confirmed:false,status:'RUNNING'},keepRunning:true,confirmed:false},
  {uiResponse:{ok:true,task_id:'task',accepted:false,confirmed:false,status:'SUCCESS',clicked_at:null},nativeStatus:'SUCCESS',confirmed:false},
  {uiResponse:{ok:true,task_id:'other',accepted:true,confirmed:true,status:'CANCEL'},keepRunning:true,confirmed:false},
]){
  const h=harness(scenario);await h.c.cancelMotionAfterSave(h.admin,'job',h.rhJson);
  assert.equal(h.row.meta.provider_cancel_confirmed,scenario.confirmed);
  assert.equal(h.row.meta.provider_cancel_method,'authenticated_ui');
  assert(!h.events.includes('/task/openapi/cancel'));
  assert.equal(h.events.filter(x=>x==='/ui/cancel').length,1);
  assert.equal(h.row.result_video_id,'job');
  if(scenario.uiResponse.status==='SUCCESS')assert.equal(h.row.meta.provider_cancel_error,'A tarefa já estava encerrada antes do cancelamento.');
  if(!scenario.confirmed)assert(h.queue.paused);
}
console.log('PASS UI bridge proof binding, authoritative CANCEL, conflicting SUCCESS, auth refusal, no OpenAPI fallback');
const reconciled=harness({uiResponse:{ok:true,task_id:'task',accepted:true,status:'UNKNOWN'},passiveResponse:{ok:true,task_id:'task',confirmed:true,status:'CANCEL'},priorMeta:{provider_cancel_accepted:true,provider_cancel_attempts:1},nativeMissing:true});
await reconciled.c.cancelMotionAfterSave(reconciled.admin,'job',reconciled.rhJson);assert.equal(reconciled.row.meta.provider_cancel_confirmed,true);assert.equal(reconciled.events.filter(x=>x==='/ui/passive').length,1);assert(!reconciled.events.includes('/ui/cancel'));
console.log('PASS OpenAPI807 plus exact UI CANCEL confirms stop; foreign account/unknown/active conflicts rejected; restart reconciles without a second click');

for(const status of ['SUCCESS','FAILED','CANCEL']){
  const z=harness({zero:true,nativeMissing:true,passiveResponse:{ok:true,task_id:'task',status}});
  assert.equal(await z.c.cancelMotionAfterSave(z.admin,'job',z.rhJson),true);
  assert.equal(z.row.status,'ready');assert.equal(z.row.meta.provider_task_pending,false);
  assert.equal(z.row.meta.provider_terminal_ui_proof.status,status);
  assert(!z.events.some(x=>x.endsWith('/cancel')));assert.equal(z.row.result_video_id,'job');
  assert.equal(z.row.meta.provider_auto_cancel_enabled,false);
}
for(const passiveResponse of [
  {ok:true,task_id:'task',status:'RUNNING'},
  {ok:true,task_id:'other',status:'SUCCESS'},
  {ok:true,task_id:'task',account_id:'1234567890123456789',status:'SUCCESS'},
  {ok:true,task_id:'task',status:'SUCCESS',observed_at:'2026-01-01T00:00:00Z'},
  {ok:true,task_id:'task',status:'SUCCESS',method:'untrusted'},
  {ok:false,error:'authentication_required'}
]){
  const z=harness({zero:true,nativeMissing:true,passiveResponse});
  assert.equal(await z.c.cancelMotionAfterSave(z.admin,'job',z.rhJson),false);
  assert.equal(z.row.status,'running');assert.equal(z.row.meta.provider_task_pending,true);
  await z.c.cancelMotionAfterSave(z.admin,'job',z.rhJson);
  assert.equal(z.events.filter(x=>x==='/ui/passive').length,1,'throttle passive reconciliation');
  assert(!z.events.some(x=>x.endsWith('/cancel')));
}
const activeZero=harness({zero:true,nativeStatus:'RUNNING',passiveResponse:{ok:true,task_id:'task',status:'SUCCESS'}});
assert.equal(await activeZero.c.cancelMotionAfterSave(activeZero.admin,'job',activeZero.rhJson),false);
assert(!activeZero.events.includes('/ui/passive'));
const explicitZero=harness({zero:true,nativeMissing:true,
  priorMeta:{genjutsu_stop_requested_at:new Date().toISOString(),genjutsu_stop_requested_task_id:'task'},
  uiResponse:{ok:true,task_id:'task',accepted:true,confirmed:true,status:'CANCEL'}});
assert.equal(await explicitZero.c.cancelMotionAfterSave(explicitZero.admin,'job',explicitZero.rhJson),true);
assert.equal(explicitZero.events.filter(x=>x==='/ui/cancel').length,1);
assert.equal(explicitZero.row.meta.provider_cancel_confirmed,true);
const alreadyFinished=harness({zero:true,nativeMissing:true,
  priorMeta:{genjutsu_stop_requested_at:new Date().toISOString(),genjutsu_stop_requested_task_id:'task'},
  uiResponse:{ok:true,task_id:'task',accepted:false,confirmed:false,status:'SUCCESS'}});
assert.equal(await alreadyFinished.c.cancelMotionAfterSave(alreadyFinished.admin,'job',alreadyFinished.rhJson),true);
assert.equal(alreadyFinished.row.status,'ready');assert.equal(alreadyFinished.row.meta.provider_cancel_confirmed,false);
assert.equal(alreadyFinished.queue.paused,false);
const foreignStop=harness({zero:true,nativeMissing:true,priorMeta:{genjutsu_stop_requested_at:new Date().toISOString(),genjutsu_stop_requested_task_id:'other'}});
assert.equal(await foreignStop.c.cancelMotionAfterSave(foreignStop.admin,'job',foreignStop.rhJson),false);
assert(!foreignStop.events.some(x=>x.endsWith('/cancel')));
console.log('PASS GENJUTSU0 passive terminal recovery, freshness/account/task binding, active conflict, throttle, exact explicit stop without automatic cancel');

// Exercise the actual monitor: 482 is copied in its event handler while channel auth is in memory.
const monitor=harness();let captured=false,closed=false;monitor.row.result_video_id=null;monitor.row.meta.motion_preview_file=null;
class Socket{
  static OPEN=1;readyState=1;
  constructor(){queueMicrotask(()=>{this.onmessage?.({data:JSON.stringify(event('384'))});this.onmessage?.({data:JSON.stringify(event('482'))});});}
  send(){}close(){closed=true;}
}
monitor.c.WebSocket=Socket;
await monitor.c.watchMotionPreview(monitor.admin,monitor.row,'https://www.runninghub.ai','server-key','worker-secret','lease',async(file,url,current)=>{
  assert.equal(file.node_id,'482');assert(url.includes('private-token'));assert.equal(current.meta.motion_preview_file.task_id,'task');captured=true;
  monitor.row.status='ready';
});
assert(captured);assert(closed);assert(!JSON.stringify(monitor.writes).includes('private-token'));
console.log('PASS immediate 482 callback before channel close; channel credential never persisted; V7 output ignored');
