// Current execution topology. Migration utilities are history, never liveness targets.
export const workerPolicy:Record<string,{grace:number,retired?:boolean,reason?:string}>={
  instagram_publish:{grace:360},trial_reels:{grace:360},posting_scheduler:{grace:360},
  automation:{grace:900},followers:{grace:900},notifications:{grace:900},media_cleaner:{grace:900},
  motion_control:{grace:900},motion_status:{grace:900},production:{grace:360},x_drive_publisher:{grace:360},
  hot_storage:{grace:0,retired:true,reason:'Rotina antiga de armazenamento; não executada no projeto atual.'},
  motion_supabase:{grace:0,retired:true,reason:'Rotina antiga de migração; não é um serviço contínuo.'},
  supabase_migration:{grace:0,retired:true,reason:'Migração histórica; não é um serviço contínuo.'},
  x_warmup:{grace:0,retired:true,reason:'Aquecimento X desativado; publicação usa o worker X Studio.'}
};
export function healthWorkers(rows:any[],now=Date.now()){
  const byName=new Map(rows.map(w=>[w.worker_name,w]));
  return Object.entries(workerPolicy).map(([name,p])=>{
    const w:any=byName.get(name)||{worker_name:name,last_heartbeat:null,last_error:null};
    const age=w.last_heartbeat?now-Date.parse(w.last_heartbeat):Infinity;
    const online=Number.isFinite(age)&&age>=-60000&&age<=p.grace*1000;
    return {...w,online:!p.retired&&online,retired:!!p.retired,reason:p.reason||null,
      healthy:!p.retired&&online&&!w.last_error,heartbeat_age_seconds:Number.isFinite(age)?Math.max(0,Math.round(age/1000)):null};
  }).concat(rows.filter(w=>!workerPolicy[w.worker_name]).map(w=>({...w,online:false,healthy:false,retired:false,reason:'Worker não cadastrado no monitoramento.'})));
}
export function healthFailures(rows:any[],now=Date.now()){
  // Preserve terminal records and their errors. Old metric collection failures are
  // shown as historical separately; they must never trigger a publish retry.
  const historical=rows.filter(r=>r.job_type==='collect_metrics'&&Date.parse(r.updated_at)<now-7*86400000);
  const current=rows.filter(r=>!historical.includes(r));
  return {current,historical};
}
