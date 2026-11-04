import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const status={textContent:''},error={textContent:''},controls=[{},{}];
const form={querySelector:s=>s==='[data-pipeline-status]'?status:s==='[data-pipeline-error]'?error:{},querySelectorAll:()=>controls};
const root={querySelector:s=>s==='form'?form:null};
const confirmed=new Set(),tickets=[],revoked=[];let frameCount=0,fail='sahry_japah';
const ui={document:{createElement:tag=>tag==='video'?{duration:12.5,removeAttribute(){},load(){},set src(v){queueMicrotask(()=>this.onloadedmetadata?.());}}:{textContent:''},head:{appendChild(){}},querySelector:()=>null,getElementById:()=>null},cloudSession:{user:{id:'owner'}},currentPage:'other',window:{},setInterval(){},setTimeout,clearTimeout,queueMicrotask,File,URL:{createObjectURL:f=>'blob:'+f.name,revokeObjectURL:u=>revoked.push(u)},crypto:webcrypto,extractFirstFrameBlob:async()=>{frameCount++;return new Blob(['frame']);},uploadFaceSwapPart:async()=>{},cloudFetch:async(path,options)=>{if(!options)return {jobs:[]};const b=JSON.parse(options.body);if(path.includes('ticket')){tickets.push(b);if(b.character_id===fail)throw Error('offline');return {job_id:b.job_id,registered:confirmed.has(b.job_id),original:{},reference:{}};}confirmed.add(b.job_id);return {ok:true};}};
const source=fs.readFileSync('image-pipeline-ui.js','utf8');vm.createContext(ui);vm.runInContext(source.replace('  if(sources[currentPage])render(currentPage);','  window.test={addBatchFiles,submitBatch,drafts,resetOwner,workflowSelector};'),ui);
const t=ui.window.test;
assert(t.workflowSelector({}).includes('value="genjutsu" selected'));
assert(t.workflowSelector({workflow:'motion_control'}).includes('value="motion_control" selected'));
assert(t.workflowSelector({workflow:'standard'}).includes('value="standard" selected'));
const files=[new File(['a'],'video-1.mp4',{type:'video/mp4',lastModified:1}),new File(['b'],'video-2.mp4',{type:'video/mp4',lastModified:2})];
t.addBatchFiles(files);t.addBatchFiles(files);assert.equal(t.drafts.faceSwap.entries.length,2,'duplicate selection does not add pending file twice');
await t.submitBatch(root);assert(error.textContent.includes('Escolha'));assert.equal(frameCount,0);assert.equal(tickets.length,0,'validate every selection before sending any video');
t.drafts.faceSwap.entries[0].characters=['jujuh','sahry_japah'];t.drafts.faceSwap.entries[1].characters=['sahry_gravida'];t.drafts.faceSwap.entries[1].workflow='standard';
await t.submitBatch(root);assert.equal(confirmed.size,2,'failure in first file does not block second file');assert.equal(t.drafts.faceSwap.entries.length,1);assert.equal(t.drafts.faceSwap.entries[0].original.name,'video-1.mp4');assert.equal(frameCount,2,'extract exactly once per source');assert(revoked.includes('blob:video-2.mp4'));assert(!revoked.includes('blob:video-1.mp4'));
assert.equal(tickets.find(x=>x.character_id==='sahry_gravida').workflow_key,'standard');assert.equal(tickets[0].workflow_key,'genjutsu');assert.equal(tickets[0].duration_seconds,12.5);assert.equal(t.drafts.faceSwap.entries[0].workflowLocked,true);
const firstId=tickets[0].job_id;fail=null;await t.submitBatch(root);assert.equal(confirmed.size,3);assert.equal(t.drafts.faceSwap.entries.length,0);assert.equal(tickets.filter(x=>x.character_id==='jujuh')[1].job_id,firstId);assert.equal(frameCount,2,'retry reuses extracted frame');assert(revoked.includes('blob:video-1.mp4'));assert(controls.every(c=>c.disabled===false));
t.addBatchFiles(files);ui.cloudSession=null;t.resetOwner();assert.equal(t.drafts.faceSwap,undefined,'logout discards local videos and references');
assert(source.includes("natural?'multiple'"));assert(source.includes('data-entry="'));assert(source.includes('row.querySelectorAll(\'input[name=character]:checked\')'));
console.log('PASS batch: multi-file selection, independent models, complete preflight, duplicate prevention, partial failure continues, stable retry IDs, cached frame and logout cleanup');

const core=fs.readFileSync('motion-control-core-v6.js','utf8');
const initial=core.slice(core.indexOf('  const MODE_KEY='),core.indexOf('  let motionConfig='));
for(const [saved,expected] of [[null,'genjutsu'],['motion_control','motion_control'],['standard','standard'],['genjutsu','genjutsu'],['invalid','genjutsu']]){
 const state={localStorage:{getItem:key=>key.endsWith('_v2')?saved:'motion_control'}};
 vm.runInNewContext(initial+';this.mode=activeMode',state);assert.equal(state.mode,expected);
}
console.log('PASS GENJUTSU default, explicit V7/standard choices and new tab preference persistence');
