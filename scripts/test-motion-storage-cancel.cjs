const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto').webcrypto,{stripTypeScriptTypes}=require('node:module');
const raw=fs.readFileSync(fs.existsSync('protection-fix/production.ts')?'protection-fix/production.ts':'supabase/functions/cloudent-production-worker/index.ts','utf8');const source=stripTypeScriptTypes(raw.slice(raw.indexOf('async function cancelMotionAfterSave'),raw.indexOf('Deno.serve')),{mode:'strip'});
const bytes=new Uint8Array(32);bytes.set(Buffer.from('ftyp'),4);const blob=new Blob([bytes]);
async function scenario(options={}){
 let job={id:'job',user_id:'owner',status:'running',runninghub_task_id:'task',result_video_id:'video',result_storage_path:'owner/production-results/job.mp4',storage_provider:'supabase',meta:{workflow_key:'motion_control',workflow_id:'2110721194974982146',motion_preview_available:true,result_node_id:'384',motion_preview_file:{task_id:'task'}}};
 if(options.patch)job={...job,...options.patch};
 let video={id:'video',status:'ready',storage_path:job.result_storage_path,storage_provider:'supabase',size_bytes:32,mime_type:'video/mp4'};
 if(options.videoPatch)video={...video,...options.videoPatch};
 const events=[];let statusCalls=0;
 const admin={from(table){let update;const q={select(){return q},eq(){return q},in(){return q},update(v){update=v;return q},async maybeSingle(){if(update){events.push('persist_verified');job={...job,...update};return {data:{id:job.id}}}return {data:table==='production_jobs'?structuredClone(job):video}},then(ok,bad){events.push('persist_state');if(update)job={...job,...update};return Promise.resolve({error:null}).then(ok,bad)}};return q},storage:{from(){return {download:async()=>{events.push('verify_storage');return options.downloadFails?{error:{message:'offline'}}:{data:blob}}}}}};
 const rhJson=async(path,body)=>{assert.equal(body.taskId,'task');events.push(path);if(path.endsWith('/cancel'))return {code:options.cancelRejected?500:0};assert(path.endsWith('/status'));return {code:0,data:options.alreadyDone?'SUCCESS':++statusCalls===1?'RUNNING':options.staysRunning?'RUNNING':'FAILED'}};
 const c=vm.createContext({Blob,TextDecoder,Date,Number,Error,Array,Uint8Array,crypto,isMotionPreviewJob:j=>j.meta?.workflow_key==='motion_control'&&j.meta?.workflow_id==='2110721194974982146'});vm.runInContext(source,c);
 try{return {result:await c.cancelMotionAfterSave(admin,'job',rhJson),job,events}}catch(error){return {error,job,events}};
}
(async()=>{
 const good=await scenario();assert(!good.error);assert.equal(good.result,true);assert.equal(good.job.status,'ready');assert.equal(good.job.result_video_id,'video');assert.equal(good.job.meta.provider_task_pending,false);assert.equal(good.job.meta.motion_preview_verified_bytes,32);assert.match(good.job.meta.motion_preview_sha256,/^[a-f0-9]{64}$/);
 assert(good.events.indexOf('persist_verified')<good.events.indexOf('/task/openapi/cancel'));assert(good.events.indexOf('verify_storage')<good.events.indexOf('/task/openapi/cancel'));
 for(const opts of [{downloadFails:true},{videoPatch:{storage_path:'other-owner/video.mp4'}},{videoPatch:{size_bytes:999}},{patch:{meta:{workflow_key:'motion_control',workflow_id:'2110721194974982146',motion_preview_available:true,result_node_id:'384',motion_preview_file:{task_id:'wrong'}}}}]){const r=await scenario(opts);assert(r.error);assert(!r.events.some(x=>x.endsWith('/cancel')));assert.equal(r.job.status,'running');}
 const backup=await scenario({patch:{storage_provider:'r2',meta:{workflow_key:'motion_control',workflow_id:'2110721194974982146',motion_preview_available:true,result_node_id:'384',motion_preview_file:{task_id:'task'},result_storage_provider:'supabase'}}});
 assert(!backup.error);assert.equal(backup.job.status,'ready');assert(backup.events.indexOf('verify_storage')<backup.events.indexOf('/task/openapi/cancel'));
 const mismatch=await scenario({patch:{storage_provider:'r2'}});assert(mismatch.error);assert(!mismatch.events.some(x=>x.endsWith('/cancel')));
 const standard=await scenario({patch:{meta:{}}});assert.equal(standard.result,false);assert.equal(standard.events.length,0);
 const pending=await scenario({staysRunning:true});assert.equal(pending.job.status,'running');assert.equal(pending.job.result_video_id,'video');assert.equal(pending.job.meta.provider_task_pending,true);
 const failed=await scenario({staysRunning:true,cancelRejected:true});assert.equal(failed.job.status,'running');assert.equal(failed.job.meta.provider_cancel_accepted,false);assert(failed.job.meta.provider_cancel_error);
 const done=await scenario({alreadyDone:true});assert.equal(done.job.status,'ready');assert(!done.events.some(x=>x.endsWith('/cancel')));
 console.log('PASS: verify stored video before cancellation, preserve file, confirm terminal state before ready/calendar, retry cancellation failure, never cancel wrong task/workflow or unverified output');
})().catch(e=>{console.error(e);process.exit(1)});
