import fs from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {BILLING_URL,checkSession,verifyAccount,cancelThroughUI} from './runninghub-ui-actions.mjs';
const root='/vercel/runninghub-ui';
const [operation,taskId='',accountId='']=process.argv.slice(2);
const errors=new Set(['authentication_required','human_verification_required','account_mismatch','invalid_task_id','invalid_account_id','ambiguous_task','task_mismatch','task_not_visible','unknown_task_status','cancel_control_unavailable','confirmation_task_mismatch','ambiguous_confirmation','cancel_refused_817','cancel_refused','unexpected_origin','ambiguous_search','busy']);
let acquired=false;
try {
  if(!['probe','prepare','cancel'].includes(operation))throw Error('invalid_operation');
  if(operation!=='probe'&&!/^\d{15,25}$/.test(taskId))throw Error('invalid_task_id');
  try{await fs.mkdir(root+'/command-lock');acquired=true;}catch{
    let alive=true;try{const pid=Number(await fs.readFile(root+'/command-lock/pid','utf8'));try{process.kill(pid,0);}catch{alive=false;}}catch{}
    if(alive)throw Error('busy');
    await fs.rm(root+'/command-lock',{recursive:true,force:true});await fs.mkdir(root+'/command-lock');acquired=true;
  }
  await fs.writeFile(root+'/command-lock/pid',String(process.pid));
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222',{timeout:8000});
  const context=browser.contexts()[0];
  let page=context.pages().find(p=>p.url().startsWith('https://www.runninghub.ai/')&&!p.url().includes('user-center'));
  if(!page)page=await context.newPage();
  if(operation==='probe') {
    const account=await verifyAccount(page,accountId);
    await page.goto(BILLING_URL,{waitUntil:'domcontentloaded',timeout:20000});
    await checkSession(page);
    console.log(JSON.stringify({ok:true,ready:true,...account}));
  } else {
    const proofPath=root+'/prepared-'+taskId+'.json';
    let proof=null;try{proof=JSON.parse(await fs.readFile(proofPath,'utf8'));}catch{}
    if(operation==='prepare'||proof?.account_id!==accountId||Date.now()-Date.parse(proof?.verified_at||'')>7200000) {
      proof=await verifyAccount(page,accountId);
      await page.goto(BILLING_URL,{waitUntil:'domcontentloaded',timeout:20000});
      await fs.writeFile(proofPath,JSON.stringify({...proof,task_id:taskId}),{mode:0o600});
    } else if(!page.url().includes('/call-api/bill-task'))await page.goto(BILLING_URL,{waitUntil:'domcontentloaded',timeout:20000});
    const result=await cancelThroughUI(page,{taskId,allowClick:operation==='cancel'});
    console.log(JSON.stringify({ok:true,...result,account_id:accountId}));
  }
  // Do not browser.close(): that would terminate the retained login session.
} catch(error) {
  const code=errors.has(error?.message)?error.message:(error?.name==='TimeoutError'?'ui_timeout':'ui_unavailable');
  console.log(JSON.stringify({ok:false,error:code,task_id:taskId||null}));
  process.exitCode=1;
} finally {
  if(acquired)await fs.rm(root+'/command-lock',{recursive:true,force:true}).catch(()=>{});
  // connectOverCDP's socket otherwise keeps Node alive. Chrome remains running.
  setTimeout(()=>process.exit(process.exitCode||0),50);
}
