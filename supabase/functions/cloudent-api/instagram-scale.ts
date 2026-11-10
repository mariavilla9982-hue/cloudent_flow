const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const calendarTime=/^(?:[01]\d|2[0-3]):[0-5]\d$/;

export async function instagramScaleAccounts(admin:any,actor:string){
  const {data,error}=await admin.rpc("instagram_scale_accounts",{p_actor:actor});
  if(error)throw error;
  return data||[];
}

export async function instagramScaleApi(req:Request,url:URL,admin:any,actor:string,json:any){
  const action=url.searchParams.get("action")||"summary";
  if(req.method==="GET"&&action==="summary"){
    const from=new Date(String(url.searchParams.get("from")||""));
    const until=new Date(String(url.searchParams.get("until")||""));
    const span=until.getTime()-from.getTime();
    if(!Number.isFinite(span)||span<=0||span>61*86400000)return json({error:"invalid_metrics_period"},400);
    const {data,error}=await admin.rpc("instagram_scale_summary",{p_actor:actor,p_from:from.toISOString(),p_until:until.toISOString()});
    if(error)throw error;
    return json({accounts:data||[]});
  }

  if(!["upcoming","sync","policy","retry"].includes(action))return json({error:"route_not_found"},404);
  if((action==="upcoming"&&req.method!=="GET")||(action!=="upcoming"&&req.method!=="POST"))return json({error:"method_not_allowed"},405);
  const body=req.method==="POST"?await req.json().catch(()=>null):null;
  const accountId=String(url.searchParams.get("account_id")||body?.account_id||"");
  if(!uuid.test(accountId))return json({error:"invalid_account_id"},400);
  const account=(await instagramScaleAccounts(admin,actor)).find((a:any)=>a.id===accountId);
  if(!account)return json({error:"account_not_found"},404);

  if(action==="upcoming"){
    const [{data,error},{data:failed,error:failedError}]=await Promise.all([
      admin.from("schedules").select("id,scheduled_at,status,instagram_scale_caption,videos(file_name,caption)")
        .eq("platform_account_id",accountId).in("status",["scheduled","queued","processing"]).order("scheduled_at").limit(30),
      admin.from("schedules").select("id,scheduled_at,status,last_error,instagram_scale_caption,videos(file_name,caption)")
        .eq("platform_account_id",accountId).eq("status","failed").order("scheduled_at",{ascending:false}).limit(10)
    ]);
    if(error||failedError)throw error||failedError;
    return json({upcoming:data||[],failed:failed||[]});
  }

  if(!account.config?.scale_pilot_child)return json({error:"instagram_daughter_required"},409);
  if(action==="retry"){
    const scheduleId=String(body?.schedule_id||"");
    if(!uuid.test(scheduleId))return json({error:"invalid_schedule_id"},400);
    const {data:schedule,error:scheduleError}=await admin.from("schedules").select("id")
      .eq("id",scheduleId).eq("platform_account_id",accountId).maybeSingle();
    if(scheduleError)throw scheduleError;
    if(!schedule)return json({error:"schedule_not_found"},404);
    const {data,error}=await admin.rpc("instagram_scale_edit_schedule",{
      p_schedule_id:scheduleId,p_actor:actor,p_scheduled_at:null,p_retry:true
    });
    if(error||!data)return json({error:"instagram_retry_unavailable",user_message:"Só falhas confirmadas podem ser reenfileiradas."},409);
    return json({ok:true});
  }
  if(action==="sync"){
    if(typeof body?.enabled!=="boolean")return json({error:"invalid_sync_setting"},400);
    const {error}=await admin.from("instagram_scale_links").update({sync_enabled:body.enabled}).eq("child_id",accountId);
    if(error)throw error;
    return json({ok:true});
  }

  const times=body?.times;
  const zone=String(body?.timezone||"");
  if(!Array.isArray(times)||!times.length||times.length>10||new Set(times).size!==times.length||
    times.some((time:unknown)=>typeof time!=="string"||!calendarTime.test(time))||!zone){
    return json({error:"invalid_calendar_policy",user_message:"Informe de 1 a 10 horários válidos e diferentes no formato HH:MM."},400);
  }
  try{new Intl.DateTimeFormat("pt-BR",{timeZone:zone}).format()}catch{return json({error:"invalid_timezone"},400)}
  const calendar_policy={enabled:true,locked:true,timezone:zone,times:[...times].sort(),daily_limit:times.length};
  const {data,error}=await admin.from("platform_accounts").update({config:{...account.config,calendar_policy},updated_at:new Date().toISOString()})
    .eq("id",accountId).eq("updated_at",account.updated_at).select("id").maybeSingle();
  if(error)throw error;
  if(!data)return json({error:"account_changed",user_message:"A conta foi atualizada. Recarregue e tente novamente."},409);
  return json({ok:true});
}
