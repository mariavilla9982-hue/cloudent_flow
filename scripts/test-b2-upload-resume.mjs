import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the storage verification logic with realistic B2 responses, without real credentials.
const source=fs.readFileSync('supabase/functions/_shared/image-pipeline-api.ts','utf8');
const start=source.indexOf('export async function uploadedObjectMatches(');
const end=source.indexOf('\nfunction genjutsuMedia(',start);
assert(start>=0&&end>start,'storage verification function exists');
const fn=source.slice(start,end).replace('export async function uploadedObjectMatches(address:string,size:number)','async function uploadedObjectMatches(address,size)');
function harness(responses){
  let calls=0;
  const ctx={
    fetch:async()=>{const response=responses[calls++];if(response instanceof Error)throw response;return response;},
    AbortSignal, console:{warn(){}}, setTimeout:(f)=>f()
  };
  vm.runInNewContext(fn+';this.verify=uploadedObjectMatches',ctx);
  return {verify:ctx.verify,calls:()=>calls};
}
const response=(status,total)=>({
  status,ok:status>=200&&status<300,
  headers:new Headers(status===206?{'content-range':'bytes 0-0/'+total}:{'content-length':String(total)}),
  body:{async cancel(){}}
});
let h=harness([new Error('connection closed before message completed'),response(206,1024)]);
assert.equal(await h.verify('https://example.test/presigned-url',1024),true);
assert.equal(h.calls(),2,'retries an interrupted B2 verification');
h=harness([response(404,0)]);
assert.equal(await h.verify('https://example.test/presigned-url',1024),false);
assert.equal(h.calls(),1,'does not retry genuinely absent objects');
h=harness([response(503,0),response(206,1024)]);
assert.equal(await h.verify('https://example.test/presigned-url',1024),true);
assert.equal(h.calls(),2,'retries a transient B2 server error');
h=harness([response(206,999)]);
assert.equal(await h.verify('https://example.test/presigned-url',1024),false,'rejects truncated uploads');
h=harness([new Error('connection closed'),new Error('connection closed'),new Error('connection closed')]);
await assert.rejects(h.verify('https://example.test/presigned-url',1024),/Falha temporária/);
assert.equal(h.calls(),3,'bounded retries');

const frontend=fs.readFileSync('image-pipeline-ui.js','utf8');
assert(frontend.includes('if(ticket.original?.already_uploaded)sentVideo=entry.original.size'));
assert(frontend.includes('if(ticket.reference?.already_uploaded)sentFrame=entry.reference.size'));
assert(source.includes('parts[key].already_uploaded=await uploadedObjectMatches'));
const retryGuard=source.match(/const paidPointsRejected=([\s\S]*?);\n    if\(j.status/);
assert(retryGuard,'safe paid-points retry guard exists');
const canRetryAfterCredits=Function('j','return ('+retryGuard[1]+')');
const paidPointsJob={
  meta:{stage:'face_swap',error_stage:'face_swap'},
  runninghub_task_id:null,
  last_error:'Insufficient paid points. Consumer API keys can only spend paid points; free points are not accepted.'
};
assert.equal(canRetryAfterCredits(paidPointsJob),true,'manual retry becomes eligible after paid-points rejection');
assert.equal(canRetryAfterCredits({...paidPointsJob,runninghub_task_id:'existing-task'}),false,'never retry an existing external task');
assert.equal(canRetryAfterCredits({...paidPointsJob,last_error:'Server error'}),false,'unrelated errors remain protected');
console.log('PASS RunningHub: paid-points rejection manual retry eligibility, existing task and unrelated-error guards');
console.log('PASS B2: network retries, 5xx retries, 404 no retry, size verification, bounded failure, and resumable tickets');
