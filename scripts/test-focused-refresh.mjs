import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html=fs.readFileSync('index.html','utf8');
const between=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
let calls=[],renders=0,release;
const names=['loadAutomationStatus','loadNotifications','loadFollowerStats','refreshCalendarLiveData','syncFromBackend','loadDashboardScheduleRows','syncDashboardLiveMetrics','loadInstagramMetricsStored','loadServerLogs','loadProductionData','loadTrialReels','loadSystemHealth','loadInstagramWebSessionStatus'];
const c=vm.createContext({console,currentPage:'production',cloudSession:{user:{id:'owner'}},cloudAccess:{role:'admin'},settingsTab:'',window:{CloudentMotionControl:{mode:'genjutsu'}},document:{activeElement:null,hidden:false},$:()=>null,updateLiveChrome(){},renderAll(){renders++},toast(){},toggleActivityPanel(){},refreshXPosting(){}});
for(const name of names)c[name]=async()=>{calls.push(name)};
vm.runInContext(between('async function refreshLiveData(','function keyFor('),c);
for(const page of ['production','faceSwap','faceSwapPhoto','upscale']){
  c.currentPage=page;calls=[];renders=0;await c.refreshLiveData();
  assert.deepEqual(calls,['loadAutomationStatus','loadNotifications'],page+' does not poll unrelated pages');
  assert.equal(renders,0,'queue controller keeps drafts, players and focus');
}
c.currentPage='calendar';calls=[];await c.refreshLiveData();
assert.deepEqual(calls,['loadAutomationStatus','loadNotifications','refreshCalendarLiveData']);
c.currentPage='metrics';calls=[];await c.refreshLiveData();
assert(calls.includes('loadFollowerStats')&&calls.includes('loadInstagramMetricsStored'));
assert(!calls.includes('syncFromBackend')&&!calls.includes('loadDashboardScheduleRows'));
c.currentPage='overview';calls=[];await c.refreshLiveData();
for(const name of ['loadFollowerStats','syncFromBackend','loadDashboardScheduleRows','syncDashboardLiveMetrics'])assert(calls.includes(name));
c.currentPage='metrics';renders=0;
c.loadInstagramMetricsStored=()=>new Promise(resolve=>{release=resolve});
const pending=c.refreshLiveData();c.currentPage='faceSwap';release();await pending;
assert.equal(renders,0,'late global update cannot reconstruct a newly opened page');

const timers=[];c.setInterval=(fn,ms)=>{timers.push({fn,ms});return 1};
c.currentPage='production';c.loadProductionData=async()=>{calls.push('production')};
c.syncProductionElapsed=()=>{};c.productionLiveSignature=()=>'';c.productionPage=()=>{};
vm.runInContext(between('function ensureProductionTicker(','function actionButtonBusy('),c);
c.ensureProductionTicker();calls=[];
await timers.find(t=>t.ms===10000).fn();assert.equal(calls.length,0,'legacy timer leaves GENJUTSU to its controller');
c.window.CloudentMotionControl.mode='standard';await timers.find(t=>t.ms===10000).fn();assert.deepEqual(calls,['production'],'standard queue retains its polling');

let resolveMetrics;
const m=vm.createContext({console,cloudSession:{user:{id:'old'}},metricsAccountId:'A',metricsLoadVersion:0,metricsDataError:'',liveInstagramMetrics:['current'],metricsAccountQuery:()=>'',IG_METRICS_URL:'https://test/metrics',edgeFetch:()=>new Promise(resolve=>{resolveMetrics=resolve})});
vm.runInContext(between('async function loadInstagramMetricsStored(','async function syncDashboardLiveMetrics('),m);
const old=m.loadInstagramMetricsStored();m.cloudSession={user:{id:'new'}};resolveMetrics({media:['old-owner']});await old;
assert.deepEqual(m.liveInstagramMetrics,['current'],'old session metrics never populate the new session');
let resolveFollowers;
const f=vm.createContext({console,cloudSession:{user:{id:'owner'}},followerLoadVersion:0,followerStats:null,metricsAccountId:'',metricsPeriod:30,metricsAccountQuery:()=>'',IG_FOLLOWERS_STATUS_URL:'https://test/followers',edgeFetch:()=>new Promise(resolve=>{resolveFollowers=resolve})});
vm.runInContext(between('async function loadFollowerStats(','async function loadInstagramStatus('),f);
const followers=f.loadFollowerStats();f.metricsAccountId='default-account';resolveFollowers({account_id:'default-account',current:{followers_count:5}});await followers;
assert.equal(f.followerStats.current.followers_count,5,'default account resolved concurrently keeps its followers');
const oldFollowers=f.loadFollowerStats();f.cloudSession={user:{id:'another'}};resolveFollowers({current:{followers_count:99}});await oldFollowers;
assert.equal(f.followerStats.current.followers_count,5,'old session followers are ignored');
console.log('PASS focused refresh: production global reads 6→2, metrics 6→4, calendar 5→3; independent queue controllers, legacy timer isolation, navigation and session races');
