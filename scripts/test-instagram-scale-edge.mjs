import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = name => stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/'+name+'/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,''));
const response = (data,status=200) => new Response(JSON.stringify(data),{status});
const globals = {URL,URLSearchParams,TextEncoder,TextDecoder,AbortSignal,Request,Response,crypto,btoa,atob,console};
function handler(name,admin,fetch){
  let handle;
  vm.runInNewContext(source(name),{
    ...globals,fetch,createClient:()=>admin,
    Deno:{serve(fn){handle=fn},env:{get:key=>({
      SUPABASE_URL:'https://cloudent.test',SUPABASE_SERVICE_ROLE_KEY:'test-server-secret',
      INSTAGRAM_APP_ID:'test-app',INSTAGRAM_APP_SECRET:'test-app-secret'
    })[key]}}
  });
  return handle;
}
function chain(read,write=()=>{}){
  let patch=null;
  const query={
    select(){return this},eq(){return this},is(){return this},contains(){return this},single(){return this},maybeSingle(){return this},
    update(value){patch=value;return this},insert(value){patch=value;return this},upsert(value){patch=value;return this},
    delete(){return this},throwOnError(){return this},
    then(resolve,reject){try{if(patch)write(patch);return Promise.resolve(read()).then(resolve,reject)}catch(e){return Promise.reject(e).then(resolve,reject)}}
  };
  return query;
}

const mother='c5f2fdd6-00e8-4ca7-adb8-281aa922ad0a';
const child='30000000-0000-4000-8000-000000000001';
const user='10000000-0000-4000-8000-000000000001';
const sid='20000000-0000-4000-8000-000000000001';
let grants=['instagram_business_basic','instagram_business_content_publish'],vaultWrites=[],metaReads=[],membership=true,session=true,accountType='MEDIA_CREATOR';
const oauth=handler('instagram-oauth',{
  auth:{getUser:async()=>({data:{user:{id:user}}})},
  rpc:async(name,args)=>{
    if(name==='cloudent_auth_session_active')return {data:session};
    if(name==='instagram_scale_accounts')return {data:[{id:mother,enabled:true}]};
    if(name==='instagram_scale_connect'){vaultWrites.push(args);return {data:child}}
    throw new Error('unexpected RPC '+name);
  },
  from(name){
    if(name==='app_members')return chain(()=>({data:{enabled:membership,role:'admin'}}));
    if(name==='app_settings')return chain(()=>({data:{value:{mother_id:mother}}}));
    if(name==='instagram_scale_links')return chain(()=>({count:0}));
    if(name==='activity_logs')return chain(()=>({data:null}));
    throw new Error('unexpected table '+name);
  }
},async(url,options)=>{
  const target=new URL(url);
  metaReads.push(target.pathname);
  assert.ok(!target.pathname.endsWith('media_publish'));
  if(target.host==='api.instagram.com')return response({data:[{access_token:'short',permissions:grants}]});
  if(target.pathname==='/access_token')return response({access_token:'long',expires_in:5184000});
  assert.equal(options.headers.Authorization,'Bearer long');
  if(target.pathname==='/me')return response({user_id:'10',username:'pilot_child',account_type:accountType});
  if(target.pathname.endsWith('/content_publishing_limit'))return response({data:[{quota_usage:0,config:{quota_total:100}}]});
  throw new Error('unexpected Meta path '+target.pathname);
});
const start=()=>oauth(new Request('https://cloudent.test/functions/v1/instagram-oauth',{
  method:'POST',headers:{Authorization:'Bearer head.'+Buffer.from(JSON.stringify({session_id:sid})).toString('base64url')+'.sig'},
  body:JSON.stringify({mother_id:mother,return_page:'calendar'})
}));
const auth=await (await start()).json();
const authorize=new URL(auth.url);
assert.equal(authorize.origin,'https://www.instagram.com');
assert.equal(authorize.pathname,'/oauth/authorize');
assert.ok(authorize.searchParams.get('scope').includes('instagram_business_content_publish'));
const state=authorize.searchParams.get('state');
const callback=(s=state)=>oauth(new Request('https://cloudent.test/functions/v1/instagram-oauth?code=test&state='+encodeURIComponent(s)));
const result=async s=>new URL((await callback(s)).headers.get('location')).searchParams;
assert.equal((await result(state+'tampered')).get('reason'),'invalid_state');
assert.equal(metaReads.length,0);
grants=['instagram_business_basic'];
assert.equal((await result()).get('reason'),'meta_authorization_required');
assert.equal(vaultWrites.length,0);
grants.push('instagram_business_content_publish');
accountType='PERSONAL';
assert.equal((await result()).get('reason'),'instagram_professional_required');
assert.equal(vaultWrites.length,0);
accountType='MEDIA_CREATOR';
session=false;
assert.equal((await result()).get('reason'),'forbidden');
session=true;
const ok=await result();
assert.equal(ok.get('instagram_oauth'),'success');
assert.equal(ok.get('destination'),'calendar');
assert.equal(vaultWrites.length,1);
assert.equal(vaultWrites[0].p_mother_id,mother);
assert.equal(vaultWrites[0].p_token,'long');
assert.ok(Date.parse(vaultWrites[0].p_config.token_expires_at)>Date.now());

