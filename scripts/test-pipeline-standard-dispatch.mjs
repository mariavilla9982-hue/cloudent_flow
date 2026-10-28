import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {pipelineVideoWorkflow} from '../supabase/functions/_shared/image-pipeline-workflows.ts';
const worker=fs.readFileSync('supabase/functions/cloudent-production-worker/index.ts','utf8');
const body=worker.slice(worker.indexOf('    async function startProductionJobs()'),worker.indexOf('    async function startFaceSwapJobs()'));
async function run(meta,valid=true){
 const creates=[],reads=[],updates=[];
 const row={id:'job',meta,original_storage_path:'original-video',frame_storage_path:'upscale-frame',attempt_count:1,max_attempts:1};
 const c=vm.createContext({pipelineVideoWorkflow,Date,workerId:'worker',concurrency:2,touched:0,workflowId:'native-config',videoNodeId:'native-video',frameNodeId:'native-frame',videoFieldName:'video',frameFieldName:'image',getAccountCredits:async()=>null,
  admin:{rpc:async()=>({data:[row]}),from:()=>({update(v){updates.push(v);return {eq:async()=>({error:null})}}})},
  prepareInput:async path=>{reads.push(path);return 'uploaded-'+path;},
  rhJson:async(path,payload)=>{if(path.endsWith('getJsonApiFormat'))return {code:0,data:{'336':{class_type:valid?'VHS_LoadVideo':'wrong'},'338':{class_type:'LoadImage'}}};creates.push(payload);return {code:0,data:{taskId:'task'}};}
 });
 vm.runInContext(stripTypeScriptTypes(body)+';this.run=startProductionJobs;',c);await c.run();return {creates,reads,updates};
}
const selected=await run({image_pipeline_version:2,workflow_key:'standard',video_workflow:{key:'standard'}});
assert.equal(selected.creates[0].workflowId,'2100995504908824578');
assert.deepEqual(selected.creates[0].nodeInfoList.map(x=>[x.nodeId,x.fieldName,x.fieldValue]).flat().join(','),'336,video,uploaded-original-video,338,image,uploaded-upscale-frame');
assert.equal(Object.keys(selected.creates[0]).sort().join(','),'addMetadata,nodeInfoList,workflowId');
const invalid=await run({image_pipeline_version:2,workflow_key:'standard'},false);assert.equal(invalid.creates.length,0);assert.equal(invalid.reads.length,0);assert.equal(invalid.updates.at(-1).status,'failed');
const legacy=await run({});assert.equal(legacy.creates[0].workflowId,'native-config');assert.equal(legacy.creates[0].nodeInfoList[0].nodeId,'native-video');
console.log('PASS standard executor: selected immutable workflow, original video and Upscale frame only, invalid graph blocks uploads/create, native flow preserved');
