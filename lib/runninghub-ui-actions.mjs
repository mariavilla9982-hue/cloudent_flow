// Uses visible controls only. Never reads cookies, tokens, passwords or private APIs.
export const BILLING_URL = 'https://www.runninghub.ai/pt-br/call-api/bill-task?tab=detail';
const ID = /^\d{15,25}$/;
export function taskStatus(text) {
  const s=String(text||'').trim().toLowerCase();
  if(/^(cancelado|cancelled|canceled|cancel|已取消)$/.test(s))return 'CANCEL';
  if(/^(sucesso|success|succeeded|成功)$/.test(s))return 'SUCCESS';
  if(/^(falha|failed|失败)$/.test(s))return 'FAILED';
  if(/^(em execução|running|in progress|运行中|执行中)$/.test(s))return 'RUNNING';
  if(/^(na fila|queued|排队中)$/.test(s))return 'QUEUED';
  return 'UNKNOWN';
}
export async function checkSession(page) {
  if(!page.url().startsWith('https://www.runninghub.ai/'))throw Error('unexpected_origin');
  if(/sso-login|\/login/.test(page.url())||await page.locator('input[type=password]:visible').count())throw Error('authentication_required');
  if(await page.locator('iframe[src*="captcha"]:visible,iframe[src*="challenges.cloudflare.com"]:visible,[data-sitekey]:visible').count())throw Error('human_verification_required');
}
export async function selectTask(page,taskId,{preferLoaded=false}={}) {
  if(!ID.test(taskId))throw Error('invalid_task_id');
  await checkSession(page);
  if(preferLoaded){
    const loaded=page.getByRole('row').filter({has:page.getByText(taskId,{exact:true})});
    if(await loaded.count()===1&&await loaded.isVisible()&&await loaded.getByText(taskId,{exact:true}).count()===1)return loaded;
  }
  const search=page.locator('input.detail-search:visible,.detail-search input:visible');
  await search.waitFor({state:'visible',timeout:12000});
  if(await search.count()!==1)throw Error('ambiguous_search');
  await search.fill(taskId);
  await page.getByRole('button',{name:/^(Pesquisar|Search|查询|搜索)$/,exact:true}).click();
  const row=page.getByRole('row').filter({has:page.getByText(taskId,{exact:true})});
  await row.waitFor({state:'visible',timeout:12000});
  if(await row.count()!==1)throw Error('ambiguous_task');
  if(await row.getByText(taskId,{exact:true}).count()!==1)throw Error('task_mismatch');
  return row;
}
export async function readTask(page,taskId) {
  await checkSession(page);
  const row=page.getByRole('row').filter({has:page.getByText(taskId,{exact:true})});
  if(await row.count()!==1)throw Error('task_not_visible');
  const status=await row.locator('.status-cell').innerText({timeout:5000});
  return {task_id:taskId,status:taskStatus(status),observed_at:new Date().toISOString()};
}
export async function verifyAccount(page,accountId) {
  if(!ID.test(accountId))throw Error('invalid_account_id');
  await page.goto('https://www.runninghub.ai/pt-br/user-center',{waitUntil:'domcontentloaded',timeout:20000});
  await checkSession(page);
  const label=page.getByText(new RegExp('^ID:\\s*'+accountId+'$'));
  await label.waitFor({state:'visible',timeout:12000});
  if(await label.count()!==1)throw Error('account_mismatch');
  return {account_id:accountId,verified_at:new Date().toISOString()};
}
export async function cancelThroughUI(page,{taskId,allowClick=false,pollMs=1000,timeoutMs=18000}) {
  // Preparation already pins this exact task. Avoid a round-trip refresh before
  // the one authorized click; the confirmation dialog still must bind its ID.
  // Passive reconciliation always refreshes to avoid trusting a stale row.
  const row=await selectTask(page,taskId,{preferLoaded:allowClick});
  const before=await readTask(page,taskId);
  const result={...before,accepted:false,confirmed:before.status==='CANCEL',method:'authenticated_ui',clicked_at:null};
  if(['CANCEL','SUCCESS','FAILED'].includes(before.status))return result;
  if(!['RUNNING','QUEUED'].includes(before.status))throw Error('unknown_task_status');
  if(!allowClick)return {...result,ready:true};
  const cancel=row.locator('.cancel-link:visible');
  if(await cancel.count()!==1)throw Error('cancel_control_unavailable');
  await cancel.click();
  // The task identifier must be visible in the provider's confirmation dialog.
  const dialog=page.getByRole('dialog').filter({hasText:taskId});
  await dialog.waitFor({state:'visible',timeout:5000});
  if(await dialog.count()!==1)throw Error('confirmation_task_mismatch');
  const confirm=dialog.locator('.ant-btn-primary:visible');
  if(await confirm.count()!==1)throw Error('ambiguous_confirmation');
  result.clicked_at=new Date().toISOString();
  await confirm.click();
  // A successful click or toast is NOT confirmation. Read the provider's row.
  const until=Date.now()+timeoutMs;
  while(Date.now()<until) {
    await checkSession(page);
    const body=await page.locator('body').innerText();
    if(/APIKEY_TASK_CANCEL_NOT_ALLOWED|\b817\b/.test(body))throw Error('cancel_refused_817');
    if(/UNAUTHORIZED_OPERATION|TASK_CANCEL_FAILED_BY_STATUS/.test(body))throw Error('cancel_refused');
    let observed;
    try{observed=await readTask(page,taskId);}catch(error){
      // Searching refreshes the table asynchronously. A temporarily missing row
      // after the confirmed click is not a refusal and must never cause a re-click.
      if(error?.message!=='task_not_visible'&&error?.name!=='TimeoutError')throw error;
    }
    if(observed&&['CANCEL','SUCCESS','FAILED'].includes(observed.status))return {...result,...observed,accepted:true,confirmed:observed.status==='CANCEL'};
    await page.waitForTimeout(pollMs);
    // Refresh by the supported search control, never by a private request.
    await page.getByRole('button',{name:/^(Pesquisar|Search|查询|搜索)$/,exact:true}).click();
  }
  return {...result,accepted:true,status:'UNKNOWN',confirmed:false};
}
