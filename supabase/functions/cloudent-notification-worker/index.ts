
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const H={"Content-Type":"application/json"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});

function retryDelay(attempt:number){
  return Math.min(60,Math.max(1,Math.pow(2,Math.max(0,attempt-1))))*60_000;
}

Deno.serve(async(req:Request)=>{
  const supabaseUrl=Deno.env.get("SUPABASE_URL")!;
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

  try{
    const supplied=req.headers.get("x-cloudent-worker-secret")||"";
    const {data:expected,error:secretError}=await admin.rpc("get_cloudent_worker_secret");
    if(secretError)throw secretError;
    if(!supplied||!expected||supplied!==expected)return out({ok:false,error:"unauthorized"},401);

    const [{data:vapidPrivate,error:vapidError},{data:pushSetting,error:settingError}]=await Promise.all([
      admin.rpc("get_cloudent_vapid_private_key"),
      admin.from("app_settings").select("value").eq("key","push_notifications").maybeSingle()
    ]);
    if(vapidError)throw vapidError;
    if(settingError)throw settingError;

    const publicKey=String(pushSetting?.value?.public_key||"");
    if(!vapidPrivate||!publicKey)throw new Error("vapid_not_configured");

    webpush.setVapidDetails(
      "https://github.com/mariavilla9982-hue/cloudent_flow",
      publicKey,
      String(vapidPrivate)
    );

    const workerId="notify-"+crypto.randomUUID();
    const now=new Date().toISOString();
    await admin.from("worker_runtime").upsert({
      worker_name:"notifications",
      last_heartbeat:now,
      updated_at:now
    },{onConflict:"worker_name"});

    const {error:generateError}=await admin.rpc("generate_cloudent_patch_notifications");
    if(generateError)throw generateError;
    const {data:storyAccounts,error:storyClaimError}=await admin.rpc("claim_story_monitor_accounts",{p_limit:10});
    if(storyClaimError)throw storyClaimError;
    const storyResults=await Promise.all((storyAccounts||[]).map(async(a:any)=>{
      let count:number|null=null,problem:string|null=null;
      try{
        const {data:token,error:tokenError}=await admin.rpc("get_instagram_page_token_for_account",{p_account_id:a.account_id});
        if(tokenError||!token)throw new Error("Reconecte a conta: token do Instagram indisponível.");
        const host=a.auth_mode==="facebook_login"?"graph.facebook.com":"graph.instagram.com";
        const response=await fetch("https://"+host+"/v26.0/"+encodeURIComponent(a.external_account_id)+"/stories?fields=id&limit=100",{
          headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(15000)
        });
        const data=await response.json();
        if(!response.ok||data.error)throw new Error(data.error?.message||"Instagram respondeu HTTP "+response.status);
        if(!Array.isArray(data.data))throw new Error("Instagram não retornou uma lista válida de Stories.");
        count=data.data.length;
      }catch(e:any){problem=e instanceof Error?e.message:String(e)}
      const {error}=await admin.rpc("record_story_monitor_result",{p_account:a.account_id,p_count:count,p_error:problem});
      if(error)throw error;
      return {account:a.account_label,status:problem?"unknown":count===0?"empty":"active",count};
    }));
    const {data:jobs,error:claimError}=await admin.rpc("claim_due_system_notifications",{p_worker:workerId,p_limit:20});
    if(claimError)throw claimError;

    const results:any[]=[];
    for(const n of jobs||[]){
      const {data:subs,error:subsError}=await admin.from("push_subscriptions")
        .select("id,endpoint,p256dh,auth")
        .eq("user_id",n.user_id).eq("enabled",true);
      if(subsError)throw subsError;

      let sent=0;
      let transient=0;
      let lastError:string|null=null;

      const payload=JSON.stringify({
        id:n.id,
        title:n.title,
        body:n.body,
        severity:n.severity,
        category:n.category,
        tag:"cloudent-"+String(n.category||"system")+"-"+String(n.source_ref||n.id),
        url:"/?notification="+encodeURIComponent(String(n.id))
      });

      for(const sub of subs||[]){
        try{
          await webpush.sendNotification({
            endpoint:String(sub.endpoint),
            keys:{p256dh:String(sub.p256dh),auth:String(sub.auth)}
          },payload,{TTL:300,urgency:n.severity==="error"?"high":"normal"});
          sent++;
          await admin.from("push_subscriptions").update({
            last_success_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()
          }).eq("id",sub.id);
        }catch(e:any){
          const status=Number(e?.statusCode||e?.status||0);
          const message=e instanceof Error?e.message:String(e);
          lastError=message;
          if(status===404||status===410){
            await admin.from("push_subscriptions").update({
              enabled:false,last_error:message,updated_at:new Date().toISOString()
            }).eq("id",sub.id);
          }else{
            transient++;
            await admin.from("push_subscriptions").update({
              last_error:message,updated_at:new Date().toISOString()
            }).eq("id",sub.id);
          }
        }
      }

      const ts=new Date().toISOString();
      if(sent>0){
        await admin.from("system_notifications").update({
          status:"sent",sent_at:ts,last_error:null,next_attempt_at:null,updated_at:ts,
          meta:{...(n.meta||{}),sent_devices:sent,last_push_at:ts}
        }).eq("id",n.id).eq("status","processing");
        results.push({id:n.id,state:"sent",devices:sent});
      }else if(transient>0){
        const next=new Date(Date.now()+retryDelay(Number(n.push_attempts||1))).toISOString();
        await admin.from("system_notifications").update({
          status:"pending",next_attempt_at:next,last_error:lastError,updated_at:ts
        }).eq("id",n.id).eq("status","processing");
        results.push({id:n.id,state:"retry",error:lastError});
      }else{
        // all subscriptions became invalid; keep it pending until a new device subscribes
        await admin.from("system_notifications").update({
          status:"pending",next_attempt_at:null,last_error:lastError||"no_active_subscription",updated_at:ts
        }).eq("id",n.id).eq("status","processing");
        results.push({id:n.id,state:"waiting_device"});
      }
    }

    await admin.from("worker_runtime").upsert({
      worker_name:"notifications",
      last_heartbeat:new Date().toISOString(),
      last_success_at:new Date().toISOString(),
      last_error:null,
      last_jobs:results.length,
      updated_at:new Date().toISOString()
    },{onConflict:"worker_name"});

    return out({ok:true,worker:"notifications",claimed:(jobs||[]).length,stories:storyResults,results});
  }catch(e:any){
    const message=e instanceof Error?e.message:String(e);
    try{
      await admin.from("worker_runtime").upsert({
        worker_name:"notifications",
        last_heartbeat:new Date().toISOString(),
        last_error:message,
        updated_at:new Date().toISOString()
      },{onConflict:"worker_name"});
    }catch{}
    return out({ok:false,error:message},500);
  }
});
