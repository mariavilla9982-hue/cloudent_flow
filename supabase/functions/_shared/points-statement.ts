export function statementFilter(url: URL, now = new Date()) {
  const period = url.searchParams.get('period') || 'month';
  const rawPage = url.searchParams.get('page') || '0';
  if (!/^[0-9]{1,6}$/.test(rawPage) || !['today','yesterday','month','all'].includes(period)) throw new Error('invalid_filter');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
  const day = Date.UTC(+parts.year,+parts.month-1,+parts.day,3), daily=86400000;
  const since = period==='today'?day:period==='yesterday'?day-daily:Date.UTC(+parts.year,+parts.month-1,1,3);
  const until = period==='yesterday'?day:day+daily;
  const module = url.searchParams.get('module') || 'all';
  if (module.length>80 || /[\x00-\x1f]/.test(module)) throw new Error('invalid_filter');
  return {page:Number(rawPage),size:50,period,module,since:period==='all'?null:new Date(since).toISOString(),until:period==='all'?null:new Date(until).toISOString()};
}

export async function pointsStatement(admin:any, url:URL) {
  const filter=statementFilter(url);
  let q=admin.from('runninghub_charges').select('task_id,job_id,module,started_at,points,provider_status,settled,checked_at',{count:'exact'});
  if(filter.since)q=q.gte('started_at',filter.since).lt('started_at',filter.until);
  if(filter.module!=='all')q=q.eq('module',filter.module);
  const {data,error,count}=await q.order('started_at',{ascending:false}).order('task_id',{ascending:false}).range(filter.page*filter.size,(filter.page+1)*filter.size-1);
  if(error)throw error;
  return {rows:data||[],count:count||0,...filter,timezone:'America/Sao_Paulo'};
}
