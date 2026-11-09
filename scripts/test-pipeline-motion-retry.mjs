import assert from 'node:assert/strict';
import {retryPipelineMotion as retry,retryNextFailedGenjutsu} from '../supabase/functions/_shared/image-pipeline-retry.ts';
function fixture(){
 const p={id:'job',user_id:'owner',status:'failed',updated_at:'version1',result_video_id:null,runninghub_task_id:'task',original_storage_path:'owner/original',frame_storage_path:'owner/upscale',meta:{image_pipeline_version:2,workflow_id:'v7',provider_status:'FAILED',provider_status_task_id:'task',pipeline_dispatch_intent:'old',motion_execution_phase:'waiting_loop'}};
 const j={id:'job',user_id:'owner',status:'failed',meta:{pipeline_version:2,stage:'control_motion',face_swap_result:{path:'owner/face'},upscale_result:{path:'owner/upscale'},provider_failed:true}};
 const db={production_jobs:p,face_swap_jobs:j};
 const admin={beforeWrite:null,from(table){let filters=[],patch=null;const q={select(){return q},eq(k,v){filters.push(x=>x[k]===v);return q},is(k,v){filters.push(x=>(x[k]??null)===v);return q},contains(k,v){filters.push(x=>Object.entries(v).every(([a,b])=>x[k]?.[a]===b));return q},not(k,op,v){assert.equal(op,'is');const [column,key]=k.split('->>');filters.push(x=>(x[column]?.[key]??null)!==v);return q},order(){return q},limit(){return q},update(v){patch=v;return q},maybeSingle(){return Promise.resolve({data:filters.every(f=>f(db[table]))?structuredClone(db[table]):null})},then(resolve){if(patch&&admin.beforeWrite){const hook=admin.beforeWrite;admin.beforeWrite=null;hook(db[table]);}const ok=filters.every(f=>f(db[table]));if(ok&&patch)Object.assign(db[table],structuredClone(patch));return Promise.resolve({data:ok?[{id:'job'}]:[]}).then(resolve)}};return q}};
 return {p,j,admin};
}
{
 const {p,j,admin}=fixture();const r=await retry(admin,'owner','job');
 assert.equal(r.reused_inputs,true);assert.equal(p.status,'motion_waiting');assert.equal(p.original_storage_path,'owner/original');assert.equal(p.frame_storage_path,'owner/upscale');assert.equal(j.meta.face_swap_result.path,'owner/face');assert.equal(j.meta.upscale_result.path,'owner/upscale');assert.equal(p.meta.provider_status,undefined);assert.equal(p.meta.motion_execution_phase,undefined);assert.equal(p.meta.previous_motion_task_id,'task');assert.equal(p.meta.workflow_id,'v7');
 assert.equal((await retry(admin,'owner','job')).queued,true);assert.equal(p.meta.previous_motion_task_id,'task');
}
for(const change of [p=>p.meta.provider_status='RUNNING',p=>p.meta.provider_status_task_id='another',p=>p.meta.pipeline_dispatch_uncertain=true,p=>p.result_video_id='saved',p=>p.meta.motion_preview_file={filename:'saved.mp4'},p=>p.frame_storage_path='wrong']){
 const {p,admin}=fixture();change(p);assert.equal((await retry(admin,'owner','job')).ok,false);assert.equal(p.runninghub_task_id,'task');
}
{const {admin}=fixture();assert.equal((await retry(admin,'stranger','job')).status,404)}
function unavailableFixture(){
 const f=fixture();Object.assign(f.p.meta,{workflow_key:'genjutsu',genjutsu_prompt:{status:'complete',text:'per-video prompt'},motion_preview_file:{node_id:'482',task_id:'task',filename:'output.mp4'},genjutsu_capture_recovery:{status:'provider_output_unavailable',node_id:'482',task_id:'task'},genjutsu_execution:{task_id:'task'},genjutsu_execution_error:{task_id:'task'}});return f;
}
{
 const {p,j,admin}=unavailableFixture();const r=await retry(admin,'owner','job');
 assert.equal(r.reused_inputs,true);assert.equal(p.status,'motion_waiting');assert.equal(p.runninghub_task_id,null);assert.equal(p.started_at,null);assert.equal(p.completed_at,null);assert.equal(p.last_error,null);
 assert.equal(p.meta.genjutsu_prompt.text,'per-video prompt');assert.equal(p.meta.previous_motion_capture.file.filename,'output.mp4');assert.equal(p.meta.previous_motion_capture.task_id,'task');
 for(const key of ['motion_preview_file','genjutsu_capture_recovery','genjutsu_execution','genjutsu_execution_error','provider_status'])assert.equal(p.meta[key],undefined);
 assert.equal(j.status,'waiting');assert.equal((await retry(admin,'owner','job')).queued,true);assert.equal(p.meta.previous_motion_task_id,'task');
}
for(const change of [p=>p.meta.workflow_key='motion_control',p=>p.meta.genjutsu_capture_recovery.task_id='other',p=>p.meta.genjutsu_capture_recovery.node_id='384',p=>p.meta.genjutsu_capture_recovery.status='retrying',p=>p.meta.motion_preview_file.task_id='other',p=>p.meta.motion_preview_file.node_id='384',p=>p.meta.motion_preview_available=true,p=>p.result_video_id='saved',p=>p.meta.provider_status='RUNNING',p=>p.meta.pipeline_dispatch_uncertain=true]){
 const {p,admin}=unavailableFixture();change(p);assert.equal((await retry(admin,'owner','job')).ok,false);assert.equal(p.runninghub_task_id,'task');
}
for(const change of [p=>p.updated_at='version2',p=>p.result_video_id='concurrently-saved',p=>p.runninghub_task_id='new-task']){
 const {p,j,admin}=unavailableFixture();admin.beforeWrite=change;await retry(admin,'owner','job');assert.equal(p.status,'failed');assert.equal(j.status,'failed');assert.equal(p.meta.motion_preview_file.filename,'output.mp4');
}
console.log('PASS: preserved inputs/prompt; confirmed unavailable482 retries once; saved output, mismatched task/node, active/uncertain state, foreign owner and concurrent writes guarded');


