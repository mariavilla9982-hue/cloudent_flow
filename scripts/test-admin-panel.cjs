const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('let adminPanelState='),html.indexOf('async function syncScaleMetrics'));
const ig={id:'ig',platform:'instagram',account_label:'nova',enabled:true},x={id:'x',platform:'x',account_label:'reis',enabled:true};
const root={innerHTML:''};let requests=[],confirmValue=true,release=null;
const ctx=vm.createContext({Set,JSON,Promise,cloudSession:{user:{id:'owner'}},cloudAccess:{role:'admin'},currentPage:'admin',platformAccounts:[ig,x],document:{getElementById:()=>root},
 esc:v=>String(v).replaceAll('<','&lt;'),scaleHandle:v=>'@'+v,scaleAction:(a,l)=>`<button data-action="${a}">${l}</button>`,scaleKpi:(l,v)=>`${l}:${v}`,
 confirm:()=>confirmValue,toast:()=>{},friendlyCloudentError:v=>v,X_POSTING_URL:'https://test/x',loadPlatformAccounts:async()=>true,loadInstagramScaleSummary:async()=>{},
 cloudFetch:async(url,options)=>{requests.push({url,options});if(release)await release},edgeFetch:async(url,options)=>requests.push({url,options})});
vm.runInContext(source,ctx);
(async()=>{
 ctx.adminPage();assert(root.innerHTML.includes('nova')&&root.innerHTML.includes('reis'));assert(root.innerHTML.includes('Painel de admin'));
 confirmValue=false;await ctx.adminDisconnectAccount('ig');assert.equal(requests.length,0);
 confirmValue=true;await ctx.adminDisconnectAccount('ig');assert.equal(requests.length,1);assert.equal(JSON.parse(requests[0].options.body).platform_account_id,'ig');assert.equal(ctx.platformAccounts[0].enabled,false);assert.equal(ctx.platformAccounts[1].enabled,true);
 await ctx.adminDisconnectAccount('x');assert(requests[1].url.endsWith('action=account-status'));assert.equal(JSON.parse(requests[1].options.body).platform_account_id,'x');
 ctx.platformAccounts=[{...ig,enabled:true}];let done;release=new Promise(r=>done=r);const task=ctx.adminDisconnectAccount('ig');await ctx.adminDisconnectAccount('ig');assert.equal(requests.length,3,'double click coalesced');ctx.cloudSession=null;done();await task;ctx.adminPage();assert.equal(root.innerHTML,'','logout clears private page');
 ctx.cloudSession={user:{id:'secondary'}};ctx.cloudAccess={role:'x_user'};ctx.adminPage();await ctx.adminDisconnectAccount('ig');assert.equal(requests.length,3);assert.equal(root.innerHTML,'','secondary users cannot use admin');
 assert(html.includes('admin:adminPage')&&html.includes('pages:["admin","settings"]')&&html.includes('"admin","accounts"'),'desktop/mobile nav and renderer wired');
 console.log('PASS admin: dynamic IG/X list, explicit account IDs, cancel, isolated disconnect, duplicate click, logout and role guards, navigation');
})().catch(e=>{console.error(e);process.exitCode=1});
