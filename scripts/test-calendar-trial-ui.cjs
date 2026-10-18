const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const html=fs.readFileSync('index.html','utf8'),code=html.slice(html.indexOf('let calendarTrialDraft=null;'),html.indexOf('\ninit();\n</script>'));
const nodes=new Map();function $(id){if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:''});return nodes.get(id);}
const row={id:'main',video_id:'A',status:'scheduled',scheduled_at:new Date(Date.now()+86400000).toISOString(),platform:'instagram',platform_account_id:'accountA',videos:{file_name:'Principal A'},trial_video_id:null,pretrial:{scheduled_at:new Date(Date.now()+86400000-1200000).toISOString(),status:'scheduled'}};
const videos=[{id:'B',production_job_id:'jobB',file_name:'Separado B',platform_account_id:'accountA'},{id:'C',production_job_id:'jobC',file_name:'Outra conta',platform_account_id:'accountC'}];let saved,mode='same';
const c={console,Date,$,esc:s=>String(s??''),cloudFetch:async(p,o)=>{if(o){saved=JSON.parse(o.body);return {ok:true};}return p.includes('calendar-trial')?{videos}:[row];},document:{querySelector:()=>({value:mode})},calendarInstagramAccounts:()=>[{id:'accountA',account_label:'A'},{id:'accountC',account_label:'C'}],localISO:d=>d.toISOString().slice(0,10),toast:()=>{},closeModal:()=>{},syncFromBackend:async()=>{},calendarPage:()=>{},actionButtonBusy:()=>{}};vm.createContext(c);vm.runInContext(code,c);
(async()=>{
 await c.openCalendarTrialModal('main');assert($('#modalHost').innerHTML.includes('Usar mesmo vídeo'));assert(!$('#modalHost').innerHTML.includes('Outra conta'));
 await c.saveCalendarTrial({});assert.equal(saved.video_id,null);mode='separate';$('#trialVideoChoice').value='B';await c.saveCalendarTrial({});assert.equal(saved.video_id,'B');assert.equal(saved.schedule_id,'main');
 $('#productionTrialAccount').value='accountA';$('#productionTrialDay').value=c.localISO(new Date(row.scheduled_at));await c.openProductionTrialModal('jobB');assert($('#productionTrialPost').innerHTML.includes('Principal A'));$('#productionTrialPost').value='main';await c.saveProductionTrial({});assert.equal(saved.video_id,'B');assert.equal(saved.schedule_id,'main');assert.equal(row.video_id,'A');
 console.log('PASS calendar default/separate selection and Production IA association UI');
})().catch(e=>{console.error(e);process.exitCode=1;});
