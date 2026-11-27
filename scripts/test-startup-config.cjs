const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8'),sw=fs.readFileSync('sw.js','utf8');
const source=html.slice(html.indexOf('async function loadCloudConfig(){'),html.indexOf('\nconst pageSubtitles='));
assert.match(html,/<script id="cloudentAuthConfig" src="\/api\/auth-config" defer><\/script>/);
function harness(config){const listeners=new Map();let timeout,cleared=0;const c=vm.createContext({window:{CloudentConfig:config},document:{getElementById:()=>({addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)})},setTimeout:f=>(timeout=f,1),clearTimeout:()=>cleared++});vm.runInContext('let SUPABASE_URL="",SUPABASE_KEY="",EDGE_URL,IG_CONNECT_URL,IG_METRICS_URL,IG_STATUS_URL,IG_FOLLOWERS_STATUS_URL,IG_PUBLISH_TEST_URL,X_OAUTH_URL;'+source,c);return {c,listeners,expire:()=>timeout(),cleared:()=>cleared};}
(async()=>{
 let h=harness();const p=h.c.loadCloudConfig();assert(h.listeners.has('load'));h.c.window.CloudentConfig={supabaseUrl:'https://test',publishableKey:'public'};h.listeners.get('load')();await p;assert.equal(vm.runInContext('EDGE_URL',h.c),'https://test/functions/v1/cloudent-api');assert.equal(h.listeners.size,0);assert.equal(h.cleared(),1);
 h=harness();const timed=h.c.loadCloudConfig();h.expire();await assert.rejects(timed,/configuração/);assert.equal(h.listeners.size,0);
 h=harness();const failed=h.c.loadCloudConfig();h.listeners.get('error')();await assert.rejects(failed,/configuração/);assert.equal(h.listeners.size,0);
 h=harness({});await assert.rejects(h.c.loadCloudConfig(),/indisponível/);
 h=harness({supabaseUrl:'https://test',publishableKey:'public'});await h.c.loadCloudConfig();assert.equal(h.listeners.size,0);
 const ctx=vm.createContext({self:{addEventListener(){}},Response,Headers});vm.runInContext(sw,ctx);
 for(const modern of [false,true]){const input='<html><head><script src="/api/auth-config"></script></head><body>'+(modern?'async function loadCloudConfig(){}':'')+'</body></html>';const out=await(await ctx.injectCalendarPatch(new Response(input,{headers:{'content-type':'text/html'}}))).text();assert.equal(out.includes('id="cloudentAuthConfig" src="/api/auth-config" defer'),modern,'legacy config stays synchronous');}
 console.log('PASS deferred config, endpoint initialization, timeout/error cleanup, invalid config, preloaded config and legacy cache ordering');
})().catch(e=>{console.error(e);process.exit(1)});
