import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {amount, accountAmounts, taskAmounts} from '../supabase/functions/_shared/runninghub-points.ts';

for(const value of [null,undefined,'',true,false,'abc',-1,Infinity])assert.equal(amount(value),null);
assert.equal(amount('0'),0);assert.equal(amount('1.28'),1.28);
assert.equal(accountAmounts({remainPoint:88.5,remainCoins:'123'}).points,88.5);
const result={taskId:'1',status:'SUCCESS',usage:{settleMode:'POINT',chargedPoint:'1.28',consumeCoins:null},taskUsageList:[{usage:{chargedPoint:'1.28'}}],results:[{},{}]};
assert.equal(taskAmounts(result,'2'),null);
assert.equal(taskAmounts({...result,status:'RUNNING'},'1'),null);
assert.equal(taskAmounts(result,'1').points,1.28);
assert.equal(taskAmounts(result,'1').settled,true);
assert.equal(taskAmounts({...result,usage:{settleMode:'POINT',chargedPoint:null,consumeCoins:'0'}},'1').settled,false);
assert.equal(taskAmounts({...result,usage:{settleMode:'POINT',chargedPoint:'0'}},'1').settled,true);

const sample={balance:{points:88.5,coins:100,fetched_at:new Date().toISOString()},totals:[
 {key:'today',module:'all',points:12.8,tasks:3,pending:1},
 {key:'month',module:'all',points:40,tasks:10,pending:2},
 {key:'today',module:'GENJUTSU V3',points:10,tasks:1,pending:0}],modules:[],recent:[]};
const c={window:null,document:{createElement:()=>({}),head:{appendChild(){}},querySelectorAll:()=>[],querySelector:()=>null},setInterval:()=>{},URLSearchParams,cloudSession:{access_token:'session1'},cloudAccess:{role:'admin'},currentPage:'overview',overview:()=>{},console,Intl,Date};c.window=c;
let calls=0,reply=sample,fail=false,wait;
c.edgeFetch=async()=>{calls++;if(wait)await wait;if(fail)throw Error('offline');return reply};
vm.createContext(c);vm.runInContext(fs.readFileSync('runninghub-points.js','utf8'),c);
assert(!c.CloudentPoints.markup().includes('>0 <small>pts'));
await Promise.all([c.CloudentPoints.load(),c.CloudentPoints.load()]);assert.equal(calls,1);
assert(c.CloudentPoints.markup().includes('88,5'));assert(c.CloudentPoints.markup().includes('cobrança(s) pendente(s)'));
await c.CloudentPoints.load();assert.equal(calls,1);
assert(!c.CloudentPoints.markup().includes('RH coins'));assert(!c.CloudentPoints.expenses().includes('RH coins'));assert(c.CloudentPoints.header().includes('88,5'));
fail=true;await c.CloudentPoints.refresh();assert(c.CloudentPoints.markup().includes('88,5'));assert(c.CloudentPoints.markup().includes('Última leitura preservada'));
fail=false;let release;wait=new Promise(r=>release=r);const pending=c.CloudentPoints.refresh();
c.cloudSession=null;assert.equal(c.CloudentPoints.markup(),'');release();await pending;
c.cloudSession={access_token:'session2'};assert(!c.CloudentPoints.markup().includes('88,5'),'old response discarded on logout');
c.cloudAccess.role='x_user';assert.equal(c.CloudentPoints.markup(),'');

// Exercise actual endpoint auth gates without touching any provider or database.
let handler,rpcs=0,memberRole='admin',sessionActive=true;
const edge=fs.readFileSync('supabase/functions/cloudent-points/index.ts','utf8').replace(/^import .*;\n/gm,'');
const admin={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},rpc:async name=>{rpcs++;return {data:name==='cloudent_auth_session_active'?sessionActive:'worker-secret'}},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{enabled:true,role:memberRole}})})};
const ctx={createClient:()=>admin,Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://test.supabase.co':'secret'},serve:fn=>handler=fn},Response,Request,URL,atob,console,amount,accountAmounts,taskAmounts};
vm.runInNewContext(stripTypeScriptTypes(edge),ctx);
assert.equal((await handler(new Request('https://test/'))).status,403);assert.equal(rpcs,0);
assert.equal((await handler(new Request('https://test/?action=worker',{method:'POST'}))).status,401);assert.equal(rpcs,0);
const token='x.'+Buffer.from(JSON.stringify({iss:'https://test.supabase.co/auth/v1',session_id:'11111111-1111-4111-8111-111111111111'})).toString('base64url')+'.x';
memberRole='x_user';assert.equal((await handler(new Request('https://test/',{headers:{Authorization:'Bearer '+token}}))).status,403);
memberRole='admin';sessionActive=false;assert.equal((await handler(new Request('https://test/',{headers:{Authorization:'Bearer '+token}}))).status,403);
console.log('PASS billing amounts, task/terminal binding, duplicate outputs, pending/zero; dashboard cache, errors, logout, role and late responses; endpoint anonymous/X/revoked-session isolation');
