(()=>{
  if(window.CloudentMotionControl?.version>=5)return;
  function start(){
  if(window.CloudentMotionControl?.version>=5)return;
  // A cached document may request this script before the SPA bundle.
  // Wait at the document boundary; never capture undefined SPA functions.
  const required=[typeof productionPage,typeof productionJobRow,typeof productionCostSummary,typeof uploadProductionJobDirect,typeof controlRunningHub,typeof productionAction,typeof renderProductionDraft];
  if(required.some(type=>type!=="function")){
    console.error("Motion Control: bundle principal da SPA indisponível.");
    return;
  }

  const MODE_KEY="cloudent_production_workflow_tab_v1";
  const MOTION="motion_control";
  const STANDARD="standard";
  let activeMode=localStorage.getItem(MODE_KEY)===MOTION?MOTION:STANDARD;
  let motionConfig=null;
  let configLoadedAt=0;
  const MOTION_EDGE="https://dxrhvudvutmgrmfkmzxo.supabase.co/functions/v1/cloudent-motion-control";

  const isMotionJob=job=>String(job?.meta?.workflow_key||"")===MOTION;
  const belongsToMode=job=>activeMode===MOTION?isMotionJob(job):!isMotionJob(job);
  const visibleJobs=()=>((typeof productionData!=="undefined"&&productionData?.jobs)||[]).filter(belongsToMode);

  async function motionFetch(path,options={},retry=true){
    if(typeof cloudSession==="undefined"||!cloudSession)throw new Error("Entre no CloudentFlow novamente.");
    const headers={...(options.headers||{}),Authorization:"Bearer "+cloudSession.access_token,apikey:SUPABASE_KEY};
    const res=await fetch(MOTION_EDGE+path,{...options,headers,cache:"no-store"});
    if(res.status===401&&retry&&typeof refreshCloudSession==="function"&&await refreshCloudSession())return motionFetch(path,options,false);
    let data=null;
    const type=String(res.headers.get("content-type")||"");
    try{data=type.includes("json")?await res.json():await res.text()}catch{}
    if(!res.ok||data?.ok===false)throw new Error(data?.error||data?.message||("Motion Control · HTTP "+res.status));
    return data;
  }

  async function loadMotionConfig(force=false){
    if(!cloudSession)return null;
    if(!force&&motionConfig&&Date.now()-configLoadedAt<60000)return motionConfig;
    try{
      motionConfig=await motionFetch("?resource=config");
      configLoadedAt=Date.now();
    }catch(e){
      motionConfig={ok:false,error:e.message};
    }
    return motionConfig;
  }

  function injectStyle(){
    if(document.getElementById("motionControlProductionStyle"))return;
    const style=document.createElement("style");
    style.id="motionControlProductionStyle";
    style.textContent=`
      #production .production-workflow-tabs{display:flex;gap:8px;align-items:center;margin:-2px 0 16px;padding:5px;width:max-content;max-width:100%;border:1px solid #272727;background:#0d0d0d;border-radius:14px}
      #production .production-workflow-tab{border:0;background:transparent;color:#8b8b8b;padding:9px 14px;border-radius:10px;font:700 12px/1 inherit;cursor:pointer;white-space:nowrap}
      #production .production-workflow-tab.active{background:#fff;color:#050505}
      #production .motion-workflow-map{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:10px;align-items:center;margin:0 0 14px;padding:14px 16px;border:1px solid #252525;border-radius:16px;background:#0b0b0b}
      #production .motion-node{min-width:0;padding:10px 12px;border:1px solid #2d2d2d;border-radius:12px;background:#111}
      #production .motion-node small{display:block;color:#777;font-size:10px;letter-spacing:.08em;text-transform:uppercase}
      #production .motion-node b{display:block;margin-top:4px;font-size:13px;color:#f5f5f5}
      #production .motion-node code{display:inline-block;margin-top:5px;color:#a9a9a9;font-size:10px}
      #production .motion-node-arrow{color:#777;font-size:16px}
      #production .motion-workflow-state{grid-column:1/-1;display:flex;align-items:center;gap:8px;padding-top:4px;color:#8f8f8f;font-size:11px}
      #production .motion-workflow-state i{width:7px;height:7px;border-radius:50%;background:#777}
      #production .motion-workflow-state.ok i{background:#fff;box-shadow:0 0 0 3px #ffffff18}
      #production .motion-workflow-state.err{color:#ff8c8c}
      #production .motion-workflow-state.err i{background:#ff5e5e}
      #production.motion-control-mode .production-note{border-left:2px solid #fff;padding-left:10px}
      @media(max-width:760px){
        #production .production-workflow-tabs{width:100%;display:grid;grid-template-columns:1fr 1fr}
        #production .production-workflow-tab{width:100%}
        #production .motion-workflow-map{grid-template-columns:1fr;gap:7px}
        #production .motion-node-arrow{transform:rotate(90deg);text-align:center}
      }`;
    document.head.appendChild(style);
  }

  function workflowStateMarkup(){
    const wf=motionConfig?.workflow||{};
    const err=wf.lastValidationError||motionConfig?.error||"";
    const validated=!!wf.lastValidatedAt&&!err;
    const cls=err?"err":validated?"ok":"";
    const text=err
      ?"Validação bloqueou a execução: "+esc(err)
      :validated
        ?"Workflow validado pela API do RunningHub. GPU padrão: 48 GB."
        :"O worker valida workflow + nodes antes da primeira execução para não gastar crédito em configuração errada.";
    return '<div class="motion-workflow-state '+cls+'"><i></i><span>'+text+'</span></div>';
  }

  function decorateProduction(){
    const root=document.getElementById("production");
    if(!root)return;
    root.classList.toggle("motion-control-mode",activeMode===MOTION);

    const head=root.querySelector(".production-head");
    if(head&&!root.querySelector(".production-workflow-tabs")){
      head.insertAdjacentHTML("afterend",
        '<div class="production-workflow-tabs" role="tablist" aria-label="Fluxo da Produção IA">'+
          '<button type="button" class="production-workflow-tab '+(activeMode===STANDARD?"active":"")+'" onclick="CloudentMotionControl.setMode(&quot;standard&quot;)">video 7 minutos</button>'+
          '<button type="button" class="production-workflow-tab '+(activeMode===MOTION?"active":"")+'" onclick="CloudentMotionControl.setMode(&quot;motion_control&quot;)">motion control v7</button>'+
        '</div>'
      );
    }

    if(activeMode!==MOTION)return;

    const h2=head?.querySelector("h2");
    const p=head?.querySelector("p");
    if(h2)h2.textContent="Fila de produção";
    if(p)p.textContent="Vídeo de movimento + frame da personagem. Pipeline V7 separado da produção atual.";

    const commandInfo=root.querySelector(".runninghub-command-info");
    if(commandInfo){
      const span=commandInfo.querySelector("span"),b=commandInfo.querySelector("b");
      if(span)span.textContent="RunningHub · Motion Control V7";
      if(b)b.textContent=(productionData?.runninghubStatus?.enabled?"Motion Control ativo":"Produção pausada");
    }

    const panel=root.querySelector(".production-upload-card .ui3-panel-head");
    if(panel){
      const span=panel.querySelector("span"),title=panel.querySelector("h3"),settings=panel.querySelector("button");
      if(span)span.textContent="Novo Motion";
      if(title)title.textContent="Vídeo + frame";
      if(settings){
        settings.disabled=true;
        settings.textContent="Nodes 275 · 299 · 384";
        settings.onclick=null;
      }
    }

    const videoBox=root.querySelector("#productionVideoBox");
    const frameBox=root.querySelector("#productionFrameBox");
    if(videoBox){
      const title=videoBox.querySelector(".production-upload-title"),meta=videoBox.querySelector(".production-upload-meta");
      if(title)title.textContent="Vídeo de movimento";
      if(meta)meta.textContent="Load Video · node #275 · campo video"+(productionDraft?.video?" · "+fmtSize(productionDraft.video.size):"");
    }
    if(frameBox){
      const title=frameBox.querySelector(".production-upload-title"),meta=frameBox.querySelector(".production-upload-meta");
      if(title)title.textContent="Frame da personagem";
      if(meta)meta.textContent="Load Image · node #299 · campo image"+(productionDraft?.frame?" · "+fmtSize(productionDraft.frame.size):"");
    }
    const add=root.querySelector(".production-add-btn");
    if(add&&!productionUploading)add.textContent="＋ Adicionar ao Motion Control";
    const note=root.querySelector(".production-note");
    if(note)note.textContent="Entrega: SaveVideo · node #384. A execução é cancelada após salvar e verificar o vídeo. GPU padrão: 48 GB.";

    const main=root.querySelector(".production-main-grid");
    if(main&&!root.querySelector(".motion-workflow-map")){
      main.insertAdjacentHTML("beforebegin",
        '<div class="motion-workflow-map">'+
          '<div class="motion-node"><small>Entrada 1</small><b>Vídeo de movimento</b><code>#275 · video</code></div>'+
          '<div class="motion-node-arrow">→</div>'+
          '<div class="motion-node"><small>Entrada 2</small><b>Frame / personagem</b><code>#299 · image</code></div>'+
          '<div class="motion-node-arrow">→</div>'+
          '<div class="motion-node"><small>Saída</small><b>Vídeo disponível</b><code>#384 · SaveVideo</code></div>'+
          workflowStateMarkup()+
        '</div>'
      );
    }

    const empty=root.querySelector(".production-empty");
    if(empty){
      const b=empty.querySelector("b"),small=empty.querySelector("small");
      if(b)b.textContent="Fila do Motion Control vazia";
      if(small)small.textContent="Envie um vídeo de movimento + um frame para começar.";
    }
  }

  async function uploadMotion(video,frame,videoThumb=null,frameThumb=null){
    const ticket=await motionFetch("?action=upload-ticket",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        video_file_name:video.name,video_mime_type:video.type||"video/mp4",video_size_bytes:video.size,
        frame_file_name:frame.name,frame_mime_type:frame.type||"image/jpeg",frame_size_bytes:frame.size,
        has_video_thumb:!!videoThumb,has_frame_thumb:!!frameThumb
      })
    });

    if(ticket?.fallback){
      const fd=new FormData();
      fd.append("video",video);fd.append("frame",frame);
      if(videoThumb)fd.append("video_thumb",videoThumb,"video-thumb.jpg");
      if(frameThumb)fd.append("frame_thumb",frameThumb,"frame-thumb.jpg");
      return await motionFetch("?action=upload",{method:"POST",body:fd});
    }

    const putOne=async(part,blob,required=true)=>{
      if(!part||!blob)return false;
      try{
        const r=await fetch(part.upload_url,{method:"PUT",headers:{"Content-Type":part.content_type||blob.type||"application/octet-stream"},body:blob});
        if(!r.ok)throw new Error("HTTP "+r.status);
        return true;
      }catch(e){
        if(required)throw new Error("Upload do Motion Control falhou. "+(e?.message||""));
        return false;
      }
    };

    const [videoOk,frameOk]=await Promise.all([putOne(ticket.video,video,true),putOne(ticket.frame,frame,true)]);
    if(!videoOk||!frameOk)throw new Error("Vídeo ou frame não terminou de enviar.");
    const [videoThumbOk,frameThumbOk]=await Promise.all([
      putOne(ticket.video_thumb,videoThumb,false),
      putOne(ticket.frame_thumb,frameThumb,false)
    ]);

    return await motionFetch("?action=upload-complete",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        job_id:ticket.job_id,video_path:ticket.video.path,frame_path:ticket.frame.path,
        video_thumb_path:videoThumbOk&&ticket.video_thumb?ticket.video_thumb.path:"",
        frame_thumb_path:frameThumbOk&&ticket.frame_thumb?ticket.frame_thumb.path:"",
        video_file_name:video.name,video_mime_type:video.type||"video/mp4",video_size_bytes:video.size,
        frame_file_name:frame.name,frame_mime_type:frame.type||"image/jpeg",frame_size_bytes:frame.size
      })
    });
  }

  const nativeProductionPage=productionPage;
  productionPage=function(...args){
    const data=typeof productionData!=="undefined"?productionData:null;
    const all=data?.jobs;
    if(data&&Array.isArray(all))data.jobs=all.filter(belongsToMode);
    try{
      const result=nativeProductionPage.apply(this,args);
      decorateProduction();
      return result;
    }finally{
      if(data&&Array.isArray(all))data.jobs=all;
    }
  };

  const nativeDraft=renderProductionDraft;
  renderProductionDraft=function(...args){
    const result=nativeDraft.apply(this,args);
    if(activeMode===MOTION)decorateProduction();
    return result;
  };

  const nativeJobRow=productionJobRow;
  productionJobRow=function(job,...rest){
    if(isMotionJob(job)&&job.meta?.motion_preview_available&&job.result_video_id&&["running","queued"].includes(job.status)){
      const message=job.meta?.provider_cancel_error
        ?"Vídeo #384 salvo. Cancelamento pendente: "+job.meta.provider_cancel_error
        :"Vídeo #384 salvo. Solicitando encerramento da execução no RunningHub.";
      return '<div class="motion-preview-result"><p>'+esc(message)+'</p>'+
        nativeJobRow.call(this,job,...rest)+
        '<div class="production-ready-actions"><button data-id="'+esc(job.id)+'" data-kind="result" onclick="productionPreviewFromButton(this)">▶ Ver resultado</button><button onclick="downloadProductionResult(&quot;'+esc(job.id)+'&quot;,1)">↓ Baixar vídeo #384</button></div></div>';
    }
    if(isMotionJob(job)&&job.status==="motion_waiting"){
      return nativeJobRow.call(this,{...job,status:"waiting"},...rest)
        .replace("Pronto para nova tentativa","Aguardando vaga do Motion Control");
    }
    return nativeJobRow.call(this,job,...rest);
  };

  const nativeCostSummary=productionCostSummary;
  productionCostSummary=function(){
    if(activeMode!==MOTION)return nativeCostSummary();
    const jobs=visibleJobs();
    const data=productionData,all=data?.jobs;
    if(data)data.jobs=jobs.map(j=>j.status==="motion_waiting"?{...j,status:"waiting"}:j);
    try{return nativeCostSummary()}finally{if(data)data.jobs=all}
  };

  const nativeUpload=uploadProductionJobDirect;
  uploadProductionJobDirect=async function(...args){
    return activeMode===MOTION?uploadMotion(...args):nativeUpload.apply(this,args);
  };

  const nativeAction=productionAction;
  productionAction=async function(id,operation,button=null){
    const job=((productionData?.jobs)||[]).find(x=>String(x.id)===String(id));
    if(!isMotionJob(job))return nativeAction.call(this,id,operation,button);
    actionButtonBusy(button,true,operation==="cancel"?"Cancelando…":operation==="retry"?"Reenviando…":"Executando…");
    try{
      const r=await motionFetch("?action=job",{
        method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,operation})
      });
      await loadProductionData(false);
      if(currentPage==="production")productionPage();
      toast(operation==="cancel"?"Job cancelado.":operation==="retry"?"Motion Control reenviado para a fila.":(r?.queued?"Motion Control priorizado na fila.":"Motion Control iniciado."),"ok");
    }catch(e){
      actionButtonBusy(button,false);
      toast(e.message,"err");
    }
  };

  const nativeControl=controlRunningHub;
  controlRunningHub=async function(operation,button=null){
    if(activeMode!==MOTION||operation==="pause")return nativeControl.call(this,operation,button);
    actionButtonBusy(button,true,"Executando…");
    try{
      const result=await motionFetch("?action=run-queue",{method:"PATCH",headers:{"Content-Type":"application/json"},body:"{}"});
      await loadProductionData(false);
      if(currentPage==="production")productionPage();
      toast((result?.queued||0)+" job(s) do Motion Control priorizado(s).","ok");
    }catch(e){
      actionButtonBusy(button,false);
      toast(e.message,"err");
    }
  };

  toggleAllReadyProduction=function(checked){
    visibleJobs().filter(j=>j.status==="ready").forEach(j=>checked?productionSelectedJobs.add(String(j.id)):productionSelectedJobs.delete(String(j.id)));
    productionPage();
  };

  clearCompletedProductionJobs=async function(){
    const ready=visibleJobs().filter(j=>j.status==="ready");
    if(!ready.length){toast("Não há concluídos para limpar.","warn");return}
    if(!confirm("Remover "+ready.length+" concluído(s) somente desta aba?\n\nNada será removido do Calendário e os vídeos finais serão preservados."))return;
    try{
      const result=await motionFetch("?action=clear-completed",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({workflow_key:activeMode===MOTION?MOTION:STANDARD})
      });
      const ids=new Set(ready.map(j=>String(j.id)));
      if(productionData?.jobs)productionData.jobs=productionData.jobs.filter(j=>!ids.has(String(j.id)));
      ready.forEach(j=>productionSelectedJobs.delete(String(j.id)));
      productionPage();
      toast((result?.cleared??ready.length)+" concluído(s) removido(s) desta aba.","ok");
      loadProductionData(true).then(()=>{if(currentPage==="production")productionPage()}).catch(()=>{});
    }catch(e){toast(e.message,"err")}
  };

  async function setMode(mode){
    const next=mode===MOTION?MOTION:STANDARD;
    if(next===activeMode)return;
    if(productionUploading){toast("Aguarde o envio terminar antes de trocar de fluxo.","warn");return}
    activeMode=next;
    localStorage.setItem(MODE_KEY,activeMode);
    try{releaseProductionDraft()}catch{}
    try{productionSelectedJobs.clear()}catch{}
    if(currentPage==="production")productionPage();
    if(activeMode===MOTION){await loadMotionConfig(false);if(currentPage==="production")productionPage();}
  }

  async function install(){
    injectStyle();
    if(currentPage==="production")productionPage();
    if(activeMode===MOTION){await loadMotionConfig(false);if(currentPage==="production")productionPage();}
  }

  window.CloudentMotionControl={
    version:5,
    get mode(){return activeMode},
    setMode,
    reloadConfig:async()=>{await loadMotionConfig(true);if(currentPage==="production")productionPage();}
  };

  install().catch(error=>console.error("Motion Control:",error));
  }
  if(document.readyState==="loading"&&typeof productionPage!=="function")document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
})();

