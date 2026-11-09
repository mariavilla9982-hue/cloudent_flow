// DOM/controller test, no browser engine or real provider calls.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const nodes=new Map();
function node(){return {innerHTML:'',textContent:'',dataset:{},style:{},disabled:false,value:'',classList:{add(){},remove(){},toggle(){}},setAttribute(k,v){this[k]=v;},removeAttribute(){},replaceChildren(child){this.child=child;},load(){},click(){}};}
const container=node();let section=null;
for(const selector of ['[data-gen-entries]','[data-send]','input[type=file]','[data-auto-videos]','[data-send-manual]','[data-manual-prompt]','[data-draft-error]','[data-gen-config]','[data-gen-jobs]','[data-gen-error]','[data-gen-status]','[data-retry-all]'])nodes.set(selector,node());
Object.defineProperty(container,'innerHTML',{set(value){this.html=value;section=node();section.dataset.owner=(value.match(/data-owner="([^"]*)"/)||[])[1];section.querySelector=selector=>nodes.get(selector);},get(){return this.html;}});
for(const kind of ['video','frame']){const box=node(),parts=new Map(['.production-upload-preview','input','[data-clear]','.production-upload-meta'].map(s=>[s,node()]));box.querySelector=s=>parts.get(s);nodes.set('[data-gen-drop="'+kind+'"]',box);}
const mediaBoxes={};
for(const kind of ['original','frame']){const placeholder=node();placeholder.replaceWith=media=>mediaBoxes[kind].media=media;mediaBoxes[kind]={querySelector:()=>placeholder};}
const target={dataset:{jobMedia:'existing'},isConnected:true,querySelector:s=>s==='.genjutsu-preview-placeholder'?{replaceWith:media=>mediaBoxes.frame.media=media}:mediaBoxes[s.includes('original')?'original':'frame']};
nodes.get('[data-gen-jobs]').querySelectorAll=()=>[target];
let recoveryJob=null,failedJobs=[],resolveBulk=null;
let timer,frameReads=0,uploads=[],calls=[],failUpload=true,uploadedFiles=[],modal=null,resolveResult=null,deferResult=false,previewFailure=false;
const modalHost=node();Object.defineProperty(modalHost,'innerHTML',{set(value){if(modal){modal.isConnected=false;modal.mediaController?.abort();}this.html=value;if(!value){modal=null;return;}modal=node();modal.isConnected=true;modal.canvas=node();modal.close=node();modal.close.focus=()=>{};modal.querySelector=s=>s==='[data-gen-close]'?modal.close:modal.canvas;modal.querySelectorAll=()=>[modal.close];},get(){return this.html;}});modalHost.querySelector=()=>modal;
const video=new File(['source video'], 'video.mp4',{type:'video/mp4'});
const document={hidden:false,querySelector:s=>s.includes('modalHost')?modal:section,getElementById:id=>id==='production'?container:id==='modalHost'?modalHost:node(),createElement(tag){const el=node();el.addEventListener=()=>{};el.play=async()=>{};el.replaceChildren=child=>el.child=child;el.appendChild=child=>el.child=child;if(tag==='video'){el.duration=10;Object.defineProperty(el,'src',{get(){return el.savedSrc;},set(value){el.savedSrc=value;queueMicrotask(()=>el.onloadedmetadata?.());}});}return el;}};
const c=vm.createContext({window:{CloudentConfig:{supabaseUrl:'https://project.supabase.co'},CloudentMotionControl:{mode:'genjutsu'}},document,currentPage:'production',cloudSession:{user:{id:'owner'},access_token:'session'},SUPABASE_KEY:'publishable',crypto,File,Blob,AbortSignal,AbortController,URL:{createObjectURL:()=> 'blob:source',revokeObjectURL(){}},Date,Number,String,Error,Promise,setTimeout:(fn,ms)=>{const id=setTimeout(fn,ms);if(ms>=60000)id.unref();return id;},clearTimeout,setInterval:(fn,ms)=>{if(ms===10000)timer=fn;},queueMicrotask,
  extractFirstFrameBlob:async()=>{frameReads++;return new Blob(['frame'],{type:'image/jpeg'});},
  uploadFaceSwapPart:async(part,file)=>{uploadedFiles.push(file);uploads.push(part.path);if(part.path==='reference'&&failUpload){failUpload=false;throw Error('upload interrupted');}},
  closeModal:()=>{modalHost.innerHTML='';},cloudFetch:async(path,options)=>{
    calls.push({path,body:options?.body?JSON.parse(options.body):null});
    if(path.includes('resource=image-pipeline-characters')){assert(path.includes('metadata=1'));return {characters:[{id:'jujuh',name:'Jujuh'}]};}
    if(path.includes('resource=image-pipeline&'))return {jobs:[...failedJobs,...(recoveryJob?[recoveryJob]:[]),{id:'existing',status:'waiting',meta:{video_workflow:{key:'genjutsu'},source_file_name:'<unsafe>',character_name:'Jujuh',stage:'control_motion'},production:{id:'existing',status:'running',result_video_id:'saved',genjutsu:{providerPending:true}}},{id:'other',meta:{video_workflow:{key:'motion_control'}}}]};
    if(path.includes('action=image-pipeline-retry-genjutsu'))return new Promise(resolve=>{resolveBulk=resolve;});
    if(path.includes('resource=image-pipeline-prompt'))return {prompt:'subject_definitions: <script>alert(1)</script>'};
    if(path.includes('resource=image-pipeline-result')){if(previewFailure)throw Error('Falha de prévia');return deferResult?new Promise(resolve=>{resolveResult=resolve;}):{url:'https://b2.test/result.mp4'};}
    if(path.includes('verified=1')){const original=path.includes('kind=original');return {url:'https://b2.test/signed',name:original?'reused.mp4':'reused.webp',mime:original?'video/mp4':'image/webp',size:50,asset:original?'owner/original':'owner/frame',reusable:true,...(original?{duration:10}:{})};}
    if(path.includes('resource=image-pipeline-preview'))return {url:path.includes('kind=original')?'https://b2.test/original.mp4':'https://b2.test/frame.webp'};
    if(path.includes('image-pipeline-ticket'))return {job_id:JSON.parse(options.body).job_id,original:{path:'original'},reference:{path:'reference'}};
    return {ok:true};
  },fetch:async address=>String(address).startsWith('https://b2.test/')?new Response('downloaded media'):Response.json({active:true,readiness:{ready:true}})
});
let visibilityChanged;document.addEventListener=(name,fn)=>{if(name==='visibilitychange')visibilityChanged=fn;};
vm.runInContext(fs.readFileSync('genjutsu-ui.js','utf8'),c);
c.window.CloudentGenjutsu.render(container);
await new Promise(setImmediate);await new Promise(setImmediate);
assert(nodes.get('[data-gen-config]').textContent.includes('Ultra 84 GB'));
assert(nodes.get('[data-gen-jobs]').innerHTML.includes('data-download="existing"'));
assert(!nodes.get('[data-gen-jobs]').innerHTML.includes('data-calendar'));
assert(nodes.get('[data-gen-jobs]').innerHTML.includes('&lt;unsafe&gt;'));
assert(!nodes.get('[data-gen-jobs]').innerHTML.includes('other'));
assert(nodes.get('[data-gen-jobs]').innerHTML.includes('data-job-media="existing"'));
assert(nodes.get('[data-gen-jobs]').innerHTML.includes('data-original="existing"'));
assert(nodes.get('[data-gen-jobs]').innerHTML.includes('data-frame="existing"'));
assert(nodes.get('[data-gen-jobs]').innerHTML.includes('production-job-state'));
assert(nodes.get('[data-gen-jobs]').innerHTML.includes('studio-identity studio-model-tag'));
assert(nodes.get('[data-gen-jobs]').innerHTML.includes('>Jujuh</span>'));
assert(container.innerHTML.includes('genjutsu-upload-workspace'));assert(!container.innerHTML.includes('studio-production-result'));assert(container.innerHTML.includes('production-queue-card'));
assert(!nodes.get('[data-gen-jobs]').innerHTML.includes('<progress'));
assert.equal(mediaBoxes.frame.media.src,'https://b2.test/frame.webp');
assert.equal(mediaBoxes.frame.media.style.cssText,'display:block;width:100%;height:100%;object-fit:contain');
const oldMedia=mediaBoxes.frame.media;await c.window.CloudentGenjutsu.refresh();
assert.equal(mediaBoxes.frame.media,oldMedia,'polling preserves the media player');
assert.equal(calls.filter(x=>x.path.includes('resource=image-pipeline-preview')).length,1,'signed previews are reused');


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
// Preview opens only after an explicit click; polling cannot replace a player.
assert(!calls.some(c=>c.path.includes('image-pipeline-result')));
const clickAction=(dataset)=>{const b=node();b.dataset=dataset;b.hasAttribute=()=>false;return section.onclick({target:{closest:()=>b}});};
await clickAction({prompt:'existing'});assert.equal(modal.canvas.child.textContent,'subject_definitions: <script>alert(1)</script>');assert.equal(modal.canvas.child.className,'genjutsu-prompt-text');c.closeModal();
await clickAction({preview:'existing'});assert(modal.isConnected);assert.equal(modal.canvas.child.savedSrc,'https://b2.test/result.mp4');
const playing=modal.canvas.child;await c.window.CloudentGenjutsu.refresh();assert.equal(modal.canvas.child,playing);
modal.onkeydown({key:'Escape',preventDefault(){}});assert.equal(modal,null);
const cachedReads=calls.filter(x=>x.path.includes('image-pipeline-result')).length;
await clickAction({preview:'existing'});assert.equal(calls.filter(x=>x.path.includes('image-pipeline-result')).length,cachedReads);c.closeModal();
const now=Date.now;let advance=16*60*1000;
c.Date=class extends Date{static now(){return now()+advance;}};
// Closing while the URL request is pending cannot resurrect the preview.
deferResult=true;const opening=clickAction({preview:'existing'});assert(modal.isConnected);c.closeModal();resolveResult({url:'https://b2.test/late.mp4'});await opening;assert.equal(modal,null);
// Suppress double clicks even if polling rerenders the originating row.
advance+=16*60*1000;
const pending=clickAction({preview:'existing'});const requests=calls.filter(x=>x.path.includes('image-pipeline-result')).length;
await c.window.CloudentGenjutsu.refresh();await clickAction({preview:'existing'});assert.equal(calls.filter(x=>x.path.includes('image-pipeline-result')).length,requests);
resolveResult({url:'https://b2.test/result.mp4'});await pending;c.closeModal();deferResult=false;
advance+=16*60*1000;previewFailure=true;await clickAction({preview:'existing'});assert.equal(modal.canvas.textContent,'Falha de prévia');c.closeModal();previewFailure=false;
// Secondary menu actions preserve the production handlers and HTTP contracts.
c.confirm=()=>true;let calendarId=null,trialId=null,bulkId=null,productionLoads=0;
c.loadProductionData=async()=>{productionLoads++;};
c.openProductionScheduleModal=async(id,_,job)=>{calendarId=id;assert.equal(job.result_video_id,'saved');};
c.openProductionTrialModal=async id=>{trialId=id;};
c.sendProductionResultToBulk=async id=>{bulkId=id;};
await clickAction({calendar:'existing'});assert.equal(calendarId,'existing');assert.equal(productionLoads,0);
await clickAction({trial:'existing'});assert.equal(trialId,'existing');
await clickAction({bulk:'existing'});assert.equal(bulkId,'existing');
await clickAction({download:'existing'});assert(calls.some(x=>x.path.includes('image-pipeline-result')));
await clickAction({retry:'existing'});assert(calls.some(x=>x.path.includes('action=image-pipeline-retry')&&x.body.id==='existing'));
await clickAction({delete:'existing'});assert(calls.some(x=>x.path.includes('action=image-pipeline-job')&&x.body.id==='existing'));
assert(nodes.get('[data-gen-jobs]').innerHTML.includes('genjutsu-more'));
const failed=(id,canRetry)=>({id,status:'failed',last_error:'falhou',meta:{video_workflow:{key:'genjutsu'},stage:'control_motion'},production:{status:'failed',genjutsu:{canRetry}}});
assert.equal(nodes.get('[data-retry-all]').hidden,true);
failedJobs=[failed('first',true),failed('second',true),failed('blocked',false)];
await c.window.CloudentGenjutsu.refresh();
assert.match(nodes.get('[data-retry-all]').textContent,/\(2\)/);
const retryAll=node();retryAll.hasAttribute=key=>key==='data-retry-all';
const retryAllClick=()=>section.onclick({target:{closest:()=>retryAll}});
const batch=retryAllClick();assert.match(nodes.get('[data-gen-jobs]').innerHTML,/Retomando…/);
assert.equal(nodes.get('[data-retry-all]').disabled,true);
await retryAllClick();await clickAction({retry:'second'});
assert.deepEqual(calls.filter(x=>x.path.includes('retry-genjutsu')).map(x=>x.body),[{ids:['first','second']}]);
failedJobs=failedJobs.slice(1);
resolveBulk({results:[{id:'first',ok:true},{id:'second',ok:false,error:'Arquivo indisponível.'}]});await batch;
assert.match(nodes.get('[data-gen-status]').textContent,/1 de 2/);
assert.equal(nodes.get('[data-gen-error]').textContent,'Arquivo indisponível.');
assert.match(nodes.get('[data-retry-all]').textContent,/\(1\)/);
failedJobs=[];
console.log('PASS secondary menu calendar, trial, bulk, download, retry and deletion handler contracts');
choose('video',video);choose('frame',customFrame);
c.cloudSession={user:{id:'another'},access_token:'new-session'};timer();await new Promise(setImmediate);c.window.CloudentGenjutsu.render(container);
assert.equal(section.dataset.owner,'another');
assert.equal(nodes.get('[data-gen-drop="frame"]').querySelector('.production-upload-meta').textContent,'Clique para escolher o arquivo');
assert.equal(c.window.CloudentGenjutsu.busy,false);
await new Promise(setImmediate);const readsBeforeHidden=calls.length;document.hidden=true;timer();await new Promise(setImmediate);assert.equal(calls.length,readsBeforeHidden,'hidden tab does not poll');
document.hidden=false;visibilityChanged();await new Promise(setImmediate);assert(calls.length>readsBeforeHidden,'returning to tab refreshes immediately');
console.log('PASS Genjutsu UI: metadata-only models, isolated queue, safe text, result while cancel pending, required model, duration/970 inputs, stable retry ID/frame, session reset, click-only modal, close race, duplicate actions and preview error');

// A persisted retry must identify the prompt and its deadline; running removes it.
recoveryJob={id:'retrying',status:'waiting',meta:{stage:'control_motion',video_workflow:{key:'genjutsu'}},production:{status:'motion_waiting',genjutsu:{display:{key:'recovering',label:'Recuperação · nova tentativa agendada',activity:false,retryAt:'2026-11-05T01:00:00Z'}}}};
c.cloudSession={user:{id:'owner'},access_token:'session'};c.currentPage='production';document.hidden=false;
await c.window.CloudentGenjutsu.refresh();
assert(nodes.get('[data-gen-jobs]').innerHTML.includes('Prompt · aguardando nova tentativa automática'));
assert(nodes.get('[data-gen-jobs]').innerHTML.includes('data-gen-retry="1793840400000"'));
recoveryJob.production.status='running';recoveryJob.production.genjutsu.display={key:'running',label:'Gerando vídeo',activity:true};
await c.window.CloudentGenjutsu.refresh();
assert(!nodes.get('[data-gen-jobs]').innerHTML.includes('data-gen-retry='));
console.log('PASS prompt retry deadline and automatic transition to video execution');

c.cloudSession={user:{id:'owner'},access_token:'session'};
c.currentPage='production';c.window.CloudentMotionControl.mode='genjutsu';
recoveryJob={id:'failed-media',status:'failed',media:{original:true,frame:true,reuseOriginal:true,reuseFrame:true},meta:{video_workflow:{key:'genjutsu'}},production:{status:'failed'}};
c.window.CloudentGenjutsu.render(container);
await new Promise(setImmediate);await new Promise(setImmediate);
assert.match(nodes.get('[data-gen-jobs]').innerHTML,/data-use-video="failed-media"/);
assert.match(nodes.get('[data-gen-jobs]').innerHTML,/data-use-frame="failed-media"/);
assert.match(nodes.get('[data-gen-jobs]').innerHTML,/data-download-frame="failed-media"/);
const beforeReuse=calls.filter(x=>x.path.includes('image-pipeline-ticket')).length;
let downloadedName;const createElement=document.createElement;
document.createElement=tag=>tag==='a'?{click(){downloadedName=this.download;}}:createElement(tag);
await clickAction({downloadFrame:'failed-media'});assert.equal(downloadedName,'reused.webp');
await clickAction({useVideo:'failed-media'});await clickAction({useFrame:'failed-media'});
assert.equal(calls.filter(x=>x.path.includes('image-pipeline-ticket')).length,beforeReuse);
assert.equal(nodes.get('[data-gen-drop="video"]').querySelector('.production-upload-meta').textContent,'reused.mp4');
assert.equal(nodes.get('[data-gen-drop="frame"]').querySelector('.production-upload-meta').textContent,'reused.webp');
const text=nodes.get('[data-manual-prompt]');text.value='  First line\nSecond line.  ';
section.oninput({target:{value:text.value,hasAttribute:key=>key==='data-manual-prompt'}});
const beforeUploads=uploads.length;
await manualClick();
const sent=calls.filter(x=>x.path.includes('image-pipeline-ticket')).at(-1).body;
assert.equal(sent.manual_prompt,'  First line\nSecond line.  ');
assert.equal(sent.reuse.original.id,'failed-media');assert.equal(sent.reuse.reference.asset,'owner/frame');
assert.equal(uploads.length,beforeUploads,'reused media does not upload through the browser');
console.log('PASS manual prompt and card actions: exact text, download, two draft fields, no implicit dispatch or browser re-upload');
