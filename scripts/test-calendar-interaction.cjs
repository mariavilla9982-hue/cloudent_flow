const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const times=['07:30','10:00','13:00','16:00','18:30'];
const row=(id,account,time='18:30')=>({id,video_id:'v-'+id,platform:'instagram',platform_account_id:account,scheduled_at:'2026-11-04T'+time+':00-03:00',status:'scheduled',videos:{file_name:id,caption:'',thumbnail_storage_path:''}});
let rows=[row('A-late','A'),row('B-first','B','07:30')],reads=0,renders=0,updates=0,resolveRead,modal=false;
const session={user:{id:'owner'}};
const ctx=vm.createContext({console,Date,Intl,AbortController,setTimeout,clearTimeout,
  cloudSession:session,currentPage:'calendar',state:{slots:{}},
  platformAccounts:['A','B'].map(id=>({id,platform:'instagram',config:{calendar_policy:{enabled:true,locked:true,times,timezone:'America/Recife'}}})),
  localStorage:{getItem:()=> 'A',setItem(){}},queueResourcePath:()=>'?resource=queue',
  cloudFetch:async()=>{reads++;return rows},loadPlatformAccounts:async()=>true,loadTrialReels:async()=>{},
  $:selector=>selector==='#modalHost'?{children:modal?[{}]:[]}:null,document:{querySelector:()=>null},
  calendarPage:()=>renders++,updateCalendarLiveDom:()=>updates++,updateTrialReelsBlock(){},
  save(){},closeModal(){modal=false},toast(){},renderProductionCalendarOverview(){},
  weekDates:()=>[new Date('2026-11-04T12:00:00Z')]
});
const run=s=>vm.runInContext(s,ctx);
const load=(start,end)=>run(html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start))));
load('function minutesOf(','function dateSlots(');
load('function localISO(','function save(');
load('function keyFor(','function openDB(');
load('function slotData(','function filledCount(');
load('function firstFreeSlot(','async function runMediaCleaner(');
load('const CALENDAR_ACCOUNT_KEY=','function backendScheduleStatus(');
load('async function refreshCalendarLiveData(','function ensureCalendarMetricsTicker(');
ctx.calendarDayVolume=()=>5;
(async()=>{
  await run('syncFromBackend()');
  assert.equal(reads,1);
  assert.equal(ctx.state.slots['2026-11-04#4'].scheduleId,'A-late','18:30 remains position five');
  assert.equal(ctx.state.slots['2026-11-04#0'],undefined,'07:30 remains available');
  assert.equal(ctx.state.slots['2026-11-04#4'].time,'18:30','account clock independent of host timezone');
  const switching=run('selectCalendarAccount("B")');
  assert.equal(run('calendarActiveAccountId'),'B','selection changes before any network wait');
  assert.equal(ctx.state.slots['2026-11-04#0'].scheduleId,'B-first');
  await switching;assert.equal(reads,1,'loaded accounts switch without fetching again');
  await run('selectCalendarAccount("A")');
  reads=renders=updates=0;
  await run('refreshCalendarLiveData()');
  assert.equal(reads,1);assert.equal(renders,0,'other accounts do not cause a structural mismatch');assert.equal(updates,1);
  rows=[...rows,row('B-second','B','10:00')];
  reads=renders=0;await run('refreshCalendarLiveData()');
  assert.equal(renders,0,'new post on another account preserves the open calendar DOM');assert.equal(reads,1);
  rows=rows.map(r=>r.id==='A-late'?{...r,videos:{...r.videos,caption:'Updated'}}:r);
  reads=renders=0;await run('refreshCalendarLiveData()');
  assert.equal(renders,1,'actual card changes rerender');assert.equal(reads,1,'reuse fetched rows instead of a second network read');
  assert.equal(ctx.state.slots['2026-11-04#4'].caption,'Updated');
  rows=rows.map(r=>r.id==='A-late'?{...r,status:'failed',last_error:'Meta unavailable'}:r);
  renders=0;await run('refreshCalendarLiveData()');
  assert.equal(renders,0,'live status updates preserve nodes');assert.equal(ctx.state.slots['2026-11-04#4'].lastError,'Meta unavailable');
  modal=true;reads=0;await run('refreshCalendarLiveData()');assert.equal(reads,0,'do not disturb open forms');modal=false;
  ctx.cloudFetch=()=>{reads++;return new Promise(resolve=>{resolveRead=resolve})};
  reads=0;const first=run('loadCalendarQueueRows()'),second=run('loadCalendarQueueRows()');
  assert.equal(reads,1,'overlapping refreshes share one read');resolveRead(rows);await Promise.all([first,second]);
  const pending=run('refreshCalendarLiveData()');modal=true;resolveRead([]);await pending;
  assert.equal(ctx.state.slots['2026-11-04#4'].scheduleId,'A-late','form opened in flight preserves the displayed state');modal=false;
  run('resetCalendarData()');reads=0;
  const coldB=run('selectCalendarAccount("B")'),coldA=run('selectCalendarAccount("A")');
  assert.equal(reads,1,'fast cold switches also share one read');resolveRead(rows);await Promise.all([coldB,coldA]);
  assert.equal(run('calendarActiveAccountId'),'A');assert.equal(ctx.state.slots['2026-11-04#4'].scheduleId,'A-late','last click wins');
  const logout=run('refreshCalendarLiveData()');ctx.cloudSession=null;run('resetCalendarData()');resolveRead(rows);await logout;
  assert.equal(Object.keys(ctx.state.slots).length,0,'old session response cannot repopulate rows');assert.equal(run('calendarAllQueueRows'),null);
  ctx.cloudSession=session;ctx.cloudFetch=async()=>{throw Error('offline')};
  await assert.rejects(()=>run('loadCalendarQueueRows()'),/offline/);
  ctx.cloudFetch=async()=>rows;assert.equal((await run('loadCalendarQueueRows()')).length,3,'failed read releases the shared request');
  run('resetCalendarData()');
  console.log('PASS calendar interaction: fixed positions, timezone, immediate switch, latest click, account isolation, shared reads, no redundant renders/refetch, live errors, form/session races and retry after failure');
})().catch(e=>{console.error(e);process.exitCode=1});
