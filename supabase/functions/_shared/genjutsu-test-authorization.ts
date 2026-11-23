// Explicit production test authorization is distinct from cancellation proof.
export function authorizedGenjutsuTest(config:any,job:any,now=Date.now()){
 const batch=config?.authorized_test;
 return batch?.enabled===true&&batch.workflow_id==='2124648844280733698'
  &&batch.owner_user_id===job?.user_id&&job?.meta?.workflow_id===batch.workflow_id
  &&job?.meta?.genjutsu_test_batch_id===batch.batch_id
  &&Array.isArray(batch.job_ids)&&batch.job_ids.length>0&&batch.job_ids.length<=8
  &&batch.job_ids.includes(job?.id)&&Number.isFinite(Date.parse(batch.expires_at))&&Date.parse(batch.expires_at)>now
  &&config.prompt_concurrency===1&&job.max_attempts===1;
}
