const fs=require('fs'),assert=require('assert/strict');
const {JSDOM}=require(require.resolve('jsdom',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,process.env.NODE_PATH,__dirname].filter(Boolean)}));
const {PIPELINE_CHARACTERS}=require('../supabase/functions/_shared/image-pipeline-characters.ts');
(async()=>{
 const dom=new JSDOM('<section id="faceSwap"></section><section id="faceSwapPhoto"></section><section id="upscale"></section>',{url:'https://cloudent-flow.vercel.app',runScripts:'outside-only'}),w=dom.window;
 const calls=[],uploads=[],confirmed=[];
 w.currentPage='faceSwapPhoto';w.cloudSession={user:{id:'owner'}};w.File=File;w.URL.createObjectURL=f=>'blob:'+f.name;w.URL.revokeObjectURL=()=>{};w.extractFirstFrameBlob=async()=>new Blob(['frame']);
 w.cloudFetch=async(path,options)=>{if(path.includes('image-pipeline-characters'))return {characters:PIPELINE_CHARACTERS.map(c=>({...c,preview_url:'data:'+c.mime_type+';base64,'+c.base64}))};if(!options)return {jobs:[]};const body=JSON.parse(options.body);calls.push({path,body});if(path.includes('ticket'))return {job_id:body.job_id,model_selected:body.source==='face_swap_photo',original:{},reference:{}};confirmed.push(body.job_id);return {ok:true};};
 w.uploadFaceSwapPart=async(ticket,file)=>{assert(file,'never upload undefined model');uploads.push(file.name);};
 w.showPage=id=>{w.currentPage=id;w.ImagePipeline.render(id);};
 w.eval(fs.readFileSync('image-pipeline-ui.js','utf8'));
 const tick=async()=>{for(let i=0;i<10;i++)await new Promise(setImmediate)};await tick();
 const photo=w.document.getElementById('faceSwapPhoto');
 assert.equal(photo.querySelectorAll('input[type=file]').length,1);assert.equal(photo.querySelectorAll('input[type=radio]').length,2);assert.equal(photo.querySelectorAll('input[name=original]').length,0);
 for(const c of PIPELINE_CHARACTERS.slice(0,2)){const img=photo.querySelector('[data-character-preview="'+c.id+'"]');assert(!img.hidden);assert.equal(img.src,'data:'+c.mime_type+';base64,'+c.base64);}
 const character=photo.querySelector('input[value=sahry_japah]');character.click();
 const input=photo.querySelector('input[name=reference]');Object.defineProperty(input,'files',{value:[new File(['reference'],'target.jpg',{type:'image/jpeg'})],configurable:true});input.dispatchEvent(new w.Event('change',{bubbles:true}));photo.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 assert.equal(calls[0].body.character_id,'sahry_japah');assert.equal(calls[0].body.original,null);assert.deepEqual(uploads,['target.jpg']);assert.equal(confirmed.length,1);assert(character.checked);assert.equal(photo.querySelector('[data-pipeline-error]').textContent,'');
 w.showPage('faceSwap');const videos=w.document.getElementById('faceSwap'),fileInput=videos.querySelector('input[name=original]');
 Object.defineProperty(fileInput,'files',{value:[new File(['v1'],'a.mp4',{type:'video/mp4'}),new File(['v2'],'b.mp4',{type:'video/mp4'})]});fileInput.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
 const rows=[...videos.querySelectorAll('[data-entry]')];assert.equal(rows.length,2);assert.equal(videos.querySelectorAll('select').length,2);assert.equal(rows[0].querySelectorAll('select option').length,2);
 for(const row of rows)row.querySelector('input[value=jujuh]').click();
 const select=rows[1].querySelector('select');select.value='standard';select.dispatchEvent(new w.Event('change',{bubbles:true}));
 videos.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 const tickets=calls.filter(c=>c.body.source==='face_swap_natural');assert.equal(tickets.length,2);assert.equal(tickets[0].body.workflow_key,'motion_control');assert.equal(tickets[1].body.workflow_key,'standard');assert.equal(videos.querySelector('[data-pipeline-error]').textContent,'');
 w.showPage('faceSwapPhoto');assert(photo.querySelector('input[value=sahry_japah]').checked);
 w.showPage('upscale');assert.equal(w.document.querySelectorAll('#upscale input[type=file]').length,1);
 await tick();dom.window.close();console.log('PASS DOM: two exact photo sheets, target-only file upload, character retained, two video selectors route independently, tabs/upscale preserved');
})().catch(e=>{console.error(e);process.exitCode=1});
