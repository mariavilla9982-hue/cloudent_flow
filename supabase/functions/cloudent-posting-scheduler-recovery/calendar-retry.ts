export function calendarRetryGate(job:any,now=Date.now(),sourceKey?:string){
 if(!job)return null;
 if(sourceKey&&job.payload?.calendar_media_source_key&&sourceKey!==job.payload.calendar_media_source_key)return null;
 // A receipt can always be finalized; never send the publication again.
 if(job.payload?.instagram_media_id)return null;
 const lock=Date.parse(job.locked_at||'');
 if(job.locked_by&&Number.isFinite(lock)&&lock>now-10*60000)return 'busy';
 if(['failed','pending'].includes(job.status)&&Number(job.attempts)>=Number(job.max_attempts||15))return 'attempts_exhausted';
 if(Date.parse(job.run_at||'')>now)return 'cooldown';
 return null;
}
export function calendarFailurePlan(job:any,error:any,now=Date.now()){
 const code=Number(error?.payload?.code),message=String(error?.message||'');
 const receipt=!!job.payload?.instagram_media_id;
 const uncertain=!receipt&&!!job.payload?.publish_started_at;
 const reconnect=code===190||['instagram_token_missing','instagram_account_unavailable'].includes(message);
 const quota=[4,17,32,613,2207051].includes(code)||message==='instagram_quota_reached';
 const attempts=Number(job.attempts||0)+(receipt||uncertain||reconnect||quota?0:1);
 const exhausted=attempts>=Number(job.max_attempts||15);
 const delay=uncertain?6*3600000:receipt?60000:reconnect?15*60000:quota?30*60000:Math.min(30,2**Math.min(attempts,5))*60000;
 const reason=uncertain?'Publicação enviada; confirmação necessária antes de repetir.':receipt?'Publicação confirmada; finalização local pendente.':reconnect?'Reconecte esta conta do Instagram.':quota?'Limite temporário da Meta; aguardando nova tentativa.':exhausted?'Tentativas automáticas esgotadas. Arquivo e agendamento preservados.':'Falha temporária da Meta ou armazenamento; nova tentativa agendada.';
 return {attempts,reason,state:uncertain?'confirmation_required':receipt?'finalization_pending':reconnect?'reconnect_required':exhausted?'attempts_exhausted':'retry',status:receipt?'running':'failed',run_at:new Date(now+delay).toISOString()};
}
