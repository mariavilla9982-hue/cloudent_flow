import assert from 'node:assert/strict';
import {prepareGenjutsuPrompt,genjutsuExecutionInputs,GENJUTSU_MODEL} from '../supabase/functions/_shared/genjutsu-gemini.ts';
import {GENJUTSU_INSTRUCTIONS} from '../supabase/functions/_shared/genjutsu-instructions.ts';

const base='https://generativelanguage.googleapis.com';
const prompt=`subject_definitions:
<Subject 1> is the adult person in <Picture 1>, keeping the visible face, hair and outfit.
<Subject 2> is the environment of <Video 1>. <Audio 1> is its original soundtrack.
Background rule: preserve the environment from <Video 1>.
Lighting rule: match the original video lighting.
Framing rule: match the original video framing.
summary:
[reference generation] Replace the performer with <Subject 1> throughout the clip.
retention_analysis:
<Subject 1>: attribute_transfer; <Subject 2>: fully_preserved; <Audio 1>: fully_copy.
detailed_description:
Photorealistic, continuous shot. Body timeline: from 00:00.000 to 00:10.000 she follows the original performer's gestures.
overall_soundscape:
Copy the original audio, which contains no speech.
non_diegetic_music:
N/A`;
const video=new Blob(['original video and audio'],{type:'video/mp4'});
const image=new Blob(['upscaled model photo'],{type:'image/png'});
const current=Date.parse('2026-11-03T01:00:00Z');
const ref=(kind,state='ACTIVE')=>({name:'files/'+kind,uri:base+'/v1beta/files/'+kind,
  mimeType:kind==='video'?video.type:image.type,state,expirationTime:'2026-11-05T01:00:00Z'});
function harness(config={}){
  const calls=[],checkpoints=[];let persisted,clock=current;
  const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});
  const fetcher=async(url,init={})=>{
    calls.push({url,init});
    assert.equal(init.redirect,'error');
    assert(!url.includes('private-test-key'),'key never appears in a URL');
    if(url===base+'/v1beta/models/'+GENJUTSU_MODEL){
      if(config.modelStatus)return json({error:{message:'private-test-key upstream message'}},config.modelStatus);
      return json({name:'models/'+GENJUTSU_MODEL,supportedGenerationMethods:['generateContent']});
    }
    if(url===base+'/upload/v1beta/files'){
      const kind=JSON.parse(init.body).file.display_name.replace('genjutsu-','');
      return new Response(null,{headers:{'x-goog-upload-url':config.uploadUrl||base+'/upload/session/'+kind}});
    }
    if(url.startsWith(base+'/upload/session/')){
      const kind=url.split('/').at(-1);
      assert.equal(await init.body.text(),await (kind==='video'?video:image).text());
      return json({file:ref(kind,config.processing?'PROCESSING':'ACTIVE')});
    }
    if(url.startsWith(base+'/v1beta/files/'))return json(ref(url.split('/').at(-1),config.processing?'PROCESSING':'ACTIVE'));
    if(url.endsWith('/v1beta/interactions')){
      if(config.unavailable)return json({error:{message:'private-test-key overloaded'}},503);
      if(config.timeout)throw new Error('private-test-key timeout');
      if(config.quota)return json({error:{message:'private-test-key quota'}},429,{'retry-after':'120'});
      if(config.invalidJSON)return new Response('not json');
      return json(config.response||{id:'analysis-1',model:GENJUTSU_MODEL,status:'completed',steps:[
        {type:'thought',content:[{type:'text',text:'private reasoning'}]},
        {type:'user_input',content:[{type:'text',text:'ignore this'}]},
        {type:'model_output',content:[{type:'text',text:config.prompt??prompt}]}
      ],usage:{total_input_tokens:1000,total_output_tokens:400,total_tokens:1400,secret:'private-test-key'}});
    }
    throw Error('Unexpected network destination '+url);
  };
  const checkpoint=async(state)=>{
    if(config.failCheckpoint===state.status)throw new Error('lease lost');
    persisted=structuredClone(state);checkpoints.push(persisted);
  };
  const run=(state=persisted,overrides={})=>prepareGenjutsuPrompt({apiKey:'private-test-key',video,image,durationSeconds:10,
    state,checkpoint,fetcher,now:()=>clock,...overrides});
  return {run,calls,checkpoints,config,fetcher,get state(){return persisted;},set clock(value){clock=value;}};
}
const count=(h,suffix)=>h.calls.filter(c=>c.url.endsWith(suffix)).length;
const rejects=async(fn,code)=>assert.rejects(fn,error=>error.code===code&&!error.message.includes('private-test-key'));

