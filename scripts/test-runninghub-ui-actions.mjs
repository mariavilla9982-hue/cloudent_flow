import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {BILLING_URL,cancelThroughUI,verifyAccount,taskStatus} from '../lib/runninghub-ui-actions.mjs';
const task='2123236869265518593',account='2093283289942581250';
const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
try{
  assert.equal(taskStatus('Cancelado'),'CANCEL');assert.equal(taskStatus('Sucesso'),'SUCCESS');assert.equal(taskStatus('Cancelamento solicitado'),'UNKNOWN');
  async function fixture(options={}){
    const page=await browser.newPage();
    await page.route('https://www.runninghub.ai/**',async route=>{
      if(route.request().url().includes('user-center'))return route.fulfill({contentType:'text/html; charset=utf-8',body:'<p>ID:'+String(options.foreignAccount?'1234567890123456789':account)+'</p>'});
      if(options.auth)return route.fulfill({contentType:'text/html; charset=utf-8',body:'<input type="password">'});
      const rowId=options.foreignTask?'1234567890123456789':task;
      const status=options.status||'Em execução';
      await route.fulfill({contentType:'text/html; charset=utf-8',body:`<input class="detail-search"><button>Pesquisar</button><p id="clicks">0</p><table><tr><td>${rowId}</td><td class="status-cell">${status}</td><td><a class="cancel-link">Cancelar</a></td></tr></table><div id="messages"></div><script>
      document.querySelector('.cancel-link').onclick=()=>{const d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML='<p>${options.wrongDialog?'1234567890123456789':task}</p><button class="ant-btn-primary">Confirmar</button>';document.body.append(d);d.querySelector('button').onclick=()=>{document.getElementById('clicks').textContent=Number(document.getElementById('clicks').textContent)+1;d.remove();${options.denied?"document.getElementById('messages').textContent='817 APIKEY_TASK_CANCEL_NOT_ALLOWED';":options.toastOnly?"document.getElementById('messages').textContent='Solicitação enviada';":"document.querySelector('.status-cell').textContent='"+(options.natural?'Sucesso':'Cancelado')+"';"}}};</script>`});
    });
    await page.goto(BILLING_URL);
    return page;
  }
  for(const options of [{},{natural:true},{toastOnly:true}]){
    const page=await fixture(options),result=await cancelThroughUI(page,{taskId:task,allowClick:true,pollMs:10,timeoutMs:80});
    assert.equal(result.confirmed,!options.natural&&!options.toastOnly);
    assert.equal(await page.locator('#clicks').innerText(),'1');await page.close();
  }
  for(const options of [{denied:true},{wrongDialog:true},{foreignTask:true},{auth:true},{status:'Resposta desconhecida'}]){
    const page=await fixture(options);await assert.rejects(()=>cancelThroughUI(page,{taskId:task,allowClick:true,pollMs:10,timeoutMs:80}));
    if(!options.auth)assert.equal(await page.locator('#clicks').innerText(),options.denied?'1':'0');
    await page.close();
  }
  for(const status of ['Sucesso','Falha','Cancelado']){
    const page=await fixture({status});const result=await cancelThroughUI(page,{taskId:task,allowClick:true});
    assert.equal(result.confirmed,status==='Cancelado');assert.equal(await page.locator('#clicks').innerText(),'0');await page.close();
  }
  const passive=await fixture();assert((await cancelThroughUI(passive,{taskId:task})).ready);assert.equal(await passive.locator('#clicks').innerText(),'0');await passive.close();
  const own=await fixture();assert.equal((await verifyAccount(own,account)).account_id,account);await own.close();
  const foreign=await fixture({foreignAccount:true});await assert.rejects(()=>verifyAccount(foreign,account));await foreign.close();
  console.log('PASS real browser fixtures: exact task and account, confirmation binding, CANCEL vs SUCCESS, toast not proof, refusal817, expired login, unknown status, passive mode; zero provider requests');
}finally{await browser.close();}
