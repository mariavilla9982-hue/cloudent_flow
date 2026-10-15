(()=>{
  if(window.CloudentMotionControlUILoader?.installed)return;
  const uiState=window.CloudentMotionControlUILoader={installed:true,patched:false};

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  async function waitMotionReady(id){
    for(let attempt=0;attempt<12;attempt++){
      const current=(productionData?.jobs||[]).find(x=>String(x.id)===String(id));
      if(current?.status==="ready"&&current?.result_video_id)return current;
      try{await loadProductionData(true)}catch{}
      const refreshed=(productionData?.jobs||[]).find(x=>String(x.id)===String(id));
      if(refreshed?.status==="ready"&&refreshed?.result_video_id)return refreshed;
      if(attempt<11)await sleep(650);
    }
    return null;
  }

  function patchCalendarScheduling(){
    if(typeof scheduleProductionResult!=="function"||scheduleProductionResult.__motionSafe)return;
    const nativeSchedule=scheduleProductionResult;
    const wrapped=async function(id,button=null){
      const job=(productionData?.jobs||[]).find(x=>String(x.id)===String(id));
      const motionPreview=String(job?.meta?.workflow_key||"")==="motion_control"&&
        !!job?.meta?.motion_preview_available&&!!job?.result_video_id;
      if(motionPreview&&job.status!=="ready"){
        try{if(button)actionButtonBusy(button,true,"Finalizando…")}catch{}
        const ready=await waitMotionReady(id);
        if(!ready){
          try{if(button)actionButtonBusy(button,false)}catch{}
          toast("O vídeo já foi salvo. Estou terminando o encerramento da task; tente novamente em alguns segundos.","warn");
          return;
        }
      }
      return nativeSchedule.call(this,id,button);
    };
    wrapped.__motionSafe=true;
    scheduleProductionResult=wrapped;
  }

  function applyExactVideo7Actions(){
    if(uiState.patched)return;
    if(typeof productionJobRow!=="function"){
      setTimeout(applyExactVideo7Actions,0);
      return;
    }

    const motionRow=productionJobRow;
    productionJobRow=function(job,...rest){
      const html=motionRow.call(this,job,...rest);
      const previewReady=String(job?.meta?.workflow_key||"")==="motion_control"&&
        !!job?.meta?.motion_preview_available&&!!job?.result_video_id&&
        ["running","queued"].includes(job.status);
      if(!previewReady||typeof html!=="string")return html;

      const tpl=document.createElement("template");
      tpl.innerHTML=html.trim();
      const wrapper=tpl.content.firstElementChild;
      if(!wrapper?.classList?.contains("motion-preview-result"))return html;

      const row=wrapper.querySelector(":scope > .production-job");
      const readyActions=wrapper.querySelector(":scope > .production-ready-actions");
      const actionCell=row?.querySelector(".production-job-actions");
      if(!row||!readyActions||!actionCell)return html;

      const id=esc(String(job.id));
      const i=Number(rest[0]||0),total=Number(rest[1]||1);
      const number=Math.max(1,total-i);
      const scheduled=!!job?.meta?.scheduled;

      // Same native Video 7 minutos grid. Calendar waits for backend finalization before submitting.
      readyActions.insertAdjacentHTML("beforeend",
        '<button class="calendar-job-toggle '+(scheduled?'scheduled':'')+'" onclick="openProductionScheduleModal(\''+id+'\','+number+')">'+(scheduled?'📅 No calendário':'📅 Calendário')+'</button>'+
        '<button class="danger" onclick="deleteProductionJob(\''+id+'\',this)">Excluir</button>'
      );
      actionCell.innerHTML=readyActions.outerHTML;
      return row.outerHTML;
    };

    patchCalendarScheduling();
    uiState.patched=true;
    try{if(window.CloudentMotionControl)window.CloudentMotionControl.version=9}catch{}
    try{if(typeof currentPage!=="undefined"&&currentPage==="production"&&typeof productionPage==="function")productionPage()}catch{}
  }

  function boot(){
    if(window.CloudentMotionControl?.version>=6){
      applyExactVideo7Actions();
      return;
    }
    const core=document.createElement("script");
    core.src="/motion-control-core-v6.js?v=7b23bad";
    core.async=false;
    core.onload=applyExactVideo7Actions;
    core.onerror=()=>console.error("Motion Control: não foi possível carregar o controlador base.");
    (document.head||document.documentElement).appendChild(core);
  }

  boot();
})();
