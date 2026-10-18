const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const file=fs.readFileSync('image-pipeline-ui.js','utf8');
let rows=[];const list={dataset:{},innerHTML:'',querySelector:()=>null};
const root={dataset:{pipelineMounted:'true'},querySelector:()=>null};
const context={window:{},cloudSession:{user:{id:'owner'}},currentPage:'faceSwap',console,
 document:{createElement:()=>({textContent:''}),head:{appendChild(){}},getElementById:()=>root,querySelector:selector=>selector.includes('data-pipeline-jobs')?list:null},
 cloudFetch:async()=>({jobs:rows}),setInterval:()=>0,URL,Date};
vm.createContext(context);vm.runInContext(file,context);
const make=(id,status,stage='upscale')=>({id,status,created_at:'2026-10-18T10:0'+id+':00Z',original_file_name:'video-'+id+'.mp4',meta:{pipeline_version:2,source:'face_swap_natural',stage,face_swap_result:{path:'saved/'+id},pipeline_status:'UPSCALE_RUNNING'}});
(async()=>{
 await new Promise(setImmediate);
 rows=[make('3','waiting'),make('1','waiting'),make('2','running'),{...make('4','failed'),last_error:'Workflow incompatível: node 131'},make('5','ready')];
 await context.window.ImagePipeline.refresh();
 const html=list.innerHTML;
 assert(html.indexOf('Em processamento')<html.indexOf('Na fila'));
 assert(html.indexOf('video-1.mp4')<html.indexOf('video-3.mp4'),'FIFO within waiting group');
 const waiting=html.slice(html.indexOf('<h3 class="pipeline-group-title">Na fila'),html.indexOf('<h3 class="pipeline-group-title">Concluídos'));
 assert(waiting.includes('AGUARDANDO VAGA'));assert(waiting.includes('FILA 01'));assert(waiting.includes('FILA 02'));
 assert(!waiting.includes('pipeline-stage-segment active'));assert(!waiting.includes('pipeline-job-error'));assert(!waiting.includes('ATENÇÃO'));assert(waiting.includes('pipeline-step done'));
 assert(html.includes('Precisam de atenção'));assert(html.includes('Workflow incompatível: node 131'));
 rows=[{...make('6','waiting','control_motion'),production:{status:'running',meta:{provider_queue_waiting:false}}}];
 await context.window.ImagePipeline.refresh();assert(list.innerHTML.includes('PROCESSANDO'));assert(!list.innerHTML.includes('AGUARDANDO VAGA'));
 rows[0].production.status='queued';rows[0].production.meta.provider_queue_waiting=true;
 await context.window.ImagePipeline.refresh();assert(list.innerHTML.includes('AGUARDANDO VAGA'));assert(!list.innerHTML.includes('pipeline-stage-segment active'));
 console.log('PASS UI: ordered groups, FIFO numbering, preserved completed stages, no false error/animation while queued, real failures visible, Motion uses child status');
})().catch(e=>{console.error(e);process.exitCode=1});
