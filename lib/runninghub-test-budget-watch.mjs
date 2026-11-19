// Emergency stop for the single user-authorized test. This is a time-based
// exposure precaution, not a provider-enforced spending cap or capture proof.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const [taskId,accountId,createdAt]=process.argv.slice(2);
if(!/^\d{15,25}$/.test(taskId)||!/^\d{15,25}$/.test(accountId))throw Error('invalid_identity');
const started=Date.parse(createdAt),deadline=started+1500000;
if(!Number.isFinite(started)||started>Date.now()+30000||Date.now()-started>3600000)throw Error('invalid_start_time');
const audit='/vercel/runninghub-ui/test-budget-'+taskId+'.json';
const save=value=>fs.writeFileSync(audit,JSON.stringify({...value,task_id:taskId,deadline:new Date(deadline).toISOString(),at:new Date().toISOString()}),{mode:0o600});
save({state:'armed'});
await new Promise(resolve=>setTimeout(resolve,Math.max(0,deadline-Date.now())));
for(let attempt=1;attempt<=4;attempt++){
 const p=spawnSync(process.execPath,['/vercel/runninghub-ui/runner.mjs','cancel',taskId,accountId],{encoding:'utf8',timeout:60000,env:{...process.env,PLAYWRIGHT_HOST_PLATFORM_OVERRIDE:'ubuntu24.04-x64'}});
 let result;try{result=JSON.parse(String(p.stdout).trim().split('\n').at(-1));}catch{result={ok:false,error:'watch_runner_unavailable'};}
 save({state:'observed',attempt,result});
 console.log(JSON.stringify({attempt,result}));
 if(result.ok&&['CANCEL','SUCCESS','FAILED'].includes(result.status))process.exit(0);
 if(result.error&&result.error!=='busy')break;
 await new Promise(resolve=>setTimeout(resolve,5000));
}
save({state:'stop_unconfirmed'});process.exitCode=1;
