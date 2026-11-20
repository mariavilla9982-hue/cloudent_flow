// Explicitly authorized, single-task actuator test before output exists.
// This does not verify capture/storage or bypass their production guards.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const [taskId,accountId,createdAt]=process.argv.slice(2);
if(!/^\d{15,25}$/.test(taskId)||!/^\d{15,25}$/.test(accountId))throw Error('invalid_identity');
const started=Date.parse(createdAt);
if(!Number.isFinite(started)||started>Date.now()+30000||Date.now()-started>300000)throw Error('invalid_start_time');
const path='/vercel/runninghub-ui/active-test-'+taskId+'.json';
const run=operation=>{
 const result=spawnSync(process.execPath,['/vercel/runninghub-ui/runner.mjs',operation,taskId,accountId],{encoding:'utf8',timeout:60000,env:{...process.env,PLAYWRIGHT_HOST_PLATFORM_OVERRIDE:'ubuntu24.04-x64'}});
 try{return JSON.parse(String(result.stdout).trim().split('\n').at(-1));}catch{return {ok:false,error:'test_runner_unavailable'};}
};
const audit={task_id:taskId,scope:'active_task_before_output',started_at:new Date().toISOString(),before:null,result:null};
const save=()=>fs.writeFileSync(path,JSON.stringify(audit),{mode:0o600});save();
audit.before=run('prepare');save();console.log(JSON.stringify({before:audit.before}));
await new Promise(resolve=>setTimeout(resolve,Math.max(0,started+30000-Date.now())));
for(let attempt=1;attempt<=4;attempt++){
 audit.result=run('cancel');save();console.log(JSON.stringify({attempt,result:audit.result}));
 if(audit.result.error!=='busy')break;
 await new Promise(resolve=>setTimeout(resolve,1000));
}
process.exitCode=audit.before?.status==='RUNNING'&&audit.result?.confirmed===true&&audit.result?.status==='CANCEL'?0:1;
