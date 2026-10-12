import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync('face-swap-character-presets.js','utf8');
const html=fs.readFileSync('index.html','utf8');
new vm.Script(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
let calls=[],inFlight=0,max=0,backend='Julia',hold=null,fail=false;
const buttons=['julia','sahry'].map(name=>({dataset:{faceSwapPreset:name},disabled:false,active:false,label:{textContent:''},classList:{toggle(key,value){if(key==='active')buttons.find(b=>b.dataset.faceSwapPreset===name).active=value}},setAttribute(){},querySelector(){return this.label}}));
const ctx=vm.createContext({window:{},document:{querySelectorAll:()=>buttons},cloudSession:{user:{id:'u'},access_token:'test'},faceSwapData:{workflow:{character:{file_name:'Julia'}}},toast(){},fetch:async(url,options)=>{
 const name=JSON.parse(options.body).p_preset;calls.push(name);max=Math.max(max,++inFlight);
 if(hold){const wait=hold;hold=null;await wait;}
 inFlight--;if(fail){fail=false;return {ok:false,json:async()=>({message:'failed'})}}
 backend=name==='julia'?'Julia':'Sahry';return {ok:true,json:async()=>({ok:true,preset:name,character:{file_name:backend,storage_path:name}})};
}});
vm.runInContext(source,ctx);const api=ctx.window.CloudentFaceSwapCharacter;
ctx.faceSwapData=api.merge(ctx.faceSwapData,api.stamp());
for(let i=0;i<10;i++){
 const name=i%2?'sahry':'julia';const promise=api.select(name);
 assert.equal(buttons.find(b=>b.dataset.faceSwapPreset===name).active,true);
 assert.ok(buttons.every(b=>!b.disabled));await promise;
 assert.equal(backend,name==='julia'?'Julia':'Sahry');assert.equal(ctx.faceSwapData.workflow.character.file_name,backend);
 assert.equal(buttons.find(b=>b.active).label.textContent,'Em uso');
}
assert.equal(calls.length,10);
// Delayed reads, redraw and rapid clicks cannot revert desired selection.
const stamp=api.stamp();let release;hold=new Promise(r=>release=r);
api.select('julia');await Promise.resolve();api.select('sahry');api.select('julia');
ctx.faceSwapData=api.merge({workflow:{character:{file_name:'Sahry'}}},stamp);
assert.match(api.markup(),/active[^>]*data-face-swap-preset="julia"/);
release();await api.flush();assert.equal(backend,'Julia');assert.equal(max,1);
const old=api.stamp();api.select('sahry');await api.flush();
ctx.faceSwapData=api.merge({workflow:{character:{file_name:'Julia'}}},old);
assert.equal(ctx.faceSwapData.workflow.character.file_name,'Sahry');
fail=true;await api.select('julia');await assert.rejects(api.flush());assert.equal(buttons.find(b=>b.active).dataset.faceSwapPreset,'sahry');assert.ok(buttons.every(b=>!b.disabled));
await api.select('julia');await api.flush();assert.equal(backend,'Julia');
assert.ok(!source.includes('MutationObserver'));assert.ok(!source.includes('addEventListener'));assert.ok(!source.includes('loadFaceSwapData'));
const sw=fs.readFileSync('sw.js','utf8');assert.ok(!sw.includes('faceSwapCharacterClickHotfixTag'));assert.ok(!html.includes('changeFaceSwapCharacter'));
console.log('PASS: 10 alternating clicks; immediate UI; serial backend writes; rapid last-click-wins; stale reads/redraw; failure/retry; pipeline flush; retired handlers; inline syntax');
