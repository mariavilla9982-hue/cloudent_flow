const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
function extract(name){const start=html.indexOf('async function '+name+'(');assert(start>=0);const end=html.indexOf('\nasync function ',start+1);return html.slice(start,end);}
function harness(fetch){let timer,cleared=0;const c=vm.createContext({fetch,AbortController,setTimeout:fn=>(timer=fn,1),clearTimeout:()=>cleared++,console});vm.runInContext(extract('authRecoveryRequest'),c);return {c,expire:()=>timer(),cleared:()=>cleared};}
(async()=>{
 let h=harness((_url,opts)=>new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('aborted')))));
 let p=h.c.authRecoveryRequest('login',{});h.expire();await assert.rejects(p,/demorou demais/);assert.equal(h.cleared(),1);
 h=harness(async()=>({ok:false,status:401,json:async()=>({error:'invalid_credentials'})}));await assert.rejects(h.c.authRecoveryRequest('login',{}),e=>e.status===401);assert.equal(h.cleared(),1);
 h=harness(async()=>({ok:true,status:200,json:async()=>({ok:true})}));await assert.rejects(h.c.authRecoveryRequest('login',{}),/inválida/);
 h=harness(async()=>({ok:true,status:200,json:async()=>({ok:true,session:{access_token:'test'}})}));assert.equal((await h.c.authRecoveryRequest('login',{})).session.access_token,'test');assert.equal(h.cleared(),1);
 // Run the actual initializer with valid access but unavailable account metadata.
 const events=[],session={access_token:'header.'+Buffer.from(JSON.stringify({iss:'https://test/auth/v1'})).toString('base64url')+'.sig'};
 const c=vm.createContext({SESSION_KEY:'test-session',localStorage:{getItem:()=>JSON.stringify(session)},atob,JSON,Date,SUPABASE_URL:'https://test',location:{pathname:'/'},document:{body:{classList:{toggle(){}}}},cloudSession:null,cloudAccess:null,backendOnline:false,currentPage:'overview',authRecoveryRequest:async()=>({ok:true,role:'admin'}),persistCloudSession:()=>{throw Error('must not clear valid session')},nav(){},syncAuthGate:()=>events.push('gate'),setLoginBusy(){},setLoginMessage(){},testBackend:async()=>{c.backendOnline=true},withTimeout:p=>p,loadPlatformAccounts:async()=>{throw Error('offline')},console:{warn(){}},canAccessPage:()=>true});
 for(const name of ['syncFromBackend','loadDashboardScheduleRows','loadStorageBackendStatus','loadInstagramStatus','loadInstagramWebSessionStatus','loadAutomationStatus','loadFollowerStats','loadTrialReels','loadXPostingStatus','loadXIntegrationConfig','loadNotifications'])c[name]=async()=>events.push('data');
 vm.runInContext(extract('initCloud'),c);await c.initCloud();assert.equal(events[0],'gate');assert(events.includes('data'));assert.equal(c.cloudSession.access_token,session.access_token);
 c.authRecoveryRequest=async()=>{const e=Error('unavailable');e.status=503;throw e};await assert.rejects(c.initCloud(),/unavailable/);assert(c.cloudSession);
 let validations=0;c.authRecoveryRequest=async()=>{validations++;return {ok:true,role:'admin'}};
 await c.initCloud({ok:true,session,role:'admin',workspace_id:'workspace'});assert.equal(validations,0,'exact freshly verified login skips duplicate request');
 await c.initCloud({ok:true,session:{access_token:'different'},role:'admin',workspace_id:'workspace'});assert.equal(validations,1,'foreign token must validate');
 await c.initCloud();assert.equal(validations,2,'reload must validate');
 console.log('PASS aborted login, credential status, invalid response, successful login, gate before secondary data, account outage and transient session failure');
})().catch(e=>{console.error(e);process.exit(1)});