for(const status of ['failed','generating','complete']){
 const {p,admin}=fixture();p.runninghub_task_id=null;p.meta={image_pipeline_version:2,workflow_key:'genjutsu',genjutsu_prompt:{status,interactionId:'previous-analysis',repairInteractionId:'repair',formatRepairAttempts:2,processingRetryAttempts:1,video:{uri:'video-ref'},image:{uri:'image-ref'},prompt:'saved-prompt'}};
 const r=await retry(admin,'owner','job');assert.equal(r.ok,true);
 const state=p.meta.genjutsu_prompt;
 assert.equal(state.video.uri,'video-ref');assert.equal(state.image.uri,'image-ref');
 if(status==='failed'){assert.equal(state.status,'preparing');assert.equal(state.interactionId,undefined);assert.equal(state.previousInteractionId,'previous-analysis');assert.equal(state.repairInteractionId,undefined);assert.equal(state.formatRepairAttempts,undefined);assert.equal(state.processingRetryAttempts,undefined);}
 else {assert.equal(state.interactionId,'previous-analysis');assert.equal(state.status,status==='complete'?'complete':'preparing');}
}
console.log('PASS explicit terminal prompt retry starts fresh; active analysis and completed prompt stay reusable');

{
 const {p,admin}=unavailableFixture();
 Object.assign(p.meta,{genjutsu_auto_retry_pending_at:'2026-11-09T12:00:00Z',genjutsu_serial_turn_at:'2026-11-09T11:00:00Z'});
 await retryNextFailedGenjutsu(admin);
 assert.equal(p.status,'motion_waiting');
 assert.equal(p.runninghub_task_id,null);
 assert.equal(p.meta.genjutsu_serial_turn_at,undefined);
 assert.equal(p.meta.genjutsu_auto_retry_pending_at,undefined);
 assert.ok(p.meta.genjutsu_auto_retry_at);
 p.status='failed';
 await retryNextFailedGenjutsu(admin);
 assert.equal(p.status,'failed');
}
{
 const {p,admin}=fixture();
 p.runninghub_task_id=null;
 p.meta={image_pipeline_version:2,workflow_key:'genjutsu',genjutsu_auto_retry_pending_at:'2026-11-09T12:00:00Z',
   genjutsu_prompt:{status:'failed',interactionId:'failed-analysis'}};
 await retryNextFailedGenjutsu(admin);
 assert.equal(p.status,'motion_waiting');
 assert.equal(p.meta.genjutsu_prompt.previousInteractionId,'failed-analysis');
 assert.equal(p.meta.genjutsu_prompt.interactionId,undefined);
}
for(const patch of [
 {status:'failed',verifiedProviderFinishReason:'PROHIBITED_CONTENT'},
 {status:'generating'}
]){
 const {p,admin}=fixture();
 p.runninghub_task_id=null;
 p.meta={image_pipeline_version:2,workflow_key:'genjutsu',genjutsu_auto_retry_pending_at:'2026-11-09T12:00:00Z',genjutsu_prompt:patch};
 await retryNextFailedGenjutsu(admin);
 assert.equal(p.status,'failed');
 assert.equal(p.meta.genjutsu_auto_retry_pending_at,undefined);
 assert.equal(p.meta.genjutsu_auto_retry_at,undefined);
}
console.log('PASS automatic retry consumes a new failure once and preserves refused or unconfirmed requests');
