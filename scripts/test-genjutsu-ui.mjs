// DOM/controller test, no browser engine or real provider calls.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const nodes=new Map();
function node(){return {innerHTML:'',textContent:'',dataset:{},disabled:false,value:'',classList:{remove(){},toggle(){}},setAttribute(k,v){this[k]=v;},removeAttribute(){},load(){},click(){}};}
const container=node();let section=null;
for(const selector of ['[data-gen-entries]','[data-send]','input[type=file]','[data-auto-videos]','[data-send-manual]','[data-draft-error]','[data-gen-config]','[data-gen-jobs]','[data-gen-error]','[data-gen-status]'])nodes.set(selector,node());
Object.defineProperty(container,'innerHTML',{set(value){this.html=value;section=node();section.dataset.owner=(value.match(/data-owner="([^"]*)"/)||[])[1];section.querySelector=selector=>nodes.get(selector);},get(){return this.html;}});
for(const kind of ['video','frame']){const box=node(),parts=new Map(['.production-upload-preview','input','[data-clear]','.production-upload-meta'].map(s=>[s,node()]));box.querySelector=s=>parts.get(s);nodes.set('[data-gen-drop="'+kind+'"]',box);}
let timer,frameReads=0,uploads=[],calls=[],failUpload=true,uploadedFiles=[];
const video=new File(['source video'], 'video.mp4',{type:'video/mp4'});
const document={hidden:false,querySelector:()=>section,getElementById:id=>id==='production'?container:node(),createElement(tag){const el=node();if(tag==='video'){el.duration=10;Object.defineProperty(el,'src',{set(){queueMicrotask(()=>el.onloadedmetadata?.());}});}return el;}};
const c=vm.createContext({window:{CloudentConfig:{supabaseUrl:'https://project.supabase.co'},CloudentMotionControl:{mode:'genjutsu'}},document,currentPage:'production',cloudSession:{user:{id:'owner'},access_token:'session'},SUPABASE_KEY:'publishable',crypto,File,Blob,AbortSignal,URL:{createObjectURL:()=> 'blob:source',revokeObjectURL(){}},Date,Number,String,Error,Promise,setTimeout,clearTimeout,setInterval:fn=>{timer=fn;},queueMicrotask,
  extractFirstFrameBlob:async()=>{frameReads++;return new Blob(['frame'],{type:'image/jpeg'});},
  uploadFaceSwapPart:async(part,file)=>{uploadedFiles.push(file);uploads.push(part.path);if(part.path==='reference'&&failUpload){failUpload=false;throw Error('upload interrupted');}},
  cloudFetch:async(path,options)=>{
    calls.push({path,body:options?.body?JSON.parse(options.body):null});
    if(path.includes('resource=image-pipeline-characters')){assert(path.includes('metadata=1'));return {characters:[{id:'jujuh',name:'Jujuh'}]};}
    if(path.includes('resource=image-pipeline&'))return {jobs:[{id:'existing',status:'waiting',meta:{video_workflow:{key:'genjutsu'},source_file_name:'<unsafe>',character_name:'Jujuh',stage:'control_motion'},production:{status:'running',result_video_id:'saved',genjutsu:{providerPending:true}}},{id:'other',meta:{video_workflow:{key:'motion_control'}}}]};
    if(path.includes('image-pipeline-ticket'))return {job_id:JSON.parse(options.body).job_id,original:{path:'original'},reference:{path:'reference'}};
    return {ok:true};
  },fetch:async()=>Response.json({active:true,readiness:{ready:true}})
});
vm.runInContext(fs.readFileSync('genjutsu-ui.js','utf8'),c);
c.window.CloudentGenjutsu.render(container);
await new Promise(setImmediate);await new Promise(setImmediate);
assert(nodes.get('[data-gen-config]').textContent.includes('Ultra 84 GB'));
assert(nodes.get('[data-gen-jobs]').innerHTML.includes('data-download="existing"'));
assert(!nodes.get('[data-gen-jobs]').innerHTML.includes('data-calendar'));
assert(nodes.get('[data-gen-jobs]').innerHTML.includes('&lt;unsafe&gt;'));
assert(!nodes.get('[data-gen-jobs]').innerHTML.includes('other'));
const input=nodes.get('input[type=file]');input.type='file';input.files=[video];section.onchange({target:input});
let entryId=nodes.get('[data-gen-entries]').innerHTML.match(/data-entry="([^"]+)"/)[1];
const send=node();send.hasAttribute=key=>key==='data-send';
await section.onclick({target:{closest:()=>send}});
assert(nodes.get('[data-gen-error]').textContent.includes('modelo'));
assert.equal(calls.filter(x=>x.path.includes('ticket')).length,0);
section.onchange({target:{type:'select',dataset:{model:entryId},value:'jujuh'}});
await section.onclick({target:{closest:()=>send}});
assert(nodes.get('[data-gen-entries]').innerHTML.includes('upload interrupted'));
assert.equal(c.window.CloudentGenjutsu.busy,false);
await section.onclick({target:{closest:()=>send}});
const tickets=calls.filter(x=>x.path.includes('ticket'));
assert.equal(tickets.length,2);assert.equal(tickets[0].body.job_id,tickets[1].body.job_id);
assert.equal(tickets[0].body.workflow_key,'genjutsu');assert.equal(tickets[0].body.duration_seconds,10);assert.equal(tickets[0].body.character_id,'jujuh');
assert.equal(frameReads,1);assert.equal(calls.filter(x=>x.path.includes('image-pipeline-complete')).length,1);
assert.equal(nodes.get('[data-gen-entries]').innerHTML,'');
// Manual pair uses the user's exact frame, without model selection or extraction.
assert(container.innerHTML.includes('data-gen-file="video"'));assert(container.innerHTML.includes('data-gen-file="frame"'));assert(container.innerHTML.includes('Frame / personagem'));
const manualSend=node();manualSend.hasAttribute=k=>k==='data-send-manual';
const manualClick=()=>section.onclick({target:{closest:()=>manualSend}});
const before=calls.length;await manualClick();assert.equal(calls.length,before);assert(nodes.get('[data-gen-error]').textContent.includes('frame'));
const customFrame=new File(['exact custom model frame'],'custom.webp',{type:'image/webp'});
const choose=(kind,file)=>section.onchange({target:{type:'file',files:[file],dataset:{genFile:kind}}});
choose('video',video);await manualClick();assert.equal(calls.length,before,'frame is required');
choose('frame',new File(['bad'],'bad.svg',{type:'image/svg+xml'}));assert(nodes.get('[data-gen-error]').textContent.includes('JPG'));
choose('frame',customFrame);failUpload=true;await manualClick();assert(nodes.get('[data-draft-error]').textContent.includes('upload interrupted'));await manualClick();
const manualTickets=calls.filter(x=>x.body?.input_mode==='manual_frame');assert.equal(manualTickets.length,2);assert.equal(manualTickets[0].body.job_id,manualTickets[1].body.job_id);assert.equal(manualTickets[0].body.character_id,undefined);assert.equal(manualTickets[0].body.reference.name,'custom.webp');assert.equal(uploadedFiles.at(-1),customFrame);assert.equal(uploadedFiles.at(-2),video);assert.equal(frameReads,1,'manual frame cannot trigger extraction');
assert.equal(nodes.get('[data-gen-drop="frame"]').querySelector('.production-upload-meta').textContent,'Clique para escolher o arquivo');
choose('video',video);choose('frame',customFrame);
c.cloudSession={user:{id:'another'},access_token:'new-session'};timer();await new Promise(setImmediate);c.window.CloudentGenjutsu.render(container);
assert.equal(section.dataset.owner,'another');
assert.equal(nodes.get('[data-gen-drop="frame"]').querySelector('.production-upload-meta').textContent,'Clique para escolher o arquivo');
assert.equal(c.window.CloudentGenjutsu.busy,false);
console.log('PASS Genjutsu UI: metadata-only models, isolated queue, safe text, result while cancel pending, required model, duration/970 inputs, stable retry ID/frame, session reset');
