import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {handleInstagramDisconnect} from '../functions/cloudent-api/instagram-disconnect.ts';
import {instagramScaleAccounts} from '../functions/cloudent-api/instagram-scale.ts';
import {panelViewApi} from '../functions/cloudent-api/panel-view.ts';

const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(script[1]);
const start=html.indexOf('const CALENDAR_ACCOUNT_KEY=');
const end=html.indexOf('async function syncFromBackend',start);
const ctx=vm.createContext({localStorage:{getItem:()=> 'A',setItem(){}},platformAccounts:[{id:'A',platform:'instagram'},{id:'B',platform:'instagram'}],state:{slots:{}},weekDates:()=>[],calendarDayVolume:()=>5,localISO:d=>d.toISOString().slice(0,10)});
vm.runInContext(html.slice(start,end),ctx);
const rows=[{platform:'instagram',platform_account_id:'A',id:1},{platform:'instagram',platform_account_id:'B',id:2},{platform:'instagram',id:3},{platform:'x',platform_account_id:'A',id:4}];
ctx.rows=rows;
assert.equal(vm.runInContext('calendarFilterQueueRows(rows).map(r=>r.id).join()',ctx),'1');
vm.runInContext('calendarActiveAccountId="B"',ctx);
assert.equal(vm.runInContext('calendarFilterQueueRows(rows).map(r=>r.id).join()',ctx),'2');
ctx.platformAccounts=[{id:'B',platform:'instagram'}];
assert.equal(vm.runInContext('calendarFilterQueueRows(rows).map(r=>r.id).join()',ctx),'2');
vm.runInContext('calendarActiveAccountId="REMOVED"',ctx);
assert.equal(vm.runInContext('calendarEnsureAccount()',ctx),'');
assert.equal(vm.runInContext('calendarEnsureAccount()',ctx),'');
assert.equal(vm.runInContext('calendarFilterQueueRows(rows).length',ctx),0);
ctx.platformAccounts=[];
assert.equal(vm.runInContext('calendarFilterQueueRows(rows).length',ctx),0);

let handler;
let queries=[];
let account={id:'B',enabled:true};
let rpcCalls=[];
const admin={rpc:async(name,args)=>{rpcCalls.push({name,args});return {data:name==='cloudent_auth_session_active'?true:name==='instagram_scale_accounts'?(account?[account]:[]):null,error:null}},auth:{getUser:async()=>({data:{user:{id:'USER'}}})},from(table){
  const query={table,filters:[]};queries.push(query);
  const builder=new Proxy({}, {get(_,key){
    if(key==='then')return (resolve)=>resolve({data:[],error:null});
    if(key==='maybeSingle')return async()=>({data:table==='app_members'?{role:'admin',enabled:true,workspace_id:'w'}:account,error:null});
    return (...args)=>{query[key]=args;query.filters.push([key,...args]);return builder};
  }});return builder;
}};
const source=readFileSync(new URL('../functions/cloudent-api/index.ts',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'');
const code=stripTypeScriptTypes(source,{mode:'transform'});
new Function('Deno','createClient','AwsClient','defaultCharacterBase64','handleInstagramDisconnect','panelViewApi','instagramScaleAccounts',code)({env:{get:n=>n==='SUPABASE_URL'?'https://test.supabase.co':''},serve:fn=>handler=fn},()=>admin,class{},'',handleInstagramDisconnect,panelViewApi,instagramScaleAccounts);
for(const compact of [false,true]){
  queries=[];
  const response=await handler(new Request('https://app.test/?resource=queue'+(compact?'&compact=1':''),{headers:{Authorization:'Bearer h.'+Buffer.from(JSON.stringify({iss:'https://test.supabase.co/auth/v1',session_id:'session'})).toString('base64url')+'.s'}}));
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  assert.ok(queries.find(q=>q.table==='schedules').select[0].split(',').includes('platform_account_id'));
}
const resolverCode=stripTypeScriptTypes(source.slice(source.indexOf('async function resolveCalendarInstagramAccount'),source.indexOf('Deno.serve')),{mode:'transform'});
const resolveAccount=new Function('instagramScaleAccounts',resolverCode+';return resolveCalendarInstagramAccount')(instagramScaleAccounts);
queries=[];
await assert.rejects(()=>resolveAccount(admin,''),/Selecione explicitamente/);
assert.equal(queries.length,0);
rpcCalls=[];
assert.equal(await resolveAccount(admin,'B','USER'),'B');
assert.equal(rpcCalls[0].name,'instagram_scale_accounts');assert.equal(rpcCalls[0].args.p_actor,'USER');
account=null;
await assert.rejects(()=>resolveAccount(admin,'REMOVED'),/não está disponível/);
console.log('Calendar account isolation, missing-account rejection, compact/full API payloads, removed-account handling and JS/TS syntax: passed.');
