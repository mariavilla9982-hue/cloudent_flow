// Local disconnect: preserve account identity, schedules, media and metrics.
export async function handleInstagramDisconnect(req:Request,url:URL,admin:any,userId:string,member:any,json:any){
  if(url.searchParams.get("resource")!=="platform-accounts"||url.searchParams.get("action")!=="disconnect")return null;
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  if(member?.role!=="admin"||!member?.enabled||!member?.workspace_id)return json({error:"forbidden"},403);
  let body:any;try{body=await req.json()}catch{return json({error:"invalid_json"},400)}
  const id=String(body?.platform_account_id||"");
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return json({error:"invalid_account_id"},400);
  const {data:account,error}=await admin.from("platform_accounts").select("id,platform,account_label,enabled,workspace_id,owner_user_id,config,updated_at").eq("id",id).eq("platform","instagram").maybeSingle();
  if(error)throw error;
  if(!account)return json({error:"account_not_found"},404);
  let authorized=account.workspace_id===member.workspace_id||(!account.workspace_id&&account.owner_user_id===userId);
  // Legacy OAuth rows have no ownership columns; accept only the single-workspace installation.
  if(!account.workspace_id&&!account.owner_user_id){
    const {data:workspaces,error:workspaceError}=await admin.from("workspaces").select("id").limit(2);
    if(workspaceError)throw workspaceError;
    authorized=workspaces?.length===1&&workspaces[0].id===member.workspace_id;
  }
  if(!authorized)return json({error:"account_not_found"},404);
  if(!account.enabled)return json({ok:true,platform_account_id:id,account_label:account.account_label,already_disconnected:true});
  const now=new Date().toISOString();
  let update=admin.from("platform_accounts").update({enabled:false,config:{...(account.config||{}),status:"disconnected",disconnected_at:now,disconnected_by:userId,disconnected_reason:"user_requested"},updated_at:now}).eq("id",id).eq("platform","instagram").eq("enabled",true).eq("updated_at",account.updated_at);
  update=account.workspace_id?update.eq("workspace_id",account.workspace_id):update.is("workspace_id",null);
  update=account.owner_user_id?update.eq("owner_user_id",account.owner_user_id):update.is("owner_user_id",null);
  const {data:saved,error:saveError}=await update.select("id").maybeSingle();
  if(saveError)throw saveError;
  if(!saved)return json({error:"account_changed",user_message:"A conta foi atualizada. Recarregue a lista antes de tentar novamente."},409);
  await admin.from("activity_logs").insert({level:"info",event_type:"instagram_account_disconnected",message:"Conta Instagram desconectada manualmente",meta:{user_id:userId,platform_account_id:id,workspace_id:member.workspace_id}});
  return json({ok:true,platform_account_id:id,account_label:account.account_label});
}
