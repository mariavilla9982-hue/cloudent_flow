
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Content-Type":"application/json"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});

async function graph(base:string,path:string,token:string,method="GET",params:Record<string,string>={}){
  const url=base+"/"+path.replace(/^\//,"");
  const body=new URLSearchParams(params);
  const r=await fetch(method==="GET"&&Object.keys(params).length?url+"?"+body.toString():url,{
    method,
    headers:{Authorization:"Bearer "+token,...(method==="POST"?{"Content-Type":"application/x-www-form-urlencoded"}:{})},
    body:method==="POST"?body:undefined
  });
  let j:any={};try{j=await r.json()}catch{}
  if(!r.ok||j?.error){
    const err:any=new Error(j?.error?.error_user_msg||j?.error?.message||("Meta API "+r.status));
    err.payload=j?.error||j;throw err;
  }
  return j;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
  const bearer=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"")||"";
  const {data:a}=await admin.auth.getUser(bearer);
  if(!a.user)return out({error:"unauthorized"},401);
  const {data:accessMember,error:accessError}=await admin.from("app_members").select("role,enabled").eq("user_id",a.user.id).maybeSingle();
  if(accessError||!accessMember?.enabled||accessMember.role!=="admin")return out({error:"forbidden"},403);

  try{
    if(req.method==="GET"){
      const {data,error}=await admin.from("reel_test_publications")
        .select("id,file_name,caption,is_trial,share_to_feed,status,container_id,instagram_media_id,last_error,created_at,updated_at,published_at")
        .eq("user_id",a.user.id).order("created_at",{ascending:false}).limit(20);
      if(error)throw error;
      return out({ok:true,items:data||[]});
    }

    const body=await req.json();
    const action=String(body.action||"create");

    const {data:secret,error:se}=await admin.rpc("get_instagram_page_token");if(se)throw se;
    if(!secret)return out({error:"instagram_not_connected"},400);

    const {data:ig,error:ie}=await admin.from("integrations")
      .select("enabled,external_account_id,config").eq("provider","instagram").single();
    if(ie)throw ie;
    if(!ig?.enabled)return out({error:"instagram_not_connected"},400);

    const mode=ig?.config?.api_mode||"instagram_login";
    const base=mode==="facebook_login"?"https://graph.facebook.com/v26.0":"https://graph.instagram.com/v26.0";
    const igId=String(ig.external_account_id);

    if(action==="create"){
      const storagePath=String(body.storage_path||"");
      const caption=String(body.caption||"").slice(0,2200);
      const shareToFeed=!!body.share_to_feed;

      if(!storagePath.startsWith(a.user.id+"/"))return out({error:"invalid_storage_path"},403);

      const {data:signed,error:signedErr}=await admin.storage.from("videos").createSignedUrl(storagePath,7200);
      if(signedErr||!signed?.signedUrl)throw signedErr||new Error("signed_url_failed");

      const params:any={
        media_type:"REELS",
        video_url:signed.signedUrl,
        caption,
        share_to_feed:"false",
        trial_params:JSON.stringify({graduation_strategy:"MANUAL"})
      };

      const container=await graph(base,igId+"/media",secret,"POST",params);
      const fileName=storagePath.split("/").pop()||"video.mp4";

      const {data:row,error:re}=await admin.from("reel_test_publications").insert({
        user_id:a.user.id,
        storage_path:storagePath,
        file_name:fileName,
        caption,
        share_to_feed:shareToFeed,
        is_trial:true,
        container_id:String(container.id),
        status:"container_created"
      }).select().single();
      if(re)throw re;

      return out({ok:true,publication:row,container_id:String(container.id),status:"container_created"});
    }

    const id=String(body.publication_id||"");
    if(!id)return out({error:"publication_id_required"},400);

    const {data:row,error:re}=await admin.from("reel_test_publications")
      .select("*").eq("id",id).eq("user_id",a.user.id).single();
    if(re)throw re;
    if(!row?.container_id)return out({error:"container_missing"},400);

    if(action==="status"){
      const st=await graph(base,row.container_id+"?fields=status_code,status",secret,"GET");
      const code=String(st.status_code||"");
      let status="processing";
      if(code==="FINISHED")status="ready";
      else if(code==="ERROR"||code==="EXPIRED")status="failed";

      await admin.from("reel_test_publications")
        .update({status,last_error:status==="failed"?(st.status||code):null})
        .eq("id",id);

      return out({ok:true,status,status_code:code,detail:st.status||null});
    }

    if(action==="publish"){
      const st=await graph(base,row.container_id+"?fields=status_code,status",secret,"GET");
      if(String(st.status_code)!=="FINISHED"){
        return out({ok:false,error:"container_not_ready",status_code:st.status_code,detail:st.status||null},409);
      }

      await admin.from("reel_test_publications").update({status:"publishing"}).eq("id",id);

      const pub=await graph(base,igId+"/media_publish",secret,"POST",{creation_id:String(row.container_id)});

      await admin.from("reel_test_publications").update({
        status:"published",
        instagram_media_id:String(pub.id),
        published_at:new Date().toISOString(),
        last_error:null
      }).eq("id",id);

      await admin.from("activity_logs").insert({
        level:"info",
        event_type:"test_reel_published",
        message:"Reel de teste publicado pela API",
        meta:{publication_id:id,instagram_media_id:String(pub.id),share_to_feed:row.share_to_feed}
      });

      return out({ok:true,status:"published",instagram_media_id:String(pub.id)});
    }

    return out({error:"invalid_action"},400);
  }catch(e:any){
    const msg=e instanceof Error?e.message:String(e);
    try{
      await admin.from("activity_logs").insert({
        level:"error",event_type:"test_reel_error",message:msg,meta:{meta_error:e?.payload||null}
      });
    }catch{}
    return out({ok:false,error:msg},500);
  }
});
