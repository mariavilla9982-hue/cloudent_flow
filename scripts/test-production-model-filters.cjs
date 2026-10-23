const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let motion=false,renders=0,confirmation='',writes=0;
const jobs=[
 {id:'jj',status:'ready',meta:{character_id:'jujuh'}},
 {id:'sj',status:'ready',meta:{character_id:'sahry_japah'}},
 {id:'sg',status:'ready',meta:{character_id:'sahry_gravida'}},
 {id:'legacy',status:'ready',original_file_name:'Jujuh.mp4',meta:{}},
 {id:'motion',status:'ready',meta:{workflow_key:'motion_control',character_id:'jujuh'}},
];
const root={classList:{contains:()=>motion}};
const context={window:{},document:{getElementById:()=>root,addEventListener(){},activeElement:null},
 cloudSession:{user:{id:'owner'}},currentPage:'other',productionData:{jobs},productionSelectedJobs:new Set(),
 productionPage:()=>renders++,productionPanelScope:()=>motion?'production_motion':'production_standard',panelVisibleRows:(_,rows)=>rows,
 MutationObserver:class{observe(){} disconnect(){}},requestAnimationFrame(){},setInterval(){},URL:{revokeObjectURL(){}},
 confirm:m=>{confirmation=m;return false},toast(){},cloudFetch:async()=>{writes++;},Set,console};
vm.createContext(context);vm.runInContext(fs.readFileSync('production-studio.js','utf8'),context);
const s=context.window.CloudentStudio,ids=rows=>Array.from(rows,x=>x.id);
assert.deepEqual(ids(s.currentJobs()),['jj','sj','sg','legacy']);
s.setModelFilter('jujuh');assert.deepEqual(ids(s.currentJobs()),['jj']);
motion=true;assert.deepEqual(ids(s.currentJobs()),['motion'],'same model cannot cross workflow');motion=false;
assert.equal(s.modelOf({meta:{character_id:'jujuh',character_name:'Sahry Japah'}}),'jujuh','stable ID takes precedence');
assert.equal(s.modelOf({meta:{character_name:'Sahry Gravidinha'}}),'sahry_gravida');
assert.equal(s.modelOf({meta:{tags:['Sahry grávida']}}),'sahry_gravida');
assert.equal(s.modelOf({meta:{tags:['Jujuh','Sahry japah']}}),'','ambiguous tags do not guess');
assert.equal(s.modelOf(jobs[3]),'','filenames are not identity evidence');
assert.equal(s.modelOf({meta:{character_name:'Sahry'}}),'','ambiguous old Sahry stays unknown');
const html=fs.readFileSync('index.html','utf8');
vm.runInContext(html.slice(html.indexOf('function toggleProductionJobSelection('),html.indexOf('async function deleteProductionJob(')),context);
context.toggleAllReadyProduction(true);assert.deepEqual([...context.productionSelectedJobs],['jj'],'select all selects only filtered mode/model');
context.productionSelectedJobs.add('sj');
(async()=>{
 await context.deleteSelectedProductionJobs();assert(confirmation.includes('1 selecionados'),'hidden model excluded from destructive selection');assert.equal(writes,0);
 s.setModelFilter('sahry_japah');assert.deepEqual(ids(s.currentJobs()),['sj']);assert.equal(context.productionSelectedJobs.size,0);
 s.setModelFilter('sahry_gravida');assert.deepEqual(ids(s.currentJobs()),['sg']);
 s.setModelFilter('unknown');assert.deepEqual(ids(s.currentJobs()),['sg'],'invalid filters ignored');
 context.cloudSession={user:{id:'new-owner'}};assert.equal(s.filterRows(jobs).length,5,'new user resets filter');
 s.setModelFilter('all');assert.equal(jobs.length,5);assert(renders>=3);assert.equal(writes,0);
 assert(html.includes('CloudentStudio?.filterRows(visibleJobs)'));assert(html.includes('modelFilterNative="true"'));
 console.log('PASS production model filters: three identities, all/legacy, ID authority, no filename guesses, workflow isolation, bulk selection safety, filter changes/session reset, zero API writes');
})().catch(e=>{console.error(e);process.exitCode=1});
