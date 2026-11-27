import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
process.env.SUPABASE_PROJECT_REF='aaaaaaaaaaaaaaaaaaaa';
process.env.SUPABASE_URL='https://aaaaaaaaaaaaaaaaaaaa.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
const {default:handler}=await import('../api/login.js');
const origin='https://cloudent-flow.vercel.app';
let calls=0,outcome=200,payload,bodySeen;
globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,process.env.SUPABASE_URL+'/functions/v1/cloudent-x-local-auth?action=login');assert.equal(options.method,'POST');bodySeen=JSON.parse(options.body);return Response.json(payload||{ok:false,error:outcome===401?'invalid_credentials':'forbidden'},{status:outcome});};
async function run(method='GET',body={},requestOrigin=origin){const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},end(s){this.body=s}};await handler({method,headers:{origin:requestOrigin},body},res);return res;}
let r=await run();assert.equal(r.statusCode,200);assert.match(r.body,/<form method="post" action="\/api\/login">/);assert(!r.body.includes('fetch('));assert(!r.body.includes('src='));assert.equal(calls,0);assert.equal(r.headers['cache-control'],'no-store, max-age=0');assert(r.headers['content-security-policy'].includes("frame-ancestors 'none'"));
r=await run('POST',{email:'person@example.com',password:'test'},'https://foreign.example');assert.equal(r.statusCode,403);assert.equal(calls,0);
r=await run('POST',{});assert.equal(r.statusCode,400);assert.equal(calls,0);
for(const status of [401,403,429,503]){outcome=status;payload=null;r=await run('POST',{email:'<script>test@example.com',password:'test'});assert.equal(r.statusCode,status);assert(!r.headers['set-cookie']);assert(!r.body.includes('value="<script>'));assert(!r.body.includes('value="test"'));}
outcome=200;const session={access_token:'test-token',refresh_token:'test-refresh',user:{id:'owner',user_metadata:{name:'</script><script>leak()</script>'}}};payload={ok:true,session,role:'admin',workspace_id:'workspace'};
r=await run('POST','email=person%40example.com&password=test');assert.equal(r.statusCode,200);assert.deepEqual(bodySeen,{email:'person@example.com',password:'test'});assert(r.headers['set-cookie'].includes('HttpOnly; Secure; SameSite=Lax'));assert(!r.body.includes('</script><script>leak()'));
const stored=new Map();let target;const script=r.body.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];new vm.Script(script).runInNewContext({localStorage:{setItem:(k,v)=>stored.set(k,v)},location:{replace:v=>target=v},document:{getElementById:()=>({})}});assert.equal(target,'/');assert.deepEqual(JSON.parse(stored.get('cloudentflow-user-session')),session);assert.equal(stored.get('cloudentflow-login-audit-pending'),'1');
payload={ok:true,session,role:'guest',workspace_id:'workspace'};r=await run('POST',{email:'person@example.com',password:'test'});assert.equal(r.statusCode,503);assert(!r.headers['set-cookie']);assert(!r.body.includes('test-token'));
const html=fs.readFileSync('index.html','utf8');assert.match(html,/<form class="login-card" method="post" action="\/api\/login"/);assert.match(html,/id="loginEmail" name="email"/);assert.match(html,/id="loginPassword" name="password"/);
console.log('PASS native form, no browser fetch/assets, origin guard, input validation, credential/role/rate/upstream errors, cookie, safe session transfer, redirect, audit marker and SPA form wiring');
