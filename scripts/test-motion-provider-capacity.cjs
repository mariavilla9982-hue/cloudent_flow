const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const raw=fs.readFileSync(process.env.MOTION_SOURCE||'supabase/functions/cloudent-motion-control-worker/index.ts','utf8');
const source=stripTypeScriptTypes(raw).replace(/^import .*;\n/gm,'');
async function run(capacity,options={}){
 let handler;const claims=[],fetches=[],writes=[];
 const admin={rpc:async(name,args)=>{if(name==='get_cloudent_worker_secret')return {data:'test'};assert.equal(name,'claim_motion_control_jobs');claims.push(args);return {data:[]}},from(table){let key;
  const q={select(){return q},eq(_,v){key=v;return q},in(){q.count=table==='production_jobs'?(options.localActive||0):0;return q},contains(){return q},lte(){q.count=options.waiting??2;return q},limit(){return q},async maybeSingle(){return {data:table==='integrations'?{enabled:true,config:{apiKeyCipher:'test',apiKeyIv:'test',concurrency:3}}:{value:key==='motion_control_workflow'?{workflowId:'2110721194974982146',videoNodeId:'275',videoFieldName:'video',frameNodeId:'299',frameFieldName:'image',outputNodeId:'285',executionInstanceType:'plus'}:{enabled:true}}}},async upsert(value){writes.push({table,value});return {error:null}},then(ok,bad){return Promise.resolve({count:q.count||0,error:null}).then(ok,bad)}};return q}};
 const context=vm.createContext({Deno:{env:{get:()=>''},serve:f=>handler=f},createClient:()=>admin,Date,TextDecoder,TextEncoder,Uint8Array,atob,Request,Response,AbortSignal,Error,Number,Math,Promise,crypto:require('crypto').webcrypto,motionStorageHealth:async()=>({allow_primary:options.storage!==false}),fetch:async(url)=>{
  fetches.push(url);
  if(url.endsWith('/openapi/v2/queue/status')){if(capacity instanceof Error)throw capacity;return new Response(JSON.stringify(capacity),{status:options.http||200});}
  assert(url.endsWith('/api/openapi/getJsonApiFormat'),'unexpected media or create request');
  return new Response(JSON.stringify({code:0,data:{'275':{class_type:'VHS_LoadVideo',inputs:{video:''}},'299':{class_type:'LoadImage',inputs:{image:''}},'285':{class_type:'VHS_VideoCombine'},'384':{class_type:'SaveVideo'}}}));
 }});
 vm.runInContext(source,context);vm.runInContext('decrypt=async()=>"key"',context);
 const res=await handler(new Request('https://test/worker',{method:'POST',headers:{'x-cloudent-worker-secret':'test'}}));
 return {body:await res.json(),claims,fetches,writes};
}
const cap=(running,queued=0,limit=2)=>({code:0,data:{concurrentLimit:limit,runningCount:String(running),queuedCount:String(queued),totalCurrentTasks:String(running+queued)}});
(async()=>{
 const full=await run(cap(2));assert.equal(full.body.provider_queue_waiting,true);assert.equal(full.claims.length,0);assert.equal(full.fetches.length,1);
 const freed=await run(cap(1));assert.equal(freed.claims.length,1);assert.equal(freed.claims[0].p_limit,1);assert.equal(freed.fetches.length,2);
 const queued=await run(cap(1,1));assert.equal(queued.claims.length,0);
 const empty=await run(cap(0));assert.equal(empty.claims[0].p_limit,2);
 const local=await run(cap(0),{localActive:2});assert.equal(local.claims[0].p_limit,1);
 for(const invalid of [new Error('network'),{code:1},cap(-1),{code:0,data:{}},{code:0,data:{concurrentLimit:2,runningCount:null,queuedCount:0,totalCurrentTasks:0}}, {code:0,data:{concurrentLimit:2,runningCount:2,queuedCount:0,totalCurrentTasks:1}}]){const r=await run(invalid);assert.equal(r.body.provider_capacity_unknown,true);assert.equal(r.claims.length,0);assert.equal(r.fetches.length,1);}
 const noWaiting=await run(cap(2),{waiting:0});assert.equal(noWaiting.fetches.length,0);
 const storage=await run(cap(0),{storage:false});assert.equal(storage.body.storage_paused,true);assert.equal(storage.fetches.length,0);assert.equal(storage.claims.length,0);
 console.log('PASS: real account full blocks claim/media/create; freed slot limits claim; queued and local reservations count; malformed/unavailable capacity preserves jobs; storage and idle guards preserved.');
})().catch(e=>{console.error(e);process.exit(1)});
