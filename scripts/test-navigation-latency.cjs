const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const sw=fs.readFileSync('sw.js','utf8');
const fn=sw.slice(sw.indexOf('async function handleNavigation('),sw.indexOf('\nasync function staleWhileRevalidate'));
async function run({cached=true,pending=false,cachePending=false}={}){
 let fire,resolveNetwork,cacheCalls=0;const old=new Response('cached'),fresh=new Response('fresh'),waits=[];
 const network=pending?new Promise(resolve=>resolveNetwork=resolve):Promise.resolve(fresh);
 const context=vm.createContext({CACHE:'test',APP_SHELL:'/',Response,Promise,setTimeout:f=>(fire=f,1),clearTimeout(){},caches:{open:async()=>({match:async()=>cached?old:null,put:()=>{cacheCalls++;return cachePending?new Promise(()=>{}):Promise.resolve()}})},fetch:()=>network,isCacheable:r=>r.ok,injectCalendarPatch:r=>r});
 vm.runInContext(fn,context);
 const result=context.handleNavigation({request:{},preloadResponse:Promise.resolve(null),waitUntil:p=>waits.push(p)});
 for(let i=0;i<8;i++)await Promise.resolve();
 if(pending)fire();
 const response=await result;
 if(pending){resolveNetwork(fresh);await Promise.all(waits);assert.equal(cacheCalls,1,'network continues and updates cache');}
 return response.text();
}
(async()=>{
 assert.equal(await run({pending:true}),'cached');
 assert.equal(await run({}),'fresh');
 assert.equal(await run({cached:false}),'fresh');
 assert.equal(await run({cachePending:true}),'fresh','slow cache write must not block response');
 console.log('PASS cached navigation fallback, background refresh, fresh network, cold load and nonblocking cache write');
})().catch(e=>{console.error(e);process.exit(1)});
