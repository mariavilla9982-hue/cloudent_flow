import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
let handler,wrongIdentity=false;const writes=[];
const admin={auth:{getUser:async()=>({data:{user:{id:'USER'}}})},rpc:async(name,args)=>{writes.push({name,args});return {error:null}},from(table){
  const q={table,filters:{}};
  const result=()=>{
    if(table==='app_members')return {data:{role:'admin',enabled:true}};
    if(table==='platform_accounts'){
      if(q.select?.[1]?.head)return {count:3};
      if(q.upsert)return {data:{id:'TARGET'}};
      return {data:{id:q.filters.external_account_id==='OTHER_EXTERNAL'?'OTHER':'TARGET',config:{owner_user_id:'USER',retained_setting:true}}};
    }
    if(table==='schedules')return {data:{platform_account_id:'TARGET',status:q.filters.id==='PUBLISHED'?'published':'queued',instagram_media_id:null}};
    if(table==='reel_test_publications'&&!q.update)return {data:[{id:'RETRY',linked_schedule_id:'ACTIVE',meta:{failure_reason:'instagram_reconnect_required',platform_account_id:'TARGET',keep:true}},{id:'NO_RETRY',linked_schedule_id:'PUBLISHED',meta:{failure_reason:'instagram_reconnect_required',platform_account_id:'TARGET'}}]};
    return {data:null,error:null};
  };
  const builder=new Proxy({}, {get(_,key){
    if(key==='then')return resolve=>resolve(result());
    if(['maybeSingle','single'].includes(key))return async()=>result();
    return (...args)=>{q[key]=args;if(key==='eq')q.filters[args[0]]=args[1];if(['upsert','update','insert'].includes(key))writes.push(q);return builder};
  }});return builder;
}};
const fakeFetch=async url=>new Response(JSON.stringify(String(url).includes('/me?')?{user_id:wrongIdentity?'OTHER_EXTERNAL':'TARGET_EXTERNAL',username:'test'}:{access_token:'TEST_ONLY',expires_in:3600}),{headers:{'Content-Type':'application/json'}});
const source=readFileSync(new URL('../functions/instagram-oauth/index.ts',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'');
new Function('Deno','createClient','fetch',stripTypeScriptTypes(source,{mode:'transform'}))({env:{get:name=>({INSTAGRAM_APP_ID:'TEST_APP',INSTAGRAM_APP_SECRET:'TEST_SECRET',SUPABASE_SERVICE_ROLE_KEY:'TEST_SIGNING_KEY',SUPABASE_URL:'https://example.test'})[name]||''},serve:fn=>handler=fn},()=>admin,fakeFetch);
const start=await handler(new Request('https://example.test/oauth',{method:'POST',headers:{Authorization:'Bearer TEST','Content-Type':'application/json'},body:JSON.stringify({platform_account_id:'TARGET'})}));
assert.equal(start.status,200,'Existing account can reconnect at the three-account limit');
const authUrl=new URL((await start.json()).url);
const denied=await handler(new Request('https://example.test/oauth',{method:'POST',headers:{Authorization:'Bearer TEST'},body:'{}'}));assert.equal(denied.status,409,'New account still obeys the limit');
const callback='https://example.test/oauth?code=TEST_CODE&state='+encodeURIComponent(authUrl.searchParams.get('state'));
wrongIdentity=true;
const wrong=await handler(new Request(callback));
assert.equal(new URL(wrong.headers.get('Location')).searchParams.get('reason'),'reconnect_account_mismatch');
assert.equal(writes.filter(w=>w.name==='set_instagram_page_token_for_account').length,0,'Wrong account cannot overwrite the token');
wrongIdentity=false;
const correct=await handler(new Request(callback));
assert.equal(new URL(correct.headers.get('Location')).searchParams.get('instagram_oauth'),'success');
assert.equal(writes.find(w=>w.upsert&&w.table==='platform_accounts').upsert[0].config.retained_setting,true);
assert.equal(writes.filter(w=>w.name==='set_instagram_page_token_for_account').length,1);
const retries=writes.filter(w=>w.table==='reel_test_publications'&&w.update);
assert.equal(retries.length,1);assert.equal(retries[0].filters.id,'RETRY');
assert.equal(retries[0].update[0].meta.retry_blocked,false);assert.equal(retries[0].update[0].meta.keep,true);
console.log('Reconnect at limit, new-account limit, identity mismatch, config preservation and safe Trial resume: passed.');
