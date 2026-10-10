import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {metricAccount,metricContext,metricCutoff,metricGraph,storeMetric,storedMetrics} from './metrics-core.ts';
const H={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json'};
const out=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:H});
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try{
 const {data:auth,error:ae}=await admin.auth.getUser((req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,''));
 if(ae||!auth.user)return out({error:'unauthorized'},401);
 const url=new URL(req.url),requested=url.searchParams.get('account_id');
 const rawDays=Number(url.searchParams.get('days')||120),days=Number.isFinite(rawDays)?Math.max(1,Math.min(120,Math.floor(rawDays))):120;
 const cutoff=metricCutoff(days),account=await metricAccount(admin,auth.user.id,requested);
 let nextCursor:string|null=null;const errors:any[]=[];let synced=0;
 if(req.method==='POST'){
 const context=await metricContext(admin,account.id);const after=url.searchParams.get('after');
 const fields='id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count';
 const list=await metricGraph(context.base,account.external_account_id+'/media?fields='+fields+'&limit=12'+(after?'&after='+encodeURIComponent(after):''),context.token);
 if(!Array.isArray(list.data))throw new Error('invalid_instagram_media_response');
 const recent=list.data.filter((m:any)=>m.media_product_type==='REELS'&&m.timestamp&&new Date(m.timestamp).getTime()>=new Date(cutoff).getTime());
 // Three simultaneous requests bound Meta traffic and keep Edge runs short.
 for(let i=0;i<recent.length;i+=3)await Promise.all(recent.slice(i,i+3).map(async(m:any)=>{
 try{await storeMetric(admin,context,m);synced++}catch(e){errors.push({id:m.id,error:e instanceof Error?e.message:String(e)})}
 }));
 if(list.paging?.next&&list.data.length&&list.data.every((m:any)=>m.timestamp&&new Date(m.timestamp).getTime()>=new Date(cutoff).getTime()))nextCursor=list.paging.cursors?.after||null;
 }else if(req.method!=='GET')return out({error:'method_not_allowed'},405);
 const media=await storedMetrics(admin,account.id,cutoff);
 return out({ok:true,account_id:account.id,account_label:account.account_label,days,timezone:'America/Sao_Paulo',count:media.length,synced,errors,next_cursor:nextCursor,media,
  last_collected_at:media.reduce((last:string|null,m:any)=>!last||m.collected_at>last?m.collected_at:last,null),generated_at:new Date().toISOString()});
 }catch(e){const error=e instanceof Error?e.message:String(e);return out({ok:false,error},error==='forbidden'?403:error==='account_not_found'?404:500)}
});
