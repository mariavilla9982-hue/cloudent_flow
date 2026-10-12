(()=>{
  if(window.__cfProductionScheduleTimeHotfixV1)return;
  window.__cfProductionScheduleTimeHotfixV1=true;

  const MIN_LEAD_MS=2*60*1000;

  function parseLocal(date,time){
    const dm=String(date||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const tm=String(time||'').match(/^(\d{2}):(\d{2})$/);
    if(!dm||!tm)return null;
    const d=new Date(Number(dm[1]),Number(dm[2])-1,Number(dm[3]),Number(tm[1]),Number(tm[2]),0,0);
    return Number.isNaN(d.getTime())?null:d;
  }

  function isPastOrTooClose(date,time){
    const target=parseLocal(date,time);
    return !!target&&target.getTime()<Date.now()+MIN_LEAD_MS;
  }

  function toTime(minutes){
    const h=Math.floor(minutes/60),m=minutes%60;
    return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
  }

  function nextHalfHour(){
    const now=new Date(Date.now()+MIN_LEAD_MS);
    let minutes=now.getHours()*60+now.getMinutes();
    minutes=Math.ceil(minutes/30)*30;
    return Math.min(minutes,23*60+30);
  }

  function install(){
    if(typeof window.validateProductionSchedule!=='function'||typeof window.productionScheduleDefaultTime!=='function')return false;
    if(window.validateProductionSchedule.__cfTimeFixed)return true;

    const originalValidate=window.validateProductionSchedule;
    const originalDefault=window.productionScheduleDefaultTime;

    const patchedValidate=function(accountId,date,time){
      if(isPastOrTooClose(date,time)){
        return {ok:false,msg:'Esse horário já passou. Escolha um horário futuro.'};
      }
      return originalValidate(accountId,date,time);
    };
    patchedValidate.__cfTimeFixed=true;
    window.validateProductionSchedule=patchedValidate;

    window.productionScheduleDefaultTime=function(accountId,date){
      const original=originalDefault(accountId,date);
      if(original&&!isPastOrTooClose(date,original)){
        const check=patchedValidate(accountId,date,original);
        if(check?.ok)return original;
      }

      const today=new Date();
      const todayStr=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
      if(String(date)!==todayStr)return original;

      const start=nextHalfHour();
      for(let mins=start;mins<=23*60+30;mins+=30){
        const candidate=toTime(mins);
        const check=patchedValidate(accountId,date,candidate);
        if(check?.ok)return candidate;
      }
      return original;
    };

    return true;
  }

  function repairOpenModal(){
    const modal=document.querySelector('.production-schedule-modal');
    if(!modal)return;
    const day=document.getElementById('productionScheduleDay');
    const time=document.getElementById('productionScheduleTime');
    const account=document.getElementById('productionScheduleAccount');
    if(!day||!time||!account?.value)return;
    if(isPastOrTooClose(day.value,time.value)){
      const next=window.productionScheduleDefaultTime?.(account.value,day.value);
      if(next&&!isPastOrTooClose(day.value,next))time.value=next;
    }
  }

  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    if(install()||attempts>40)clearInterval(timer);
  },100);
  install();

  document.addEventListener('change',event=>{
    if(event.target?.id==='productionScheduleAccount'||event.target?.id==='productionScheduleDay'){
      requestAnimationFrame(repairOpenModal);
    }
  },true);

  document.addEventListener('focusin',event=>{
    if(event.target?.id==='productionScheduleTime')repairOpenModal();
  },true);

  if(typeof MutationObserver==='function'){
    new MutationObserver(()=>repairOpenModal()).observe(document.documentElement,{subtree:true,childList:true});
  }
})();
