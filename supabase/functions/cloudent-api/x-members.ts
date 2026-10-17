// This route is reached only after native Auth/session and administrator checks.
export async function handleXMembers(req:Request,admin:any,member:any,userId:string,url:URL,respond:any){
  if(member.role!=="admin"||!member.enabled)return respond({error:"forbidden"},403);
  const workspace=member.workspace_id,action=url.searchParams.get("action");
  if(req.method==="GET"){
    const [m,i,g,a]=await Promise.all([
      admin.from("app_members").select("user_id,role,enabled,created_at").eq("workspace_id",workspace),
      admin.from("member_invites").select("email,enabled,claimed_by,signup_token_expires_at").eq("workspace_id",workspace).eq("role","x_user").is("claimed_by",null),
      admin.from("x_account_access").select("user_id,platform_account_id").eq("workspace_id",workspace),
      admin.from("platform_accounts").select("id,account_label,enabled").eq("workspace_id",workspace).eq("platform","x")
    ]);
    for(const r of [m,i,g,a])if(r.error)throw r.error;
    const members=await Promise.all((m.data||[]).filter((m:any)=>m.role==="admin"||m.role==="x_user").map(async(m:any)=>{
      const {data,error}=await admin.auth.admin.getUserById(m.user_id);if(error)throw error;
      return {...m,email:data?.user?.email||null,status:m.enabled?"active":"disabled",account_ids:(g.data||[]).filter((g:any)=>g.user_id===m.user_id).map((g:any)=>g.platform_account_id)};
    }));
    const {data:pendingAccounts,error}=await admin.from("x_invite_account_access").select("email,platform_account_id").eq("workspace_id",workspace);if(error)throw error;
    const invitations=(i.data||[]).map((i:any)=>({...i,status:i.enabled&&new Date(i.signup_token_expires_at)>new Date()?"pending":"disabled",account_ids:(pendingAccounts||[]).filter((g:any)=>g.email===i.email).map((g:any)=>g.platform_account_id)}));
    return respond({members,invitations,accounts:a.data||[]});
  }
  if(req.method!=="POST")return respond({error:"method_not_allowed"},405);
  const body=await req.json();
  if(action==="invite"){
    const email=String(body.email||"").trim().toLowerCase();if(!/^\S+@\S+\.\S+$/.test(email))return respond({error:"invalid_email"},400);
    const raw=crypto.randomUUID()+crypto.randomUUID();
    const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
    const hash=Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join("");
    const {error}=await admin.rpc("configure_x_invite",{p_actor:userId,p_email:email,p_hash:hash,p_accounts:body.account_ids||[]});if(error)throw error;
    const frontend=String(Deno.env.get("CLOUDENT_FRONTEND_URL")||"https://cloudent-flow.vercel.app").replace(/\/$/,"");
    const link=frontend+"/primeiro-acesso.html?email="+encodeURIComponent(email)+"&token="+encodeURIComponent(raw);
    let email_sent=false,email_error=null;
    if(body.send_email===true){
      const r=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:frontend+"/primeiro-acesso.html"});
      if(r.error)email_error="O envio por email não foi confirmado. Use o link individual ou configure o SMTP do Supabase.";
      else{
        email_sent=true;
        const {error:save}=await admin.from("member_invites").update({auth_user_id:r.data.user.id}).eq("email",email).eq("workspace_id",workspace).eq("signup_token_hash",hash);
        if(save)throw save;
      }
    }
    return respond({ok:true,url:link,email_sent,email_error});
  }
  if(action==="revoke-invite"||action==="invite-accounts"){
    const {error}=await admin.rpc("update_x_invite_access",{p_actor:userId,p_email:String(body.email||"").toLowerCase(),p_enabled:action!=="revoke-invite",p_accounts:body.account_ids||[]});if(error)throw error;return respond({ok:true});
  }
  if(["set-enabled","remove-access","set-accounts","grant-account","revoke-account"].includes(String(action))){
    const target=String(body.user_id||"");
    if(target===userId)return respond({error:"cannot_change_self"},409);
    let accounts=body.account_ids===undefined?null:body.account_ids;
    if(action==="grant-account"||action==="revoke-account"){
      const {data,error}=await admin.from("x_account_access").select("platform_account_id").eq("workspace_id",workspace).eq("user_id",target);if(error)throw error;
      const ids=(data||[]).map((g:any)=>g.platform_account_id),id=String(body.platform_account_id||"");
      accounts=action==="grant-account"?[...new Set([...ids,id])]:ids.filter((v:string)=>v!==id);
    }
    const {error}=await admin.rpc("set_x_user_access",{p_actor:userId,p_user:target,p_enabled:action==="set-enabled"?body.enabled===true:action==="remove-access"?false:null,p_accounts:action==="remove-access"?[]:accounts});if(error)throw error;
    return respond({ok:true});
  }
  return respond({error:"not_found"},404);
}
