const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const html=fs.readFileSync('index.html','utf8');
for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
const start=html.indexOf('async function loadXPostingStatus(){'),end=html.indexOf('async function refreshXPosting()',start);
let resolveOld;const stale=new Promise(resolve=>resolveOld=resolve);
const c={cloudSession:{access_token:'fake'},xPostingData:{posts:[{account:'A'}]},xPostingLoaded:false,xPostingLoading:false,xPostingReload:false,xPostingError:'',xAccountGeneration:1,xStatusRevision:0,xAccountList:[],xPostingDraft:{},xCalendarRange:()=>({from:'2026-10-16',to:'2026-10-20'}),xPostingRequest:()=>stale};vm.createContext(c);vm.runInContext(html.slice(start,end),c);
(async()=>{const pending=c.loadXPostingStatus();c.xAccountGeneration=2;c.xPostingData=null;resolveOld({accounts:[{id:'A'}],posts:[{account:'A'}]});await pending;assert.equal(c.xPostingData,null,'Old account response must not repaint new account');assert.equal(c.xAccountList.length,0);console.log('PASS: SPA syntax and delayed old-account responses discarded.');})().catch(e=>{console.error(e);process.exitCode=1;});
