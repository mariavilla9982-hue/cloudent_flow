import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {motionVideoDigest,motionBlobDigest} from '../supabase/functions/_shared/motion-video-integrity.ts';
import {genjutsuExecutionEvent} from '../supabase/functions/_shared/genjutsu-diagnostics.ts';
const source=fs.readFileSync('supabase/functions/cloudent-production-worker/index.ts','utf8');
const functions=stripTypeScriptTypes(source.slice(source.indexOf('const MOTION_PREVIEW_WORKFLOW'),source.indexOf('Deno.serve')));
const bytes=new Uint8Array(64);bytes.set(new TextEncoder().encode('ftyp'),4);const blob=new Blob([bytes],{type:'video/mp4'});
function harness(options={}){
  let row={id:'job',user_id:'owner',status:'running',storage_provider:'r2',runninghub_task_id:'task',result_video_id:'job',result_storage_path:'owner/production-results/job.mp4',
    meta:{workflow_key:'genjutsu',workflow_id:'2117411301344411649',motion_preview_available:true,result_node_id:options.wrongNode?'384':'482',motion_preview_file:{task_id:'task',node_id:'482'}}};
  const events=[],writes=[];let status=0;
  const video={id:'job',status:'ready',storage_path:row.result_storage_path,storage_provider:'r2',size_bytes:64,mime_type:'video/mp4'};
  const admin={rpc:async name=>{assert.equal(name,'wake_genjutsu_queue');return {data:true};},from(table){let value;const q={select(){return q;},eq(){return q;},in(){return q;},is(){return q;},update(v){value=v;return q;},async maybeSingle(){if(value){writes.push(value);Object.assign(row,value);events.push('verify-saved');return {data:{id:row.id}};}return {data:table==='production_jobs'?structuredClone(row):video};},then(resolve){if(value){writes.push(value);Object.assign(row,value);}return Promise.resolve({error:null}).then(resolve);}};return q;}};
  const c=vm.createContext({Date,Number,String,Array,Uint8Array,TextDecoder,crypto,Blob,URL,AbortSignal,Error,Promise,JSON,setTimeout,clearTimeout,setInterval,clearInterval,
    motionVideoDigest,motionBlobDigest,Deno:{env:{get:()=>''}},EdgeRuntime:{waitUntil(){}},genjutsuExecutionEvent,
    getCloudentR2Config:async()=>({}),requireMotionStorage:async()=>{if(options.storageBlocked)throw Error('storage blocked');},
    motionStorageRead:async()=>{events.push('download-copy');return new Response(options.corrupt?new Blob(['bad']):blob);},
    fetch:async()=>Response.json({data:{netWssUrl:'wss://www.runninghub.ai/ws?Rh-Comfy-Auth=private-token'}})
  });vm.runInContext(functions,c);
  const rhJson=async(path,{taskId})=>{assert.equal(taskId,'task');events.push(path);if(path.endsWith('cancel'))return {code:0};return {code:0,data:++status===1||options.keepRunning?'RUNNING':'FAILED'};};
  return {c,admin,rhJson,events,writes,get row(){return row;}};
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
assert.equal(h.row.status,'ready');assert.equal(h.row.result_video_id,'job');assert.equal(h.row.meta.motion_preview_verified_bytes,64);
for(const options of [{wrongNode:true},{corrupt:true},{storageBlocked:true}]){const h=harness(options);await assert.rejects(()=>h.c.cancelMotionAfterSave(h.admin,'job',h.rhJson));assert(!h.events.includes('/task/openapi/cancel'));}
const pending=harness({keepRunning:true});assert.equal(await pending.c.cancelMotionAfterSave(pending.admin,'job',pending.rhJson),false);assert.equal(pending.row.status,'running');assert.equal(pending.row.meta.provider_task_pending,true);assert.equal(pending.row.result_video_id,'job');
console.log('PASS 482-only capture origin, task binding, persisted MP4/hash before cancel, storage failure guards and pending-task slot retention');

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
