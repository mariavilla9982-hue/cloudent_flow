const fs=require('node:fs'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
if(!fs.existsSync('/tmp/genjutsu-fixture.mp4'))execFileSync('ffmpeg',['-y','-f','lavfi','-i','color=c=gray:s=360x640:d=2','-an','-c:v','libx264','-pix_fmt','yuv420p','/tmp/genjutsu-fixture.mp4','-loglevel','error']);
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const html=fs.readFileSync('index.html','utf8');
const main=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(m=>m[2].includes('const navItems='))[2].replace(/\ninit\(\);\s*$/,'\n');
const styles=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
const image='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1600"><rect width="800" height="1600" fill="#5d7686"/><circle cx="400" cy="600" r="200" fill="#c0c6ca"/></svg>').toString('base64');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>/\.js(?:\?|$)/.test(r.request().url())&&fs.existsSync(new URL(r.request().url()).pathname.slice(1))?r.fulfill({contentType:'application/javascript',body:fs.readFileSync(new URL(r.request().url()).pathname.slice(1))}):r.request().url().includes('/fixture.mp4')?r.fulfill({contentType:'video/mp4',body:fs.readFileSync('/tmp/genjutsu-fixture.mp4')}):r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="modalHost"></div><div id="toast"></div><main style="padding:16px;max-width:1440px;margin:auto"><section id="production"></section></main></body></html>'}));
 await page.goto('https://studio.test/');await page.addStyleTag({content:styles});await page.addStyleTag({content:fs.readFileSync('production-studio.css','utf8')});await page.addScriptTag({content:main});
 await page.evaluate(image=>{
   cloudSession={user:{id:'owner'},access_token:'fixture'};cloudAccess={role:'admin'};currentPage='production';window.fixtureImage=image;window.testCalls=[];
   window.fixtureJobs=[{id:'ready',status:'ready',original_file_name:'very-long-filename-'.repeat(12)+'.mp4',meta:{input_mode:'manual_frame',video_workflow:{key:'genjutsu'},stage:'control_motion'},production:{status:'ready',result_video_id:'saved',progress:100,genjutsu:{phase:'complete'}}},{id:'waiting',status:'waiting',original_file_name:'queued.mp4',meta:{input_mode:'manual_frame',video_workflow:{key:'genjutsu'},stage:'control_motion'},production:{status:'motion_waiting',progress:5,genjutsu:{phase:'provider_waiting'}}},{id:'failed',status:'failed',meta:{video_workflow:{key:'genjutsu'},stage:'control_motion'},production:{status:'failed',genjutsu:{canRetry:true},last_error:'Erro de teste '+('palavra'.repeat(80))}},{id:'foreign',meta:{video_workflow:{key:'motion_control'}}}];
   cloudFetch=async(path,opts)=>{testCalls.push({path,body:opts?.body});if(path.includes('image-pipeline-preview'))return {url:path.includes('kind=original')?'https://studio.test/fixture.mp4':image};if(path.includes('image-pipeline-result'))return {url:'https://studio.test/fixture.mp4'};if(path.includes('image-pipeline-characters'))return {characters:[{id:'jujuh',name:'Jujuh'}]};if(path.includes('resource=image-pipeline&'))return {jobs:fixtureJobs};return {};};
   window.fetch=async()=>Response.json({active:true,readiness:{ready:true}});
   ensureProductionTicker=()=>{};setupProductionThumbs=()=>{};loadPanelViews=async()=>{};loadProductionData=async()=>{};calendarEnsureAccount=()=>null;toast=()=>{};
   productionData={jobs:[],integration:{enabled:true,config:{}},runninghubStatus:{enabled:true},worker:{online:true}};
 },image);
 await page.addScriptTag({content:fs.readFileSync('genjutsu-ui.js','utf8')});await page.addScriptTag({content:fs.readFileSync('production-studio.js','utf8')});await page.addScriptTag({content:fs.readFileSync('motion-control-core-v6.js','utf8')});await page.addScriptTag({content:fs.readFileSync('motion-control-production.js','utf8')});
 await page.evaluate(()=>CloudentMotionControl.setMode('motion_control'));await page.waitForSelector('#production .studio-workspace');
 const v7=await page.locator('.production-upload-card').evaluate(n=>({padding:getComputedStyle(n).padding,radius:getComputedStyle(n).borderRadius,bg:getComputedStyle(n).backgroundColor}));
 await page.evaluate(()=>CloudentMotionControl.setMode('genjutsu'));await page.waitForSelector('[data-gen-count]');await page.waitForFunction(()=>document.querySelector('[data-gen-count]').textContent==='3 vídeo(s)');
 const gen=await page.locator('.production-upload-card').evaluate(n=>({padding:getComputedStyle(n).padding,radius:getComputedStyle(n).borderRadius,bg:getComputedStyle(n).backgroundColor}));assert.deepEqual(gen,v7,'GENJUTSU uses V7 card styling');
 assert.equal(await page.locator('.studio-workspace').count(),1);assert.equal(await page.locator('.studio-production-result').count(),1);assert.equal(await page.locator('.production-queue-card').count(),1);assert.equal(await page.locator('[data-gen-job]').count(),3);assert.equal(await page.locator('[data-gen-job][hidden]').count(),0,'V7 decorator cannot hide Genjutsu jobs');
 assert.equal(await page.locator('[data-gen-jobs] video').count(),0,'queue uses thumbnails, never full size players');
 for(const width of [360,390,430,768,1440]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(80);
  const dims=await page.locator('#production').evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth}));assert(dims.scroll<=dims.width+2,'overflow at '+width+': '+JSON.stringify(dims));
  const drops=await page.locator('[data-gen-drop]').evaluateAll(ns=>ns.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));assert(drops.every(d=>d.h<=342&&d.w>90),JSON.stringify({width,drops}));
  const thumbs=await page.locator('[data-job-media]').evaluateAll(ns=>ns.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));await page.screenshot({path:'/tmp/genjutsu-check.png',fullPage:true});assert(thumbs.every(t=>t.w<=50&&t.h<=60),JSON.stringify({width,thumbs}));
  await page.screenshot({path:'/tmp/genjutsu-v7-'+width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:390,height:844});
 await page.locator('[data-gen-drop="video"] input').setInputFiles({name:'reference.mp4',mimeType:'video/mp4',buffer:fs.readFileSync('/tmp/genjutsu-fixture.mp4')});
 await page.locator('[data-gen-drop="frame"] input').setInputFiles({name:'custom.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
 assert.equal(await page.locator('[data-gen-drop].has-preview').count(),2);await page.locator('[data-clear="frame"]').click();assert.equal(await page.locator('[data-gen-drop].has-preview').count(),1);
 await page.locator('[data-gen-jobs] [data-frame="ready"]').click();await page.waitForSelector('[data-gen-result] img');
 assert.equal(await page.locator('[data-gen-result] img').getAttribute('src'),image);
 await page.locator('[data-gen-jobs] [data-original="ready"]').click();await page.waitForSelector('[data-gen-result] video');
 assert((await page.locator('[data-gen-result] video').getAttribute('src')).includes('fixture.mp4'));
 await page.locator('[data-gen-jobs] [data-preview="ready"]').click();await page.waitForSelector('[data-gen-result] video');
 await page.locator('[data-gen-result] video').evaluate(v=>v.dataset.identity='preserved');
 await page.evaluate(()=>{fixtureJobs[1].production.genjutsu.phase='generating';return CloudentGenjutsu.refresh();});
 assert.equal(await page.locator('[data-gen-result] video').getAttribute('data-identity'),'preserved','status polling preserves selected player');
 await page.evaluate(()=>CloudentStudio.enhanceProduction());assert.equal(await page.locator('[data-gen-job][hidden]').count(),0);
 await page.screenshot({path:'/tmp/genjutsu-v7-selected-mobile.png',fullPage:true});
 // Repeated navigation must not leak a Genjutsu player into V7 or vice versa.
 await page.evaluate(()=>CloudentMotionControl.setMode('motion_control'));assert.equal(await page.locator('[data-genjutsu-root]').count(),0);await page.waitForSelector('.studio-workspace');
 await page.evaluate(()=>CloudentMotionControl.setMode('genjutsu'));await page.waitForSelector('[data-gen-count]');assert.equal(await page.locator('[data-gen-result] video').count(),0);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS browser: V7 shared card styling, workspace/result/queue parity, 360–1440px overflow and bounded portrait media, exact frame/original/result preview, clear input, stable player on status refresh, mode isolation, no page errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
