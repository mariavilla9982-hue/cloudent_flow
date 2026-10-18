const fs=require('fs'),assert=require('assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES]}));
(async()=>{
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.setContent('<section id="faceSwap"></section><section id="upscale"></section><section id="faceSwapPhoto"></section>');
 await page.evaluate(()=>{window.currentPage='faceSwapPhoto';window.cloudSession={user:{id:'owner'}};window.calls=[];window.cloudFetch=async(path,opts)=>{calls.push(path);if(path.includes('resource=image-pipeline-result'))return {url:'https://example.test/a.png',type:'image'};if(path.includes('resource=image-pipeline'))return {jobs:[{id:'a',original_file_name:'modelo.jpg',status:'ready',meta:{source:'face_swap_photo',pipeline_status:'COMPLETED'}}]};return {ok:true};};});
 await page.addScriptTag({content:fs.readFileSync('image-pipeline-ui.js','utf8')});
 await page.waitForFunction(()=>document.querySelector('#faceSwapPhoto [data-open]'));
 assert.equal(await page.locator('#faceSwapPhoto input[type=file]').count(),2);
 await page.locator('#faceSwapPhoto [data-open]').click();assert(await page.locator('#faceSwapPhoto [data-result] img').count());
 await page.locator('#faceSwapPhoto [data-refresh]').click();assert(await page.locator('#faceSwapPhoto [data-result] img').count(),'poll must preserve opened result');
 await page.evaluate(()=>{currentPage='upscale';ImagePipeline.render('upscale')});assert.equal(await page.locator('#upscale input[type=file]').count(),1);
 await page.evaluate(()=>{currentPage='faceSwap';ImagePipeline.render('faceSwap')});assert.equal(await page.locator('#faceSwap input[type=file]').getAttribute('accept'),'video/*');
 await browser.close();console.log('PASS browser: 3 pages, manual inputs, video input, result buttons, refresh preserves preview');
})().catch(e=>{console.error(e);process.exitCode=1});
