import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const events=new Map(),saved=new Map();let offline=false,reads=0;
const c=vm.createContext({self:{location:{origin:'https://studio.test'},addEventListener:(k,v)=>events.set(k,v)},caches:{open:async()=>({put:async(req,res)=>saved.set(req.url,res),match:async req=>saved.get(req.url)?.clone()})},URL,Response,Headers,fetch:async(req,opts)=>{reads++;assert.equal(opts.cache,'no-store');if(offline)throw Error('offline');return new Response('fresh asset');}});
vm.runInContext(fs.readFileSync('sw.js','utf8'),c);
for(const html of ['<html><head><link rel="stylesheet" href="/production-studio.css?v=5"></head><body><script src="/image-pipeline-ui.js?v=12"></script><script src="/production-studio.js?v=5"></script><script src="/genjutsu-ui.js?v=4"></script></body></html>','<html><head></head><body><script src="/image-pipeline-ui.js?v=12"></script></body></html>']){
 const output=await (await c.injectCalendarPatch(new Response(html,{headers:{'content-type':'text/html'}}))).text();
 for(const name of ['production-studio.css?v=10','production-studio.js?v=6','genjutsu-ui.js?v=14'])assert(output.includes(name),name);
 assert(!output.includes('production-studio.css?v=5'));assert(!output.includes('production-studio.js?v=5'));
}
for(const name of ['production-studio.css?v=10','production-studio.js?v=6']){
 const request={url:'https://studio.test/'+name,method:'GET',destination:name.includes('.css')?'style':'script'};let promise;
 const event={request,respondWith:p=>promise=p};offline=false;events.get('fetch')(event);assert.equal(await (await promise).text(),'fresh asset');
 offline=true;events.get('fetch')(event);assert.equal(await (await promise).text(),'fresh asset','offline retains the last good studio asset');
}
assert.equal(reads,4);console.log('PASS old/native PWA documents use current studio assets, network-first updates and offline cached fallback');
