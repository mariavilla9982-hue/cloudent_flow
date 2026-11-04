import assert from 'node:assert/strict';
import {runGenjutsuPreparation} from '../supabase/functions/_shared/genjutsu-preparation.ts';
import {genjutsuFingerprint} from '../supabase/functions/_shared/genjutsu-gemini.ts';
import {GENJUTSU_INSTRUCTIONS} from '../supabase/functions/_shared/genjutsu-instructions.ts';
import {genjutsuDisplay} from '../supabase/functions/_shared/genjutsu-display.ts';
const video=new Blob(['video'],{type:'video/mp4'}),image=new Blob(['frame'],{type:'image/png'});
const digest=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))),n=>n.toString(16).padStart(2,'0')).join('');
const now=Date.now();
const state={status:'generating',interactionId:'accepted-analysis',fingerprint:await genjutsuFingerprint(video,image,10),model:'gemini-3.5-flash-lite',durationSeconds:10,instructionsSha256:await digest(GENJUTSU_INSTRUCTIONS),
video:{uri:'https://generativelanguage.googleapis.com/v1beta/files/video',name:'files/video',state:'ACTIVE',mimeType:'video/mp4',expirationTime:new Date(now+86400000).toISOString()},
image:{uri:'https://generativelanguage.googleapis.com/v1beta/files/image',name:'files/image',state:'ACTIVE',mimeType:'image/png',expirationTime:new Date(now+86400000).toISOString()}};
const prompt=`subject_definitions:
<Subject 1> is the person from <Picture 1>. <Subject 2> is the setting in <Video 1>. <Audio 1> is the original audio.
Background rule: preserve the setting.
Lighting rule: match the video.
Framing rule: preserve the framing.
summary:
[reference generation] replace only the performer.
retention_analysis:
Preserve source actions and audio.
detailed_description:
Body timeline: from 00:00.000 to 00:10.000 follow the visible gestures in the source video.
overall_soundscape:
Copy original audio.
non_diegetic_music:
N/A`;
function harness(config={}){
 let row={id:'job',user_id:'owner',status:'motion_waiting',original_storage_path:'owner/video',frame_storage_path:'owner/image',meta:{workflow_key:'genjutsu',workflow_id:'2117411301344411649',source_duration_seconds:10,genjutsu_prompt:structuredClone(state)}};
 let wake=0,claims=0,reads=0;
 const admin={async rpc(name,args){if(name==='wake_genjutsu_queue'){wake++;return {data:true};}assert.equal(name,'claim_genjutsu_prompt_job');claims++;row.locked_by=args.p_worker;return {data:config.empty?[]:[structuredClone(row)]};},from(){let patch;const filters=[];const q={update(p){patch=p;return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},is(k,v){filters.push(r=>(r[k]??null)===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},select(){return q;},async maybeSingle(){if(config.lost||!filters.every(f=>f(row)))return {data:null};Object.assign(row,structuredClone(patch));return {data:{id:'job'}};}};return q;}};
 return {admin,get row(){return row;},get wake(){return wake;},get claims(){return claims;},run:()=>runGenjutsuPreparation({admin,key:'key',now:()=>now,readBlob:()=>{reads++;throw Error('unexpected media read');}})};
}
const savedFetch=globalThis.fetch;
try{
 globalThis.fetch=async(url,init)=>{assert(url.endsWith('/interactions/accepted-analysis'),'only accepted analysis is polled');assert(!init.method,'never creates another interaction on resume');return Response.json({id:'accepted-analysis',status:'completed',steps:[{type:'model_output',content:[{type:'text',text:prompt}]}]});};
 const h=harness();const result=await h.run();assert(result.ready);assert.equal(h.row.meta.preparation_status,'READY_FOR_VIDEO');assert.equal(h.row.status,'motion_waiting');assert.equal(h.row.locked_by,null);assert.equal(h.wake,1);assert.equal(h.row.runninghub_task_id,undefined);
 const empty=harness({empty:true});assert.equal((await empty.run()).processed,0);assert.equal(empty.wake,0);
 const lost=harness({lost:true});await assert.rejects(()=>lost.run(),/reserva.*perdida/);
 globalThis.fetch=async()=>Response.json({error:'temporary'},{status:503});const transient=harness();assert.equal((await transient.run()).failed,false);assert.equal(transient.row.status,'motion_waiting');assert.equal(transient.row.meta.genjutsu_prompt.interactionId,'accepted-analysis');assert(Date.parse(transient.row.next_attempt_at)>now);
 globalThis.fetch=async()=>Response.json({id:'accepted-analysis',status:'failed',errors:[{code:'INVALID_ARGUMENT'}]});const failed=harness();assert.equal((await failed.run()).failed,true);assert.equal(failed.row.status,'failed');assert.equal(failed.row.locked_by,null);assert.equal(failed.wake,1);
}finally{globalThis.fetch=savedFetch;}
const parent={created_at:new Date(now-120000).toISOString(),status:'waiting',meta:{stage:'control_motion'}};
const p={status:'running',runninghub_task_id:'task',started_at:new Date(now-60000).toISOString(),meta:{provider_status_task_id:'task',genjutsu_prompt:{status:'complete'},genjutsu_execution:{event:'progress',task_id:'task',value:3,max:10,node_id:'469'}}};
assert.deepEqual(genjutsuDisplay(p,parent).progress,{value:3,max:10,node:'469'});
assert.equal(genjutsuDisplay({...p,meta:{...p.meta,genjutsu_execution:{...p.meta.genjutsu_execution,task_id:'foreign'}}},parent).progress,null);
for(const [status,key,active] of [['motion_waiting','video_waiting',false],['queued','provider_queued',false],['uploading','uploading',true],['running','running',true],['failed','failed',false],['cancelled','cancelled',false]]){const d=genjutsuDisplay({...p,status},parent);assert.equal(d.key,key);assert.equal(d.activity,active);}
assert.equal(genjutsuDisplay({...p,status:'motion_waiting',meta:{genjutsu_prompt:{status:'provider_waiting'}}},parent).activity,false);
assert.equal(genjutsuDisplay({...p,meta:{...p.meta,motion_preview_file:{node_id:'482'}}},parent).key,'capturing');
assert.equal(genjutsuDisplay({...p,status:'ready',result_video_id:'saved'},parent).key,'complete');
console.log('PASS independent prompt preparation, READY_FOR_VIDEO persistence, checkpoint lease loss, no duplicate analysis on resume, 503 recovery, permanent-error isolation, truthful display/progress and wait/run states');
