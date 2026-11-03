import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync('supabase/functions/cloudent-production-worker/index.ts','utf8');
const helper=source.slice(source.indexOf('async function claimMotionSaveLease('),source.indexOf('async function ensureMotionPreviewMonitor('));
const now=Date.now();
function harness(row){
 const writes=[];
 const admin={from(){let patch;const filters=[];const q={update(v){patch=v;return q},eq(k,v){filters.push(r=>r[k]===v);return q},is(k,v){filters.push(r=>(r[k]??null)===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},select(){return q},async maybeSingle(){if(!filters.every(f=>f(row)))return {data:null};Object.assign(row,patch);writes.push(patch);return {data:{id:row.id}}},then(resolve){return q.maybeSingle().then(resolve)}};return q}};
 return {admin,row,writes};
}
const c=vm.createContext({Date,Number,Error});vm.runInContext(stripTypeScriptTypes(helper),c);
const base={id:'job',runninghub_task_id:'task',status:'running',result_video_id:null,locked_by:'old',locked_at:new Date(now-150000).toISOString()};
const expired=harness({...base});assert(await c.claimMotionSaveLease(expired.admin,{...base},'new',now));assert.equal(expired.row.locked_by,'new');
for(const change of [{locked_at:new Date(now-20000).toISOString()},{locked_at:'bad'}]){const row={...base,...change},h=harness(row);assert.equal(await c.claimMotionSaveLease(h.admin,{...row},'new',now),false);assert.equal(h.writes.length,0)}
for(const change of [{locked_by:'another'},{locked_at:new Date(now-140000).toISOString()},{runninghub_task_id:'other'},{result_video_id:'saved'},{status:'ready'}]){const h=harness({...base,...change});assert.equal(await c.claimMotionSaveLease(h.admin,{...base},'new',now),false);assert.equal(h.writes.length,0)}
const free=harness({...base,locked_by:null,locked_at:null});assert(await c.claimMotionSaveLease(free.admin,{...free.row},'new',now));
const terminal=source.slice(source.indexOf("              if(isGenjutsuPreviewJob(job)&&['FAILED'"),source.indexOf('              throw new Error(isGenjutsuPreviewJob(job)?'));
const snippet='(async()=>{let touched=0;do{'+terminal+'}while(false);return touched;})()';
for(const [provider,code,gen,expected] of [['FAILED',805,true,1],['CANCELLED',805,true,1],['RUNNING',805,true,0],['UNKNOWN',805,true,0],['FAILED',500,true,0],['FAILED',805,false,0]]){
 const h=harness({...base,locked_by:'lease',meta:{motion_preview_file:{node_id:'482',filename:'kept.mp4'},genjutsu_prompt:{status:'complete'}}});
 const context=vm.createContext({admin:h.admin,job:{...h.row},lease:'lease',motionState:{status:provider},outputs:{code},isGenjutsuPreviewJob:()=>gen,Date,Number});
 assert.equal(await vm.runInContext(snippet,context),expected);
 if(expected){assert.equal(h.row.status,'failed');assert.equal(h.row.meta.motion_preview_file.filename,'kept.mp4');assert.equal(h.row.meta.genjutsu_prompt.status,'complete');assert.equal(h.row.runninghub_task_id,'task')}
}
console.log('PASS expired capture lease CAS, active lease/task/result guards; terminal 805 releases dead task, preserves descriptor and prompt; live/transient/V7 untouched');
