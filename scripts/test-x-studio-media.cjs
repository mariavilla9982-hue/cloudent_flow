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
function context(path,admin){const c={crypto,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,AbortSignal,fetch:async()=>{throw Error('External request forbidden in tests');},console,setTimeout,clearTimeout,Uint8Array,Buffer,btoa,atob,createClient:()=>admin,twitterText:{parseTweet:t=>({valid:t.length>0&&t.length<=280})},Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test':''},serve:f=>{c.handler=f;}}};vm.createContext(c);const js=stripTypeScriptTypes(fs.readFileSync(path,'utf8')).replace(/^import .*;\n/gm,'');vm.runInContext(js,c);vm.runInContext('globalThis.HttpError=typeof HttpError!=="undefined"?HttpError:Error',c);return c;}
(async()=>{
 const db={x_account_configs:[{platform_account_id:A,last_metrics_at:null}],x_drive_posts:[{id:'p',platform_account_id:A,x_post_id:'post'}]};
 const admin={from:t=>new Query(db,t)};const x=context('supabase/functions/cloudent-x-publish-worker/index.ts',admin);
 let seen=[];x.fetch=async(url,opt)=>{seen.push(opt);return new Response(new Uint8Array([255,216,255]),{status:206,headers:{'Content-Range':'bytes 0-2/25000','Content-Type':'image/jpeg'}});};
 assert.equal(await x.uploadedThumbnailMatches('signed-get'),true);assert.equal(seen[0].method,'GET');assert.equal(seen[0].headers.Range,'bytes=0-2');
 x.fetch=async()=>new Response(new Uint8Array([1,2,3]),{status:206,headers:{'Content-Range':'bytes 0-2/25000','Content-Type':'image/jpeg'}});assert.equal(await x.uploadedThumbnailMatches('bad-jpeg'),false);
 x.fetch=async()=>new Response('',{status:403});assert.equal(await x.uploadedThumbnailMatches('unavailable'),false);
 x.usableXToken=async()=> 'mock-token';let calls=0;
 x.xJson=async(path)=>{calls++;if(path.includes('/tweets?'))return {data:[{id:'post',author_id:'own',public_metrics:{like_count:7}},{id:'foreign',author_id:'other',public_metrics:{like_count:999}}]};return {data:{id:'own',public_metrics:{followers_count:123}}};};
 const result=await x.syncAccountMetrics(admin,{id:A,external_account_id:'own'},'');assert.equal(result.updated,1);assert.equal(db.x_account_configs[0].metrics_snapshot.account.followers_count,123);assert.equal(db.x_account_configs[0].metrics_snapshot.recent_posts.length,1);assert.equal(db.x_drive_posts[0].metrics.like_count,7);
 await x.syncAccountMetrics(admin,{id:A,external_account_id:'own'},'');assert.equal(calls,2,'cooldown must avoid duplicate external reads');
 db.x_account_configs[0].last_metrics_at=null;x.xJson=async()=>{throw new x.HttpError('forbidden',403)};await assert.rejects(x.syncAccountMetrics(admin,{id:A,external_account_id:'own'},''),/API do X/);assert.equal(db.x_account_configs[0].metrics_snapshot.account.followers_count,123,'failed read must preserve previous metrics');

 const Uuid='11111111-1111-4111-8111-111111111111',path=U+'/x-uploads/'+Uuid+'.mp4';
 const apiDb={app_members:[{user_id:U,role:'x_user',enabled:true,workspace_id:'w'}],platform_accounts:[{id:A,platform:'x',enabled:true,config:{status:'connected'}},{id:B,platform:'x',enabled:true,config:{status:'connected'}}],x_account_configs:[],x_drive_posts:[],x_caption_queue:[]};
 const apiAdmin={auth:{getUser:async()=>({data:{user:{id:U}}})},from:t=>new Query(apiDb,t),rpc:async(n,p)=>({data:n==='get_cloudent_worker_secret'?'mock-master':n==='cloudent_x_access'?p.p_account===A:true})};
 const api=context('supabase/functions/cloudent-x-publish-worker/index.ts',apiAdmin);api.uploadReadUrl=async()=> 'signed-get';api.uploadedVideoMatches=async()=>true;api.uploadedThumbnailMatches=async()=>true;
 const jwt='header.'+Buffer.from(JSON.stringify({iss:'https://test/auth/v1',session_id:'test-session'})).toString('base64url')+'.signature';
 async function call(action,body){return api.handler(new Request('https://test/?action='+action,{method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify({platform_account_id:A,...body})}));}
 let response=await call('upload-complete',{object_path:path,provider:'r2',thumbnail_path:path+'.jpg',size_bytes:100,mime_type:'video/mp4',file_name:'neutral.mp4',caption:'Neutral caption',scheduled_at:'2030-10-20T18:00:00.000Z'});assert.equal(response.status,200);assert.equal(apiDb.x_drive_posts[0].scheduled_at,'2030-10-20T18:00:00.000Z');assert.equal(apiDb.x_drive_posts[0].meta.thumbnail_path,path+'.jpg');
 api.uploadedThumbnailMatches=async()=>false;response=await call('upload-complete',{object_path:path,provider:'r2',thumbnail_path:path+'.jpg',size_bytes:100,mime_type:'video/mp4',file_name:'neutral.mp4',caption:'',gallery:true});assert.equal(response.status,200);assert.equal((await response.json()).thumbnail_warning,true);assert.equal(apiDb.x_drive_posts[1].scheduled_at,null);assert.equal(apiDb.x_drive_posts[1].post_text,'');
 response=await call('upload-complete',{object_path:path,provider:'r2',thumbnail_path:'other/path.jpg'});assert.equal(response.status,403);
 response=await call('caption-add',{caption:'Neutral queue caption'});assert.equal(response.status,200);assert.equal(apiDb.x_caption_queue[0].platform_account_id,A);
 response=await call('caption-add',{platform_account_id:B,caption:'Not authorized'});assert.equal(response.status,403);
 response=await call('save-config',{enabled:false,daily_slots:['21:00','06:00','15:00'],queue_mode:'daily_slots',interval_minutes:360});assert.equal(response.status,200);const saved=(await response.json()).config;assert.deepEqual(saved.daily_slots,['06:00','15:00','21:00']);assert.equal(saved.timezone,'America/Sao_Paulo');assert.equal(saved.enabled,false);
 console.log('PASS GET/range/JPEG thumbnail validation; real-account metrics, account isolation, cooldown, failure preservation');
})().catch(e=>{console.error(e);process.exitCode=1;});
