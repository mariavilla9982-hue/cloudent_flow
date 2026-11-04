import assert from 'node:assert/strict';
import {runGenjutsuReadiness,validateGenjutsuGraph,GENJUTSU_WORKFLOW_ID} from '../supabase/functions/_shared/genjutsu-readiness.ts';
import {genjutsuApi} from '../supabase/functions/_shared/genjutsu-api.ts';
import {GENJUTSU_MODEL} from '../supabase/functions/_shared/genjutsu-gemini.ts';
const shape={'970':{class_type:'VHS_LoadVideo',inputs:{video:'x'}},'496':{class_type:'LoadImage',inputs:{image:'x'}},
  '910':{class_type:'PrimitiveStringMultiline',inputs:{value:'example prompt'}},'482':{class_type:'SaveVideo',inputs:{video:['476',0]}}};
assert.equal(validateGenjutsuGraph({data:{prompt:JSON.stringify(shape)}}).length,4);
assert.throws(()=>validateGenjutsuGraph({...shape,'910':{class_type:'Other',inputs:{value:'x'}}}),/910/);
assert.throws(()=>validateGenjutsuGraph({...shape,'496':{class_type:'LoadImage',inputs:{wrong:'x'}}}),/496/);

const master='test-internal-worker-secret',key='test-runninghub-secret';
const iv=crypto.getRandomValues(new Uint8Array(12));
const cryptoKey=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(master)),{name:'AES-GCM'},false,['encrypt']);
const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},cryptoKey,new TextEncoder().encode(key)));
const b64=bytes=>Buffer.from(bytes).toString('base64');
let cached=null,queueConfig=null,writes=0,role='admin',active=true,providerCalls=[];
const admin={
  auth:{getUser:async()=>({data:{user:{id:'owner'}}})},
  rpc:async name=>({data:name==='get_cloudent_worker_secret'?master:active}),
  from(table){let value,op='read',settingKey;const q={select(){return q;},eq(k,v){if(k==='key')settingKey=v;return q;},maybeSingle(){return q.then(x=>x);},
    upsert(x){value=x;op='write';return q;},then(resolve){
      if(op==='write'){assert.equal(table,'app_settings');assert(['genjutsu_readiness','genjutsu_queue_config'].includes(value.key));if(value.key==='genjutsu_readiness')cached=value.value;else queueConfig=value.value;writes++;return Promise.resolve({data:null}).then(resolve);}
      const data=table==='integrations'?{enabled:true,config:{apiKeyCipher:b64(encrypted),apiKeyIv:b64(iv)}}:table==='app_members'?{role,enabled:true}:settingKey==='genjutsu_queue_config'?(queueConfig?{value:queueConfig}:null):cached?{value:cached}:null;
      return Promise.resolve({data}).then(resolve);
    }};return q;}
};
const options={admin,master,apiKey:'test-gemini-secret',now:()=>Date.parse('2026-11-03T04:00:00Z'),fetcher:async(url,init)=>{
  providerCalls.push(url);assert.equal(init.redirect,'error');
  if(url.includes('googleapis.com')){assert.equal(init.headers['x-goog-api-key'],'test-gemini-secret');return Response.json({name:'models/'+GENJUTSU_MODEL,supportedGenerationMethods:['generateContent']});}
  assert.equal(url,'https://www.runninghub.ai/api/openapi/getJsonApiFormat');assert.deepEqual(JSON.parse(init.body),{apiKey:key,workflowId:GENJUTSU_WORKFLOW_ID});
  return Response.json({code:0,data:{prompt:JSON.stringify(shape)}});
}};
const ready=await runGenjutsuReadiness(options);assert.equal(ready.ready,true);assert.equal(providerCalls.length,2);
const redacted=JSON.stringify(ready);for(const secret of [master,key,options.apiKey,'example prompt'])assert(!redacted.includes(secret));
const unavailable=await runGenjutsuReadiness({...options,fetcher:async(url,init)=>url.includes('googleapis.com')?Response.json({error:{message:'test-gemini-secret'}},{status:404}):options.fetcher(url,init)});
assert.equal(unavailable.ready,false);assert.equal(unavailable.gemini.code,'model_unavailable');assert(!JSON.stringify(unavailable).includes('test-gemini-secret'));
const missing=await runGenjutsuReadiness({...options,apiKey:''});assert.equal(missing.gemini.configured,false);assert.equal(missing.ready,false);
console.log('PASS exact workflow nodes, account model check, server-only decryption and sanitized status');

const env={...options,supabaseUrl:'https://project.supabase.co'};
const post=(headers={},body={action:'preflight'})=>new Request('https://project.supabase.co/functions/v1/cloudent-genjutsu',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
providerCalls=[];assert.equal((await genjutsuApi(post(),env)).status,401);
assert.equal((await genjutsuApi(post({'x-cloudent-worker-secret':'wrong'}),env)).status,401);assert.equal(providerCalls.length,0);assert.equal(writes,0);
const token='header.'+Buffer.from(JSON.stringify({iss:env.supabaseUrl+'/auth/v1',session_id:'session'})).toString('base64url')+'.signature';
role='x_user';assert.equal((await genjutsuApi(post({Authorization:'Bearer '+token}),env)).status,403);
role='admin';active=false;assert.equal((await genjutsuApi(post({Authorization:'Bearer '+token}),env)).status,401);
active=true;const response=await genjutsuApi(post({'x-cloudent-worker-secret':master}),env);
assert.equal(response.status,200);const data=await response.json();assert.equal(data.readiness.ready,true);assert.equal(data.active,true);assert.equal(writes,1);
const calls=providerCalls.length;await genjutsuApi(post({'x-cloudent-worker-secret':master}),env);assert.equal(providerCalls.length,calls,'bounded status cache');
assert.equal((await genjutsuApi(post({'x-cloudent-worker-secret':master},{action:'create'}),env)).status,409);
for(const secret of [master,key,options.apiKey])assert(!JSON.stringify(data).includes(secret));
assert.equal((await genjutsuApi(new Request('https://example',{method:'OPTIONS'}),env)).status,204);
console.log('PASS internal secret/admin+active-session auth, X restriction, bounded cache, no generation route or leaked secrets');

for(const value of [0,5,1.5,'2'])assert.equal((await genjutsuApi(post({'x-cloudent-worker-secret':master},{action:'prompt-concurrency',value}),env)).status,400);
const changed=await genjutsuApi(post({'x-cloudent-worker-secret':master},{action:'prompt-concurrency',value:3}),env);assert.equal(changed.status,200);assert.equal(queueConfig.prompt_concurrency,3);
const queueStatus=await (await genjutsuApi(new Request(env.supabaseUrl+'/functions/v1/cloudent-genjutsu',{headers:{'x-cloudent-worker-secret':master}}),env)).json();assert.equal(queueStatus.queue.promptConcurrency,3);assert.equal(queueStatus.queue.videoConcurrency,2);
role='x_user';assert.equal((await genjutsuApi(post({Authorization:'Bearer '+token},{action:'prompt-concurrency',value:4}),env)).status,403);
console.log('PASS admin-only bounded prompt concurrency setting and independent fixed video concurrency');
