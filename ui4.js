/* CloudentFlow UI 4 — Final Workspace
   Progressive enhancement only. It does not replace the production logic. */
(()=>{
  const U4={density:localStorage.getItem("cloudentflow-ui4-density")||"detail",mounted:false,renderWrapped:false};
  const qs=s=>document.querySelector(s);

  function setDensity(mode){
    U4.density=mode==="compact"?"compact":"detail";
    localStorage.setItem("cloudentflow-ui4-density",U4.density);
    document.body.classList.toggle("u4-compact",U4.density==="compact");
    document.querySelectorAll(".u4-density-toggle button").forEach(b=>b.classList.toggle("active",b.dataset.mode===U4.density));
  }

  function ensureDensityToggle(){
    const actions=qs(".top-actions");
    if(!actions||qs(".u4-density-toggle"))return;
    const el=document.createElement("div");
    el.className="u4-density-toggle";
    el.title="Densidade da interface";
    el.innerHTML='<button data-mode="detail" title="Modo detalhado">D</button><button data-mode="compact" title="Modo compacto">C</button>';
    actions.insertBefore(el,qs("#newVideoBtn")||null);
    el.querySelectorAll("button").forEach(b=>b.onclick=()=>setDensity(b.dataset.mode));
    setDensity(U4.density);
  }

  function workerOnline(name){
    const w=(window.automationData?.workers||[]).find(x=>x.worker_name===name);
    return !!w?.online;
  }

  function updateNavSignals(){
    document.querySelectorAll("#nav button .u4-nav-signal").forEach(x=>x.remove());
    const add=(page,state,title)=>{
      const b=document.querySelector('#nav button[data-page="'+page+'"]');
      if(!b)return;
      const i=document.createElement("i");
      i.className="u4-nav-signal "+state;
      i.title=title||"";
      b.appendChild(i);
    };
    const pj=window.productionData?.jobs||[];
    const activeProd=pj.filter(j=>["uploading","queued","running"].includes(String(j.status))).length;
    const waitingProd=pj.filter(j=>String(j.status)==="waiting").length;
    const failedProd=pj.filter(j=>String(j.status)==="failed").length;
    if(failedProd)add("production","bad",failedProd+" job(s) com erro");
    else if(activeProd)add("production","good",activeProd+" job(s) processando");
    else if(waitingProd)add("production","warn",waitingProd+" job(s) aguardando");

    const trials=window.trialReelsData||[];
    const trialErr=trials.filter(x=>x.status==="failed"&&!x.hidden_at).length;
    const trialActive=trials.filter(x=>["processing","container_created"].includes(x.status)).length;
    if(trialErr)add("trialReels","bad",trialErr+" Trial com erro");
    else if(trialActive)add("trialReels","good","Trial em publicação");

    const unread=Number(window.notificationsData?.unread||0);
    if(unread)add("settings","bad",unread+" alerta(s)");

    const xAccounts=(window.platformAccounts||[]).filter(x=>x.platform==="x"&&x.enabled).length;
    add("xStudio",xAccounts?"good":window.xIntegrationConfig?.configured?"warn":"",xAccounts?xAccounts+" conta(s) X conectada(s)":"X ainda não conectado");
    add("automation",workerOnline("automation")?"good":"warn",workerOnline("automation")?"Scheduler online":"Verificar scheduler");
  }

  function nextScheduled(){
    try{
      const rows=typeof allScheduled==="function"?allScheduled():[];
      const now=Date.now();
      return rows.find(x=>new Date(x.scheduledAt).getTime()>=now&&!["publicado","erro"].includes(typeof getStatus==="function"?getStatus(x):String(x.status||"")));
    }catch{return null}
  }

  function overviewAttention(){
    if(window.currentPage!=="overview")return;
    const host=qs("#overview");
    if(!host||host.querySelector(".u4-attention"))return;
    const next=nextScheduled();
    const pj=window.productionData?.jobs||[];
    const running=pj.find(j=>["uploading","queued","running"].includes(String(j.status)));
    const waiting=pj.filter(j=>String(j.status)==="waiting").length;
    const unread=Number(window.notificationsData?.unread||0);
    const storage=Number(window.systemHealthData?.usage?.storage_bytes||0);
    const storageLimit=Number(window.systemHealthData?.limits?.storage_bytes||0);
    const storagePct=storageLimit?storage/storageLimit*100:0;
    const ig=!!window.instagramIntegration?.enabled;
    const online=workerOnline("instagram_publish")&&workerOnline("automation");

    let title="Operação pronta";
    let text="O CloudentFlow está acompanhando calendário, métricas e workers.";
    let action='<button class="btn primary btn-sm" onclick="showPage(\'calendar\')">Abrir calendário</button>';
    if(unread){
      title=unread+" alerta"+(unread>1?"s":"")+" precisa"+(unread>1?"m":"")+" de atenção";
      text="Abra o centro de atividade antes de continuar a operação.";
      action='<button class="btn primary btn-sm" onclick="toggleActivityPanel()">Ver alertas</button>';
    }else if(running){
      title="Produção IA trabalhando";
      text=(running.original_file_name||"Um vídeo")+" está sendo processado. "+(waiting?waiting+" item(ns) aguardam na fila.":"");
      action='<button class="btn primary btn-sm" onclick="showPage(\'production\')">Acompanhar produção</button>';
    }else if(next){
      title="Próxima publicação · "+(typeof fmtDateTime==="function"?fmtDateTime(next.scheduledAt):"agendada");
      text=(next.name||"Vídeo")+" está na fila do calendário.";
      action='<button class="btn primary btn-sm" onclick="showPage(\'calendar\')">Ver publicação</button>';
    }

    const wrap=document.createElement("div");
    wrap.className="u4-attention";
    wrap.innerHTML=
      '<div class="u4-focus-card">'+
        '<div class="copy"><small>FOCO AGORA</small><h3>'+(typeof esc==="function"?esc(title):title)+'</h3><p>'+(typeof esc==="function"?esc(text):text)+'</p></div>'+
        '<div class="u4-focus-actions">'+action+'<button class="btn btn-sm" onclick="refreshLiveData(true)">↻ Atualizar</button></div>'+
      '</div>'+
      '<div class="u4-attention-list">'+
        '<small>SAÚDE RÁPIDA</small>'+
        '<div class="u4-attention-items">'+
          '<div class="u4-attention-item"><i class="'+(ig?"good":"bad")+'"></i><b>Instagram</b><em>'+(ig?"conectado":"pendente")+'</em></div>'+
          '<div class="u4-attention-item"><i class="'+(online?"good":"warn")+'"></i><b>Automação</b><em>'+(online?"online":"verificar")+'</em></div>'+
          '<div class="u4-attention-item"><i class="'+(storagePct>=90?"bad":storagePct>=70?"warn":"good")+'"></i><b>Storage</b><em>'+(storageLimit?storagePct.toFixed(0)+"%":"medindo")+'</em></div>'+
        '</div>'+
      '</div>';
    host.prepend(wrap);
  }

  function calendarEnhance(){
    if(window.currentPage!=="calendar")return;
    const today=typeof localISO==="function"?localISO(new Date()):new Date().toISOString().slice(0,10);
    document.querySelectorAll(".day-column").forEach(col=>{
      const date=col.dataset.day||col.getAttribute("data-date");
      col.classList.toggle("u4-today",date===today);
      if(date===today&&!col.querySelector(".u4-now-line")){
        const line=document.createElement("div");
        line.className="u4-now-line";
        const head=col.querySelector(".day-head,.ui31-day-head,.calendar-day-head");
        if(head?.nextSibling)head.parentNode.insertBefore(line,head.nextSibling);
        else col.prepend(line);
      }
    });
  }

  function productionEnhance(){
    if(window.currentPage!=="production")return;
    const host=qs("#production");
    if(!host||host.querySelector(".u4-production-summary"))return;
    const jobs=window.productionData?.jobs||[];
    if(!jobs.length)return;
    const counts={
      waiting:jobs.filter(j=>j.status==="waiting").length,
      active:jobs.filter(j=>["uploading","queued","running"].includes(j.status)).length,
      ready:jobs.filter(j=>j.status==="ready").length,
      failed:jobs.filter(j=>j.status==="failed").length
    };
    const grid=document.createElement("div");
    grid.className="u4-production-summary";
    grid.innerHTML='<div><small>AGUARDANDO</small><b>'+counts.waiting+'</b></div>'+
      '<div><small>PROCESSANDO</small><b>'+counts.active+'</b></div>'+
      '<div><small>PRONTOS</small><b>'+counts.ready+'</b></div>'+
      '<div><small>ERROS</small><b>'+counts.failed+'</b></div>';
    const head=host.querySelector(".ui3-page-head");
    if(head)head.insertAdjacentElement("afterend",grid);else host.prepend(grid);
  }

  function brainNode(label,value,detail,x,y,page,on=true){
    const safeLabel=typeof esc==="function"?esc(label):label;
    const safeValue=typeof esc==="function"?esc(String(value)):String(value);
    const safeDetail=typeof esc==="function"?esc(detail):detail;
    return '<button class="u4-brain-node" style="--x:'+x+'%;--y:'+y+'%" onclick="showPage(\''+page+'\')"><i class="'+(on?"on":"")+'"></i><small>'+safeLabel+'</small><b>'+safeValue+'</b><span>'+safeDetail+'</span></button>';
  }

  function brainEnhance(){
    if(window.currentPage!=="cloudentAI")return;
    const host=qs("#cloudentAI");
    if(!host||host.querySelector(".u4-brain-shell"))return;
    const scheduled=(()=>{try{return typeof allScheduled==="function"?allScheduled().filter(x=>new Date(x.scheduledAt)>new Date()).length:0}catch{return 0}})();
    const views=(window.liveInstagramMetrics||[]).reduce((n,x)=>n+Number(x.views||0),0);
    const prod=(window.productionData?.jobs||[]).filter(j=>["waiting","queued","running","uploading"].includes(j.status)).length;
    const trials=(window.trialReelsData||[]).filter(x=>!x.hidden_at&&["scheduled","processing","container_created"].includes(x.status)).length;
    const recs=(window.automationData?.recommendations||[]);
    const topTime=recs[0]?.recommended_time?String(recs[0].recommended_time).slice(0,5):"—";
    const xAccounts=(window.platformAccounts||[]).filter(x=>x.platform==="x"&&x.enabled).length;
    const shell=document.createElement("section");
    shell.className="u4-brain-shell";
    shell.innerHTML='<div class="u4-brain-head"><small>LIVE SYSTEM MAP</small><b>Mente operacional do CloudentFlow</b></div>'+
      '<div class="u4-brain-status">'+(workerOnline("automation")?"● aprendendo":"○ aguardando worker")+'</div>'+
      '<div class="u4-brain-map">'+
        '<svg class="u4-brain-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'+
          '<line x1="50" y1="52" x2="16" y2="24"/><line x1="50" y1="52" x2="84" y2="22"/>'+
          '<line x1="50" y1="52" x2="14" y2="72"/><line x1="50" y1="52" x2="84" y2="74"/>'+
          '<line x1="50" y1="52" x2="31" y2="88"/><line x1="50" y1="52" x2="68" y2="90"/>'+
          '<circle cx="50" cy="52" r="1.2"/></svg>'+
        '<div class="u4-brain-core">CF</div>'+
        brainNode("REELS",Number(views).toLocaleString("pt-BR")+" views","métricas recentes",16,24,"metrics",views>0)+
        brainNode("HORÁRIO",topTime,"melhor candidato",84,22,"smartTimes",topTime!=="—")+
        brainNode("CALENDÁRIO",scheduled+" futuros","fila de publicação",14,72,"calendar",scheduled>0)+
        brainNode("PRODUÇÃO IA",prod+" ativos","RunningHub",84,74,"production",prod>0)+
        brainNode("TRIAL",trials+" ativos","laboratório da madrugada",31,88,"trialReels",trials>0)+
        brainNode("X",xAccounts+" contas","OAuth / canal",68,90,"xStudio",xAccounts>0)+
      '</div>';
    const head=host.querySelector(".ui3-page-head");
    if(head)head.insertAdjacentElement("afterend",shell);else host.prepend(shell);
  }

  function pageTitleContext(){
    const title=qs("#pageTitle");if(!title)return;
    const map={overview:"Operação",calendar:"Conteúdo",trialReels:"Laboratório",production:"Pipeline",frameExtractor:"Utilitário",xStudio:"Canal",tiktokStudio:"Canal",metrics:"Analytics",smartTimes:"Inteligência",automation:"Sistema",cloudentAI:"Copiloto",settings:"Configurações"};
    title.dataset.context=map[window.currentPage]||"Workspace";
  }

  function busyDuringNavigation(){
    document.body.classList.add("u4-page-busy");
    clearTimeout(window.__u4BusyTimer);
    window.__u4BusyTimer=setTimeout(()=>document.body.classList.remove("u4-page-busy"),260);
  }

  function enhance(){
    ensureDensityToggle();
    updateNavSignals();
    overviewAttention();
    calendarEnhance();
    productionEnhance();
    brainEnhance();
    pageTitleContext();
  }

  function wrapCore(){
    if(U4.renderWrapped)return;
    U4.renderWrapped=true;
    if(typeof window.renderAll==="function"){
      const originalRender=window.renderAll;
      window.renderAll=function(...args){const out=originalRender.apply(this,args);requestAnimationFrame(enhance);return out};
    }
    if(typeof window.showPage==="function"){
      const originalShow=window.showPage;
      window.showPage=function(...args){busyDuringNavigation();const out=originalShow.apply(this,args);requestAnimationFrame(enhance);return out};
    }
    if(typeof window.commandItems==="function"){
      const base=window.commandItems;
      window.commandItems=function(){
        const rows=base();
        rows.splice(3,0,
          {icon:"▶",title:"Abrir Produção IA",hint:"Fila e resultados",run:()=>{closeCommandPalette();showPage("production")}},
          {icon:"◉",title:"Abrir Reels teste",hint:"Laboratório da madrugada",run:()=>{closeCommandPalette();showPage("trialReels")}},
          {icon:"X",title:"Abrir X Studio",hint:"Contas e publicação",run:()=>{closeCommandPalette();showPage("xStudio")}}
        );
        return rows;
      };
    }
  }

  function bindKeys(){
    if(window.__u4KeysBound)return;
    window.__u4KeysBound=true;
    document.addEventListener("keydown",e=>{
      const tag=(document.activeElement?.tagName||"").toLowerCase();
      const typing=["input","textarea","select"].includes(tag)||document.activeElement?.isContentEditable;
      if(e.key==="Escape"&&typeof closeCommandPalette==="function")closeCommandPalette();
      if(typing)return;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openCommandPalette();return}
      if(e.key==="/"){e.preventDefault();openCommandPalette();return}
      if(e.key.toLowerCase()==="c"){showPage("calendar");return}
      if(e.key.toLowerCase()==="p"){showPage("production");return}
      if(e.key.toLowerCase()==="n"){e.preventDefault();showPage("calendar");setTimeout(()=>typeof openScheduleModal==="function"&&openScheduleModal(),50)}
    });
  }

  function boot(){
    if(U4.mounted)return;
    U4.mounted=true;
    document.documentElement.dataset.ui="4";
    setDensity(U4.density);
    wrapCore();
    bindKeys();
    ensureDensityToggle();
    requestAnimationFrame(enhance);
    setInterval(()=>{if(document.hidden)return;updateNavSignals();if(window.currentPage==="overview")overviewAttention()},15000);
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
})();