async function runPublish(options={}){
  const schedule={id:'schedule',video_id:'asset',platform_account_id:child,status:'processing',instagram_scale_caption:'Legenda da mãe',attempt_count:1};
  const job={id:'job',attempts:1,payload:{container_id:'container',container_created_at:new Date().toISOString(),...options.payload}};
  const writes=[],calls=[];
  let finalized=null;
  const publish=handler('cloudent-instagram-publish-recovery',{
    rpc(name,args){
      if(name==='get_cloudent_worker_secret')return {data:'worker-secret'};
      if(name==='claim_calendar_publish_schedule')return {data:[job]};
      if(name==='get_instagram_page_token_for_account'){
        assert.equal(args.p_account_id,child);return {data:'child-token'};
      }
      if(name==='instagram_scale_finish')return {throwOnError:async()=>{finalized=args}};
      throw new Error('unexpected RPC '+name);
    },
    from(name){
      const table={
        schedules:schedule,videos:{id:'asset',caption:'Legenda alterada',media_clean_status:'ready',storage_provider:'r2'},
        platform_accounts:{id:child,external_account_id:'10',platform:'instagram',enabled:true,config:{scale_pilot_child:true}},
        job_queue:{id:'job'},app_settings:null,instagram_media:null,activity_logs:null
      };
      return chain(()=>({data:table[name]}),patch=>writes.push({name,patch}));
    }
  },async(url,optionsArg)=>{
    const {pathname}=new URL(url);
    calls.push(pathname);
    assert.equal(optionsArg.headers.Authorization,'Bearer child-token');
    if(pathname.endsWith('/container'))return response({status_code:'FINISHED'});
    if(pathname.endsWith('/content_publishing_limit'))return response({data:[{quota_usage:options.quota||0,config:{quota_total:100}}]});
    if(pathname.endsWith('/media_publish')){
      assert.ok(writes.some(write=>write.name==='job_queue'&&write.patch.payload?.publish_started_at),'write intent before sending');
      if(options.timeout)throw new Error('timeout');
      return response({id:'receipt'});
    }
    if(pathname.endsWith('/receipt'))return response({id:'receipt',media_product_type:'REELS'});
    throw new Error('unexpected Meta path '+pathname);
  });
  const result=await publish(new Request('https://cloudent.test/worker',{
    method:'POST',headers:{'x-cloudent-worker-secret':'worker-secret'},body:JSON.stringify({schedule_id:'schedule'})
  }));
  return {result:await result.json(),calls,writes,finalized};
}

const published=await runPublish();
assert.equal(published.result.state,'published');
assert.equal(published.finalized.p_payload.instagram_media_id,'receipt');
assert.equal(published.writes.some(write=>write.name==='videos'),false,'child never claims the source video');
const uncertain=await runPublish({timeout:true});
assert.equal(uncertain.result.state,'confirmation_required');
assert.ok(uncertain.writes.some(write=>write.name==='job_queue'&&write.patch.status==='failed'&&write.patch.payload?.publish_started_at));
const resumed=await runPublish({payload:{publish_started_at:new Date().toISOString()}});
assert.equal(resumed.result.state,'confirmation_required');
assert.equal(resumed.calls.length,0,'uncertain publication is never reissued');
const receipt=await runPublish({payload:{instagram_media_id:'receipt',published_at:new Date().toISOString()}});
assert.equal(receipt.result.state,'published');
assert.equal(receipt.calls.some(path=>path.endsWith('/media_publish')),false);
const quota=await runPublish({quota:100});
assert.equal(quota.result.state,'retry');
assert.equal(quota.calls.some(path=>path.endsWith('/media_publish')),false);
assert.ok(quota.writes.some(write=>write.name==='job_queue'&&Date.parse(write.patch.run_at)>Date.now()));
console.log('PASS: OAuth oficial, permissão ausente, perfil pessoal, sessão revogada, credencial isolada, cota, recibo, recuperação e proteção contra reenvio.');
