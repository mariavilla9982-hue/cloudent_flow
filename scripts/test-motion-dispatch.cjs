const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const paths={'motion-dispatch.ts':'supabase/functions/cloudent-motion-control-worker/motion-dispatch.ts','motion-worker.ts':'supabase/functions/cloudent-motion-control-worker/index.ts','motion-failure-repair.ts':'supabase/functions/_shared/motion-failure-repair.ts'};
const read=n=>fs.readFileSync(process.env.MOTION_FIX_ROOT?process.env.MOTION_FIX_ROOT+'/'+(n==='motion-failure-repair.ts'?'failure-repair-final.ts':n):paths[n],'utf8');
const compile=s=>stripTypeScriptTypes(s.replace(/^import .*$/mg,'').replace(/export /g,''),{mode:'transform'});
const ctx={console,Date,Error,crypto:globalThis.crypto,setTimeout,clearTimeout,TextEncoder,TextDecoder,Uint8Array,Request,Response,Blob,File,FormData,AbortSignal,fetch:()=>{throw Error('real fetch forbidden')}};
vm.createContext(ctx);vm.runInContext(compile(read('motion-dispatch.ts'))+';globalThis.MCE=MotionCreateError;globalThis.patch=motionDispatchFailurePatch',ctx);
const job={attempt_count:1,meta:{workflow_key:'motion_control',pipeline_dispatch_intent:'intent',pipeline_dispatch_uncertain:true}};
for(const payload of [{code:421,msg:'TASK_QUEUE_MAXED'},{code:814,msg:'PERSONAL_QUEUE_COUNT_LIMIT'}]){
 const p=ctx.patch(job,new ctx.MCE(payload),null,new Date('2026-10-24T10:00:00Z'));
 assert.equal(p.status,'motion_waiting');assert.equal(p.attempt_count,0);assert.equal(p.meta.pipeline_dispatch_intent,null);assert.equal(p.started_at,null);
}
for(const err of [new Error('network timeout'),new ctx.MCE({code:500,msg:'unknown'}),new ctx.MCE({code:0,data:{}})]){
 const p=ctx.patch(job,err);assert.equal(p.status,'failed');assert.equal(p.meta.pipeline_dispatch_intent,'intent');assert.equal(p.meta.pipeline_dispatch_uncertain,true);
}
assert.equal(ctx.patch(job,new ctx.MCE({code:421,data:{taskId:'known'}})).status,'failed');
assert.equal(ctx.patch(job,new Error('save error'),'known').runninghub_task_id,'known');
assert.equal(ctx.patch(job,new ctx.MCE({code:433,msg:'validation'})).meta.pipeline_dispatch_uncertain,false);
vm.runInContext(compile(read('motion-failure-repair.ts'))+';globalThis.extract=extractMotionFailure',ctx);
assert.match(ctx.extract({code:805,data:{failedReason:{node_id:'367',exception_type:'torch.OutOfMemoryError',exception_message:'CUDA out of memory'}}}).message,/VRAM.*367/);
assert.equal(ctx.extract({code:804,data:{}}),null);
assert(!ctx.extract({code:805,failedReason:{exception_message:'token=secret https://example.com/private'}}).message.includes('secret'));

