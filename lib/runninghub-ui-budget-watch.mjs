// Time-based emergency stop for the explicitly authorized two-job batch only.
// A stop before verified capture is an incomplete test, never a successful result.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const [taskId,accountId,deadlineAt]=process.argv.slice(2),deadline=Date.parse(deadlineAt);
if(!/^\d{15,25}$/.test(taskId)||!/^\d{15,25}$/.test(accountId)||!Number.isFinite(deadline)||deadline>Date.now()+1320000)throw Error('invalid_watch_scope');
const root='/vercel/runninghub-ui',lock=root+'/budget-watch-'+taskId;
try{fs.mkdirSync(lock);}catch{try{process.kill(Number(fs.readFileSync(lock+'/pid','utf8')),0);process.exit(0);}catch{fs.rmSync(lock,{recursive:true,force:true});fs.mkdirSync(lock);}}
fs.writeFileSync(lock+'/pid',String(process.pid),{mode:0o600});
const save=value=>fs.writeFileSync(lock+'/audit.json',JSON.stringify({task_id:taskId,deadline_at:deadlineAt,at:new Date().toISOString(),...value}),{mode:0o600});
save({state:'armed'});
await new Promise(resolve=>setTimeout(resolve,Math.max(0,deadline-Date.now())));
for(let attempt=1;attempt<=4;attempt++){
 const p=spawnSync(process.execPath,[root+'/runner.mjs','cancel',taskId,accountId],{encoding:'utf8',timeout:60000,env:{...process.env,PLAYWRIGHT_HOST_PLATFORM_OVERRIDE:'ubuntu24.04-x64'}});
 let result;try{result=JSON.parse(String(p.stdout).trim().split('\n').at(-1));}catch{result={ok:false,error:'budget_runner_unavailable'};}
 save({state:'observed',attempt,result});console.log(JSON.stringify({attempt,result}));
 if(result.ok&&['CANCEL','SUCCESS','FAILED'].includes(result.status))process.exit(0);
 if(result.error&&result.error!=='busy')break;
 await new Promise(resolve=>setTimeout(resolve,1000));
}
save({state:'stop_unconfirmed'});process.exitCode=1;
