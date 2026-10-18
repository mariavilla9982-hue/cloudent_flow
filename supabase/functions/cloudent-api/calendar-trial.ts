// Called only after native session verification and the administrator guard.
export async function handleCalendarTrial(req:Request,admin:any,member:any,actor:string,url:URL,json:any){
  if(member.role!=="admin"||!member.enabled)return json({error:"forbidden"},403);
  if(req.method==="GET"){
    const {data:jobs,error}=await admin.from("production_jobs").select("id,result_video_id,created_at").eq("user_id",actor).eq("status","ready").not("result_video_id","is",null).order("created_at",{ascending:false});if(error)throw error;
    const ids=[...new Set((jobs||[]).map((j:any)=>j.result_video_id))];
    if(!ids.length)return json({videos:[]});
    const {data:videos,error:ve}=await admin.from("videos").select("id,file_name,platform_account_id,caption").in("id",ids).eq("platform","instagram").eq("storage_provider","r2").is("storage_deleted_at",null);if(ve)throw ve;
    return json({videos:(videos||[]).map((v:any)=>({...v,production_job_id:jobs.find((j:any)=>j.result_video_id===v.id)?.id}))});
  }
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const body=await req.json();
  const {data,error}=await admin.rpc("set_calendar_trial_video",{p_schedule_id:body.schedule_id,p_video_id:body.video_id||null,p_actor:actor});
  if(error)return json({error:error.message},409);
  return json(data);
}
