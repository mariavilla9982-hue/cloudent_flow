import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
process.env.SUPABASE_PROJECT_REF='aaaaaaaaaaaaaaaaaaaa';
process.env.SUPABASE_URL='https://aaaaaaaaaaaaaaaaaaaa.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
const {default:handler}=await import('../api/auth-recovery.js');
const origin='https://cloudent-flow.vercel.app';
let calls=0,outcome=200,payload,bodySeen;
globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,process.env.SUPABASE_URL+'/functions/v1/cloudent-x-local-auth?action=login');assert.equal(options.method,'POST');bodySeen=JSON.parse(options.body);return Response.json(payload||{ok:false,error:outcome===401?'invalid_credentials':'forbidden'},{status:outcome});};
async function run(method='GET',body={},requestOrigin=origin,host='cloudent-flow.vercel.app'){const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},end(s){this.body=s}};await handler({method,url:'/api/auth-recovery?action=form',headers:{origin:requestOrigin,host},body},res);return res;}
let r=await run();assert.equal(r.statusCode,200);assert.match(r.body,/<form method="post" action="\/api\/auth-recovery\?action=form-login">/);assert(!r.body.includes('fetch('));assert(!r.body.includes('src='));assert.equal(calls,0);assert.equal(r.headers['cache-control'],'no-store, max-age=0');assert.equal(r.headers['referrer-policy'],'same-origin');assert(r.headers['content-security-policy'].includes("frame-ancestors 'none'"));
r=await run('POST',{email:'person@example.com',password:'test'},'https://foreign.example');assert.equal(r.statusCode,403);assert.equal(calls,0);
assert.equal(r.headers['referrer-policy'],'same-origin','retry form must preserve Origin');
r=await run('POST',{email:'person@example.com',password:'test'},'null');assert.equal(r.statusCode,403);assert.equal(calls,0);
r=await run('POST',{});assert.equal(r.statusCode,400);assert.equal(calls,0);
for(const status of [401,403,429,503]){outcome=status;payload=null;r=await run('POST',{email:'<script>test@example.com',password:'test'});assert.equal(r.statusCode,status);assert(!r.headers['set-cookie']);assert(!r.body.includes('value="<script>'));assert(!r.body.includes('value="test"'));}
outcome=200;const session={access_token:'test-token',refresh_token:'test-refresh',user:{id:'owner',user_metadata:{name:'</script><script>leak()</script>'}}};payload={ok:true,session,role:'admin',workspace_id:'workspace'};
r=await run('POST','email=person%40example.com&password=test');assert.equal(r.statusCode,200);assert.deepEqual(bodySeen,{email:'person@example.com',password:'test'});assert(String(r.headers['set-cookie']).includes('HttpOnly; Secure; SameSite=Lax'));assert(!r.body.includes('</script><script>leak()'));
const stored=new Map();let target;const script=r.body.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];new vm.Script(script).runInNewContext({localStorage:{setItem:(k,v)=>stored.set(k,v)},sessionStorage:{setItem:(k,v)=>stored.set(k,v)},location:{replace:v=>target=v},document:{getElementById:()=>({})}});assert.equal(target,'/api/auth-recovery?action=app');assert.equal(JSON.parse(stored.get('cloudentflow-native-login')).session.access_token,session.access_token);assert.deepEqual(JSON.parse(stored.get('cloudentflow-user-session')),session);assert.equal(stored.get('cloudentflow-login-audit-pending'),'1');
r=await run('POST',{email:'person@example.com',password:'test'},'https://cloudentflow-pc.vercel.app','cloudentflow-pc.vercel.app');assert.equal(r.statusCode,200);assert(r.headers['set-cookie']);
 r=await run('POST',{email:'person@example.com',password:'test'},origin,'cloudentflow-pc.vercel.app');assert.equal(r.statusCode,403,'cross-domain form rejected');
 payload={ok:true,session,role:'guest',workspace_id:'workspace'};r=await run('POST',{email:'person@example.com',password:'test'});assert.equal(r.statusCode,503);assert(!r.headers['set-cookie']);assert(!r.body.includes('test-token'));
const html=fs.readFileSync('index.html','utf8');assert.match(html,/<form class="login-card" method="post" action="\/api\/auth-recovery\?action=form-login"/);assert.match(html,/id="loginEmail" name="email"/);assert.match(html,/id="loginPassword" name="password"/);
globalThis.fetch=async url=>{assert.equal(url,origin+'/index.html');return new Response('<html><head></head><body>public shell</body></html>')};const shell={headers:{},setHeader(k,v){this.headers[k]=v},end(s){this.body=s}};await handler({method:'GET',url:'/api/auth-recovery?action=app',headers:{}},shell);assert.equal(shell.statusCode,200);assert(shell.body.includes('history.replaceState'));assert(!shell.body.includes('test-token'));globalThis.fetch=async url=>{assert.equal(url,'https://cloudentflow-pc.vercel.app/index.html');return new Response('<html><head></head><body>public shell</body></html>')};await handler({method:'GET',url:'/api/auth-recovery?action=app',headers:{host:'cloudentflow-pc.vercel.app'}},shell);assert.equal(shell.statusCode,200);
 console.log('PASS native form, no browser fetch/assets, origin guard, input validation, credential/role/rate/upstream errors, cookie, safe session transfer, redirect, audit marker and SPA form wiring');
