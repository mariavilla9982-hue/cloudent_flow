import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {stripTypeScriptTypes} from 'node:module';
const html=fs.readFileSync('index.html','utf8'),api=fs.readFileSync('supabase/functions/cloudent-api/index.ts','utf8'),pipeline=fs.readFileSync('image-pipeline-ui.js','utf8');
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(!/src=|application\/|type="module"/.test(match[1]))new vm.Script(match[2]);}
new vm.Script(pipeline);new vm.Script(fs.readFileSync('sw.js','utf8'));
new vm.Script(stripTypeScriptTypes(api,{mode:'transform'}).replace(/^import .*;\s*$/gm,''));
const backend=stripTypeScriptTypes(fs.readFileSync('supabase/functions/cloudent-api/panel-view.ts','utf8'),{mode:'transform'}).replaceAll('export ','');
const db=new Map(),calls=[];const admin={from(table){assert.equal(table,'app_settings');let prefix='';return {
 select(){return this},gte(k,v){prefix=v;return this},lt(){return this},
 async limit(){return {data:[...db].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>({key,value}))}},
 async upsert({key,value}){calls.push(key);db.set(key,value);return {error:null}}
}}};
const bctx=vm.createContext({Request,URL,Set,Date});vm.runInContext(backend+';globalThis.handler=panelViewApi',bctx);
const json=(data,status=200)=>({data,status}),url=new URL('https://api.test/?resource=panel-view');
const invoke=(uid,body)=>bctx.handler(new Request(url,{method:body?'PATCH':'GET',...(body?{body:JSON.stringify(body)}:{})}),url,admin,uid,json);
const id='00000000-0000-4000-8000-000000000001';
assert.equal((await invoke('one',{scope:'calendar',operation:'clear',ids:[id]})).status,400);
assert.equal((await invoke('one',{scope:'production_motion',operation:'delete',ids:[id]})).status,400);
assert.equal((await invoke('one',{scope:'faceSwap',operation:'clear',ids:[id],user_id:'other'})).status,200);
assert.equal(calls[0],'panel_view_one_faceSwap');
assert.equal(Object.keys((await invoke('two')).data.views).length,0);
assert.equal((await invoke('one',{scope:'faceSwap',operation:'clear',ids:Array(1001).fill(id)})).status,400);
assert.equal((await invoke('one',{scope:'faceSwap',operation:'restore'})).data.value.before,null);
assert.equal((await invoke('one',{scope:'bulkPublish:'+id,operation:'clear',ids:[id]})).status,200);
assert.equal(api.indexOf('if(accessMember.role!=="admin")')<api.indexOf('const panelViewResponse='),true);
const helper=html.slice(html.indexOf('// Persistent, per-user view cleanup.'),html.indexOf('async function loadProductionData('));
const ctx=vm.createContext({Set,Date,console,cloudSession:{user:{id:'one'}},window:{},confirm:()=>true,toast:()=>{},productionData:{jobs:[]},productionSelectedJobs:new Set(),productionPage:()=>{},bulkPublishPage:()=>{},calendarEnsureAccount:()=>id,esc:String,bulkPublishRows:[],cloudFetch:async()=>({views:{}})});
vm.runInContext(helper,ctx);
const run=code=>vm.runInContext(code,ctx);
run("resetPanelViews();panelViews.faceSwap={before:'2026-10-23T12:00:00Z',ids:['legacy']}");
ctx.rows=[{id:'old',created_at:'2026-10-22T00:00:00Z',status:'running'},{id:'new',created_at:'2026-10-23T13:00:00Z'},{id:'legacy'}];
assert.deepEqual(Array.from(run("panelVisibleRows('faceSwap',rows)"),r=>r.id),['new']);
assert.equal(run("panelVisibleRows('upscale',rows).length"),3);
assert.equal(run("panelVisibleRows('production_motion',rows).length"),3);
assert.equal(ctx.rows[0].status,'running');
run("panelViews={};panelViewsLoadedAt=0");
let finishRead;ctx.cloudFetch=()=>new Promise(resolve=>{finishRead=resolve});const pending=run("loadPanelViews()");
run("panelViewsRevision++;panelViews.faceSwap={before:'2026-10-23T12:00:00Z',ids:['old']}");
finishRead({views:{}});await pending;assert.equal(run("!!panelViews.faceSwap.before"),true);
run("cloudSession={user:{id:'two'}};resetPanelViews()");assert.equal(run("Object.keys(panelViews).length"),0);
ctx.cloudFetch=async()=>({ok:true,scope:'upscale',value:{before:'2026-10-23T12:00:00Z',ids:[]}});
ctx.window.ImagePipeline={rowsForPage:()=>ctx.rows,draw:()=>{}};
await run("clearPanelView('upscale',null)");
assert.equal(run("!!panelViews.upscale.before"),true);assert.equal(run("panelViews.faceSwap===undefined"),true);
const badFetch=async()=>{throw Error('offline')};ctx.cloudFetch=badFetch;run("panelViewsLoadedAt=0");await run("loadPanelViews()");assert.equal(run("!!panelViews.upscale.before"),true);
assert.match(pipeline,/panelVisibleRows\(currentPage,allRows\)/);
assert.match(pipeline,/data-panel-clear/);
assert.match(html,/panelViewToolbar\(panelScope,jobs\)/);assert.match(html,/panelViewToolbar\(panelScope,displayRows\)/);
assert.match(html,/frameExtractorBusy\)\{toast/);
assert.doesNotMatch(backend,/from\(['"](?:schedules|videos|production_jobs|face_swap_jobs)['"]\)|\.delete\(|\.remove\(|hidden_at/);
console.log('PASS: full SPA/API syntax; private scope and user isolation; clear and restore; new items; active job preservation; stale-response and logout protection; offline fallback; native controls.');
function renderPipelineFixture(withHelpers){
 const list={dataset:{},innerHTML:'',querySelector:()=>null};
 const form={addEventListener:()=>{}};
 const root={dataset:{},innerHTML:'',querySelector:s=>s==='form'?form:null};
 const document={createElement:()=>({textContent:''}),head:{appendChild:()=>{}},getElementById:id=>id==='faceSwap'?root:null,querySelector:()=>list};
 const c=vm.createContext({document,window:{},cloudSession:null,currentPage:'faceSwap',console,Set,Map,Date,setInterval:()=>1,esc:String,cloudFetch:async()=>({jobs:[]})});
 if(withHelpers)vm.runInContext(helper,c);
 vm.runInContext(pipeline,c);
 assert.equal(list.innerHTML.includes('Excluir tudo desta aba'),withHelpers);
 assert.ok(list.innerHTML.includes('Envie um arquivo'));
}
renderPipelineFixture(false);renderPipelineFixture(true);
console.log('PASS: actual pipeline render in current document and cached legacy document without new globals.');

