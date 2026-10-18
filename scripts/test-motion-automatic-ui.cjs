const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{stripTypeScriptTypes}=require('node:module');
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('function productionFriendlyError('),html.indexOf('function productionCostSummary('));
const context={productionData:{jobs:[],previews:{},imagePipelineQueue:{face_swap:0,upscale:3}},productionSelectedJobs:new Set(),
 esc:v=>String(v??''),friendlyCloudentError:v=>v,productionStatusMeta:s=>({label:s,cls:s}),productionPreviewMarkup:()=>'',fmtSize:()=>'',
 productionCreditUsage:()=>null,productionMoneyUsage:()=>({has:false}),productionElapsedSeconds:()=>0,formatProductionSeconds:()=>'',Date,Number,String,Math};
vm.createContext(context);vm.runInContext(source,context);
const j={id:'a',status:'waiting',attempt_count:0,max_attempts:1,meta:{workflow_key:'motion_control',image_pipeline_version:2}};
let row=context.productionJobRow(j,0,1);
assert(row.includes('Na fila automática'));assert(row.includes('Upscale 3'));assert(!row.includes('data-op="run"'));assert(!row.includes('Pronto para nova tentativa'));assert(row.includes('Cancelar'));
context.productionData.imagePipelineQueue={face_swap:0,upscale:0};row=context.productionJobRow(j,0,1);assert(row.includes('inicia quando houver vaga'));
row=context.productionJobRow({...j,status:'failed',last_error:'工作流运行失败'},0,1);assert(!row.includes('retry automático'));assert(row.includes('Sem nova tentativa automática'));assert(row.includes('data-op="retry"'));
row=context.productionJobRow({...j,meta:{}},0,1);assert(row.includes('data-op="run"'),'standard production controls preserved');
const api=fs.readFileSync('supabase/functions/cloudent-api/index.ts','utf8');
const branch=stripTypeScriptTypes('(async()=>{'+api.slice(api.indexOf('    if (req.method === "GET" && resource === "production")'),api.indexOf('    if (req.method === "GET" && resource === "production-previews")'))+'})()');
async function load(auto=true,failed=false){let faceReads=0;const filters=[];
 const c={req:{method:'GET'},resource:'production',userData:{user:{id:'owner'}},Date,Number,String,Promise,json:x=>x,
 admin:{from(table){let q={select(columns){if(table==='face_swap_jobs')assert.equal(columns,'status,stage:meta->>stage');return q},eq(k,v){if(table==='face_swap_jobs')filters.push([k,v]);return q},is(){return q},contains(){return q},in(){return q},order(){return q},limit(){return q},maybeSingle(){return q},then(ok,bad){let data;
 if(table==='production_jobs')data=[{status:'motion_waiting',meta:auto?{image_pipeline_version:2}:{}}];
 if(table==='integrations')data={enabled:true,config:{}};if(table==='worker_runtime')data={last_heartbeat:new Date().toISOString()};
 if(table==='face_swap_jobs'){faceReads++;data=[{stage:'upscale',status:'running'},{stage:'upscale',status:'queued'},{stage:'control_motion',status:'waiting'}];}
 return Promise.resolve({data,error:failed&&table==='face_swap_jobs'?new Error('unavailable'):null}).then(ok,bad)}};return q}}};
 vm.createContext(c);const data=await vm.runInContext(branch,c);return {data,faceReads,filters};}
(async()=>{let r=await load();assert.equal(r.data.imagePipelineQueue.upscale,2);assert.deepEqual(r.filters,[['user_id','owner']]);r=await load(false);assert.equal(r.faceReads,0);r=await load(true,true);assert.equal(r.data.imagePipelineQueue,null);assert(r.data.jobs.length);console.log('PASS automatic Motion: no Execute prompt, real image queue reason, standard controls preserved, no fake automatic retry, bounded owner-scoped read and graceful count failure');})().catch(e=>{console.error(e);process.exitCode=1});
