const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const html=fs.readFileSync('index.html','utf8');
function fn(name){const start=html.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const end=html.slice(start).search(/\n(?=(?:async )?function |let |const )/);return html.slice(start,start+end);}
const posts=[{id:'photo',platform_account_id:'a',status:'queued',post_text:'',drive_file_name:'foto.jpg',meta:{gallery:true,allow_empty_caption:false}},
{id:'video',platform_account_id:'a',status:'queued',post_text:'Own caption',drive_file_name:'video.mp4',meta:{}},
{id:'foreign',platform_account_id:'b',status:'queued',post_text:''},
{id:'published',platform_account_id:'a',status:'published'},
{id:'locked',platform_account_id:'a',status:'processing'},
{id:'uncertain',platform_account_id:'a',status:'queued',meta:{publish_uncertain:true}},
{id:'scheduled',platform_account_id:'a',status:'queued',scheduled_at:'2026-11-11T18:00:00Z'}];
let requests=[],renders=0;
const c={console,Date,Array,Set,cloudSession:{},xPostingBusy:false,xSelectedAccountId:'a',xComposeOpen:true,xComposeDate:'2026-11-25T19:00',xStudioTab:'calendar',xPostingFiles:[],xPostingDraft:{caption:''},xPostingData:{posts,captions:[{id:'one',caption:'Next queue caption',status:'pending'},{id:'two',caption:'Reserved',status:'reserved'}]},xAllPosts:()=>posts,xStudioPage:()=>renders++,toast:()=>{},esc:s=>String(s).replaceAll('<','&lt;'),document:{getElementById:()=>null},xDefaultComposeDate:()=> '2026-11-11T12:00',xScheduleIso:d=>new Date(d+':00-03:00').toISOString(),xPostingRequest:async(action,body)=>{requests.push({action,body});const p=posts.find(p=>p.id===body.id);Object.assign(p,{scheduled_at:body.scheduled_at},Object.hasOwn(body,'caption')?{post_text:body.caption}:{});},loadXPostingStatus:async()=>{},xDateKey:d=>d.slice(0,10),xTimeKey:d=>d.slice(11,16),xPreviewMarkup:()=>'',xSavedCaptionMarkup:()=>'',xStatusLabels:{queued:'Na fila'}};
vm.createContext(c);
for(const name of ['xEditable','xClearSelected','xQueueCaptionEligible','xAvailableGallery','xSavedMediaMarkup','xQueueCaptionMarkup','xScheduleGallery','xSelectPost','xSaveDetail','xDetailMarkup','xGalleryMarkup'])vm.runInContext(fn(name),c);
(async()=>{
 assert.deepEqual(Array.from(c.xAvailableGallery(),p=>p.id),['photo','video']);
 assert.match(c.xGalleryMarkup(),/xScheduleGallery\('photo'\)/);
 assert.match(c.xSavedMediaMarkup(),/foto.jpg/);assert(!c.xSavedMediaMarkup().includes('foreign'));
 c.xScheduleGallery('foreign');assert.equal(c.xSelectedPost,undefined);
 c.xScheduleGallery('photo');assert.equal(c.xSelectedPost,'photo');assert.equal(c.xDetailDraft.date,'2026-11-25T19:00');assert.equal(c.xDetailDraft.useQueue,true);
 assert.match(c.xDetailMarkup(),/Next queue caption/);assert.match(c.xDetailMarkup(),/Adicionar à agenda/);assert(!c.xQueueCaptionMarkup(posts[0],c.xDetailDraft).includes('Reserved'));
 await c.xSaveDetail();assert.equal(requests.length,1);assert.equal(requests[0].action,'schedule');assert(!Object.hasOwn(requests[0].body,'caption'),'automatic queue must not become allow_empty_caption');assert.equal(requests[0].body.id,'photo');assert.equal(c.xCalendarAnchor,'2026-11-25');assert(!c.xAvailableGallery().some(p=>p.id==='photo'));
 c.xDetailDraft.useQueue=false;c.xDetailDraft.caption='';await c.xSaveDetail();assert.equal(requests[1].body.caption,'','explicit no-caption supported');
 c.xDetailDraft.useQueue=true;c.xDetailDraft.caption='Manual with https://example.com';await c.xSaveDetail();assert.equal(requests[2].body.caption,'Manual with https://example.com');
 assert.equal(c.xQueueCaptionEligible({post_text:'',meta:{allow_empty_caption:true}}),false);
 assert.equal(requests.some(r=>r.action==='upload-ticket'||r.action==='upload-complete'),false,'reuses existing ID without upload or duplication');
 console.log('PASS gallery → calendar, photo/video picker, account/lock filters, chosen slot, automatic queue, optional caption/link, no upload/duplication');
})().catch(e=>{console.error(e);process.exitCode=1;});
