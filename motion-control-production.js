(()=>{
  if(window.CloudentMotionControlUILoader?.installed)return;
  const uiState=window.CloudentMotionControlUILoader={installed:true,patched:false};

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

      // Reuse the exact native action container/placement from video 7 minutos.
      // Only the two actions that are valid while provider cancellation is pending stay visible.
      actionCell.innerHTML=readyActions.outerHTML;
      return row.outerHTML;
    };

    uiState.patched=true;
    try{if(window.CloudentMotionControl)window.CloudentMotionControl.version=7}catch{}
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