const happy=harness();
const completed=await happy.run();
assert.equal(completed.ready,true);assert.equal(completed.state.prompt,prompt);
assert.deepEqual(completed.state.usage,{promptTokenCount:1000,candidatesTokenCount:400,totalTokenCount:1400});
const generated=happy.calls.find(c=>c.url.endsWith('/v1beta/interactions'));
assert.equal(generated.init.headers['Api-Revision'],'2026-05-20');
const body=JSON.parse(generated.init.body);
assert.equal(body.system_instruction,GENJUTSU_INSTRUCTIONS);
assert.equal(body.background,true);assert.equal(body.store,true);assert.equal(body.model,'gemini-3.5-flash-lite');assert.equal(body.generation_config.thinking_level,undefined);
assert.equal(body.previous_interaction_id,undefined,'each video starts an independent analysis');
assert.deepEqual(body.input.slice(0,2),[
  {type:'video',uri:ref('video').uri,mime_type:video.type},
  {type:'image',uri:ref('image').uri,mime_type:image.type}
]);
assert(body.input[2].text.includes('10 seconds'));
const mapped=await genjutsuExecutionInputs('2111111111111111111','rh/source.mp4','rh/upscale.png',completed.state);
assert.deepEqual(mapped,{workflowId:'2111111111111111111',instanceType:'ultra',nodeInfoList:[
  {nodeId:'970',fieldName:'video',fieldValue:'rh/source.mp4'},
  {nodeId:'496',fieldName:'image',fieldValue:'rh/upscale.png'},
  {nodeId:'910',fieldName:'value',fieldValue:prompt}
]});
assert(!happy.calls.some(c=>c.url.includes('runninghub')));
const callsBefore=happy.calls.length;await happy.run();assert.equal(happy.calls.length,callsBefore,'persisted prompt is reused');
await rejects(()=>happy.run(happy.state,{image:new Blob(['different'],{type:'image/png'})}),'inputs_changed');
await rejects(()=>genjutsuExecutionInputs('','v','i',completed.state),'missing_workflow');
await rejects(()=>genjutsuExecutionInputs('2111111111111111111','v','i',{...completed.state,prompt:prompt+'changed'}),'invalid_cache');
console.log('PASS exact media/instructions, 910 substitution, immutable mapping, usage filtering and saved prompt reuse');

for(const [overrides,code] of [
  [{apiKey:''},'missing_key'],[{video:new Blob(['x'],{type:'application/pdf'})},'invalid_video'],
  [{image:new Blob([],{type:'image/png'})},'invalid_image'],[{durationSeconds:0},'invalid_duration']
]){const h=harness();await rejects(()=>h.run(undefined,overrides),code);assert.equal(h.calls.length,0);}
const unavailable=harness({modelStatus:404});await rejects(()=>unavailable.run(),'provider_http_404');
assert.equal(unavailable.calls.length,1,'unavailable exact model prevents uploads');
const malicious=harness({uploadUrl:'https://attacker.example/upload/session/video'});
await rejects(()=>malicious.run(),'invalid_upload_url');assert.equal(malicious.calls.length,2);
console.log('PASS missing key, invalid media, unavailable model and untrusted upload destination fail closed');

