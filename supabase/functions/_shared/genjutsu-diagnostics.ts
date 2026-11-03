// Provider messages can contain inputs or credentials. Store a bounded, redacted reason only.
export function safeGenjutsuError(value:any){
  return String(value||'').replace(/https?:\/\/\S+/gi,'[url]')
    .replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
    .replace(/((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)[^\s,;]+/gi,'$1[redacted]')
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g,'[redacted]').slice(0,1200);
}
export function genjutsuExecutionEvent(message:any,taskId:string,previous:any,now=Date.now()){
  const d=message?.data;
  if(!taskId||String(d?.prompt_id)!==taskId||!['executing','progress','execution_error','execution_interrupted'].includes(message?.type))return null;
  const node=String(d.display_node??d.node??d.node_id??'');
  if(node&&!/^\d{1,20}$/.test(node))return null;
  const prior=previous?.task_id===taskId?previous:null;
  const result:any={task_id:taskId,node_id:node||prior?.node_id||null,event:message.type,observed_at:new Date(now).toISOString()};
  if(message.type==='progress'){
    if(!Number.isFinite(d.value)||!Number.isFinite(d.max)||d.value<0||d.max<=0||d.value>d.max)return null;
    result.value=d.value;result.max=d.max;
  }
  if(['execution_error','execution_interrupted'].includes(message.type)){
    result.node_type=safeGenjutsuError(d.node_type).slice(0,100);
    result.exception_type=safeGenjutsuError(d.exception_type).slice(0,100);
    result.error=safeGenjutsuError(d.exception_message)||'Execução interrompida no provedor.';
  }
  return result;
}
