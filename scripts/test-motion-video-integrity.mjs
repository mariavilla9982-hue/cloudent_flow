import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {motionVideoDigest,motionBlobDigest,validMotionCheckpoint,recoverMotionCheckpoint} from '../supabase/functions/_shared/motion-video-integrity.ts';
const size=40*1024*1024,chunkSize=65536;
function stream(size){let offset=0;return new ReadableStream({pull(c){if(offset===size){c.close();return;}const b=new Uint8Array(Math.min(chunkSize,size-offset));if(!offset)b.set(new TextEncoder().encode('ftyp'),4);offset+=b.length;c.enqueue(b);}});}
const fake={size,arrayBuffer(){throw Error('full video allocation forbidden')},stream:()=>stream(size)};
const digest=await motionBlobDigest(fake);assert.equal(digest.size_bytes,size);
const expected=createHash('sha256');for await(const b of stream(size))expected.update(b);assert.equal(digest.sha256,expected.digest('hex'));
await assert.rejects(()=>motionVideoDigest(stream(size),size-1),/limite/);
await assert.rejects(()=>motionVideoDigest(new Blob(['not a video']).stream()),/inválida/);
const blob=new Blob([new Uint8Array([0,0,0,8,102,116,121,112,0,0,0,0])]);
const small=await motionBlobDigest(blob);
const base={id:'job',user_id:'owner',status:'failed',runninghub_task_id:'task',updated_at:'version',result_video_id:null,meta:{workflow_key:'genjutsu',workflow_id:'2117411301344411649',motion_preview_file:{task_id:'task',node_id:'482'},motion_capture_checkpoint:{provider:'r2',task_id:'task',node_id:'482',date:'2026-11-04',path:'owner/production-results/2026-11-04/job.mp4',...small}}};
assert(validMotionCheckpoint(base));
for(const change of [{task_id:'other'},{node_id:'384'},{path:'other/production-results/2026-11-04/job.mp4'},{size_bytes:size+1},{sha256:'bad'}])assert(!validMotionCheckpoint({...base,meta:{...base.meta,motion_capture_checkpoint:{...base.meta.motion_capture_checkpoint,...change}}}));
function admin(row,concurrent=false){const events=[];return {events,from(table){let patch;const q={upsert(p){events.push(['video',p]);return Promise.resolve({error:null})},update(p){patch=p;return q},eq(){return q},is(){return q},in(){return q},select(){return q},then(resolve){if(patch)Object.assign(row,patch);return Promise.resolve({error:null}).then(resolve)},async maybeSingle(){if(concurrent)return {data:null};events.push([patch.result_video_id?'link':'lease',patch]);Object.assign(row,patch);return {data:row,error:null}}};return q}};}
const row=structuredClone(base),db=admin(row);let reads=0;
assert(await recoverMotionCheckpoint(db,row,async()=>{reads++;return new Response(blob)}));
assert.equal(row.result_video_id,'job');assert.equal(row.meta.motion_preview_sha256,small.sha256);assert.equal(row.status,'running');assert.equal(db.events[0][0],'lease');assert.equal(db.events[1][0],'video');assert.equal(db.events[2][0],'link');
const bad=structuredClone(base),badDb=admin(bad);await assert.rejects(()=>recoverMotionCheckpoint(badDb,bad,async()=>new Response(new Blob(['wrong']))));assert(!badDb.events.some(x=>x[0]==='video'));
const missing=structuredClone(base),missingDb=admin(missing);assert.equal(await recoverMotionCheckpoint(missingDb,missing,async()=>new Response(null,{status:404})),null);assert(!missingDb.events.some(x=>x[0]==='video'));
const locked={...base,locked_by:'saver',locked_at:new Date().toISOString()};assert.equal(await recoverMotionCheckpoint(admin(locked),locked,async()=>{throw Error('must not read active saver')}),null);
console.log('PASS 40MiB streaming SHA256 without full arrayBuffer, signature/size limits; same task/node/path/hash recovery; absent/corrupt/active saver guarded');

const racing=structuredClone(base),raceDb=admin(racing,true);assert.equal(await recoverMotionCheckpoint(raceDb,racing,async()=>{throw Error('CAS rejected before read')}),null);assert.equal(raceDb.events.length,0);
