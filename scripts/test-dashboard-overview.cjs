const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('dashboard-multi-account-patch.js','utf8');
const ids=['c5f2fdd6-00e8-4ca7-adb8-281aa922ad0a','7160f95b-a23c-4f28-a5b8-9502a856e091'];
const fixed=new Date('2026-10-29T19:30:00Z');
class Clock extends Date{constructor(...args){super(...(args.length?args:[fixed]))}static now(){return fixed.getTime()}}
const account=(id,label)=>({id,account_label:label,config:{username:label},enabled:true,platform:'instagram'});
const media=(id,account,views,timestamp='2026-10-29T04:00:00Z')=>({id,platform_account_id:account,views,timestamp,media_product_type:'REELS'});
function fixture(){
 const elements={overview:{innerHTML:''},pageTitle:{textContent:''}};let requests=[],fail=false,delay=null;
 const c=vm.createContext({window:{},document:{getElementById:id=>elements[id]||null,createElement:()=>({}),head:{appendChild:()=>{}}},Date:Clock,Intl,Map,Set,console,
  cloudSession:{user:{id:'owner'}},cloudAccess:{role:'admin'},cloudLoading:false,currentPage:'overview',
  platformAccounts:[account(ids[0],'jujuhmartinss'),account(ids[1],'sahryjapah'),account('old','sahrylinns'),account('disabled','old')],
  IG_METRICS_URL:'https://test/metrics',IG_FOLLOWERS_STATUS_URL:'https://test/followers',
  overview:()=>{},syncDashboardLiveMetrics:async()=>{throw Error('legacy sync must not run on dashboard')},
  loadingShell:()=>'<p>Loading</p>',loadPlatformAccounts:async()=>{},
  edgeFetch:async(url,options)=>{
   const q=new URL(url),id=q.searchParams.get('account_id');requests.push({url,method:options.method});
   if(delay)await delay;
   if(fail)throw Error('offline');
   if(q.pathname==='/followers')return {ok:true,account_id:id,current:{followers_count:id===ids[0]?80000:700,last_checked_at:fixed.toISOString()}};
   return {ok:true,account_id:id,last_collected_at:fixed.toISOString(),summary:{available:true,views:id===ids[0]?(q.searchParams.get('days')==='1'?100:130):50,reels:id===ids[0]?(q.searchParams.get('days')==='1'?90:120):48,stories:id===ids[0]?10:2},media:id===ids[0]?
    [media('j1',id,100),media('j1',id,100),media('boundary',id,30,'2026-09-30T03:00:00Z'),media('too-old',id,1000,'2026-09-30T02:59:59Z'),media('future',id,900,'2026-10-30T03:00:00Z'),media('wrong-account',ids[1],2000),{...media('feed',id,500),media_product_type:'FEED'}]:[media('s1',id,50)]};
  }
 });
 // Browser global properties and bare names resolve to the same object.
 c.window=c;vm.runInContext(source,c);
 return {c,elements,requests,setFail:v=>fail=v,setDelay:v=>delay=v,render:()=>vm.runInContext('overview()',c)};
}
(async()=>{
 const f=fixture();await f.c.refreshDashboardMultiAccount(false);
 assert.equal(f.requests.length,4,'two read-only snapshots per account, concurrent loads coalesced');
 assert(f.requests.every(r=>r.method==='GET'));
 let markup=f.elements.overview.innerHTML;
 assert(markup.includes('<strong>180</strong>'),'official account summary totals for both accounts');
 assert(markup.includes('80.700'),'current follower totals');
 assert(!markup.includes('sahrylinns'),'inactive persona not included');
 assert(markup.includes('<span>Stories</span><b>12</b>'),'real Story summary');assert(markup.includes('<span>Reels</span><b>168</b>'));
 assert(!/canvas|<path|<polyline|<table|PRÓXIMOS POSTS|PROGRAMADOS/.test(markup));
 assert.equal(f.elements.pageTitle.textContent,'Dashboard');
 await f.c.syncDashboardLiveMetrics(true);assert.equal(f.requests.length,4,'existing cadence respects cache and avoids legacy POST');
 f.c.setDashboardAnalyticsPeriod('1');await f.c.refreshDashboardMultiAccount(false);
 assert.equal(f.requests.length,6,'period change rereads media only, followers reused');
 assert(f.elements.overview.innerHTML.includes('<strong>150</strong>'));
 assert(f.requests.slice(4).every(r=>new URL(r.url).searchParams.get('days')==='1'));
 f.c.setDashboardAnalyticsPeriod('invalid');assert(f.elements.overview.innerHTML.includes('<strong>150</strong>'));
 f.setFail(true);await f.c.refreshDashboardMultiAccount(true);
 assert(f.elements.overview.innerHTML.includes('<strong>150</strong>'),'offline preserves same account and period');
 assert(f.elements.overview.innerHTML.includes('último dado preservado'));
 f.c.cloudSession={user:{id:'other'}};f.render();await f.c.refreshDashboardMultiAccount(false);
 assert(!f.elements.overview.innerHTML.includes('80.700'),'session switch clears private cached totals');
 assert(f.elements.overview.innerHTML.includes('<strong>—</strong>'));
 f.c.cloudSession=null;f.render();assert.equal(f.elements.overview.innerHTML,'','logout clears display');
 const late=fixture();await late.c.refreshDashboardMultiAccount(false);
 let release;late.setDelay(new Promise(r=>release=r));
 const loading=late.c.refreshDashboardMultiAccount(true);
 await new Promise(r=>setImmediate(r));
 late.c.cloudSession=null;late.render();release();await loading;
 assert.equal(late.elements.overview.innerHTML,'','late response cannot revive logged-out data');
 const unavailable=fixture();unavailable.c.cloudAccess={role:'x_user'};unavailable.render();await unavailable.c.refreshDashboardMultiAccount(true);
 assert.equal(unavailable.elements.overview.innerHTML,'');assert.equal(unavailable.requests.length,4,'no requests beyond those started before role restriction');
 const empty=fixture();empty.c.platformAccounts=[];empty.render();await empty.c.refreshDashboardMultiAccount(false);
 assert(empty.elements.overview.innerHTML.includes('Nenhuma das duas contas'));assert(empty.elements.overview.innerHTML.includes('<strong>—</strong>'));
 new vm.Script(fs.readFileSync('sw.js','utf8'));
 const sw=fs.readFileSync('sw.js','utf8');
 assert(sw.includes('cloudentflow-pwa-v66'));assert(sw.includes('url.pathname==="/dashboard-multi-account-patch.js"'));
 const swContext=vm.createContext({self:{addEventListener:()=>{}},Response,Headers});vm.runInContext(sw,swContext);
 const legacy='<head></head><body><script>const example=1;</script><script src="/dashboard-multi-account-patch.js?v=1"></script><script src="/dashboard-multi-account-patch.js?v=3"></script></body>';
 const patched=await (await swContext.injectCalendarPatch(new Response(legacy,{headers:{'content-type':'text/html'}}))).text();
 assert.equal((patched.match(/src="\/dashboard-multi-account-patch.js\?v=3"/g)||[]).length,1);
 assert(patched.indexOf('const example=1')<patched.indexOf('dashboard-multi-account-patch.js?v=3'));
 console.log('PASS dashboard: scoped accounts, official account totals and Story breakdown, period cache, GET-only cadence, real Stories, stale data, session/role/logout guards, late responses, empty state, PWA v66 single loader');
})().catch(e=>{console.error(e);process.exitCode=1});
