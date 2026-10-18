import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
const src=stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/image-pipeline-retry.ts','utf8')).replace('export async function','async function');
const retry=vm.runInNewContext(src+';retryPipelineMotion',{Date});
function fixture(){
 const p={id:'job',user_id:'owner',status:'failed',runninghub_task_id:'task',original_storage_path:'owner/original',frame_storage_path:'owner/upscale',meta:{image_pipeline_version:2,workflow_id:'v7',provider_status:'FAILED',provider_status_task_id:'task',pipeline_dispatch_intent:'old',motion_execution_phase:'waiting_loop'}};
 const j={id:'job',user_id:'owner',status:'failed',meta:{pipeline_version:2,stage:'control_motion',face_swap_result:{path:'owner/face'},upscale_result:{path:'owner/upscale'},provider_failed:true}};
 const db={production_jobs:p,face_swap_jobs:j};
 const admin={from(table){let filters=[],patch=null;const q={select(){return q},eq(k,v){filters.push(x=>x[k]===v);return q},contains(k,v){filters.push(x=>Object.entries(v).every(([a,b])=>x[k]?.[a]===b));return q},update(v){patch=v;return q},maybeSingle(){return Promise.resolve({data:filters.every(f=>f(db[table]))?structuredClone(db[table]):null})},then(resolve){const ok=filters.every(f=>f(db[table]));if(ok&&patch)Object.assign(db[table],structuredClone(patch));return Promise.resolve({data:ok?[{id:'job'}]:[]}).then(resolve)}};return q}};
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
console.log('PASS: only Motion resumes; completed stages and inputs preserved; duplicate retry, foreign owner, active/uncertain/wrong task and saved output guarded');
