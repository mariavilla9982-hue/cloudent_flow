const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const src=fs.readFileSync('supabase/functions/cloudent-motion-control-worker/index.ts','utf8');
const code=src.slice(src.indexOf('function motionExecutionOptions('),src.indexOf('function cleanBase('));
const c=vm.createContext({});vm.runInContext(stripTypeScriptTypes(code)+';this.options=motionExecutionOptions',c);
const cfg={executionInstanceType:'plus',workflowId:'2110721194974982146'};
const job={id:'target',attempt_count:1,max_attempts:1,meta:{workflow_key:'motion_control'}};
assert.equal(c.options(job,cfg).instanceType,'plus');
const grant={approval_id:'44444444-4444-4444-8444-444444444444',job_id:'target',workflow_id:cfg.workflowId,source_task_id:'2115252978189692929',state:'pending'};
const allowed=()=>({...job,meta:{...job.meta,execution_ultra_once:{...grant}}});
assert.equal(c.options(allowed(),cfg).instanceType,'ultra');
for(const patch of [{state:'used'},{job_id:'other'},{workflow_id:'other'},{approval_id:''},{source_task_id:''}]){
 const j=allowed();Object.assign(j.meta.execution_ultra_once,patch);assert.throws(()=>c.options(j,cfg));
}
for(const patch of [{runninghub_task_id:'already-active'},{attempt_count:2},{max_attempts:2}])assert.throws(()=>c.options({...allowed(),...patch},cfg));
assert.throws(()=>c.options({...job,meta:{...job.meta,execution_instance_type:'ultra'}},cfg));
assert.throws(()=>c.options(allowed(),{...cfg,executionInstanceType:'ultra'}));
assert.throws(()=>c.options({...allowed(),meta:{...allowed().meta,workflow_key:'standard'}},cfg));
console.log('PASS Ultra: explicit approval bound to one job/workflow/attempt, consumed grants and active tasks blocked, 48GB default unchanged');
