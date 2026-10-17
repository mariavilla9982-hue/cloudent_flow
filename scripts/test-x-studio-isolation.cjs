const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{stripTypeScriptTypes}=require('node:module');
const crypto=require('node:crypto').webcrypto;
const A='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',U='user-a',V='user-b';
class Query{
 constructor(db,table){this.db=db;this.table=table;this.filters=[];this.op='read';this.patch={};}
 select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}is(k,v){return this.eq(k,v);}in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}order(){return this;}limit(){return this;}not(){return this;}
 update(p){this.op='update';this.patch=p;return this;}insert(p){this.op='insert';this.patch=p;return this;}upsert(p){return this.insert(p);}delete(){this.op='delete';return this;}
 async result(){const rows=this.db[this.table]||[];const selected=rows.filter(r=>this.filters.every(f=>f(r)));if(this.op==='insert'){rows.push(...(Array.isArray(this.patch)?this.patch:[this.patch]));this.db[this.table]=rows;return {data:[this.patch],error:null};}if(this.op==='update')for(const r of selected)Object.assign(r,this.patch);return {data:selected.map(r=>({...r})),error:null};}
 async maybeSingle(){const r=await this.result();return {...r,data:r.data[0]||null};}single(){return this.maybeSingle();}then(a,b){return this.result().then(a,b);}
}
function context(path,admin){const c={crypto,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,fetch:async()=>{throw Error('External request forbidden in tests');},console,setTimeout,clearTimeout,Uint8Array,Buffer,btoa,atob,createClient:()=>admin,twitterText:{parseTweet:t=>({valid:t.length>0&&t.length<=280})},Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test':''},serve:f=>{c.handler=f;}}};vm.createContext(c);const js=stripTypeScriptTypes(fs.readFileSync(path,'utf8')).replace(/^import .*;\n/gm,'');vm.runInContext(js,c);vm.runInContext('globalThis.HttpError=typeof HttpError!=="undefined"?HttpError:Error',c);return c;}
(async()=>{
 const db={app_members:[{user_id:U,role:'x_user',enabled:true,workspace_id:'w'}],platform_accounts:[{id:A,platform:'x',owner_user_id:U,workspace_id:'w',enabled:true,config:{status:'connected'}},{id:B,platform:'x',owner_user_id:V,workspace_id:'w',enabled:true,config:{status:'connected'}}],x_account_access:[{user_id:U,workspace_id:"w",platform_account_id:A}],x_drive_posts:[],x_account_configs:[],activity_logs:[]};
 const admin={auth:{getUser:async()=>({data:{user:{id:U}},error:null})},from:t=>new Query(db,t),rpc:async(n,p)=>({data:n==='cloudent_x_access'?p.p_user===U&&p.p_account===A:['cloudent_rate_limit','cloudent_auth_session_active'].includes(n)?true:null,error:null})};
 const api=context('supabase/functions/cloudent-api/index.ts',admin);
 const validToken='header.'+Buffer.from(JSON.stringify({iss:'https://test/auth/v1',session_id:'active-session'})).toString('base64url')+'.signature';
 for(const resource of ['platform-accounts','queue','production','integrations','media-url']){const r=await api.handler(new Request('https://test/?resource='+resource,{headers:{Authorization:'Bearer '+validToken}}));assert.equal(r.status,403,resource);}
 const session=await api.handler(new Request('https://test/?resource=session',{headers:{Authorization:'Bearer '+validToken}}));assert.equal((await session.json()).role,'x_user');
 const x=context('supabase/functions/cloudent-x-publish-worker/index.ts',admin);
 assert.equal((await x.requireUser(admin,new Request('https://test/',{headers:{Authorization:'Bearer '+validToken}}))).id,U);
 await assert.rejects(x.requireUser(admin,new Request('https://test/',{headers:{Authorization:'Bearer malformed'}})),/unauthorized/);
 await assert.rejects(x.resolveXAccount(admin,U,{}),/platform_account_id_required/);await assert.rejects(x.resolveXAccount(admin,U,{platform_account_id:B}),/forbidden/);
 assert.equal((await x.resolveXAccount(admin,U,{platform_account_id:A})).id,A);
 const payload=await x.statusPayload(admin,U,'',new URL('https://test/?platform_account_id='+A));assert.equal(payload.accounts.length,1);assert.equal(JSON.stringify(payload).includes('Cipher'),false);
 await assert.rejects(x.statusPayload(admin,U,'',new URL('https://test/?platform_account_id='+B)),/forbidden/);
 db.app_members[0].enabled=false;await assert.rejects(x.requireXMember(admin,U),/forbidden/);db.app_members[0].enabled=true;
 // Exercise production worker behavior: five explicit jobs, one API rejection, no repeated successes.
 const jobs=Array.from({length:5},(_,i)=>({id:'job-'+i,user_id:U,platform_account_id:'acct-'+i,status:'queued',x_post_id:null,attempts:1,max_attempts:5,post_text:'caption '+i,drive_file_id:'f'+i,meta:{source:'upload',storage_path:U+'/x-uploads/video.mp4'}}));db.x_drive_posts=jobs;
 const sent=[];admin.rpc=async(n,p)=>{
 if(n==='claim_x_account_post'){const j=jobs.find(j=>j.platform_account_id===p.p_account&&j.status==='queued');if(!j)return {data:null};j.status='processing';j.locked_by=p.p_worker;return {data:{...j,meta:{...j.meta}}};}
 if(n==='complete_x_upload_post'){const j=jobs.find(j=>j.id===p.p_id);j.status='published';j.x_post_id=p.p_post_id;j.locked_by=null;return {error:null};}return {data:true};};
 x.resolveXAccount=async(_a,_u,c)=>({id:c.platform_account_id,enabled:true,config:{status:'connected'}});x.usableXToken=async()=>'';x.uploadReadUrl=async()=>'';x.uploadVideoX=async()=> 'media';x.createTweet=async(_t,text)=>{if(text==='caption 1')throw new x.HttpError('account rejected',403);sent.push(text);return 'post-'+text;};
 for(let i=0;i<5;i++)await x.publishOne(admin,U,{platform_account_id:'acct-'+i},'','worker');
 assert.equal(jobs.filter(j=>j.status==='published').length,4);assert.equal(jobs.filter(j=>j.status==='failed').length,1);
 for(let i=0;i<5;i++)await x.publishOne(admin,U,{platform_account_id:'acct-'+i},'','worker');assert.equal(sent.length,4,'published jobs must not repeat');
 const failed=jobs[1];failed.status='queued';x.createTweet=async(_t,text)=>{sent.push(text);return 'recovered';};await x.publishOne(admin,U,{platform_account_id:'acct-1'},'','worker');assert.equal(sent.length,5);assert.equal(jobs.filter(j=>j.status==='published').length,5);
 // Reply errors must not rewrite publication state; uncertain replies never automatically retry.
 const reply={...jobs[0],reply_text:'reply',reply_status:'pending',external_reply_id:null};db.x_drive_posts=[reply];x.xJson=async()=>{throw new x.HttpError('reply denied',403);};await x.publishReply(admin,reply,'');assert.equal(reply.status,'published');assert.equal(reply.reply_status,'failed');
 reply.reply_status='pending';x.xJson=async()=>{throw Error('network lost');};await x.publishReply(admin,reply,'');assert.equal(reply.reply_status,'uncertain');let called=0;x.xJson=async()=>{called++;};await x.publishReply(admin,reply,'');assert.equal(called,0);
 // Successful automatic reply must reference the accepted parent and stay separate.
 reply.reply_status='pending';reply.external_reply_id=null;x.xJson=async(path,token,method,body)=>{assert.equal(body.reply.in_reply_to_tweet_id,reply.x_post_id);return {data:{id:'reply-success'}};};await x.publishReply(admin,reply,'');assert.equal(reply.external_reply_id,'reply-success');assert.equal(reply.status,'published');
 // A network timeout after the POST starts is quarantined, including across restarts.
 const timeout={...jobs[0],id:'timeout',status:'queued',x_post_id:null,meta:{source:'upload',storage_path:U+'/x-uploads/timeout.mp4'}};jobs.splice(0,jobs.length,timeout);db.x_drive_posts=jobs;x.createTweet=async()=>{throw new x.HttpError('timeout',599,null,true);};await x.publishOne(admin,U,{platform_account_id:timeout.platform_account_id},'','worker');assert.equal(timeout.status,'failed');assert.equal(timeout.meta.publish_uncertain,true);assert.equal(timeout.meta.x_media_id,'media');assert(timeout.meta.publish_started_at);
 let republished=0;x.createTweet=async()=>{republished++;return 'duplicate';};await x.publishOne(admin,U,{platform_account_id:timeout.platform_account_id},'','restarted');assert.equal(republished,0);
 // Reconcile using this account's media ID, never by a caption shared across accounts.
 x.resolveXAccount=async()=>({enabled:true,external_account_id:'qa-x'});x.xJson=async()=>({data:[{id:'reconciled',attachments:{media_keys:['7_media']},created_at:new Date().toISOString()}]});await x.reconcileUncertain(admin,{user_id:U,platform_account_id:timeout.platform_account_id},'');assert.equal(timeout.x_post_id,'reconciled');assert.equal(timeout.status,'published');assert.equal(republished,0);
 console.log('PASS: role gates, IDOR, disabled membership, account metadata, five-account failure isolation, idempotent replay, individual retry, separate reply failure and uncertainty.');
})().catch(e=>{console.error(e);process.exitCode=1;});
