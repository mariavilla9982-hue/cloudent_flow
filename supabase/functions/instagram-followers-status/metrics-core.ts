export function metricNumber(value:any){const n=Number(value);return Number.isFinite(n)&&n>=0?n:0}
export function metricDay(d:Date,tz='America/Sao_Paulo'){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
 const g=(t:string)=>p.find(x=>x.type===t)?.value||'';return g('year')+'-'+g('month')+'-'+g('day');
}
export function metricCutoff(days:number,now=new Date()){
 const day=metricDay(now);const d=new Date(day+'T03:00:00Z');d.setUTCDate(d.getUTCDate()-(days-1));return d.toISOString();
}
export async function metricAccount(admin:any,userId:string,requested:string|null){
 const {data:member,error:me}=await admin.from('app_members').select('role,enabled').eq('user_id',userId).maybeSingle();
 if(me)throw me;if(!member?.enabled)throw new Error('forbidden');
 const {data:accounts,error}=await admin.from('platform_accounts').select('id,external_account_id,account_label,config').eq('platform','instagram').eq('enabled',true).order('created_at');
 if(error)throw error;
 const allowed=(accounts||[]).filter((a:any)=>member.role==='admin'||a.config?.owner_user_id===userId);
 const account=requested?allowed.find((a:any)=>a.id===requested):allowed[0];
 if(!account)throw new Error(requested?'account_not_found':'instagram_not_connected');return account;
}
export async function metricContext(admin:any,accountId:string){
 const {data:account,error}=await admin.from('platform_accounts').select('id,enabled,external_account_id,account_label,config').eq('id',accountId).eq('platform','instagram').maybeSingle();
 if(error)throw error;if(!account?.enabled)throw new Error('instagram_account_disabled');
 const {data:token,error:te}=await admin.rpc('get_instagram_page_token_for_account',{p_account_id:account.id});
 if(te)throw te;if(!token)throw new Error('instagram_token_unavailable');
 return {account,token,base:account.config?.api_mode==='facebook_login'?'https://graph.facebook.com/v26.0':'https://graph.instagram.com/v26.0'};
}
export async function metricGraph(base:string,path:string,token:string){
 const response=await fetch(base+'/'+path.replace(/^\//,''),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
 let data:any={};try{data=await response.json()}catch{}
 if(!response.ok||data.error)throw new Error(data.error?.message||'Instagram HTTP '+response.status);return data;
}
export async function metricInsights(base:string,id:string,token:string){
 let last:any;for(const names of ['views,reach,saved,shares','plays,reach,saved,shares']){
  try{const data=await metricGraph(base,id+'/insights?metric='+names,token);const metrics:any={};
  for(const row of data.data||[])if(row.values?.[0]?.value!=null||row.value!=null)metrics[row.name]=metricNumber(row.values?.[0]?.value??row.value);
  if(metrics.views===undefined&&metrics.plays===undefined)throw new Error('views_unavailable');
  for(const key of ['reach','saved','shares'])if(metrics[key]===undefined)throw new Error(key+'_unavailable');
  return {data,metrics};}catch(e){last=e}
 }throw last;
}
export async function storeMetric(admin:any,context:any,media:any,scheduleId:string|null=null){
 // Never save fabricated zeros when insights cannot be read. Preserve the previous snapshot.
 const {data:insights,metrics:mm}=await metricInsights(context.base,String(media.id),context.token);
 const {data:row,error}=await admin.from('instagram_media').upsert({ig_media_id:String(media.id),platform_account_id:context.account.id,
  media_type:media.media_type||null,media_product_type:media.media_product_type||null,caption:media.caption||null,permalink:media.permalink||null,
  thumbnail_url:media.thumbnail_url||null,media_url:media.media_url||null,posted_at:media.timestamp||null,
  like_count:metricNumber(media.like_count),comments_count:metricNumber(media.comments_count),raw:{media,insights,api_mode:context.account.config?.api_mode||'instagram_login'}
 },{onConflict:'ig_media_id'}).select('id').single();if(error)throw error;
 const snapshot={instagram_media_record_id:row.id,schedule_id:scheduleId,collected_at:new Date().toISOString(),
  views:metricNumber(mm.views??mm.plays),reach:metricNumber(mm.reach),likes:metricNumber(media.like_count),comments:metricNumber(media.comments_count),
  shares:metricNumber(mm.shares),saves:metricNumber(mm.saved),raw:{metrics:mm,source:'account_metrics'}};
 const {error:se}=await admin.from('metrics_snapshots').insert(snapshot);if(se)throw se;
 const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date(media.timestamp));
 const g=(t:string)=>p.find(x=>x.type===t)?.value||'';const dow:any={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
 const {data:trial,error:trialError}=await admin.from('reel_test_publications').select('trial_kind').eq('instagram_media_id',String(media.id)).limit(1).maybeSingle();
 if(trialError)throw trialError;
 const source=trial?(trial.trial_kind==='prepost'?'instagram_prepost_trial':'instagram_trial'):'instagram';
 const {error:sampleError}=await admin.from('smart_samples').upsert({instagram_media_record_id:row.id,...(scheduleId?{schedule_id:scheduleId}:{}),platform_account_id:context.account.id,
  sample_date:metricDay(new Date(media.timestamp)),sample_time:g('hour')+':'+g('minute')+':00',weekday:dow[g('weekday')],
  views:snapshot.views,reach:snapshot.reach,likes:snapshot.likes,comments:snapshot.comments,shares:snapshot.shares,saves:snapshot.saves,source
 },{onConflict:'instagram_media_record_id'});if(sampleError)throw sampleError;return snapshot;
}
export async function storedMetrics(admin:any,accountId:string,cutoff:string){
 const all:any[]=[];for(let offset=0;;offset+=500){
  const {data,error}=await admin.from('latest_instagram_metrics').select('*').eq('platform_account_id',accountId).gte('posted_at',cutoff)
   .order('posted_at',{ascending:false}).order('ig_media_id').range(offset,offset+499);
  if(error)throw error;all.push(...(data||[]));if((data||[]).length<500)break;
 }return all.filter(m=>m.media_product_type==='REELS').map(m=>({id:m.ig_media_id,record_id:m.instagram_media_record_id,
  platform_account_id:m.platform_account_id,caption:m.caption||'',permalink:m.permalink,thumbnail_url:m.thumbnail_url,media_url:m.media_url,
  timestamp:m.posted_at,media_type:m.media_type,media_product_type:m.media_product_type,collected_at:m.collected_at,
  views:metricNumber(m.views),reach:metricNumber(m.reach),likes:metricNumber(m.likes),comments:metricNumber(m.comments),shares:metricNumber(m.shares),saves:metricNumber(m.saves)}));
}
