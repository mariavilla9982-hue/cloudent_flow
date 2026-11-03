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
    if(url.endsWith(':generateContent')){
      if(config.timeout)throw new Error('private-test-key timeout');
      if(config.quota)return json({error:{message:'private-test-key quota'}},429,{'retry-after':'120'});
      if(config.invalidJSON)return new Response('not json');
      return json(config.response||{candidates:[{finishReason:'STOP',content:{parts:[
        {thought:true,text:'private reasoning'},
        {text:config.prompt??prompt}
      ]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:400,totalTokenCount:1400,secret:'private-test-key'}});
    }
    throw Error('Unexpected network destination '+url);
  };
  const checkpoint=async(state)=>{
    if(config.failCheckpoint===state.status)throw new Error('lease lost');
    persisted=structuredClone(state);checkpoints.push(persisted);
  };
  const run=(state=persisted,overrides={})=>prepareGenjutsuPrompt({apiKey:'private-test-key',video,image,durationSeconds:10,
    state,checkpoint,fetcher,now:()=>clock,...overrides});
  return {run,calls,checkpoints,config,get state(){return persisted;},set clock(value){clock=value;}};
}
const count=(h,suffix)=>h.calls.filter(c=>c.url.endsWith(suffix)).length;
const rejects=async(fn,code)=>assert.rejects(fn,error=>error.code===code&&!error.message.includes('private-test-key'));

const happy=harness();
const completed=await happy.run();
assert.equal(completed.ready,true);assert.equal(completed.state.prompt,prompt);
assert.deepEqual(completed.state.usage,{promptTokenCount:1000,candidatesTokenCount:400,totalTokenCount:1400});
const generated=happy.calls.find(c=>c.url.endsWith(':generateContent'));
const body=JSON.parse(generated.init.body);
assert.equal(body.systemInstruction.parts[0].text,GENJUTSU_INSTRUCTIONS);
assert.deepEqual(body.contents[0].parts.slice(0,2),[
  {fileData:{fileUri:ref('video').uri,mimeType:video.type}},
  {fileData:{fileUri:ref('image').uri,mimeType:image.type}}
]);
assert(body.contents[0].parts[2].text.includes('10 seconds'));
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
assert.equal(processing.state.status,'processing');assert.equal(count(processing,':generateContent'),0);
const uploads=count(processing,'/upload/v1beta/files');processing.config.processing=false;
assert.equal((await processing.run(processing.state,{resumeUploadedFiles:true,video:new Blob(['saved'],{type:video.type}),image:new Blob(['saved'],{type:image.type})})).ready,true);assert.equal(count(processing,'/upload/v1beta/files'),uploads);
const failed=harness({failCheckpoint:'generating'});await assert.rejects(()=>failed.run(),/lease lost/);
assert.equal(count(failed,':generateContent'),0,'lost lease blocks generation');
const timeout=harness({timeout:true});await rejects(()=>timeout.run(),'network_error');
assert.equal(timeout.state.status,'generating');await rejects(()=>timeout.run(),'generation_uncertain');
assert.equal(count(timeout,':generateContent'),1,'ambiguous generation cannot replay');
console.log('PASS resumable processing, media reuse, lost lease and ambiguous generation do not duplicate calls');

const quota=harness({quota:true});await rejects(()=>quota.run(),'quota_waiting');
assert.equal(quota.state.status,'quota_waiting');const quotaCalls=quota.calls.length;
assert.equal((await quota.run()).ready,false);assert.equal(quota.calls.length,quotaCalls);
quota.clock=current+121000;quota.config.quota=false;assert.equal((await quota.run()).ready,true);
assert.equal(count(quota,'/upload/v1beta/files'),2,'quota retry reuses both uploads');
for(const response of [
  {promptFeedback:{blockReason:'SAFETY'}},
  {candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:prompt}]}}]}
]){const h=harness({response});await rejects(()=>h.run(),'incomplete_response');assert.equal(h.state.status,'failed');}
for(const invalid of [prompt.replace('summary:','missing:'),prompt.replace('00:10.000','00:11.000'),'```\n'+prompt+'\n```',prompt+' {unfilled}']){
  const h=harness({prompt:invalid});await rejects(()=>h.run(),'invalid_prompt');assert.equal(h.state.status,'failed');
}
console.log('PASS quota wait without paid fallback; blocked/truncated/invalid responses never reach RunningHub inputs');
