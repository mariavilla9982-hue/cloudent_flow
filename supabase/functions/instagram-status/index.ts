import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const H={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  "Content-Type":"application/json"
};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});

async function fetchProfile(token:string,mode:string,igId:string){
  const url=mode==="facebook_login"
    ? "https://graph.facebook.com/v26.0/"+encodeURIComponent(igId)+"?fields=id,username,name,profile_picture_url"
    : "https://graph.instagram.com/me?fields=id,user_id,username,name,profile_picture_url";
  const r=await fetch(url,{headers:{Authorization:"Bearer "+token}});
  let j:any={};try{j=await r.json()}catch{}
  if(!r.ok||j?.error)throw new Error(j?.error?.message||("Meta API "+r.status));
  return j;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});

  const admin=createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {auth:{persistSession:false}}
  );

  const bearer=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"")||"";
  const {data:a}=await admin.auth.getUser(bearer);
  if(!a.user)return out({error:"unauthorized"},401);
  const {data:accessMember,error:accessError}=await admin.from("app_members").select("role,enabled").eq("user_id",a.user.id).maybeSingle();
  if(accessError||!accessMember?.enabled||accessMember.role!=="admin")return out({error:"forbidden"},403);

  const {data,error}=await admin.from("integrations")
    .select("provider,enabled,account_label,external_account_id,config,last_verified_at")
    .eq("provider","instagram")
    .maybeSingle();
  if(error)return out({error:error.message},500);
  if(!data)return out({ok:true,integration:null});

  const cfg:any=data.config||{};
  const pictureAge=cfg.profile_picture_updated_at
    ? Date.now()-new Date(cfg.profile_picture_updated_at).getTime()
    : Infinity;
  const shouldRefresh=!!data.enabled&&(!cfg.profile_picture_url||!Number.isFinite(pictureAge)||pictureAge>6*60*60*1000);

  if(shouldRefresh){
    try{
      const {data:token,error:tokenError}=await admin.rpc("get_instagram_page_token");
      if(tokenError||!token)throw tokenError||new Error("instagram_token_missing");
      const profile=await fetchProfile(String(token),String(cfg.api_mode||"instagram_login"),String(data.external_account_id||""));
      const picture=String(profile?.profile_picture_url||"").trim();
      const username=String(profile?.username||"").trim();
      const nextConfig={
        ...cfg,
        profile_picture_url:picture||cfg.profile_picture_url||null,
        profile_picture_updated_at:new Date().toISOString()
      };
      const nextLabel=username||data.account_label;
      const {error:updateError}=await admin.from("integrations").update({
        account_label:nextLabel,
        config:nextConfig,
        last_verified_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      }).eq("provider","instagram");
      if(!updateError){
        data.account_label=nextLabel;
        data.config=nextConfig;
        data.last_verified_at=new Date().toISOString();
      }
    }catch(e){
      console.warn("instagram profile picture refresh failed",e);
    }
  }

  return out({ok:true,integration:data});
});
