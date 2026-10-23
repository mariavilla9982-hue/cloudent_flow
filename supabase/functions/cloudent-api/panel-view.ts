const PANEL_SCOPES=new Set(['faceSwap','faceSwapPhoto','upscale','production_standard','production_motion']);
export function validPanelScope(scope:unknown):scope is string{
  return typeof scope==='string'&&(PANEL_SCOPES.has(scope)||/^bulkPublish:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope));
}
export async function panelViewApi(req:Request,url:URL,admin:any,userId:string,json:any){
  if(url.searchParams.get('resource')!=='panel-view')return null;
  const prefix='panel_view_'+userId+'_';
  if(req.method==='GET'){
    const {data,error}=await admin.from('app_settings').select('key,value').gte('key',prefix).lt('key',prefix+'\uffff').limit(50);
    if(error)throw error;
    const views:Record<string,unknown>={};
    for(const row of data||[]){if(!String(row.key).startsWith(prefix))continue;const scope=String(row.key).slice(prefix.length);if(validPanelScope(scope))views[scope]=row.value;}
    return json({views});
  }
  if(req.method!=='PATCH')return json({error:'method_not_allowed'},405);
  const b=await req.json(),scope=b.scope;
  if(!validPanelScope(scope)||!['clear','restore'].includes(b.operation))return json({error:'invalid_panel_scope'},400);
  const ids=b.operation==='clear'?b.ids:[];
  if(!Array.isArray(ids)||ids.length>1000||ids.some((id:any)=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)))return json({error:'invalid_panel_items'},400);
  const value={before:b.operation==='clear'?new Date().toISOString():null,ids:[...new Set(ids)]};
  const {error}=await admin.from('app_settings').upsert({key:prefix+scope,value},{onConflict:'key'});
  if(error)throw error;
  return json({ok:true,scope,value});
}

