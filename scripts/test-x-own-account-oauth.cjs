const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{stripTypeScriptTypes}=require('node:module');
const {webcrypto:crypto}=require('node:crypto');
class Q{
 constructor(db,t){this.db=db;this.t=t;this.f=[];this.op='read';}
 select(){return this;}ilike(){return this;}eq(k,v){this.f.push(r=>r[k]===v);return this;}lt(k,v){this.f.push(r=>r[k]<v);return this;}
 insert(p){this.op='insert';this.p=p;return this;}upsert(p){this.op='insert';this.p=p;return this;}update(p){this.op='update';this.p=p;return this;}delete(){this.op='delete';return this;}
 async run(){let rows=this.db[this.t]||[],matches=rows.filter(r=>this.f.every(f=>f(r)));if(this.op==='insert'){const r={id:'new-account',...this.p};rows.push(r);this.db[this.t]=rows;return {data:[r]};}if(this.op==='update')matches.forEach(r=>Object.assign(r,this.p));if(this.op==='delete')this.db[this.t]=rows.filter(r=>!matches.includes(r));return {data:matches,count:matches.length};}
 then(a,b){return this.run().then(a,b);}async maybeSingle(){const r=await this.run();return {...r,data:r.data[0]};}single(){return this.maybeSingle();}
}
async function fixture(role='x_user',enabled=true,foreign=false){
 const db={app_members:[{user_id:'u',role,enabled,workspace_id:'w'}],integrations:[{provider:'x',config:{clientIdCipher:'a',clientIdIv:'b',clientSecretCipher:'c',clientSecretIv:'d'}}],x_oauth_states:[{id:'state',user_id:'u',state_hash:await hash('state'),expires_at:new Date(Date.now()+60000).toISOString()}],platform_accounts:foreign?[{id:'foreign',platform:'x',external_account_id:'x-id',owner_user_id:'other',workspace_id:'w',config:{}}]:[],x_account_access:[]};
 const admin={auth:{getUser:async()=>({data:{user:{id:'u'}}})},from:t=>new Q(db,t),rpc:async(n)=>({data:n==='get_cloudent_worker_secret'?'master':true})};let handler;
 const c={crypto,URL,URLSearchParams,TextEncoder,TextDecoder,Request,Response,Headers,Uint8Array,btoa,atob,console,createClient:()=>admin,Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test':'secret'},serve:f=>handler=f},fetch:async u=>new Response(JSON.stringify(String(u).includes('/users/me')?{data:{id:'x-id',username:'own'}}:{access_token:'access',refresh_token:'refresh'}))};
 vm.createContext(c);vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/cloudent-x-oauth/index.ts','utf8')).replace(/^import .*;\n/gm,''),c);vm.runInContext('decryptSecret=async()=>"client";encryptSecret=async()=>({cipher:"encrypted",iv:"iv"})',c);
 return {db,handler};
}
async function hash(s){return Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');}
(async()=>{
 const token='header.'+Buffer.from(JSON.stringify({iss:'https://test/auth/v1',session_id:'s'})).toString('base64url')+'.sig';
 for(const [role,enabled,status] of [['x_user',true,200],['admin',true,200],['member',true,403],['x_user',false,403]]){const f=await fixture(role,enabled);const r=await f.handler(new Request('https://test/?action=start',{method:'POST',headers:{Authorization:'Bearer '+token}}));assert.equal(r.status,status);}
 let f=await fixture();let r=await f.handler(new Request('https://test/?action=callback&state=state&code=code'));assert.equal(r.status,302);assert.equal(new URL(r.headers.get('location')).searchParams.get('x_connected'),'1');assert.equal(f.db.platform_accounts[0].owner_user_id,'u');assert.deepEqual(f.db.x_account_access.map(g=>[g.user_id,g.platform_account_id,g.workspace_id]),[['u','new-account','w']]);
 f=await fixture('x_user',true,true);r=await f.handler(new Request('https://test/?action=callback&state=state&code=code'));assert.equal(new URL(r.headers.get('location')).searchParams.get('x_error'),'account_owned_by_another_user');assert.equal(f.db.x_account_access.length,0);assert.equal(f.db.platform_accounts[0].owner_user_id,'other');
 f=await fixture('x_user',false);r=await f.handler(new Request('https://test/?action=callback&state=state&code=code'));assert.equal(new URL(r.headers.get('location')).searchParams.get('x_error'),'forbidden');assert.equal(f.db.platform_accounts.length,0);
 console.log('PASS own-account OAuth start/callback/grant, foreign ownership denied, disabled member denied.');
})().catch(e=>{console.error(e);process.exit(1)});
