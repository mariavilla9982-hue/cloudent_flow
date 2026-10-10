import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {stripTypeScriptTypes} from 'node:module';
const ctx=vm.createContext({Date,Intl,Number,Error,AbortSignal,fetch:async()=>({ok:false,status:401,json:async()=>({error:{message:'login required'}})})});
const mod=new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(new URL('../functions/instagram-metrics-today/metrics-core.ts',import.meta.url),'utf8')),{context:ctx});await mod.link(()=>{});await mod.evaluate();const m=mod.namespace;
assert.equal(m.metricCutoff(1,new Date('2026-10-10T02:59:59Z')),'2026-10-09T03:00:00.000Z');assert.equal(m.metricCutoff(120,new Date('2026-10-10T03:00:00Z')),'2026-06-13T03:00:00.000Z');
let writes=0;await assert.rejects(()=>m.storeMetric({from(){writes++;throw Error('write')}},{base:'https://graph.instagram.com/v26.0',token:'test',account:{id:'A'}},{id:'1',timestamp:new Date().toISOString()}),/login required/);assert.equal(writes,0);
ctx.fetch=async()=>({ok:true,json:async()=>({data:[{name:'views',values:[{value:0}]},{name:'reach',values:[{value:0}]},{name:'saved',values:[{value:0}]},{name:'shares',values:[{value:0}]}]})});assert.equal((await m.metricInsights('x','id','test')).metrics.views,0);
function builder(data){return new Proxy({},{get(_,k){if(k==='then')return (resolve)=>resolve({data,error:null});if(k==='maybeSingle'||k==='single')return async()=>({data,error:null});return ()=>builder(data)}})}
const memberAdmin={from:table=>builder(table==='app_members'?{enabled:true,role:'admin'}:[{id:'A',config:{}},{id:'B',config:{owner_user_id:'other'}}])};assert.equal((await m.metricAccount(memberAdmin,'user',null)).id,'A');assert.equal((await m.metricAccount(memberAdmin,'user','B')).id,'B');
const member={from:table=>builder(table==='app_members'?{enabled:true,role:'member'}:[{id:'B',config:{owner_user_id:'other'}}])};await assert.rejects(()=>m.metricAccount(member,'user','B'),/account_not_found/);
const disabled={from:()=>builder({enabled:false,role:'admin'})};await assert.rejects(()=>m.metricAccount(disabled,'user','A'),/forbidden/);
let ranges=[];const rows=Array.from({length:501},(_,i)=>({ig_media_id:String(i),media_product_type:'REELS',views:i,posted_at:'2026-10-10T03:00:00Z'}));
const paginated={from(){const q={};for(const k of ['select','eq','gte','order'])q[k]=()=>q;q.range=async(a,b)=>{ranges.push([a,b]);return {data:rows.slice(a,b+1),error:null}};return q}};
assert.equal((await m.storedMetrics(paginated,'A','2026-01-01')).length,501);assert.deepEqual(ranges,[[0,499],[500,999]]);
console.log('PASS: API failures cannot overwrite metrics, measured zero is valid, disabled/foreign accounts blocked, account defaults stable, 120-day Brazil cutoff, stored pagination');
