const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const html=fs.readFileSync('index.html','utf8');
const extract=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);
new vm.Script(fs.readFileSync('production-studio.js','utf8'));
new vm.Script(fs.readFileSync('sw.js','utf8'));
let requests=[],refreshes=0,clicks=[],messages=[],modal=null,next=null;
const host={get innerHTML(){return this.value||''},set innerHTML(v){this.value=v;if(modal)modal.isConnected=false;modal=v?{isConnected:true,dataset:{},querySelectorAll:()=>[],querySelector:()=>({addEventListener(){}})}:null;}};
const context={URL,AbortController,Error,Set,encodeURIComponent,console,
 cloudSession:{user:{id:'owner'},access_token:'token'},SUPABASE_KEY:'public',EDGE_URL:'https://api.test',productionData:{jobs:[]},
 document:{body:{appendChild(){},classList:{remove(){}}},createElement:()=>({style:{},click(){clicks.push(this)},remove(){}})},
 $:s=>s==='#modalHost'?host:modal,esc:s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;'),
 toast:m=>messages.push(m),friendlyCloudentError:s=>s,responseErrorMessage:(d,s)=>d?.error||String(s),auditMediaAccess(){},
 refreshCloudSession:async()=>{refreshes++;return true},withTimeout:p=>p,
 setTimeout:(fn,ms)=>setTimeout(fn,ms===20000?25:ms),clearTimeout,
 fetch:async(url,opts)=>{requests.push({url,opts});if(next)return next(url,opts);return {ok:true,status:200,json:async()=>({url:'https://media.test/video.mp4?signature=private'}),blob(){throw Error('must not buffer video')}};}
};
vm.createContext(context);
vm.runInContext(extract('function closeModal(){','let dragInfo='),context);
vm.runInContext(extract('async function getProductionResultUrl(','function runningHubFormPayload('),context);
vm.runInContext(extract('const productionDownloads=','async function sendProductionResultToBulk('),context);
const reset=()=>{requests=[];refreshes=0;clicks=[];messages=[];next=null;context.cloudSession={user:{id:'owner'},access_token:'token'};context.closeModal();};
(async()=>{
 reset();assert.match(await context.getProductionResultUrl('job'),/^https:\/\/media/);
 assert.match(requests[0].url,/production-preview&kind=result/);assert.equal(requests.length,1);
 reset();await context.downloadProductionResult('job',1);assert.match(requests[0].url,/production-download&mode=link/);
 assert.equal(clicks.length,1);assert.equal(clicks[0].download,'Video final 1.mp4');assert.equal(clicks[0].target,'_blank');
 assert.match(host.innerHTML,/Se o download não começar/);assert.match(host.innerHTML,/href="https:\/\/media/);
 reset();next=async()=>({ok:false,status:401,json:async()=>({error:'unauthorized'})});
 await assert.rejects(context.getProductionResultUrl('job'),/unauthorized/);assert.equal(requests.length,2);assert.equal(refreshes,1,'401 refresh is bounded');
 reset();next=async()=>({ok:true,status:200,json:async()=>({url:'javascript:bad'})});await assert.rejects(context.getProductionResultUrl('job'),/link/);
 reset();next=(_,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}))));
 await assert.rejects(context.getProductionResultUrl('job'),/tempo de preparação/);
 reset();next=(_,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}))));
 const preview=context.previewProductionJob('job');await new Promise(r=>setImmediate(r));context.closeModal();await preview;
 assert.equal(host.innerHTML,'','closing pending preview must not reopen it');assert.equal(messages.length,0,'closing is not an error');
 reset();let resolve;next=()=>new Promise(r=>resolve=r);
 const first=context.downloadProductionResult('job',1);await context.downloadProductionResult('job',1);assert.equal(requests.length,1,'double download coalesces');
 resolve({ok:true,status:200,json:async()=>({url:'https://media.test/video.mp4'})});await first;assert.equal(clicks.length,1);
 reset();next=async()=>{context.cloudSession=null;return {ok:true,status:200,json:async()=>({url:'https://media.test/video.mp4'})}};
 await assert.rejects(context.getProductionResultUrl('job'),/sessão mudou/);

 // Exercise the deployed link route with database/storage doubles; no media GET or repair.
 const api=fs.readFileSync('supabase/functions/cloudent-api/index.ts','utf8');
 const start=api.indexOf('if (req.method === "GET" && resource === "production-download")');
 const end=api.indexOf('let upstream:Response|null=null;',start);
 const code=stripTypeScriptTypes('(async()=>{'+api.slice(start,end)+'}})()', {mode:'strip'});
 async function route({owner='owner',path='owner/final.mp4',video=true,id='job',exists=true}={}){
   let signed=0,gets=0;
   const job={id:'job',storage_provider:'r2',result_storage_path:'owner/original.mp4',result_video_id:video?'result':null};
   const db={from:table=>({select(){return this},eq(){return this},async maybeSingle(){return {data:table==='videos'?{storage_path:path,storage_provider:'r2',mime_type:'video/mp4'}:exists?{...job,result_storage_path:path}:null}}})};
   const ctx={req:{method:'GET'},resource:'production-download',url:new URL('https://api.test?mode=link&name=final.mp4&id='+id),admin:db,userData:{user:{id:owner}},String,
     json:(body,status=200)=>({body,status}),safeDownloadName:n=>n,storageSignedDownloadBucket:async(a,p,k,n,e,b)=>{signed++;assert.equal(k,path);assert.equal(b,video?'videos':'production');return 'https://media.test/final.mp4'},fetch:()=>{gets++;throw Error('no video fetch')} };
   const result=await vm.runInNewContext(code,ctx);return {result,signed,gets};
 }
 let r=await route();assert.equal(r.result.status,200);assert.equal(r.signed,1);assert.equal(r.gets,0);
 r=await route({video:false});assert.equal(r.result.status,200);
 r=await route({path:'another-user/final.mp4'});assert.equal(r.result.status,403);assert.equal(r.signed,0);
 r=await route({exists:false});assert.equal(r.result.status,404);
 r=await route({id:''});assert.equal(r.result.status,400);
 console.log('PASS production media: direct streaming/link download, no video Blob/proxy, bounded 401/timeout, cancelled modal, session isolation, double-click, visible fallback, backend owner/path checks and no media reads; SPA/JS/SW parse');
})().catch(e=>{console.error(e);process.exitCode=1});