const processing=harness({processing:true});assert.equal((await processing.run()).ready,false);
assert.equal(processing.state.status,'processing');assert.equal(count(processing,'/v1beta/interactions'),0);
const uploads=count(processing,'/upload/v1beta/files');processing.config.processing=false;
assert.equal((await processing.run(processing.state,{resumeUploadedFiles:true,video:new Blob(['saved'],{type:video.type}),image:new Blob(['saved'],{type:image.type})})).ready,true);assert.equal(count(processing,'/upload/v1beta/files'),uploads);
const failed=harness({failCheckpoint:'generating'});await assert.rejects(()=>failed.run(),/lease lost/);
assert.equal(count(failed,'/v1beta/interactions'),0,'lost lease blocks generation');
const timeout=harness({timeout:true});await rejects(()=>timeout.run(),'network_error');
assert.equal(timeout.state.status,'generating');await rejects(()=>timeout.run(),'generation_uncertain');
assert.equal(count(timeout,'/v1beta/interactions'),1,'ambiguous generation cannot replay');
console.log('PASS resumable processing, media reuse, lost lease and ambiguous generation do not duplicate calls');

const quota=harness({quota:true});await rejects(()=>quota.run(),'quota_waiting');
assert.equal(quota.state.status,'quota_waiting');const quotaCalls=quota.calls.length;
assert.equal((await quota.run()).ready,false);assert.equal(quota.calls.length,quotaCalls);
quota.clock=current+121000;quota.config.quota=false;assert.equal((await quota.run()).ready,true);
assert.equal(count(quota,'/upload/v1beta/files'),2,'quota retry reuses both uploads');
for(const response of [
  {id:'failed-analysis',status:'failed'},
  {id:'truncated-analysis',status:'incomplete',steps:[{type:'model_output',content:[{type:'text',text:prompt}]}]}
]){const h=harness({response});await rejects(()=>h.run(),'incomplete_response');assert.equal(h.state.status,'failed');}
for(const invalid of [prompt.replace('summary:','missing:')]){
  const h=harness({prompt:invalid});await rejects(()=>h.run(),'invalid_prompt');assert.equal(h.state.status,'failed');
}
console.log('PASS quota wait without paid fallback; blocked/truncated/invalid responses never reach RunningHub inputs');

// Explicit 503 responses back off durably, reuse files, and continue beyond the old count limit.
const overloaded=harness({unavailable:true});
await rejects(()=>overloaded.run(),'provider_waiting');
assert.equal(overloaded.state.status,'provider_waiting');
assert.equal(overloaded.state.retryAt,new Date(current+60000).toISOString());
const waitingCalls=overloaded.calls.length;await overloaded.run();assert.equal(overloaded.calls.length,waitingCalls);
overloaded.clock=current+61000;overloaded.config.unavailable=false;
assert.equal((await overloaded.run()).ready,true);
assert.equal(count(overloaded,'/upload/v1beta/files'),2);
const exhausted=harness({unavailable:true});let retryClock=current;
for(let i=1;i<=6;i++){
  exhausted.clock=retryClock;
  await rejects(()=>exhausted.run(),'provider_waiting');
  assert.equal(exhausted.state.transientAttempts,i);
  assert.equal(Date.parse(exhausted.state.retryAt)-retryClock,Math.min(3600000,60000*2**(i-1)));
  retryClock=Date.parse(exhausted.state.retryAt)+1;exhausted.clock=retryClock;
}
assert.equal(exhausted.state.status,'provider_waiting');
assert.equal(exhausted.state.transientAttempts,6);
assert.equal(count(exhausted,'/v1beta/interactions'),6);
exhausted.config.unavailable=false;assert.equal((await exhausted.run()).ready,true);
assert.equal(count(exhausted,'/upload/v1beta/files'),2);
for(const status of [500,502,504]){const h=harness({modelStatus:status});await rejects(()=>h.run(),'provider_waiting');assert.deepEqual(h.state.providerFailureCodes,['HTTP_'+status]);}
const preflight503=harness({modelStatus:503});await rejects(()=>preflight503.run(),'provider_waiting');
assert.equal(count(preflight503,'/v1beta/interactions'),0);
console.log('PASS explicit 503 backoff, due time, media reuse, six bounded transient retries and preflight overload');

