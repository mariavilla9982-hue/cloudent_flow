import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';

const source=fs.readFileSync('supabase/functions/cloudent-posting-scheduler-recovery/index.ts','utf8');
// Run the actual dispatch block with the same five disconnected oldest rows
// that previously prevented the connected account from ever being attempted.
const block=source.slice(source.indexOf('    // Normal Reels.'),source.indexOf('    const failed=results.filter'));
let clock=Date.now();
const rows=[];
const add=(id,account,status='scheduled',extra={})=>rows.push({id,platform:'instagram',platform_account_id:account,status,scheduled_at:'2026-10-20T12:00:00Z',updated_at:'2026-10-20T00:00:00Z',instagram_media_id:null,...extra});
for(let i=0;i<5;i++)add('disconnected-'+i,'a');
for(let i=0;i<6;i++)add('missing-'+i,'b','failed');
add('ready','b');
add('future','b','scheduled',{scheduled_at:'2030-01-01T00:00:00Z'});
add('published','b','published',{instagram_media_id:'existing'});
add('cancelled','b','cancelled');
add('disabled','c');
const calls=[];
class Query{
  constructor(table){this.table=table;this.filters=[];this.orders=[];this.limitCount=Infinity;}
  select(){return this;} eq(k,v){this.filters.push(r=>r[k]===v);return this;}
  in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}
  lte(k,v){this.filters.push(r=>r[k]<=v);return this;}
  is(k,v){return this.eq(k,v);} order(k){this.orders.push(k);return this;}
  limit(n){this.limitCount=n;return this;} update(patch){this.patch=patch;return this;}
  then(resolve,reject){try{
    const base=this.table==='platform_accounts'?[{id:'a',platform:'instagram',enabled:true},{id:'b',platform:'instagram',enabled:true},{id:'c',platform:'instagram',enabled:false}]:rows;
    let found=base.filter(r=>this.filters.every(f=>f(r)));
    found.sort((a,b)=>{for(const k of this.orders){if(a[k]!==b[k])return a[k]<b[k]?-1:1;}return 0;});
    found=found.slice(0,this.limitCount);
    if(this.patch)for(const r of found)Object.assign(r,this.patch);
    resolve({data:found.map(r=>({...r})),error:null});
  }catch(e){reject(e);}}
}
const admin={from:t=>new Query(t),rpc:async(_,args)=>({data:args.p_account_id==='b'?'private-test-token':null,error:null})};
class Clock extends Date{constructor(...args){super(...(args.length?args:[++clock]));}}
const run=vm.runInNewContext(stripTypeScriptTypes('(async function(){'+block+';return results;})'),{
  admin,body:{},now:'2026-10-22T00:00:00Z',expected:'worker-secret',results:[],Date:Clock,
  Deno:{env:{get:()=> 'https://example.invalid'}},AbortSignal,
  fetch:async(_,request)=>{const {schedule_id:id}=JSON.parse(request.body);calls.push(id);if(id==='missing-0')throw new Error('timeout');return {status:409,json:async()=>({ok:false,state:'media_required'})};}
});
const first=await run();
assert.equal(calls.length,5);assert(calls.every(id=>id.startsWith('missing-')));
assert(first.some(r=>r.id==='a'&&r.error==='instagram_reconnect_required'));
await run();
assert(calls.includes('ready'),'healthy item must advance even with six older failed items');
for(const id of ['future','published','cancelled','disabled'])assert(!calls.includes(id));
assert(!JSON.stringify(first).includes('private-test-token'));
// Full file parses after stripping types/imports, without executing network code.
new vm.Script(stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'')));
console.log('PASS: disconnected account isolation, bounded batches, failure/timeout rotation, future/published/cancelled preservation and full TS syntax');
