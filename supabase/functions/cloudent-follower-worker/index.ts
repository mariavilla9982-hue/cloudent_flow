
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {metricContext} from "./metrics-core.ts";
const H={"Content-Type":"application/json"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});

async function graph(base:string,path:string,token:string){
  const r=await fetch(base+"/"+path.replace(/^\//,""),{headers:{Authorization:"Bearer "+token}});
  let j:any={};try{j=await r.json()}catch{}
  if(!r.ok||j?.error)throw new Error(j?.error?.message||("Meta API "+r.status));
  return j;
}

function localDay(tz:string){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const g=(t:string)=>p.find(x=>x.type===t)?.value||"";
  return g("year")+"-"+g("month")+"-"+g("day");
}

Deno.serve(async(req:Request)=>{
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const supplied=req.headers.get("x-cloudent-worker-secret")||"";
    const {data:expected,error:se}=await admin.rpc("get_cloudent_worker_secret");
    if(se)throw se;
    if(!supplied||supplied!==expected)return out({ok:false,error:"unauthorized"},401);

    const {data:accounts,error:accountsError}=await admin.from("platform_accounts").select("id,account_label").eq("platform","instagram").eq("enabled",true).order("created_at");
    if(accountsError)throw accountsError;
    const results:any[]=[];
    for(const account of accounts||[]){
    try{
    const {account:integration,token,base}=await metricContext(admin,account.id);

    const accountId=String(integration.external_account_id);
    const profile=await graph(base,accountId+"?fields=id,username,followers_count",String(token));
    const count=Number(profile.followers_count);
    if(profile.followers_count==null||!Number.isFinite(count)||count<0)throw new Error("followers_count_unavailable");

    const now=new Date().toISOString(),day=localDay("America/Recife");
    const {data:state,error:stateErr}=await admin.from("instagram_follower_state")
      .select("*").eq("account_id",accountId).maybeSingle();
    if(stateErr)throw stateErr;

    const previous=state?.followers_count==null?count:Number(state.followers_count);
    const delta=count-previous;

    const statePayload:any={
      account_id:accountId,
      followers_count:count,
      previous_count:previous,
      delta_last:delta,
      last_checked_at:now,
      updated_at:now
    };
    if(delta!==0)statePayload.last_change_at=now;
    else if(state?.last_change_at)statePayload.last_change_at=state.last_change_at;

    const {error:stateUpErr}=await admin.from("instagram_follower_state")
      .upsert(statePayload,{onConflict:"account_id"});
    if(stateUpErr)throw stateUpErr;

    const {data:daily,error:dailyErr}=await admin.from("instagram_follower_daily")
      .select("*").eq("account_id",accountId).eq("day",day).maybeSingle();
    if(dailyErr)throw dailyErr;

    const first=daily?.first_count==null?count:Number(daily.first_count);
    const peak=Math.max(daily?.peak_count==null?count:Number(daily.peak_count),count);
    const low=Math.min(daily?.low_count==null?count:Number(daily.low_count),count);

    const {error:dailyUpErr}=await admin.from("instagram_follower_daily").upsert({
      account_id:accountId,
      day,
      first_count:first,
      current_count:count,
      peak_count:peak,
      low_count:low,
      net_change:count-first,
      updated_at:now
    },{onConflict:"account_id,day"});
    if(dailyUpErr)throw dailyUpErr;

    if(delta!==0){
      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"followers_changed",
        message:delta>0?("Instagram ganhou "+delta+" seguidor"+(delta===1?"":"es")):("Instagram perdeu "+Math.abs(delta)+" seguidor"+(Math.abs(delta)===1?"":"es")),
        meta:{account_id:accountId,followers_count:count,delta}
      });
    }

    await admin.from("instagram_metrics_sync_state").upsert({account_id:account.id,followers_error:null,last_followers_attempt_at:now,updated_at:now},{onConflict:"account_id"});
    results.push({account_id:account.id,account_label:account.account_label,followers_count:count,delta,day});
    }catch(e:any){
      const error=e instanceof Error?e.message:String(e);
      const now=new Date().toISOString();
      await admin.from("instagram_metrics_sync_state").upsert({account_id:account.id,followers_error:error,last_followers_attempt_at:now,updated_at:now},{onConflict:"account_id"});
      results.push({account_id:account.id,account_label:account.account_label,error});
    }}
    const now=new Date().toISOString();
    await admin.from("worker_runtime").upsert({
      worker_name:"followers",
      last_heartbeat:now,
      last_success_at:now,
      last_error:results.filter(r=>r.error).map(r=>r.account_label+": "+r.error).join("; ")||null,
      last_jobs:results.filter(r=>!r.error).length,
      updated_at:now
    },{onConflict:"worker_name"});

    return out({ok:true,results});
  }catch(e:any){
    const message=e instanceof Error?e.message:(typeof e==="object"?JSON.stringify(e):String(e));
    try{
      await admin.from("worker_runtime").upsert({
        worker_name:"followers",
        last_heartbeat:new Date().toISOString(),
        last_error:message,
        updated_at:new Date().toISOString()
      },{onConflict:"worker_name"});
    }catch{}
    return out({ok:false,error:message},500);
  }
});
