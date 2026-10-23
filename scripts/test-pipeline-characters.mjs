import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHash,webcrypto} from 'node:crypto';
import {PIPELINE_CHARACTERS} from '../supabase/functions/_shared/image-pipeline-characters.ts';
const apiSource=fs.readFileSync('supabase/functions/_shared/image-pipeline-api.ts','utf8');
const sandbox={PIPELINE_CHARACTERS,ROOT_IMAGE_B64:'',ROOT_IMAGE_SHA:'legacy',atob,Request,Response,URL,AbortSignal,Uint8Array,crypto:webcrypto,retryPipelineMotion:async()=>({ok:true})};
vm.createContext(sandbox);vm.runInContext(stripTypeScriptTypes(apiSource).replace(/^import .*;\n/gm,'').replace(/export /g,'')+'\nthis.api=imagePipelineApi;',sandbox);
const rows=[],uploads=[];
const admin={storage:{from(){return {upload:async(path,bytes,opts)=>{assert.equal(opts.upsert,false);uploads.push({path,hash:createHash('sha256').update(bytes).digest('hex')});return {error:null};}}}},from(){let filters=[],mode='select',value;const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},contains(k,v){filters.push(r=>Object.entries(v).every(([x,y])=>r[k]?.[x]===y));return q},maybeSingle(){return q},insert(v){mode='insert';value=v;return q},then(resolve){if(mode==='insert'){rows.push(structuredClone(value));return Promise.resolve({data:value}).then(resolve);}return Promise.resolve({data:rows.find(r=>filters.every(f=>f(r)))||null}).then(resolve);}};return q;}};
async function api(body,resource){const url=new URL('https://test/?'+(resource?'resource='+resource:'action=image-pipeline-ticket'));return sandbox.api({req:new Request(url,{method:resource?'GET':'POST',...(resource?{}:{body:JSON.stringify(body)})}),url,admin,user:{id:'owner'},json:(body,status=200)=>({body,status}),objectConfig:async()=>({}),signPut:async(c,p)=>'https://storage/'+p,signGet:async(p,path)=>'https://storage/'+path});}
const original={name:'dance.mp4',type:'video/mp4',size:100},reference={name:'frame.jpg',type:'image/jpeg',size:50};
const ids=PIPELINE_CHARACTERS.map((c,i)=>'10000000-0000-4000-8000-00000000000'+i);
assert.equal((await api({source:'face_swap_natural',job_id:ids[0],original,reference})).status,400);
assert.equal(rows.length,0);
for(const [i,c] of PIPELINE_CHARACTERS.entries()){
 const result=await api({source:'face_swap_natural',job_id:ids[i],original,reference,character_id:c.id,character:{name:'wrong',storage_path:'attacker'}});
 assert.equal(result.status,200);const r=rows[i];assert.equal(r.meta.character.id,c.id);assert.equal(r.meta.character.sha256,c.sha256);assert.equal(uploads[i].hash,c.sha256);assert.equal(r.meta.character_name,c.name);assert.deepEqual([...r.meta.tags],[c.name]);assert(r.original_file_name.includes(c.name));
 assert.equal(createHash('sha256').update(Buffer.from(c.base64,'base64')).digest('hex'),c.sha256);
}
assert.equal((await api({source:'face_swap_natural',job_id:ids[0],original,reference,character_id:'sahry_japah'})).status,409);
rows[0].meta.stage='upscale';rows[0].status='waiting';
assert.equal((await api({source:'face_swap_natural',job_id:ids[0],original,reference,character_id:'jujuh'})).body.registered,true);
assert.equal(uploads.length,3,'completed input is never uploaded again');
const legacy={...structuredClone(rows[0]),id:'20000000-0000-4000-8000-000000000000',meta:{pipeline_version:2,source:'face_swap_natural',stage:'upscale',character:{sha256:'legacy'}}};rows.push(legacy);
assert.equal((await api({source:'face_swap_natural',job_id:legacy.id,original,reference})).body.registered,true);assert.equal(legacy.meta.character.sha256,'legacy');
const list=await api(null,'image-pipeline-characters');assert.equal(list.body.characters.length,3);assert(list.body.characters.every(c=>c.preview_url.startsWith('data:image/')));
console.log('PASS server: three exact sheets, required selection, immutable snapshots, server-owned names/tags, replay and legacy jobs');

const status={textContent:''},error={textContent:''},controls=[{},{}],form={querySelector:s=>s==='[data-pipeline-status]'?status:s==='[data-pipeline-error]'?error:{},querySelectorAll:()=>controls,reset(){}};
const root={querySelector:s=>s==='form'?form:status,querySelectorAll:()=>[]};
const calls=[],confirmed=new Set();let failOn='sahry_japah',frameReads=0;
const ui={document:{createElement:()=>({textContent:''}),head:{appendChild(){}},querySelector:()=>null,getElementById:()=>null},cloudSession:{user:{id:'owner'}},currentPage:'other',window:{},setInterval(){},setTimeout(){},File,URL:{createObjectURL:()=>'',revokeObjectURL(){}},crypto:webcrypto,extractFirstFrameBlob:async()=>{frameReads++;return new Blob(['frame']);},uploadFaceSwapPart:async()=>{},cloudFetch:async(path,options)=>{if(!options)return {jobs:[]};const b=JSON.parse(options.body);calls.push(b);if(path.includes('ticket')){if(b.character_id===failOn)throw Error('offline');return {job_id:b.job_id,registered:confirmed.has(b.job_id),original:{},reference:{}};}confirmed.add(b.job_id);return {ok:true};}};
let uiSource=fs.readFileSync('image-pipeline-ui.js','utf8').replace('  if(sources[currentPage])render(currentPage);','  window.test={submit,drafts,characterSelector};');
vm.createContext(ui);vm.runInContext(uiSource,ui);
const test=ui.window.test;assert.equal((test.characterSelector().match(/type="checkbox"/g)||[]).length,3);
test.drafts.faceSwap={id:'draft',original:new File(['video'],'video.mp4',{type:'video/mp4'}),urls:{original:'blob:video'},characters:['jujuh','sahry_japah','sahry_gravida']};
await test.submit('faceSwap',root);assert.equal(confirmed.size,1);assert(error.textContent.includes('offline'));const first=calls[0].job_id;
failOn=null;await test.submit('faceSwap',root);assert.equal(confirmed.size,3,'partial upload resumes all remaining models without a duplicate');assert.equal(calls.filter(x=>x.character_id==='jujuh')[1].job_id,first);assert.equal(test.drafts.faceSwap,undefined);assert.equal(frameReads,2,'one extraction per submit, independent of model count');
test.drafts.faceSwap={id:'no-model',original:new File(['v'],'v.mp4'),urls:{original:'blob:v'},characters:[]};await test.submit('faceSwap',root);assert(error.textContent.includes('Escolha'));assert.equal(frameReads,2);
console.log('PASS UI behavior: three choices, multiple variants, partial failure/retry without duplicate, missing-selection guard');
