import {metricContext,metricCutoff,metricGraph} from './metrics-core.ts';
const allowed=new Set(['c5f2fdd6-00e8-4ca7-adb8-281aa922ad0a','7160f95b-a23c-4f28-a5b8-9502a856e091']);
const inflight=new Map<string,Promise<any>>();
export function parseAccountViews(response:any){
 const metric=response?.data?.find((m:any)=>m.name==='views');
 const total=metric?.total_value;
 if(typeof total?.value!=='number'||!Number.isFinite(total.value)||total.value<0)throw Error('views_unavailable');
 const breakdown=total.breakdowns?.find((b:any)=>b.dimension_keys?.includes('media_product_type'));
 if(!Array.isArray(breakdown?.results))throw Error('breakdown_unavailable');
 const index=breakdown.dimension_keys.indexOf('media_product_type');
 let reels=0,stories=0;
 for(const row of breakdown.results){
  if(typeof row.value!=='number'||!Number.isFinite(row.value)||row.value<0)throw Error('invalid_views');
  const type=String(row.dimension_values?.[index]||'').toUpperCase();
  if(type==='REEL'||type==='REELS')reels+=row.value;
  if(type==='STORY'||type==='STORIES')stories+=row.value;
 }
 return {views:total.value,reels,stories};
}
export async function accountViewSummary(admin:any,account:any,days:number){
 if(!allowed.has(String(account.id)))throw Error('forbidden');
 if(![1,7,30,90].includes(days))throw Error('invalid_summary_period');
 const since=metricCutoff(days),key='dashboard_account_views_v1_'+account.id+'_'+days;
 if(inflight.has(key))return inflight.get(key);
 const task=(async()=>{
  const now=Date.now();
  const {data:stored,error:readError}=await admin.from('app_settings').select('value').eq('key',key).maybeSingle();
  if(readError)throw readError;
  const previous=stored?.value?.since===since?stored.value:null;
  if(previous&&now-Date.parse(previous.attempted_at)<300000)return previous;
  let result:any;
  try{
   const context=await metricContext(admin,account.id);
   const totals={views:0,reels:0,stories:0};
   // Meta accepts bounded date ranges. Disjoint windows preserve 90-day totals.
   for(let start=Date.parse(since);start<now;){
    const end=Math.min(start+30*86400000,now);
    const path=account.external_account_id+'/insights?metric=views&period=day&metric_type=total_value&breakdown=media_product_type&since='+Math.floor(start/1000)+'&until='+Math.floor(end/1000);
    const values=parseAccountViews(await metricGraph(context.base,path,context.token));
    totals.views+=values.views;totals.reels+=values.reels;totals.stories+=values.stories;
    start=end;
   }
   result={...totals,since,until:new Date(now).toISOString(),collected_at:new Date(now).toISOString(),attempted_at:new Date(now).toISOString(),available:true,error:null};
  }catch{
   result={...(previous||{}),since,attempted_at:new Date(now).toISOString(),available:!!previous?.available,error:'account_insights_unavailable'};
  }
  // Eight bounded small metadata rows at most. Never cache credentials or raw Meta payloads.
  const {error}=await admin.from('app_settings').upsert({key,value:result,updated_at:new Date(now).toISOString()},{onConflict:'key'});
  if(error)throw error;
  return result;
 })();
 inflight.set(key,task);
 try{return await task}finally{if(inflight.get(key)===task)inflight.delete(key)}
}
