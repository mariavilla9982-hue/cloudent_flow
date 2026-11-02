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
const ultraCfg={...cfg,executionInstanceType:'ultra',executionVramGb:84,hardwarePolicy:'motion_default_84gb'};
assert.equal(c.options(job,ultraCfg).instanceType,'ultra');
assert.equal(c.options({...job,meta:{...job.meta,execution_instance_type:'plus'}},ultraCfg).instanceType,'ultra');
assert.equal(c.options({...job,attempt_count:2,max_attempts:2,meta:{...job.meta,execution_instance_type:'ultra'}},ultraCfg).instanceType,'ultra');
assert.throws(()=>c.options({...job,runninghub_task_id:'active'},ultraCfg));
assert.throws(()=>c.options({...job,meta:{workflow_key:'standard'}},ultraCfg));
for(const patch of [{executionInstanceType:'unknown'},{executionVramGb:48},{hardwarePolicy:'motion_default_48gb'}])assert.throws(()=>c.options(job,{...ultraCfg,...patch}));
assert.equal(c.options(allowed(),ultraCfg).instanceType,'ultra');
const consumed=allowed();consumed.meta.execution_ultra_once.state='used';assert.throws(()=>c.options(consumed,ultraCfg));
console.log('PASS Ultra default 84GB: policy validated, V7 isolated, existing tasks and consumed one-time grants blocked; legacy Plus preserved');