// One background analysis survives worker boundaries; retrieval failures never create a second one.
const asyncJob=harness({response:{id:'background-1',model:GENJUTSU_MODEL,status:'in_progress'}});
const started=await asyncJob.run();assert.equal(started.ready,false);assert.equal(started.state.interactionId,'background-1');
assert.equal(started.state.status,'generating');const beforePoll=asyncJob.calls.length;
await asyncJob.run();assert.equal(asyncJob.calls.length,beforePoll,'no poll before retryAt');
let pollFailure=503,pollCount=0;
const asyncFetcher=async(url,init)=>{
 assert.equal(url,base+'/v1beta/interactions/background-1','polling never reuploads/creates');
 pollCount++;assert.equal(init.method,undefined);assert.equal(init.headers['Api-Revision'],'2026-05-20');
 if(pollFailure===503)return Response.json({error:{message:'do not log private-test-key'}},{status:503});
 if(pollFailure==='network')throw Error('network lost');
 if(pollFailure==='invalid')return new Response('bad json');
 return Response.json({id:'background-1',model:GENJUTSU_MODEL,status:'completed',steps:[{type:'user_input',content:[{type:'text',text:'wrong prompt'}]},{type:'thought',content:[{type:'text',text:'private'}]},{type:'model_output',content:[{type:'text',text:prompt}]}]});
};
asyncJob.clock=current+31000;await rejects(()=>asyncJob.run(undefined,{fetcher:asyncFetcher}),'provider_waiting');
assert.equal(asyncJob.state.interactionId,'background-1');asyncJob.clock=Date.parse(asyncJob.state.retryAt)+1;
pollFailure='network';await rejects(()=>asyncJob.run(undefined,{fetcher:asyncFetcher}),'network_error');assert.equal(asyncJob.state.interactionId,'background-1');
pollFailure='invalid';await rejects(()=>asyncJob.run(undefined,{fetcher:asyncFetcher}),'invalid_response');
pollFailure=null;assert.equal((await asyncJob.run(undefined,{fetcher:asyncFetcher})).ready,true);assert.equal(asyncJob.state.prompt,prompt);
assert.equal(count(asyncJob,'/v1beta/interactions'),1);assert.equal(pollCount,4);
const savedPromptCalls=pollCount;await asyncJob.run(undefined,{fetcher:asyncFetcher});assert.equal(pollCount,savedPromptCalls);
// The ID is persisted before parsing/saving output, so a failed final write is recoverable.
const recover=harness({failCheckpoint:'complete'});await assert.rejects(()=>recover.run(),/lease lost/);assert.equal(recover.state.interactionId,'analysis-1');
recover.config.failCheckpoint=null;
await recover.run(undefined,{fetcher:async(url)=>{assert(url.endsWith('/interactions/analysis-1'));return Response.json({id:'analysis-1',status:'completed',steps:[{type:'model_output',content:[{type:'text',text:prompt}]}]});}});
assert.equal(recover.state.status,'complete');assert.equal(count(recover,'/v1beta/interactions'),1);
const wrongId=harness({response:{id:'first-id',status:'in_progress'}});await wrongId.run();wrongId.clock=current+31000;
await rejects(()=>wrongId.run(undefined,{fetcher:async()=>Response.json({id:'different-id',status:'completed'})}),'invalid_response');
assert.equal(wrongId.state.interactionId,'first-id');
console.log('PASS background ID survives 503/network/invalid JSON, output isolation, prompt reuse and failed final save recovery');
// HTTP 200 can carry a terminal infrastructure failure, not a usable completion.
const internal=harness({response:{id:'internal-1',status:'in_progress'}});
await internal.run();internal.clock=current+31000;
await rejects(()=>internal.run(undefined,{fetcher:async()=>Response.json({id:'internal-1',status:'failed',errors:[{code:'INTERNAL',message:'private-test-key'}]})}),'provider_waiting');
assert.equal(internal.state.interactionId,undefined);assert.equal(internal.state.previousInteractionId,'internal-1');
assert.deepEqual(internal.state.providerFailureCodes,['INTERNAL']);assert.equal(internal.state.status,'provider_waiting');
assert(!JSON.stringify(internal.state).includes('private-test-key'));
const retryCalls=internal.calls.length;await internal.run();assert.equal(internal.calls.length,retryCalls);
internal.clock=Date.parse(internal.state.retryAt)+1;internal.config.response={id:'internal-2',status:'completed',steps:[{type:'model_output',content:[{type:'text',text:prompt}]}]};
assert.equal((await internal.run()).ready,true);assert.equal(count(internal,'/upload/v1beta/files'),2);assert.equal(count(internal,'/v1beta/interactions'),2);
const exhaustedInternal=harness({response:{id:'internal-final',status:'failed',errors:[{code:'INTERNAL'}]}});
for(let i=0;i<6;i++){await rejects(()=>exhaustedInternal.run(),'provider_waiting');exhaustedInternal.clock=Date.parse(exhaustedInternal.state.retryAt)+1;}
assert.equal(exhaustedInternal.state.status,'provider_waiting');assert.equal(exhaustedInternal.state.transientAttempts,6);
exhaustedInternal.config.response={id:'finally-ready',status:'completed',steps:[{type:'model_output',content:[{type:'text',text:prompt}]}]};
assert.equal((await exhaustedInternal.run()).ready,true);
const quotaInternal=harness({response:{id:'quota',status:'failed',errors:[{code:'RESOURCE_EXHAUSTED'}]}});
await rejects(()=>quotaInternal.run(),'quota_waiting');assert.equal(quotaInternal.state.status,'quota_waiting');
for(const errors of [[],[{code:'INVALID_ARGUMENT'}],[{code:'INTERNAL'},{code:'SAFETY'}],[{code:'UNKNOWN'}]]){
 const terminal=harness({response:{id:'terminal',status:'failed',errors}});
 await rejects(()=>terminal.run(),'incomplete_response');assert.equal(terminal.state.status,'failed');assert.equal(terminal.state.retryAt,undefined);
}
console.log('PASS HTTP200 terminal INTERNAL recovery, same media/new independent analysis, bounded transient retry count and refusal isolation');
// Exhausting a worker pass before POST leaves preparation resumable, never uncertain.
const budget=harness();let budgetState;
await rejects(()=>budget.run(undefined,{checkpoint:async state=>{budgetState=structuredClone(state);if(state.status==='generating')budget.clock=current+45000;}}),'pass_yield');
assert.equal(budgetState.status,'preparing');assert.equal(count(budget,'/v1beta/interactions'),0);
// Exercise the actual stage under an owner lease with an already accepted background ID.
const {prepareGenjutsuStage,GENJUTSU_CONFIG}=await import('../supabase/functions/_shared/genjutsu-stage.ts');
const savedFetch=globalThis.fetch;const stageJob={id:'job',user_id:'owner',original_storage_path:'owner/video',frame_storage_path:'owner/image',meta:{workflow_key:'genjutsu',workflow_id:GENJUTSU_CONFIG.workflowId,source_duration_seconds:10,genjutsu_prompt:started.state}};
let stageWrites=0;
const stageAdmin={from(){const q={update(value){stageWrites++;return q;},eq(){return q;},is(){return q;},in(){return q;},select(){return q;},maybeSingle:async()=>({data:{id:'job'}})};return q;}};
try{
 globalThis.fetch=async url=>{assert(String(url).endsWith('/interactions/background-1'));return Response.json({id:'background-1',status:'completed',steps:[{type:'model_output',content:[{type:'text',text:prompt}]}]});};
 assert.equal(await prepareGenjutsuStage({admin:stageAdmin,job:stageJob,workerId:'owner-lease',key:'key',readBlob:()=>{throw Error('must reuse uploaded files');},now:()=>current+31000}),true);
 assert.equal(stageJob.meta.genjutsu_prompt.prompt,prompt);assert(stageWrites>=2);
}finally{globalThis.fetch=savedFetch;}
console.log('PASS pass deadline yields before dispatch, actual leased stage polls accepted analysis without re-reading media');

