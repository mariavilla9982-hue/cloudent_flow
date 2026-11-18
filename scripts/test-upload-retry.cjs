const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('index.html','utf8');const code=src.slice(src.indexOf('function uploadFaceSwapPart('),src.indexOf('\nasync function uploadFaceSwapJobDirect'));
async function run(events){
 let calls=0,addresses=[];
 class XHR{constructor(){this.upload={}}open(method,url){assert.equal(method,'PUT');addresses.push(url)}setRequestHeader(){}send(){const event=events[Math.min(calls++,events.length-1)];queueMicrotask(()=>{if(typeof event==='number'){this.status=event;this.onload()}else this['on'+event]()})}}
 const c={XMLHttpRequest:XHR,setTimeout:fn=>queueMicrotask(fn),Error};vm.createContext(c);vm.runInContext(code,c);
 let error;try{await c.uploadFaceSwapPart({upload_url:'signed',content_type:'image/jpeg'},new Blob(['frame']),()=>{})}catch(e){error=e}
 return {calls,addresses,error};
}
(async()=>{
 let r=await run([500,204]);assert.equal(r.calls,2);assert(!r.error);assert.deepEqual(r.addresses,['signed','signed']);
 r=await run(['error',200]);assert.equal(r.calls,2);assert(!r.error);
 r=await run([503]);assert.equal(r.calls,3);assert(r.error);
 for(const e of [403,'abort','timeout']){r=await run([e]);assert.equal(r.calls,1);assert(r.error)}
 console.log('PASS PUT retries preserve path, recover HTTP 500/network, stop after three attempts and respect permanent errors/cancel/timeout');
})().catch(e=>{console.error(e);process.exitCode=1});
