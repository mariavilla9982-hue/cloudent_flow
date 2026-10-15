const fs=require('fs'),vm=require('vm'),a=require('assert/strict'),crypto=require('crypto').webcrypto,{stripTypeScriptTypes}=require('node:module');
const root=process.env.PROTECTION_SOURCE_ROOT||'protection-fix';
const paths={'api.ts':'supabase/functions/cloudent-motion-control/index.ts','motion.ts':'supabase/functions/cloudent-motion-control-worker/index.ts','production.ts':'supabase/functions/cloudent-production-worker/index.ts','sync.ts':'supabase/functions/cloudent-motion-status-worker/index.ts','motion-storage-protection.ts':'supabase/functions/cloudent-motion-control/motion-storage-protection.ts'};
const read=n=>fs.readFileSync(fs.existsSync(root+'/'+n)?root+'/'+n:(paths[n]||n),'utf8');
const strip=s=>stripTypeScriptTypes(s).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const helper=strip(read('motion-storage-protection.ts'));
function helperContext(state){const calls=[];const admin={rpc:async(name,args)=>{calls.push({name,args});if(name==='motion_storage_claim_probe')return {data:state};throw Error('unexpected RPC '+name)}};const c=vm.createContext({crypto,fetch(){throw Error('Unexpected provider read')},Error,Date});vm.runInContext(helper,c);return {c,admin,calls};}
async function workerBlocked(){
 let handler,creates=0,claims=0;
 const admin={rpc:async name=>{if(name==='get_cloudent_worker_secret')return {data:'test-secret'};claims++;throw Error('Unexpected claim '+name)},from(table){const q={select(){return q},eq(_,key){q.key=key;return q},async maybeSingle(){return {data:table==='integrations'?{enabled:true,config:{apiKeyCipher:'dummy',apiKeyIv:'dummy',workflowId:'standard',videoNodeId:'336',frameNodeId:'338',concurrency:5}}:{value:q.key==='motion_control_workflow'?{workflowId:'2110721194974982146',videoNodeId:'275',frameNodeId:'299'}:{enabled:true}}}},async upsert(){return {error:null}}};return q}};
 const c=vm.createContext({Deno:{env:{get:()=>''},serve:f=>handler=f},createClient:()=>admin,crypto,Date,TextDecoder,Uint8Array,atob,Request,Response,Error,Number,Math,Promise,motionStorageHealth:async()=>({phase:'blocked',allow_primary:false}),fetch:async()=>{creates++;throw Error('Unexpected generation request')}});
 vm.runInContext(strip(read('motion.ts')),c);vm.runInContext('decrypt=async()=>"test-api-key"',c);
 const r=await handler(new Request('https://test/worker',{method:'POST',headers:{'x-cloudent-worker-secret':'test-secret'},body:'{}'}));const result=await r.json();
 a.equal(result.storage_paused,true);a.equal(claims,0);a.equal(creates,0);
}
async function saveToReserve(){
 const raw=read('production.ts'),source=strip(raw.slice(raw.indexOf('async function saveResult'),raw.indexOf('    function pickFaceSwapOutput')));
 const bytes=new Uint8Array(32);bytes.set(Buffer.from('ftyp'),4);const blob=new Blob([bytes]);const events=[];let saved;
 const admin={storage:{from(){return {upload:async()=>{events.push('store-reserve');return {error:null}},remove:async()=>({})}}},from(table){const q={upsert(){return q},insert(){return q},select(){return q},eq(){return q},async single(){return {data:{id:'j'}}},update(v){saved=v;return q},then(resolve,reject){return Promise.resolve({error:null}).then(resolve,reject)}};return q}};
 const c=vm.createContext({admin,Blob,Date,Number,Math,Array,Uint8Array,crypto,Error,concurrency:2,extFrom:()=> 'mp4',mimeFor:()=> 'video/mp4',isMotionStatusJob:j=>j.meta?.workflow_key==='motion_control',isMotionPreviewJob:j=>j.meta?.workflow_key==='motion_control',motionStorageHealth:async()=>({allow_primary:false}),reserveMotionStorage:async()=>events.push('reserve-capacity'),commitMotionStorage:async()=>events.push('commit-capacity'),cancelMotionAfterSave:async()=>events.push('cancel-after-verification'),rhJson(){},MotionStorageSafetyError:class extends Error{},fetch(){throw Error('No primary read allowed')}});
 vm.runInContext(source,c);await c.saveResult({id:'j',user_id:'owner',storage_provider:'r2',meta:{workflow_key:'motion_control'}},{fileType:'mp4'},null,blob);
 a.equal(saved.meta.result_storage_provider,'supabase');a.equal(saved.meta.storage_reserve_result,true);a.equal(saved.result_video_id,'j');a.equal(saved.meta.result_node_id,'384');a.match(saved.meta.motion_preview_source_sha256,/^[a-f0-9]{64}$/);
 a(events.indexOf('reserve-capacity')<events.indexOf('store-reserve'));a(events.indexOf('commit-capacity')<events.indexOf('cancel-after-verification'));
}
function fakeCache(){const data=new Map();return {data,async match(k){return data.get(typeof k==='string'?k:k.url)?.clone()},async put(k,r){data.set(k,r.clone())},async keys(){return [...data.keys()].map(url=>({url}))},async delete(k){return data.delete(typeof k==='string'?k:k.url)}};}
async function thumbnailCache(){
 const cache=fakeCache();let requests=0;
 const caches={open:async()=>cache,delete:async()=>{cache.data.clear()}};
 function context(){const c=vm.createContext({window:{CloudentMotionControl:{mode:'motion_control'}},cloudSession:{access_token:'test',user:{id:'owner'}},SUPABASE_KEY:'public-key',productionData:{jobs:[{id:'j',meta:{workflow_key:'motion_control',original_thumbnail_path:'owner/path/thumb.jpg'}}]},currentPage:'overview',loadProductionThumb:async()=>{},document:{getElementById:()=>null},crypto,TextEncoder,URL,location:{origin:'https://app.test'},Blob,Response,Date,Map,caches,setInterval(){},esc:String,fetch:async()=>{requests++;return new Response(new Blob(['thumbnail'],{type:'image/jpeg'}))}});vm.runInContext('async function signOutCloud(){cloudSession=null}',c);vm.runInContext(read('motion-storage-ui.js'),c);return c;}
 const element=()=>({dataset:{productionThumbId:'j',productionThumbKind:'video-thumb'},isConnected:true,querySelector:()=>null});
 let c=context();await Promise.all([c.loadProductionThumb(element()),c.loadProductionThumb(element())]);a.equal(requests,1);a.equal(cache.data.size,1);
 await c.loadProductionThumb(element());a.equal(requests,1);
 c=context();await c.loadProductionThumb(element());a.equal(requests,1,'cache did not survive reload');
 c.productionData.jobs[0].meta.original_thumbnail_path='owner/new/thumb.jpg';await c.loadProductionThumb(element());a.equal(requests,2,'source path should invalidate thumbnail');
 await c.signOutCloud();a.equal(cache.data.size,0);a.equal(c.cloudSession,null);
}
(async()=>{
 for(const n of ['api.ts','motion.ts','production.ts','sync.ts','motion-storage-protection.ts'])new vm.Script(strip(read(n)));
 let {c,admin}=helperContext({phase:'blocked',should_probe:false,allow_primary:false});a.equal((await c.motionStorageHealth(admin)).allow_primary,false);await a.rejects(c.requireMotionStorage(admin));
 ({c,admin}=helperContext({phase:'healthy',should_probe:false,allow_primary:true}));a.equal((await c.requireMotionStorage(admin)).allow_primary,true);
 await workerBlocked();await saveToReserve();await thumbnailCache();
 console.log('PASS: all sources parse; blocked worker makes no claims/generations; reserve chosen before save/cancel; #384/hash preserved; persistent/coalesced thumbnail cache, path invalidation and logout clearing');
})().catch(e=>{console.error(e);process.exitCode=1});
