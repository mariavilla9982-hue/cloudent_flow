(()=>{
  if(window.CloudentMotionControlUILoader?.installed)return;
  const uiState=window.CloudentMotionControlUILoader={installed:true,patched:false};

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function installAuthQuotaRecovery(){
    if(window.CloudentAuthQuotaRecovery?.installed)return;
    window.CloudentAuthQuotaRecovery={installed:true};
    if(typeof signInCloud!=="function"||typeof authRequest!=="function")return;

    const quotaError=/exceed_(?:cached_)?egress_quota|service for this project is restricted|upgrade their plan|removed caps|\b402\b/i;
    async function recoverCloudentSession(email,password){
      const res=await fetch(SUPABASE_URL+"/functions/v1/cloudent-x-local-auth?action=login",{
        method:"POST",
        headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({email,password})
      });
      let data=null;try{data=await res.json()}catch{}
      if(!res.ok)throw new Error(data?.error==="invalid_credentials"?"Email ou senha incorretos.":(data?.error||"Não foi possível validar seu acesso."));
      if(data?.mode==="supabase"&&data?.session?.access_token)return data.session;
      if(data?.mode==="local"&&data?.role==="admin"&&data?.token&&data?.user_id){
        const expMs=Date.parse(data.expires_at||"");
        const expiresAt=Number.isFinite(expMs)?Math.floor(expMs/1000):Math.floor(Date.now()/1000)+2592000;
        return {
          access_token:"cf_local_"+String(data.token),
          refresh_token:"",
          token_type:"bearer",
          expires_in:Math.max(60,expiresAt-Math.floor(Date.now()/1000)),
          expires_at:expiresAt,
          cloudent_local:true,
          user:{
            id:String(data.user_id),
            email:String(data.email||email),
            aud:"authenticated",
            role:"authenticated",
            app_metadata:{provider:"cloudent_local",providers:["cloudent_local"],cloudent_role:"admin"},
            user_metadata:{cloudent_role:"admin"}
          }
        };
      }
      throw new Error("Não foi possível recuperar sua sessão administrativa agora.");
    }

    const nativeSignOut=typeof signOutCloud==="function"?signOutCloud:null;
    if(nativeSignOut){
      signOutCloud=async function(){
        const token=String(cloudSession?.access_token||"");
        if(cloudSession?.cloudent_local&&token.startsWith("cf_local_")){
          try{
            await fetch(SUPABASE_URL+"/functions/v1/cloudent-x-local-auth?action=logout",{
              method:"POST",
              headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json","x-cloudent-x-session":token.slice("cf_local_".length)},
              body:"{}"
            });
          }catch{}
        }
        return nativeSignOut();
      };
    }

    signInCloud=async function(){
      const email=$("#loginEmail")?.value?.trim()||$("#authEmail")?.value?.trim();
      const password=$("#loginPassword")?.value||$("#authPassword")?.value||"";
      if(!email||!password){setLoginMessage("Informe email e senha.","error");return}
      setLoginMessage("Validando sua conta…");
      setLoginBusy(true);
      try{
        let session=null;
        try{
          session=await authRequest("/token?grant_type=password",{method:"POST",body:JSON.stringify({email,password})});
        }catch(error){
          const message=String(error?.message||error||"");
          if(!quotaError.test(message))throw error;
          setLoginMessage("Cota do Supabase atingida. Recuperando seu acesso administrativo…");
          session=await recoverCloudentSession(email,password);
        }
        persistCloudSession(session);
        cloudLoading=true;
        await initCloud();
        cloudLoading=false;
        syncAuthGate();
        renderAll();
        loadDeferredCloudData();
        await xPostingRequest("audit-session",{event:"login"}).catch(()=>{});
        setLoginMessage("");
      }catch(error){
        persistCloudSession(null);
        syncAuthGate();
        setLoginMessage(error?.message||"Não foi possível entrar.","error");
      }finally{
        setLoginBusy(false);
      }
    };
  }

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

  function patchMotionThumbFailures(){
    if(typeof loadProductionThumb!=="function"||loadProductionThumb.__motionStorageSafe)return;
    const nativeThumb=loadProductionThumb,failed=new Map();
    const wrapped=async function(el){
      const id=el?.dataset?.productionThumbId,kind=el?.dataset?.productionThumbKind;
      const job=(productionData?.jobs||[]).find(x=>String(x.id)===String(id));
      if(job?.meta?.workflow_key!=="motion_control")return nativeThumb.call(this,el);
      const key=String(id)+"|"+String(kind),until=failed.get(key)||0;
      const unavailable=()=>{
        failed.set(key,Date.now()+5*60*1000);
        if(failed.size>200)failed.delete(failed.keys().next().value);
        el.querySelector("img")?.remove();
        el.dataset.loaded="1";
        el.title="Miniatura indisponível no armazenamento. O arquivo original não foi alterado.";
      };
      if(until>Date.now()){el.dataset.loaded="1";el.title="Miniatura temporariamente indisponível.";return;}
      await nativeThumb.call(this,el);
      const img=el.querySelector("img");
      if(img){
        img.addEventListener("error",unavailable,{once:true});
        if(img.complete&&!img.naturalWidth)unavailable();
      }
    };
    wrapped.__motionStorageSafe=true;loadProductionThumb=wrapped;
  }

  function patchMotionDraftPreview(){
    if(document.getElementById("cloudentMotionPreviewFitStyle"))return;
    const style=document.createElement("style");
    style.id="cloudentMotionPreviewFitStyle";
    style.textContent=`
      #production.motion-control-mode .production-input-grid{
        grid-template-columns:minmax(0,220px) 22px minmax(0,220px)!important;
        justify-content:flex-start!important;
        align-items:start!important;
        gap:12px!important;
      }
      #production.motion-control-mode .production-plus{
        align-self:center!important;
        height:auto!important;
        padding-top:0!important;
      }
      #production.motion-control-mode .production-drop-live{
        width:220px!important;
        max-width:100%!important;
        min-height:0!important;
        aspect-ratio:9 / 16!important;
        padding:0!important;
        overflow:hidden!important;
        border-radius:14px!important;
      }
      #production.motion-control-mode .production-upload-preview{
        background:#050505!important;
      }
      #production.motion-control-mode .production-upload-preview video,
      #production.motion-control-mode .production-upload-preview img{
        width:100%!important;
        height:100%!important;
        object-fit:contain!important;
        transform:none!important;
        background:#050505!important;
      }
      #production.motion-control-mode .production-drop-live:hover .production-upload-preview video,
      #production.motion-control-mode .production-drop-live:hover .production-upload-preview img{
        transform:none!important;
      }
      #production.motion-control-mode .production-upload-overlay{
        padding:26px 10px 10px!important;
      }
      #production.motion-control-mode .production-upload-overlay b{
        font-size:10px!important;
      }
      #production.motion-control-mode .production-upload-overlay small{
        font-size:7px!important;
      }
      @media(max-width:760px){
        #production.motion-control-mode .production-input-grid{
          grid-template-columns:1fr!important;
          justify-items:start!important;
        }
        #production.motion-control-mode .production-plus{
          display:none!important;
        }
        #production.motion-control-mode .production-drop-live{
          width:200px!important;
        }
      }`;
    (document.head||document.documentElement).appendChild(style);
  }

  function applyExactVideo7Actions(){
    if(uiState.patched)return;
    if(typeof productionJobRow!=="function"){
      setTimeout(applyExactVideo7Actions,0);
      return;
    }

    const motionRow=productionJobRow;
    productionJobRow=function(job,...rest){
      const isMotion=String(job?.meta?.workflow_key||"")==="motion_control";

      const active=isMotion&&["queued","running"].includes(job.status);
      const queued=active&&(job.meta?.provider_status==="QUEUED"||job.meta?.provider_queue_waiting===true||(!job.meta?.provider_status&&job.status==="queued"));
      const confirmedRunning=active&&!queued&&job.meta?.provider_status==="RUNNING"&&
        String(job.meta?.provider_status_task_id||"")===String(job.runninghub_task_id||"")&&!job.meta?.provider_status_error;
      const displayJob=queued?{...job,status:"queued",progress:38,started_at:null}:
        active&&!confirmedRunning?{...job,status:"running",started_at:null}:job;
      let html=motionRow.call(this,displayJob,...rest);
      if(typeof html==="string"){
        if(queued)html=html.replace(/Na fila do RunningHub/g,"Aguardando vaga");
        else if(active&&!confirmedRunning)html=html.replace(/>Gerando</g,job.meta?.provider_status==="SUCCESS"?">Salvando resultado<":">Consultando RunningHub<");
      }
      const recovered=isMotion&&job.status==="ready"&&!!job.result_video_id&&
        job.meta?.legacy_result_recovery?.task_id===String(job.runninghub_task_id||"")&&
        job.meta?.legacy_result_recovery?.node_id==="313";
      if(recovered&&typeof html==="string"){
        html=html.replace(/>Pronto</g,">Recuperado<")
          .replace(/(<div class="production-job-meta">)/,
            '<small class="production-wait-detail" title="Esta execução antiga foi enviada pelo fluxo video 7 minutos. O vídeo foi recuperado da mesma task, sem nova geração.">Recuperado do fluxo video 7 minutos · node #313</small>$1');
      }
      const previewReady=isMotion&&
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

      readyActions.insertAdjacentHTML("beforeend",
        '<button class="calendar-job-toggle '+(scheduled?'scheduled':'')+'" onclick="openProductionScheduleModal(\''+id+'\','+number+')">'+(scheduled?'📅 No calendário':'📅 Calendário')+'</button>'+
        '<button class="danger" onclick="deleteProductionJob(\''+id+'\',this)">Excluir</button>'
      );
      actionCell.innerHTML=readyActions.outerHTML;
      return row.outerHTML;
    };

    patchCalendarScheduling();
    patchMotionThumbFailures();
    patchMotionDraftPreview();
    if(!document.getElementById("cloudentMotionStorageScript")){
      const storageScript=document.createElement("script");storageScript.id="cloudentMotionStorageScript";storageScript.src="/motion-storage-ui.js?v=1";storageScript.async=false;(document.head||document.documentElement).appendChild(storageScript);
    }
    uiState.patched=true;
    try{if(window.CloudentMotionControl)window.CloudentMotionControl.version=16}catch{}
    try{if(typeof currentPage!=="undefined"&&currentPage==="production"&&typeof productionPage==="function")productionPage()}catch{}
  }

  function boot(){
    installAuthQuotaRecovery();
    if(window.CloudentMotionControl?.version>=6){
      applyExactVideo7Actions();
      return;
    }
    const core=document.createElement("script");
    core.src="/motion-control-core-v6.js?v=storage1";
    core.async=false;
    core.onload=applyExactVideo7Actions;
    core.onerror=()=>console.error("Motion Control: não foi possível carregar o controlador base.");
    (document.head||document.documentElement).appendChild(core);
  }

  boot();
})();