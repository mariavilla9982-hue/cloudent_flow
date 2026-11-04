import assert from 'node:assert/strict';
import {genjutsuExecutionEvent,safeGenjutsuError} from '../supabase/functions/_shared/genjutsu-diagnostics.ts';
import {applyGenjutsuStatus} from '../supabase/functions/_shared/genjutsu-stage.ts';
const message={type:'execution_error',data:{prompt_id:'task',node_id:'469',node_type:'SamplerCustomAdvanced',exception_type:'OutOfMemoryError',exception_message:'CUDA out of memory token=private-token https://server/?secret=hidden'}};
const event=genjutsuExecutionEvent(message,'task',null);
assert.equal(event.node_id,'469');assert(event.error.includes('CUDA out of memory'));
assert(!event.error.includes('private-token'));assert(!event.error.includes('hidden'));
assert.equal(genjutsuExecutionEvent(message,'other',null),null);
assert.equal(genjutsuExecutionEvent({type:'progress',data:{prompt_id:'task',node:'469',value:11,max:10}},'task',null),null);
assert.equal(genjutsuExecutionEvent({type:'progress',data:{value:1,max:10}},'task',event),null);
assert.equal(genjutsuExecutionEvent({type:'progress',data:{prompt_id:'task',node:'469',value:2,max:10}},'task',null).value,2);
assert.equal(genjutsuExecutionEvent({type:'executed',data:{prompt_id:'task',node:'482'}},'task',null),null,'diagnostics never intercept capture');
assert(!safeGenjutsuError('Bearer private-token').includes('private-token'));
const job={id:'job',user_id:'owner',status:'running',runninghub_task_id:'task',meta:{workflow_key:'genjutsu',workflow_id:'2117411301344411649'}};
function adminFor(options={}){
 let row={...job,updated_at:'2026-11-03T00:00:00Z',locked_by:options.lease||null,locked_at:options.lockedAt||null,meta:{...job.meta,genjutsu_execution_error:options.noEvent?null:event,...(options.output?{motion_preview_file:{node_id:'482',task_id:'task'}}:{})}};
 let writes=0;
 const admin={rpc:async name=>{assert.equal(name,'wake_genjutsu_queue');return {data:true};},from(){let patch,filters=[];const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},update(p){patch=p;return q;},async maybeSingle(){
   if(patch){if(options.concurrent)row={...row,updated_at:'newer',meta:{...row.meta,motion_preview_file:{node_id:'482',task_id:'task'}}};if(!filters.every(f=>f(row)))return {data:null};writes++;Object.assign(row,patch);}
   return {data:structuredClone(row)};
 }};return q;}};
 return {admin,get row(){return row;},get writes(){return writes;}};
}
const h=adminFor();await applyGenjutsuStatus(h.admin,job,{status:'FAILED',error:'generic provider failure',raw:{errorCode:'805'}});
assert.equal(h.row.status,'failed');assert(h.row.last_error.includes('node 469'));assert(h.row.last_error.includes('CUDA out of memory'));
assert.equal(h.row.meta.genjutsu_provider_failure.code,'805');assert.equal(h.row.meta.genjutsu_execution_error.task_id,'task');
const output=adminFor({output:true});await applyGenjutsuStatus(output.admin,job,{status:'FAILED',error:'generic'});assert.equal(output.row.status,'running');assert(output.row.meta.motion_preview_file);
const race=adminFor({concurrent:true});assert.equal(await applyGenjutsuStatus(race.admin,job,{status:'FAILED'}),null);assert.equal(race.writes,0);assert(race.row.meta.motion_preview_file);
console.log('PASS node/task-bound diagnostics, bounded redaction, actual failure details, fresh metadata and capture/status race guards');

for(const lease of ['motion-preview-live','motion-save-live']){
 const live=adminFor({lease,lockedAt:new Date().toISOString()});
 await applyGenjutsuStatus(live.admin,job,{status:'FAILED'});assert.equal(live.row.status,'running');
}
const expired=adminFor({lease:'motion-preview-old',lockedAt:new Date(Date.now()-131000).toISOString()});
await applyGenjutsuStatus(expired.admin,job,{status:'FAILED'});assert.equal(expired.row.status,'failed');
const queueStop=adminFor({noEvent:true});await applyGenjutsuStatus(queueStop.admin,job,{status:'FAILED',raw:{errorCode:'805',failedReason:{node_id:'1044',node_name:'LayerUtility: QueueStop'}},error:'工作流运行失败'});
assert.equal(queueStop.row.meta.genjutsu_provider_failure.node_id,'1044');assert(queueStop.row.last_error.includes('QueueStop'));assert(!queueStop.row.last_error.includes('工作流'));
console.log('PASS live capture lease protects terminal race, expired lease finalizes, exact QueueStop failure is explained');
