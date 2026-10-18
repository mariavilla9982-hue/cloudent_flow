const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const html=fs.readFileSync('index.html','utf8');
function fn(name){const re=new RegExp('^(?:async )?function '+name+'\\(','m'),a=html.search(re);assert(a>=0,name);const m=html.slice(a).match(/\n(?=(?:async )?function |let |const )/);return html.slice(a,a+m.index);}
const root={innerHTML:'unchanged',querySelector:s=>s==='#xAddPost'?{}:null};let renders=0;
const c={console,Date,Array,Set,cloudSession:{},xSelectedAccountId:'a',xPostingBusy:false,xPostingFiles:[],xPostingFile:null,xBatchDrafts:[],xPostingDraft:{caption:'draft'},xDraftReply:'reply',xTargetAccounts:['a'],xUploadTicket:null,xComposeDate:'2026-10-20T15:00',xComposeOpen:true,xSelectedPost:null,xDetailDraft:null,xGalleryCompose:false,xSettingsDraft:null,xPostingData:{config:{daily_slots:['06:00','15:00','21:00'],interval_minutes:360,queue_mode:'daily_slots'}},xStudioPage:()=>renders++,$:()=>root,toast:()=>{},document:{getElementById:()=>null},xDefaultComposeDate:()=> '2026-10-20T06:00',xDateKey:()=> '2026-10-20',xTimeKey:()=> '15:00'};vm.createContext(c);
for(const name of ['xClearSelected','xPostingPickFile','xSelectionChanged','xRemoveSelected','xReplaceSelected','xCloseDetail','xOpenComposer','xSettingsState'])vm.runInContext(fn(name),c);
const a={name:'one.mp4'},b={name:'two.mp4'},d={name:'replacement.mp4'};
c.xPostingPickFile({files:[a,b]});assert.equal(c.xPostingFiles.length,2);c.xBatchDrafts[1].caption='keep';c.xBatchDrafts[1].date='2026-10-20T18:00';c.xRemoveSelected(0);assert.equal(c.xPostingFiles.length,1);assert.equal(c.xPostingDraft.caption,'keep');assert.equal(c.xComposeDate,'2026-10-20T18:00');assert(c.xComposeOpen);
c.xReplaceSelected(0,{files:[d]});assert.equal(c.xPostingFile.name,'replacement.mp4');assert.equal(c.xPostingDraft.caption,'keep');assert.equal(c.xUploadTicket,null);
c.xPostingPickFile({files:[]});assert.equal(c.xPostingFile.name,'replacement.mp4','cancel native picker preserves selection');
c.xCloseDetail();assert.equal(c.xPostingFiles.length,0);assert.equal(c.xPostingFile,null);c.xOpenComposer();assert.equal(c.xPostingFiles.length,0,'reopen cannot resurrect old files');
c.xSettingsState().slots='07:00, 19:00';c.xPostingData.config.daily_slots=['12:00','18:00'];assert.equal(c.xSettingsState().slots,'07:00, 19:00','server polling must preserve unsaved settings');c.xSelectedAccountId='b';assert.equal(c.xSettingsState().slots,'12:00, 18:00','draft must not cross accounts');
// A periodic render never replaces the open editor, even after it loses focus.
const oldRender=c.xStudioPage;vm.runInContext(fn('xStudioPage'),c);c.xPostingBusy=false;c.xComposeOpen=true;c.xStudioPage();assert.equal(root.innerHTML,'unchanged');c.xStudioPage=oldRender;
console.log('PASS picker cancel, single/batch remove/replace, close/reopen, account-scoped settings, polling editor preservation');
