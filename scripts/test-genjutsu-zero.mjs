import assert from 'node:assert/strict';
import fs from 'node:fs';
import {authorizedGenjutsuTest} from '../supabase/functions/_shared/genjutsu-test-authorization.ts';
import {PIPELINE_VIDEO_WORKFLOWS} from '../supabase/functions/_shared/image-pipeline-workflows.ts';
import {GENJUTSU_INSTRUCTIONS} from '../supabase/functions/_shared/genjutsu-instructions.ts';
assert.deepEqual(PIPELINE_VIDEO_WORKFLOWS.map(x=>x.key),['genjutsu','motion_control']);
assert.equal(PIPELINE_VIDEO_WORKFLOWS[0].workflowId,'2124648844280733698');
const batch={enabled:true,workflow_id:'2124648844280733698',owner_user_id:'owner',batch_id:'test',job_ids:['one'],expires_at:'2026-11-24T00:00:00Z'};
const config={prompt_concurrency:1,authorized_test:batch},job={id:'one',user_id:'owner',max_attempts:1,meta:{workflow_id:batch.workflow_id,genjutsu_test_batch_id:'test'}};
const now=Date.parse('2026-11-23T00:00:00Z');assert(authorizedGenjutsuTest(config,job,now));
for(const change of [{user_id:'other'},{id:'two'},{max_attempts:2},{meta:{...job.meta,workflow_id:'old'}}])assert(!authorizedGenjutsuTest(config,{...job,...change},now));
assert(!authorizedGenjutsuTest(config,job,Date.parse(batch.expires_at)));
assert(!authorizedGenjutsuTest({...config,prompt_concurrency:2},job,now));
assert(!authorizedGenjutsuTest({...config,authorized_test:{...batch,enabled:false}},job,now));
const original=JSON.parse(fs.readFileSync('../upload/work transfer v1(1).json','utf8'));
assert.equal(GENJUTSU_INSTRUCTIONS,original.nodes.find(x=>x.id===1040).widgets_values[0]);
for(const filename of ['motion-control-core-v6.js','genjutsu-ui.js']){
 const source=fs.readFileSync(filename,'utf8');assert(source.includes('GENJUTSU 0'));assert(!source.includes('[STANDARD,"Vídeo 7 minutos"]'));assert(!source.includes("['standard','Vídeo 7 minutos']"));
}
console.log('PASS GENJUTSU 0 workflow selection, exact note1040 and scoped serial test authorization');
