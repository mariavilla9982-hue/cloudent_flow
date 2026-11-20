import {GENJUTSU_MODEL} from './genjutsu-gemini.ts';
export const GENJUTSU_WORKFLOW_ID='2117411301344411649';
const GOOGLE='https://generativelanguage.googleapis.com';
const RH='https://www.runninghub.ai';
const MAPPING=[['970','VHS_LoadVideo','video'],['496','LoadImage','image'],['910','PrimitiveStringMultiline','value'],['482','SaveVideo',null]] as const;
function graph(raw:any):any{
  for(let i=0;i<5;i++){
    if(typeof raw==='string'){try{raw=JSON.parse(raw);continue;}catch{return null;}}
    if(!raw||typeof raw!=='object')return null;
    if(raw['970']||Array.isArray(raw.nodes))return raw;
    raw=raw.prompt??raw.workflow??raw.data;
  }
  return null;
}
export function validateGenjutsuGraph(payload:any){
  const root=graph(payload);
  const nodes=MAPPING.map(([id,type,field])=>{
    const node=Array.isArray(root?.nodes)?root.nodes.find((n:any)=>String(n.id)===id):root?.[id];
    if(!node||String(node.class_type??node.type)!==type)throw new Error('Genjutsu: node '+id+' incompatível.');
    if(field&&!(Array.isArray(node.inputs)?node.inputs.some((input:any)=>input.name===field):Object.prototype.hasOwnProperty.call(node.inputs||{},field)))
      throw new Error('Genjutsu: campo '+id+'/'+field+' ausente.');
    return {id,type,field};
  });
  return nodes;
}
async function decrypt(cipher:string,iv:string,master:string){
  const bytes=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(master));
  const key=await crypto.subtle.importKey('raw',hash,{name:'AES-GCM'},false,['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv)},key,bytes(cipher)));
}
export async function runGenjutsuReadiness({admin,master,apiKey,fetcher=fetch,now=Date.now}:any){
  const result:any={workflowId:GENJUTSU_WORKFLOW_ID,model:GENJUTSU_MODEL,checkedAt:new Date(now()).toISOString(),
    gemini:{configured:!!String(apiKey||'').trim(),available:false,code:'missing_key'},
    runninghub:{configured:false,available:false,code:'missing_integration'},ready:false};
  const checkGemini=async()=>{
    if(!result.gemini.configured)return;
    try{
      const response=await fetcher(GOOGLE+'/v1beta/models/'+GENJUTSU_MODEL,{headers:{'x-goog-api-key':apiKey},redirect:'error',signal:AbortSignal.timeout(15000)});
      result.gemini.httpStatus=response.status;
      if(!response.ok){result.gemini.code=response.status===404?'model_unavailable':response.status===429?'quota_unavailable':response.status===400||response.status===401||response.status===403?'key_or_access_denied':'provider_unavailable';return;}
      const model=await response.json();
      result.gemini.available=model.name==='models/'+GENJUTSU_MODEL&&Array.isArray(model.supportedGenerationMethods)&&model.supportedGenerationMethods.includes('generateContent');
      result.gemini.code=result.gemini.available?'ready':'model_unavailable';
    }catch{result.gemini.code='provider_unavailable';}
  };
  const checkRunninghub=async()=>{
    const {data:integration,error}=await admin.from('integrations').select('enabled,config').eq('provider','runninghub').maybeSingle();
    if(error){result.runninghub.code='integration_unavailable';return;}
    const config=integration?.config||{};
    if(!config.apiKeyCipher||!config.apiKeyIv)return;
    result.runninghub.configured=true;
    if(integration.enabled===false){result.runninghub.code='integration_disabled';return;}
    try{
      const key=await decrypt(String(config.apiKeyCipher),String(config.apiKeyIv),master);
      const response=await fetcher(RH+'/api/openapi/getJsonApiFormat',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
        body:JSON.stringify({apiKey:key,workflowId:GENJUTSU_WORKFLOW_ID}),redirect:'error',signal:AbortSignal.timeout(20000)});
      result.runninghub.httpStatus=response.status;
      if(!response.ok){result.runninghub.code='workflow_unavailable';return;}
      const payload=await response.json();
      if(Number(payload?.code)!==0){result.runninghub.code='workflow_unavailable';return;}
      result.runninghub.nodes=validateGenjutsuGraph(payload);
      result.runninghub.available=true;result.runninghub.code='ready';
    }catch{result.runninghub.code='workflow_or_mapping_invalid';}
  };
  await Promise.all([checkGemini(),checkRunninghub()]);
  result.ready=result.gemini.available&&result.runninghub.available;
  return result;
}
