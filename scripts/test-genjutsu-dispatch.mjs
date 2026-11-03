import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {GENJUTSU_CONFIG,genjutsuPromptWait} from '../supabase/functions/_shared/genjutsu-stage.ts';
import {GenjutsuPromptError} from '../supabase/functions/_shared/genjutsu-gemini.ts';
import {MotionCreateError,motionDispatchFailurePatch} from '../supabase/functions/cloudent-motion-control-worker/motion-dispatch.ts';
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/cloudent-motion-control-worker/index.ts','utf8')).replace(/^import .*;\n/gm,'');
async function run(options={}){
  let handler;const creates=[],events=[];
  const row={id:'job',user_id:'owner',status:'motion_waiting',attempt_count:0,max_attempts:1,storage_provider:'r2',original_storage_path:'owner/original.mp4',frame_storage_path:'owner/upscale.png',original_file_name:'video.mp4',frame_file_name:'upscale.png',original_mime_type:'video/mp4',frame_mime_type:'image/png',meta:{workflow_key:'genjutsu',workflow_id:GENJUTSU_CONFIG.workflowId,image_pipeline_version:2,source_duration_seconds:10}};
  const admin={rpc:async(name,args)=>{
    if(name==='get_cloudent_worker_secret')return {data:'worker-secret'};
    if(name==='get_cloudent_r2_config')return {data:{access_key_id:'b2-id',secret_access_key:'b2-secret',bucket:'bucket',endpoint:'https://s3.region.backblazeb2.com'}};
    assert.equal(name,'claim_genjutsu_job');assert.equal(args.p_limit,1);events.push('claim');
    Object.assign(row,{status:'uploading',attempt_count:1,locked_by:args.p_worker});return {data:[structuredClone(row)]};
  },from(table){let key,values,update=false,filters=[];const q={select(){return q;},eq(k,v){key=v;filters.push(x=>x[k]===v);return q;},is(k,v){filters.push(x=>(x[k]??null)===v);return q;},in(k,v){if(table==='production_jobs'&&k==='status'&&v.includes('queued'))q.count=options.expired?1:0;return q;},lt(){return q;},contains(){return q;},lte(){return q;},limit(){return q;},single(){return q.maybeSingle();},upsert(){return Promise.resolve({error:null});},update(value){values=value;update=true;return q;},async maybeSingle(){
    if(table==='integrations')return {data:{enabled:true,config:{apiKeyCipher:'encrypted',apiKeyIv:'iv',concurrency:options.expired?1:2}}};
    if(table==='app_settings')return {data:{value:{enabled:true}}};
    if(table==='production_jobs'){
      if(update){if(!filters.every(f=>f(row)))return {data:null,error:null};Object.assign(row,structuredClone(values));if(values.meta?.pipeline_dispatch_intent)events.push('intent');}
      return {data:structuredClone(row),error:null};
    }
    return {data:null};
  },then(resolve){if(update){if(filters.every(f=>f(row))){Object.assign(row,structuredClone(values));if(values.meta?.pipeline_dispatch_intent)events.push('intent');}return Promise.resolve({error:null,data:[{id:row.id}]}).then(resolve);}return Promise.resolve({count:0,error:null}).then(resolve);}};
    if(table==='production_jobs')q.lte=()=>{q.count=1;return q;};
    q.then=updateThen(q.then,()=>update,()=>q.count,()=>table);
    return q;
  }};
  function updateThen(original,isUpdate,count,table){return function(resolve,reject){if(!isUpdate()&&count())return Promise.resolve({count:count(),error:null}).then(resolve,reject);return original(resolve,reject);};}
  const fetcher=async(url,init={})=>{
    if(url.endsWith('/openapi/v2/queue/status'))return Response.json({code:0,data:{concurrentLimit:2,runningCount:0,queuedCount:0,totalCurrentTasks:0}});
    if(url.endsWith('/task/openapi/create')){
      events.push('create');const body=JSON.parse(init.body);creates.push(body);
      if(options.createTimeout)throw Error('timeout');
      if(options.full)return Response.json({code:421,msg:'TASK_QUEUE_MAXED'});
      return Response.json({code:0,data:{taskId:'provider-task',taskStatus:'QUEUED'}});
    }
    if(url.endsWith('/cloudent-production-worker')){events.push('wake');return Response.json({ok:true});}
    throw Error('Unexpected request '+url);
  };
  const context=vm.createContext({Deno:{env:{get:key=>key==='GEMINI_API_KEY'?'gemini-secret':'https://supabase.test'},serve:f=>handler=f},EdgeRuntime:{waitUntil:()=>{}},createClient:()=>admin,
    Date,TextDecoder,TextEncoder,Uint8Array,atob,URL,Request,Response,AbortSignal,Error,Number,Math,Promise,crypto,console:{info(){},error(){}},fetch:fetcher,
    AwsClient:class{async sign(request){return request;}},motionStorageHealth:async()=>({allow_primary:true}),requireMotionStorage:async()=>{},MotionStorageSafetyError:class extends Error{},motionCheckObject:async()=>true,storageRPC:async()=>true,
    validateGenjutsuWorkflow:async()=>{events.push('validate');return [];},GENJUTSU_CONFIG,genjutsuPromptWait,MotionCreateError,motionDispatchFailurePatch,
    prepareGenjutsuStage:async({job,key})=>{
      assert.equal(key,'gemini-secret');assert.equal(job.frame_storage_path,'owner/upscale.png');assert.equal(job.original_storage_path,'owner/original.mp4');events.push('llm');
      job.meta.genjutsu_prompt={status:options.quota?'quota_waiting':options.uncertain?'generating':'complete',prompt:'dynamic prompt',retryAt:new Date(Date.now()+120000).toISOString()};
      if(options.quota)throw new GenjutsuPromptError('quota_waiting','quota');
      if(options.uncertain)throw new GenjutsuPromptError('generation_uncertain','uncertain');
      return !options.pending;
    },genjutsuInputs:async(video,image,job)=>({workflowId:GENJUTSU_CONFIG.workflowId,instanceType:'ultra',nodeInfoList:[{nodeId:'970',fieldName:'video',fieldValue:video},{nodeId:'496',fieldName:'image',fieldValue:image},{nodeId:'910',fieldName:'value',fieldValue:job.meta.genjutsu_prompt.prompt}]}),
    applyGenjutsuStatus:async()=>{if(options.afterAttachFailure)throw Error('poll unavailable');events.push('status');}
  });
  vm.runInContext(source,context);vm.runInContext('decrypt=async()=>"provider-secret"',context);
  const response=await handler(new Request('https://supabase.test/worker?workflow=genjutsu',{method:'POST',headers:{'x-cloudent-worker-secret':'worker-secret'}}));
  return {body:await response.json(),row,creates,events};
}
const ready=await run();assert.equal(ready.body.ok,true,JSON.stringify(ready.body));assert.equal(ready.creates.length,1,JSON.stringify({body:ready.body,row:ready.row,events:ready.events}));assert.equal(ready.creates[0].instanceType,'ultra');assert.equal(ready.creates[0].workflowId,GENJUTSU_CONFIG.workflowId);
assert.deepEqual(ready.creates[0].nodeInfoList.map(x=>[x.nodeId,x.fieldName]),[['970','video'],['496','image'],['910','value']]);assert.equal(ready.creates[0].nodeInfoList[2].fieldValue,'dynamic prompt');
assert(ready.events.indexOf('llm')<ready.events.indexOf('intent'));assert(ready.events.indexOf('intent')<ready.events.indexOf('create'));assert.equal(ready.row.runninghub_task_id,'provider-task');
for(const options of [{pending:true},{quota:true}]){const h=await run(options);assert.equal(h.creates.length,0);assert.equal(h.row.status,'motion_waiting');assert.equal(h.row.attempt_count,0);assert.equal(h.row.locked_by,null);}
const uncertain=await run({uncertain:true});assert.equal(uncertain.creates.length,0);assert.equal(uncertain.row.status,'failed');
const timeout=await run({createTimeout:true});assert.equal(timeout.creates.length,1);assert.equal(timeout.row.meta.pipeline_dispatch_uncertain,true);assert.equal(timeout.row.status,'failed');
const full=await run({full:true});assert.equal(full.row.status,'motion_waiting');assert.equal(full.row.attempt_count,0);assert.equal(full.row.meta.genjutsu_prompt.status,'complete');
const accepted=await run({afterAttachFailure:true});assert.equal(accepted.creates.length,1);assert.equal(accepted.row.runninghub_task_id,'provider-task');assert.equal(accepted.row.status,'queued');
console.log('PASS real dispatch worker: exact 970/496/910, Ultra, LLM before durable create, pending/quota, ambiguity, provider capacity and accepted-task recovery');

const expired=await run({expired:true});assert.equal(expired.body.ok,true);assert.equal(expired.creates.length,1,JSON.stringify(expired));assert.equal(expired.events.filter(x=>x==='claim').length,1);console.log('PASS expired pre-create lease resumes even when its reservation fills concurrency=1');
