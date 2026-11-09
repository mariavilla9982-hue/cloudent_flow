import {genjutsuContentBlockMessage} from './genjutsu-diagnostics.ts';

// Sanitized, persisted state projection. No provider credentials or model prompts escape here.
export function genjutsuDisplay(p:any,parent:any,now=Date.now()){
 const m=p?.meta||{},s=m.genjutsu_prompt||{},task=String(p?.runninghub_task_id||'');
 const execution=!!task&&!!p?.started_at&&String(m.provider_status_task_id)===task;
 let key='queued',label='Na fila',activity=false;
 if(p?.status==='cancelled'||parent?.status==='cancelled'){key='cancelled';label='Cancelado';}
 else if(p?.status==='failed'||parent?.status==='failed'){key='failed';label=genjutsuContentBlockMessage(s.verifiedProviderFinishReason)?'Bloqueado pelo Gemini':'Precisa de atenção';}
 else if(p?.result_video_id){key=p.status==='ready'?'complete':'capturing';label=p.status==='ready'?'Concluído':'Vídeo salvo · encerrando tarefa';activity=p.status!=='ready';}
 else if(m.genjutsu_stop_requested_task_id&&String(m.genjutsu_stop_requested_task_id)===task){key='stopping';label='Cancelamento em confirmação';activity=true;}
 else if(m.motion_preview_file||m.motion_capture_checkpoint){key='capturing';label='Capturando resultado';activity=true;}
 else if(p?.status==='running'){key='running';label='Gerando vídeo';activity=true;}
 else if(p?.status==='queued'){key='provider_queued';label='Na fila do RunningHub';}
 else if(p?.status==='uploading'){key='uploading';label='Enviando ao RunningHub';activity=true;}
 else if(s.status==='complete'){key='video_waiting';label='Prompt pronto · aguardando vaga de geração';}
 else if(s.status==='provider_waiting'&&s.processingCheck==='pending'){key='recovering';label='Verificando resposta do Gemini';}
 else if(['quota_waiting','provider_waiting'].includes(s.status)){key='recovering';label=s.status==='quota_waiting'?'Aguardando cota da LLM':'Recuperação · nova tentativa agendada';}
 else if(s.status==='generating'){key='prompt';label='Gerando prompt';activity=true;}
 else if(['preparing','processing'].includes(s.status)||m.prompt_started_at){key='references';label='Preparando referências';activity=true;}
 else if(parent?.meta?.stage!=='control_motion'){key='references';label=parent?.status==='waiting'?'Na fila · preparando referências':'Preparando referências';activity=parent?.status!=='waiting';}
 const event=m.genjutsu_execution,progress=key==='running'&&event?.event==='progress'&&String(event.task_id)===task&&
 Number.isFinite(event.value)&&Number.isFinite(event.max)&&event.max>0&&event.value>=0&&event.value<=event.max?
 {value:event.value,max:event.max,node:event.node_id}:null;
 return {key,label,activity,progress,executionConfirmed:execution,
   executionStartedAt:execution?p.started_at:null,completedAt:p?.completed_at||null,
   waitingStartedAt:m.prompt_completed_at||p?.created_at||parent?.created_at||null,
   waitingEndedAt:execution?p.started_at:(['complete','cancelled','failed'].includes(key)?p?.completed_at:null),
   preparationStatus:s.status==='complete'?'READY_FOR_VIDEO':s.status||'QUEUED',
   promptStartedAt:m.prompt_started_at||null,promptCompletedAt:m.prompt_completed_at||null,
   retryAt:s.retryAt||null,observedAt:new Date(now).toISOString()};
}
