
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {metricAccount,metricDay} from "./metrics-core.ts";
const H={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  "Access-Control-Allow-Methods":"GET, OPTIONS",
  "Content-Type":"application/json"
};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  const admin=createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {auth:{persistSession:false,autoRefreshToken:false}}
  );
  try{
    const bearer=req.headers.get("Authorization")?.replace("Bearer ","")||"";
    const {data:a,error:ae}=await admin.auth.getUser(bearer);
    if(ae||!a.user)return out({ok:false,error:"unauthorized"},401);

    const url=new URL(req.url);
    const days=Math.max(1,Math.min(90,Number(url.searchParams.get("days")||30)));

    const integration=await metricAccount(admin,a.user.id,url.searchParams.get("account_id"));
    const accountId=String(integration.external_account_id);
    const cutoff=metricDay(new Date(Date.now()-(days-1)*86400000));

    const [stateQ,dailyQ,workerQ,syncQ]=await Promise.all([
      admin.from("instagram_follower_state")
        .select("account_id,followers_count,previous_count,delta_last,last_checked_at,last_change_at,updated_at")
        .eq("account_id",accountId).maybeSingle(),
      admin.from("instagram_follower_daily")
        .select("day,first_count,current_count,peak_count,low_count,net_change,updated_at")
        .eq("account_id",accountId).gte("day",cutoff).order("day",{ascending:true}),
      admin.from("worker_runtime")
        .select("worker_name,last_heartbeat,last_success_at,last_error,updated_at")
        .eq("worker_name","followers").maybeSingle(),
      admin.from("instagram_metrics_sync_state").select("followers_error,last_followers_attempt_at").eq("account_id",integration.id).maybeSingle()
    ]);
    if(stateQ.error)throw stateQ.error;
    if(dailyQ.error)throw dailyQ.error;
    if(workerQ.error)throw workerQ.error;

    const worker=workerQ.data;
    const online=!syncQ.data?.followers_error&&!!stateQ.data?.last_checked_at&&new Date(stateQ.data.last_checked_at).getTime()>Date.now()-12*60*1000;

    return out({
      ok:true,
      account_id:integration.id,error:syncQ.data?.followers_error||null,account_label:integration.account_label||null,
      current:stateQ.data||null,
      daily:dailyQ.data||[],
      worker:worker?{...worker,online}:null
    });
  }catch(e:any){
    return out({ok:false,error:e instanceof Error?e.message:String(e)},500);
  }
});
