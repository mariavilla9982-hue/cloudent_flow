import {Sandbox} from '@vercel/sandbox';
import fs from 'node:fs';
export const RUNNINGHUB_SANDBOX='cloudent-runninghub-cancel';
const root='/vercel/runninghub-ui';
export async function runninghubBrowser(operation,taskId='',accountId=''){
  const box=await Sandbox.get({name:RUNNINGHUB_SANDBOX,resume:true});
  await box.writeFiles([
    {path:root+'/actions.mjs',content:fs.readFileSync(new URL('./runninghub-ui-actions.mjs',import.meta.url))},
    {path:root+'/runner.mjs',content:Buffer.from(fs.readFileSync(new URL('./runninghub-ui-runner.mjs',import.meta.url),'utf8').replace("'./runninghub-ui-actions.mjs'","'./actions.mjs'"))},
    {path:root+'/gateway.mjs',content:fs.readFileSync(new URL('./runninghub-ui-gateway.mjs',import.meta.url))},
    {path:root+'/start.sh',content:fs.readFileSync(new URL('./runninghub-ui-start.sh',import.meta.url))}
  ]);
  const start=await box.runCommand('bash',[root+'/start.sh']);
  if(start.exitCode!==0)throw Error('ui_browser_start_failed');
  if(operation==='setup'){
    await box.runCommand('node',['--input-type=module','-e',"import fs from 'node:fs';import crypto from 'node:crypto';fs.writeFileSync('/vercel/runninghub-ui/setup-token',crypto.randomBytes(32).toString('hex'),{mode:0o600})"]);
    const result=await box.runCommand('cat',[root+'/setup-token']);
    const token=String(await result.stdout()).trim();
    if(!/^[a-f0-9]{64}$/.test(token))throw Error('setup_unavailable');
    const route=(box.routes||[]).find(r=>Number(r.port)===6080)?.url;
    if(!route)throw Error('setup_unavailable');
    return {ok:true,url:route+'/setup/'+token+'/vnc.html?autoconnect=1&resize=scale&path=setup/'+token+'/websockify'};
  }
  const result=await box.runCommand({cmd:'node',args:[root+'/runner.mjs',operation,taskId,accountId],env:{PLAYWRIGHT_HOST_PLATFORM_OVERRIDE:'ubuntu24.04-x64'}});
  const line=String(await result.stdout()).trim().split('\n').at(-1);
  try{return JSON.parse(line);}catch{throw Error('ui_runner_unavailable');}
}
