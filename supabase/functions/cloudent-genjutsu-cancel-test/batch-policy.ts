export const BATCH_IDS=['0466aaec-6615-413f-a860-6ab0804b0c63','dd20325a-c766-45f3-a4c5-69580dd9a23c'];
export function selectValidationJob(rows:any[]){
 if(rows.length!==2||new Set(rows.map(r=>r.id)).size!==2||rows.some(r=>!BATCH_IDS.includes(r.id)))throw Error('batch_identity_mismatch');
 for(const id of BATCH_IDS){
  const row=rows.find(r=>r.id===id);
  if(['queued','running','uploading'].includes(row.status)||row.meta?.provider_task_pending===true)return {phase:'waiting',job_id:null};
  if(row.runninghub_task_id){
   if(['ready','failed','cancelled'].includes(row.status))continue;
   return {phase:'waiting',job_id:null};
  }
  if(row.status!=='motion_waiting'||row.result_video_id||row.locked_by||row.meta?.pipeline_dispatch_intent||Number(row.attempt_count)!==0)return {phase:'blocked',job_id:null};
  return {phase:'dispatch',job_id:row.id};
 }
 return {phase:'complete',job_id:null};
}