// Long-lived retry renews expired provider files from the immutable owner paths.
const renew=harness({unavailable:true});await rejects(()=>renew.run(),'provider_waiting');
const expired=structuredClone(renew.state);expired.retryAt=undefined;
for(const kind of ['video','image'])expired[kind].expirationTime=new Date(current-1).toISOString();
const renewJob={...stageJob,original_mime_type:'video/mp4',frame_mime_type:'image/png',meta:{...stageJob.meta,genjutsu_prompt:expired}};let mediaReads=0;renew.config.unavailable=false;
try{
 globalThis.fetch=renew.fetcher;
 assert.equal(await prepareGenjutsuStage({admin:stageAdmin,job:renewJob,workerId:'owner-lease',key:'key',now:()=>current,readBlob:async path=>{mediaReads++;return new Response(path.endsWith('/video')?video:image);}}),true);
 assert.equal(mediaReads,2);assert.equal(count(renew,'/upload/v1beta/files'),4);
 assert.equal(renewJob.meta.genjutsu_prompt.fingerprint,expired.fingerprint);
}finally{globalThis.fetch=savedFetch;}
console.log('PASS continuous retry refreshes expired files from original owner media without changing fingerprint');

// Invalid structured output is repaired under the same job/media, with a finite budget.
for(const invalid of [prompt.replace('Body timeline:','Movement:'),prompt.replace('00:10.000','00:11.000')]){
 const h=harness({prompt:invalid});
 for(let n=1;n<=2;n++){
   await rejects(()=>h.run(),'provider_waiting');
   assert.equal(h.state.formatRepairAttempts,n);assert.equal(h.state.interactionId,undefined);
   assert.equal(h.state.rejectedPrompt,invalid);assert(h.state.repairInteractionId);
   h.clock=Date.parse(h.state.retryAt)+1;
 }
 await rejects(()=>h.run(),'invalid_prompt');assert.equal(h.state.status,'failed');
 assert.equal(count(h,'/upload/v1beta/files'),2);assert.equal(count(h,'/v1beta/interactions'),3);
}
const repair=harness({prompt:prompt.replace('Body timeline:','Movement:')});
await rejects(()=>repair.run(),'provider_waiting');repair.clock=Date.parse(repair.state.retryAt)+1;
repair.config.prompt=prompt;await repair.run();assert.equal(repair.state.status,'complete');
const repairBody=JSON.parse(repair.calls.filter(c=>c.url.endsWith('/v1beta/interactions')).at(-1).init.body);
assert.equal(repairBody.previous_interaction_id,'analysis-1');assert(repairBody.input[2].text.includes('Body timeline:'));
assert.equal(repairBody.input[0].uri,ref('video').uri);assert.equal(repairBody.input[1].uri,ref('image').uri);
const processingFault=harness({response:{id:'processing-fault',status:'failed',steps:[{type:'user_input',content:[{type:'text',text:'original user request'}]}],errors:[{code:'INVALID_ARGUMENT',message:'There was a problem processing your request. You will only be charged for tokens successfully generated.'}]}});
await rejects(()=>processingFault.run(),'provider_waiting');assert.equal(processingFault.state.processingRetryAttempts,1);
processingFault.clock=Date.parse(processingFault.state.retryAt)+1;
await rejects(()=>processingFault.run(),'incomplete_response');assert.equal(processingFault.state.status,'failed');
assert.deepEqual(processingFault.state.providerFailureCodes,['INVALID_ARGUMENT']);
console.log('PASS bounded same-media prompt repair, successful correction, hard-stop after two repairs and one exact generic processing retry');

const hardLimit=harness({unavailable:true});for(let i=0;i<6;i++){await rejects(()=>hardLimit.run(),'provider_waiting');hardLimit.clock=Date.parse(hardLimit.state.retryAt)+1;}
await rejects(()=>hardLimit.run(),'retry_exhausted');assert.equal(hardLimit.state.status,'failed');assert.equal(count(hardLimit,'/upload/v1beta/files'),2);
console.log('PASS persistent 503 stops after six retries and preserves uploaded references');
