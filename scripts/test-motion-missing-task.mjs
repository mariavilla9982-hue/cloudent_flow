import assert from 'node:assert/strict';
import {missingMotionTaskPatch} from '../supabase/functions/_shared/motion-missing-task.ts';
const now=Date.now(),job={status:'running',runninghub_task_id:'123',meta:{workflow_key:'motion_control'}};
const observation={task_id:'123',status:'UNKNOWN',status_code:807,outputs_code:807,checked_at:now,capacity:{code:0,data:{concurrentLimit:5,runningCount:0,queuedCount:0,totalCurrentTasks:0}}};
const patch=missingMotionTaskPatch(job,[observation,observation],now);assert.equal(patch.status,'failed');assert.equal(patch.meta.provider_status,'UNKNOWN');assert.equal(patch.meta.provider_terminal_status,null);assert.equal(patch.meta.pipeline_dispatch_uncertain,false);assert.equal(patch.meta.provider_retry_blocked,true);assert.equal(patch.runninghub_task_id,undefined);
for(const mutate of [o=>o.status='RUNNING',o=>o.outputs_code=804,o=>o.status_code=0,o=>o.capacity.data.runningCount=1,o=>o.capacity.data.queuedCount=1,o=>o.capacity.data.totalCurrentTasks=1,o=>o.capacity.data.concurrentLimit=null,o=>o.task_id='other',o=>o.checked_at=now-60001]){const o=structuredClone(observation);mutate(o);assert.equal(missingMotionTaskPatch(job,[observation,o],now),null);}
for(const j of [{...job,locked_by:'capturing'},{...job,result_video_id:'ready'},{...job,meta:{...job.meta,motion_preview_file:{filename:'video.mp4'}}},{...job,meta:{workflow_key:'genjutsu'}}])assert.equal(missingMotionTaskPatch(j,[observation,observation],now),null);
assert.equal(missingMotionTaskPatch(job,[observation],now),null);
console.log('PASS missing task quarantine: two idle-provider proofs, exact task, no active/output races, unknown preserved and retry blocked');
