const assert=require('assert/strict');
(async()=>{
process.env.SUPABASE_PROJECT_REF='aaaaaaaaaaaaaaaaaaaa';process.env.SUPABASE_URL='https://aaaaaaaaaaaaaaaaaaaa.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
const {default:handler}=await import('../api/route-guard.js');
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.body=s;}};}
for(const role of ['admin','x_user',null])for(const path of ['x-studio','calendar','production','face-swap','settings','dashboard','instagram','extraction','metrics']){
 global.fetch=async url=>String(url).endsWith('/index.html')?new Response('<html>shell</html>'):Response.json({ok:!!role,role},{status:role?200:401});
 const r=res();await handler({url:'/api/route-guard?path='+path,headers:{cookie:'cf_access=verified'}},r);
 if(role==='x_user'&&path!=='x-studio'){assert.equal(r.statusCode,302);assert.equal(r.headers.Location,'https://cloudent-flow.vercel.app/x-studio');}
 else if(!role&&path!=='x-studio')assert.equal(r.statusCode,302);else assert.equal(r.statusCode,200);
 assert(!String(r.headers.Location).includes('localhost'));assert.equal(r.headers['Cache-Control'],'no-store');
}
console.log('PASS production route gates for admin, X-only, revoked session, canonical redirects');
})().catch(e=>{console.error(e);process.exitCode=1;});