async function workerScenario(kind){
 const state={creates:0,updates:[],row:{id:'job',user_id:'owner',status:'uploading',attempt_count:1,max_attempts:1,storage_provider:'supabase',original_storage_path:'v',frame_storage_path:'f',original_file_name:'v.mp4',frame_file_name:'f.png',meta:{workflow_key:'motion_control',image_pipeline_version:2}}};
 const admin={from(table){let update=null,filter=[],single=false,selection='';const b={
  select(s){selection=s;return b},update(v){update=v;return b},upsert(){return b},eq(k,v){filter.push([k,v]);return b},is(k,v){filter.push([k,v]);return b},in(){return b},contains(){return b},lte(){return b},lt(){return b},not(){return b},limit(){return b},order(){return b},maybeSingle(){single=true;return b},single(){single=true;return b},
  then(resolve,reject){try{
   if(table==='integrations')return Promise.resolve({data:{enabled:true,config:{concurrency:2,apiKeyCipher:'c',apiKeyIv:'i'}}}).then(resolve,reject);
   if(table==='app_settings'){const k=filter.find(x=>x[0]==='key')?.[1];return Promise.resolve({data:{value:k==='motion_control_workflow'?{workflowId:'2110721194974982146',videoNodeId:'275',frameNodeId:'299',outputNodeId:'285',videoFieldName:'video',frameFieldName:'image',executionInstanceType:'plus'}:{enabled:true}}}).then(resolve,reject);}
   if(table==='production_jobs'&&update){
    if(update.runninghub_task_id&&kind==='attach-once'&&!state.attachFailed){state.attachFailed=true;return Promise.resolve({error:new Error('save once')}).then(resolve,reject);}
    const matches=filter.every(([k,v])=>v===null?state.row[k]==null:state.row[k]===v);
    if(matches){Object.assign(state.row,update);state.updates.push(update)}
    return Promise.resolve({data:selection?(single?(matches?{id:'job'}:null):(matches?[{id:'job'}]:[])):null,error:null}).then(resolve,reject);
   }
   if(table==='production_jobs'&&single)return Promise.resolve({data:{...state.row},error:null}).then(resolve,reject);
   return Promise.resolve({data:[],count:table==='production_jobs'&&filter.some(x=>x[0]==='status'&&x[1]==='motion_waiting')?1:0,error:null}).then(resolve,reject);
  }catch(e){return Promise.reject(e).then(resolve,reject)}}
 };return b},rpc:async(name,args)=>{
  if(name==='get_cloudent_worker_secret')return {data:'master'};
  if(name==='claim_motion_control_jobs'){state.row.locked_by=args.p_worker;return {data:[structuredClone(state.row)]};}
  return {data:null,error:null};
 },storage:{from:()=>({download:async()=>({data:new Blob(['bytes']),error:null})})}};
 const c={...ctx,createClient:()=>admin,MotionStorageSafetyError:class extends Error{},motionStorageHealth:async()=>({allow_primary:true}),requireMotionStorage:async()=>{},motionCheckObject:async()=>true,storageRPC:async()=>true,
  applyMotionProviderStatus:async()=>{if(kind==='poll-error')throw Error('poll failed')},EdgeRuntime:{waitUntil:()=>{}},Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.supabase.co':'service'},serve:f=>c.handler=f},
  fetch:async(url,opt={})=>{
   if(url.endsWith('/queue/status'))return Response.json({code:0,data:{concurrentLimit:2,runningCount:0,queuedCount:0,totalCurrentTasks:0}});
   if(url.endsWith('/getJsonApiFormat'))return Response.json({code:0,data:{'275':{class_type:'VHS_LoadVideo',inputs:{video:''}},'299':{class_type:'LoadImage',inputs:{image:''}},'285':{class_type:'VHS_VideoCombine',inputs:{}},'384':{class_type:'SaveVideo',inputs:{}}}});
   if(url.endsWith('/upload'))return Response.json({code:0,data:{fileName:'file'}});
   if(url.endsWith('/create')){state.creates++;if(kind==='timeout')throw Error('timeout');return Response.json(kind==='queue'?{code:421,msg:'TASK_QUEUE_MAXED'}:{code:0,data:{taskId:'task-known',taskStatus:'QUEUED'}});}
   return Response.json({code:0});
  }};
 vm.createContext(c);
 vm.runInContext(compile(read('motion-dispatch.ts'))+'\n'+compile(read('motion-worker.ts'))+'\ndecrypt=async()=>"key";',c);
 const response=await c.handler(new Request('https://example.test',{method:'POST',headers:{'x-cloudent-worker-secret':'master'}}));
 assert.equal(response.status,200,await response.text());assert.equal(state.creates,1);
 if(kind==='queue'){assert.equal(state.row.status,'motion_waiting');assert.equal(state.row.attempt_count,0);assert.equal(state.row.meta.pipeline_dispatch_uncertain,false);}
 if(kind==='timeout'){assert.equal(state.row.status,'failed');assert.equal(state.row.meta.pipeline_dispatch_uncertain,true);}
 if(kind==='poll-error'||kind==='attach-once'){assert.equal(state.row.runninghub_task_id,'task-known');assert.equal(state.row.status,'queued');assert.equal(state.row.last_error,null);}
}
(async()=>{for(const kind of ['queue','timeout','poll-error','attach-once'])await workerScenario(kind);console.log('PASS dispatch: explicit queue rejection, ambiguous response, known receipt, attach retry and poll error; failure details and redaction');})().catch(e=>{console.error(e);process.exit(1)});
