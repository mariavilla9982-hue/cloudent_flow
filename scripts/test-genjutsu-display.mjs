import assert from 'node:assert/strict';
import {imagePipelineApi} from '../supabase/functions/_shared/image-pipeline-api.ts';
const rows={face_swap_jobs:[{id:'parent',user_id:'owner',production_job_id:'child',meta:{pipeline_version:2,video_workflow:{key:'genjutsu'}}}],production_jobs:[{id:'child',user_id:'owner',status:'running',started_at:'2026-11-03T10:00:00Z',completed_at:null,runninghub_task_id:'task',progress:62,meta:{workflow_key:'genjutsu',provider_status_task_id:'task',provider_status:'RUNNING',genjutsu_prompt:{status:'complete',prompt:'exact <text>',video:{uri:'private'}}}}]};
let childReads=0;
const admin={from(table){if(table==="production_jobs")childReads++;let filters=[],single=false;const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},is(k,v){filters.push(r=>(r[k]??null)===v);return q;},contains(k,v){filters.push(r=>Object.entries(v).every(([key,value])=>typeof value==='object'?JSON.stringify(r[k]?.[key])===JSON.stringify(value):r[k]?.[key]===value));return q;},in(k,values){filters.push(r=>values.includes(r[k]));return q;},order(){return q;},limit(){return q;},maybeSingle(){single=true;return q;},then(resolve){const found=rows[table].filter(r=>filters.every(f=>f(r)));return Promise.resolve({data:structuredClone(single?found[0]||null:found)}).then(resolve);}};return q;}};
async function get(resource,user='owner'){const url=new URL('https://test/?resource='+resource+'&workflow=genjutsu&id=parent');return imagePipelineApi({req:new Request(url),url,admin,user:{id:user},json:(body,status=200)=>Response.json(body,{status})});}
rows.face_swap_jobs.push({...rows.face_swap_jobs[0],id:'parent2',production_job_id:'child2'});
rows.production_jobs.push({...rows.production_jobs[0],id:'child2',user_id:'stranger'});
let r=await get('image-pipeline');let body=await r.json();assert.equal(body.jobs[0].production.execution_confirmed,true);assert.equal(body.jobs[0].production.started_at,rows.production_jobs[0].started_at);assert.equal(body.jobs[0].production.meta,undefined);
assert.equal(body.jobs[1].production,null,'foreign child is excluded from the batched lookup');
assert.equal(childReads,1,'all linked children are read in a single query');
rows.face_swap_jobs.pop();rows.production_jobs.pop();
rows.production_jobs[0].meta.provider_status_task_id='old-task';body=await (await get('image-pipeline')).json();assert.equal(body.jobs[0].production.execution_confirmed,false,'a stale task cannot start the clock');
rows.production_jobs[0].hidden_at='2026-11-03';assert.equal((await (await get('image-pipeline')).json()).jobs.length,0,'calendar transfer stays hidden');
r=await get('image-pipeline-prompt');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.deepEqual(await r.json(),{prompt:'exact <text>',source:'automatic'});
assert.equal((await get('image-pipeline-prompt','stranger')).status,404);rows.production_jobs[0].user_id='stranger';assert.equal((await get('image-pipeline-prompt')).status,404);rows.production_jobs[0].user_id='owner';
rows.production_jobs[0].meta.genjutsu_prompt.status='generating';assert.equal((await get('image-pipeline-prompt')).status,409);
console.log('PASS GENJUTSU display API: persisted clock, stale task guard, calendar hiding, owner-only exact prompt, no private checkpoints');
