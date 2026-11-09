// RunningHub reports usage per task. Legacy RH coins and plan points can
// coexist in historical results, so keep their units explicit.
export function runningHubAmount(raw:unknown):number|null{
  if(typeof raw!=='number'&&(typeof raw!=='string'||!/^\d+(\.\d+)?$/.test(raw.trim())))return null;
  const amount=Number(raw);
  return Number.isFinite(amount)&&amount>=0?amount:null;
}

type Charge={stage:string;amount:number|null;unit:'points'|'coins'|null};

export async function readImageCharge(rhJson:any,taskId:string,stage:string,result?:any):Promise<Charge>{
  const sources=[result?.usage,result?.data?.usage,...(Array.isArray(result?.data)?result.data:[])];
  const charge=():Charge=>{
    for(const [key,unit] of [['consumePoints','points'],['consumeCoins','coins']] as const){
      for(const source of sources){
        const amount=runningHubAmount(source?.[key]);
        if(amount!==null)return {stage,amount,unit};
      }
    }
    return {stage,amount:null,unit:null};
  };
  const reported=charge();
  if(reported.amount!==null)return reported;
  try{
    const v2=await rhJson('/openapi/v2/query',{taskId},AbortSignal.timeout(3500));
    if(String(v2?.taskId)===taskId&&['SUCCESS','FAILED'].includes(v2?.status))sources.push(v2.usage);
  }catch{}
  return charge();
}

// Recover recent jobs that predate per-stage tracking, and retry missing
// terminal usage once after settlement. Never write over a worker's lease.
export async function reconcileImageCharges(admin:any,rhJson:any){
  const {data,error}=await admin.from('face_swap_jobs').select('id,status,meta,updated_at')
    .contains('meta',{pipeline_version:2}).is('hidden_at',null).is('locked_by',null)
    .is('meta->>image_billing_reconciled_at',null)
    .or('status.in.(ready,cancelled),meta->>stage.eq.control_motion')
    .or('meta->>face_swap_task_id.not.is.null,meta->>upscale_task_id.not.is.null')
    .gte('created_at',new Date(Date.now()-7*86400000).toISOString())
    .lt('updated_at',new Date(Date.now()-120000).toISOString())
    .order('created_at',{ascending:false}).limit(2);
  if(error)throw error;
  for(const row of data||[]){
    const meta=row.meta,charges={...meta.image_task_charges};
    for(const stage of ['face_swap','upscale']){
      const id=meta[stage+'_task_id'];
      if(typeof id==='string'&&/^\d+$/.test(id))charges[id]??={stage,amount:null,unit:null};
    }
    for(const id of [meta.face_swap_task_id,meta.upscale_task_id]){
      const value=charges[id] as Charge|undefined;
      if(!value)continue;
      if(value.amount!==null)continue;
      let result;
      try{result=await rhJson('/task/openapi/outputs',{taskId:id},AbortSignal.timeout(3500));}catch{}
      charges[id]=await readImageCharge(rhJson,id,value.stage,result);
    }
    const now=new Date().toISOString();
    await admin.from('face_swap_jobs').update({updated_at:now,meta:{...meta,image_task_charges:charges,image_billing_reconciled_at:now}})
      .eq('id',row.id).eq('status',row.status).eq('updated_at',row.updated_at).is('locked_by',null).is('meta->>image_billing_reconciled_at',null);
  }
}
