import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const patch=fs.readFileSync(new URL('../../calendar-connect-patch.js',import.meta.url),'utf8');
const button={disabled:false,textContent:''};let requests=[],redirect='',unauthorized=true;
const ctx=vm.createContext({
  localStorage:{getItem:()=> 'B',setItem(){}},platformAccounts:['A','B','C'].map(id=>({id,platform:'instagram',account_label:id})),
  state:{slots:{}},weekDates:()=>[],window:{location:{assign:url=>redirect=url}},SUPABASE_URL:'https://example.test',SUPABASE_KEY:'TEST',cloudSession:{access_token:'TEST'},
  document:{createElement:()=>({}),head:{appendChild(){}},getElementById:id=>id==='calendarReconnectInstagramBtn'?button:null},
  console,setTimeout(){},URL,sessionStorage:{setItem(){}},toast(){},refreshCloudSession:async()=>true,
  connectInstagram(){throw new Error('Old HTML connectInstagram must not be used');},
  fetch:async(url,opts)=>{requests.push(JSON.parse(opts.body));if(unauthorized){unauthorized=false;return {status:401}}return {status:200,ok:true,json:async()=>({url:'https://www.instagram.com/oauth/authorize?client_id=TEST'})};}
});
// Simulate cached HTML preceding the new helper definition.
const originalHelpers=html.slice(html.indexOf('const CALENDAR_ACCOUNT_KEY='),html.indexOf('function calendarReconnectButton('));
vm.runInContext(originalHelpers,ctx);
assert.equal(typeof ctx.calendarReconnectButton,'undefined');
vm.runInContext(patch,ctx);
const rendered=ctx.calendarAccountSwitcher();
assert.match(rendered,/3 \/ 3 contas/);assert.match(rendered,/Reconectar conta/);assert.match(rendered,/startCalendarInstagramOAuth\(&quot;B&quot;\)/);
await ctx.window.startCalendarInstagramOAuth('B');
assert.equal(requests.length,2);assert.ok(requests.every(r=>r.platform_account_id==='B'));assert.match(redirect,/^https:\/\/www.instagram.com\/oauth\/authorize/);
assert.equal(button.disabled,true);
requests=[];await ctx.window.startCalendarInstagramOAuth('REMOVED');assert.equal(requests.length,0);
vm.runInContext('calendarActiveAccountId="REMOVED"',ctx);assert.doesNotMatch(ctx.calendarAccountSwitcher(),/Reconectar conta/);
console.log('Cached HTML compatibility: missing new helper, old OAuth function, exact reconnect ID across 401 retry, max-account limit, removed-account rejection passed.');
