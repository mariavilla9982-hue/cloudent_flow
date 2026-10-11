import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const elements=Object.fromEntries(['productionScheduleAccount','productionScheduleDay','productionScheduleTime','productionScheduleCaption','productionScheduleSave','productionScheduleCapacity','modalHost'].map(id=>['#'+id,{value:'',innerHTML:'',disabled:false}]));
const day='2026-10-12';
const rows=[{id:'S',platform:'instagram',platform_account_id:'A',scheduled_at:day+'T07:30:00',status:'scheduled'}];
const messages=[];let payload;
const ctx=vm.createContext({
  localStorage:{getItem:()=> 'A',setItem(){}},platformAccounts:[{id:'A',platform:'instagram',username:'alpha'},{id:'B',platform:'instagram',username:'beta'},{id:'X',platform:'x',username:'x'}],
  state:{slots:{},defaultTimes:['07:30','09:30','13:00','15:00','18:00']},weekDates:()=>[new Date(day+'T00:00:00')],calendarDayVolume:()=>5,
  localISO:d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
  $:key=>elements[key],document:{querySelectorAll:()=>[]},esc:s=>String(s),minutesOf:t=>/^\d{2}:\d{2}$/.test(t||'')?Number(t.slice(0,2))*60+Number(t.slice(3)):NaN,
  cloudSession:{},productionData:{jobs:[{id:'JOB',result_video_id:'VIDEO',meta:{}}]},productionSelectedJobs:new Set(),currentPage:'other',
  loadPlatformAccounts:async()=>{},queueResourcePath:()=>'?resource=queue',cloudFetch:async(path,options)=>{if(!options)return rows;payload=JSON.parse(options.body);return {schedule:{id:'NEW'}}},
  toast:msg=>messages.push(msg),friendlyCloudentError:s=>s,actionButtonBusy:(button,busy)=>{if(button)button.disabled=busy},closeModal(){},loadProductionData:async()=>{},syncFromBackend:async()=>{},
  runMediaCleaner:async()=>{assert.equal(elements['#productionScheduleAccount'].disabled,true);elements['#productionScheduleAccount'].value='A';return {status:'ready'}}
});
vm.runInContext(html.slice(html.indexOf('const CALENDAR_ACCOUNT_KEY='),html.indexOf('function calendarAccountSwitcher')),ctx);
vm.runInContext(html.slice(html.indexOf('function productionCalendarCapacity('),html.indexOf('async function openProductionCalendarOverview')),ctx);
vm.runInContext(html.slice(html.indexOf('async function openProductionScheduleModal('),html.indexOf('async function removeProductionResultFromCalendar')),ctx);
await ctx.openProductionScheduleModal('JOB',1);
assert.match(elements['#modalHost'].innerHTML,/Conta Instagram/);
assert.match(elements['#modalHost'].innerHTML,/<option value="A" selected>@alpha/);
assert.match(elements['#modalHost'].innerHTML,/<option value="B" >@beta/);
assert.doesNotMatch(elements['#modalHost'].innerHTML,/<option value="X"/);
elements['#productionScheduleAccount'].value='B';elements['#productionScheduleDay'].value=day;elements['#productionScheduleCaption'].value='Preservada';
ctx.refreshProductionScheduleAccount();
assert.match(elements['#productionScheduleCapacity'].innerHTML,/5 vagas/);
assert.equal(elements['#productionScheduleTime'].value,'07:30');
assert.equal(elements['#productionScheduleCaption'].value,'Preservada');
assert.equal(vm.runInContext('calendarActiveAccountId',ctx),'A');
assert.equal(ctx.validateProductionSchedule('B',day,'07:30').ok,true);
assert.equal(ctx.validateProductionSchedule('A',day,'07:30').ok,false);
await ctx.scheduleProductionResult('JOB',elements['#productionScheduleSave']);
assert.equal(payload.platform_account_id,'B');assert.equal(payload.caption,'Preservada');assert.equal(payload.smart_mode,'manual');
payload=null;elements['#productionScheduleAccount'].value='REMOVED';
await ctx.scheduleProductionResult('JOB');assert.equal(payload,null);assert.match(messages.at(-1),/Escolha uma conta/);
ctx.refreshProductionScheduleAccount();assert.equal(elements['#productionScheduleSave'].disabled,true);
console.log('Production picker: modal options, exact account capacity/time, independent global calendar, caption preservation, async account snapshot and missing-account rejection passed.');
