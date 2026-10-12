(()=>{
  if(window.__cfCalendarMobileHotfixV1)return;
  window.__cfCalendarMobileHotfixV1=true;

  const style=document.createElement('style');
  style.id='cf-calendar-mobile-hotfix-style';
  style.textContent=`
    @media(max-width:760px){
      body.cf-calendar-modal-open .mobile-bottom-nav{display:none!important}
      #modalHost .modal:not(.production-schedule-mobile-shell){
        padding-bottom:max(14px,env(safe-area-inset-bottom))!important;
      }
      #modalHost .modal:not(.production-schedule-mobile-shell) .modal-box{
        max-height:calc(100dvh - max(20px,env(safe-area-inset-top)) - max(20px,env(safe-area-inset-bottom)))!important;
        overflow-y:auto!important;
        -webkit-overflow-scrolling:touch!important;
        overscroll-behavior:contain!important;
      }
      #modalHost .calendar-modal-save{
        margin-bottom:max(10px,env(safe-area-inset-bottom))!important;
      }
    }
  `;
  document.head.appendChild(style);

  const syncModalState=()=>{
    const mobile=window.matchMedia?.('(max-width:760px)')?.matches ?? window.innerWidth<=760;
    const open=Boolean(document.querySelector('#modalHost .modal'));
    document.body?.classList.toggle('cf-calendar-modal-open',Boolean(mobile&&open));
  };

  const host=document.getElementById('modalHost');
  if(host&&typeof MutationObserver==='function'){
    new MutationObserver(()=>requestAnimationFrame(syncModalState)).observe(host,{childList:true,subtree:true});
  }
  window.addEventListener('resize',syncModalState,{passive:true});
  syncModalState();

  let activeProductionScheduleWasScheduled=false;

  function safeTodayISO(){
    try{
      if(typeof localISO==='function')return localISO(new Date());
    }catch{}
    const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function minutesOfClock(value){
    const parts=String(value||'').split(':').map(Number);
    if(parts.length<2||!Number.isFinite(parts[0])||!Number.isFinite(parts[1]))return NaN;
    return parts[0]*60+parts[1];
  }

  function chooseFutureTime(accountId,date){
    const today=safeTodayISO();
    const now=new Date();
    const minToday=now.getHours()*60+now.getMinutes()+5;
    let candidates=[];
    try{
      if(typeof state!=='undefined'&&Array.isArray(state?.defaultTimes))candidates.push(...state.defaultTimes);
    }catch{}
    candidates.push('06:00','07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00');
    candidates=[...new Set(candidates.map(x=>String(x).slice(0,5)))].sort((a,b)=>minutesOfClock(a)-minutesOfClock(b));
    for(const time of candidates){
      if(date===today&&minutesOfClock(time)<=minToday)continue;
      try{
        if(typeof validateProductionSchedule==='function'&&validateProductionSchedule(accountId,date,time)?.ok)return time;
      }catch{}
    }
    return null;
  }

  function preferTodayWhenPossible(){
    if(activeProductionScheduleWasScheduled)return;
    const modal=document.querySelector('#modalHost .production-schedule-modal');
    if(!modal)return;
    let accountId='';
    try{accountId=typeof productionScheduleAccountId==='function'?productionScheduleAccountId():''}catch{}
    if(!accountId)return;
    const today=safeTodayISO();
    let row=null;
    try{row=typeof productionCalendarCapacity==='function'?productionCalendarCapacity(accountId).find(x=>x.date===today):null}catch{}
    if(!row||Number(row.free)<=0)return;
    const time=chooseFutureTime(accountId,today);
    if(!time)return;

    const day=document.getElementById('productionScheduleDay');
    const timeInput=document.getElementById('productionScheduleTime');
    if(day)day.value=today;
    if(timeInput)timeInput.value=time;
    document.querySelectorAll('.production-calendar-day').forEach(el=>el.classList.toggle('selected',el.dataset.calendarDate===today));
  }

  function installSchedulingFix(){
    if(window.__cfProductionSameDayFixV1)return true;
    if(typeof window.openProductionScheduleModal!=='function'||typeof window.refreshProductionScheduleAccount!=='function')return false;
    window.__cfProductionSameDayFixV1=true;

    const originalOpen=window.openProductionScheduleModal;
    window.openProductionScheduleModal=async function(id,number){
      try{
        const job=(typeof productionData!=='undefined'&&productionData?.jobs||[]).find(x=>String(x.id)===String(id));
        activeProductionScheduleWasScheduled=Boolean(job?.meta?.scheduled);
      }catch{activeProductionScheduleWasScheduled=false}
      const result=await originalOpen.apply(this,arguments);
      requestAnimationFrame(()=>{
        syncModalState();
        preferTodayWhenPossible();
      });
      return result;
    };

    const originalRefresh=window.refreshProductionScheduleAccount;
    window.refreshProductionScheduleAccount=function(){
      const result=originalRefresh.apply(this,arguments);
      requestAnimationFrame(()=>preferTodayWhenPossible());
      return result;
    };

    return true;
  }

  if(!installSchedulingFix()){
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      if(installSchedulingFix()||tries>40)clearInterval(timer);
    },250);
  }
})();
