import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
const file=fs.readFileSync('supabase/functions/cloudent-instagram-publish-recovery/index.ts','utf8');
let status=404,requests=[],cancelled=0;
const code=stripTypeScriptTypes(file.slice(0,file.indexOf('Deno.serve')).replace(/^import .*;\n/gm,''));
const f=vm.runInNewContext(code+';({verifyMediaReadable,mediaFingerprint,MediaGuardError})',{Date,AbortSignal,Error,fetch:async(url,options)=>{requests.push(options);if(status===0)throw Error('timeout');return {status,ok:status>=200&&status<300,body:{cancel:async()=>cancelled++}}}});
for(const [http,expected] of [[404,'media_missing'],[403,'media_unavailable'],[500,'media_unavailable'],[0,'media_unavailable']]){
 status=http;await assert.rejects(()=>f.verifyMediaReadable('https://example.test/media'),e=>e instanceof f.MediaGuardError&&e.code===expected);
}
status=206;await f.verifyMediaReadable('https://example.test/media');
assert.equal(requests.at(-1).headers.Range,'bytes=0-15');assert(cancelled>=4);
assert.notEqual(f.mediaFingerprint({storage_provider:'supabase',storage_path:'old'}),f.mediaFingerprint({storage_provider:'r2',storage_path:'new'}));
assert(file.indexOf('await verifyMediaReadable(mediaUrl)')<file.indexOf('const created=await graph'));
assert(file.includes('calendar_media_block_'));assert(file.includes('state:"media_required"'));
assert(file.includes('eq("locked_by",worker).throwOnError()'));assert(file.includes('.is("instagram_media_id",null).throwOnError()'));
for(const name of ['cloudent-instagram-publish-recovery','cloudent-calendar-cover-worker']){
 const source=fs.readFileSync('supabase/functions/'+name+'/index.ts','utf8');
 new vm.Script(stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'')));
}
console.log('PASS: preflight precedes Meta create; missing vs inaccessible; body cancelled, small Range, source-change invalidation, persisted blocked status guarded by lease and no mediaId');
