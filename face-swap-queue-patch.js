(()=>{
  if(window.__cloudentFaceSwapQueuePatchV2)return;
  window.__cloudentFaceSwapQueuePatchV2=true;

  const selected=new Set();
  let bulkBusy=false;

  function data(){try{return typeof faceSwapData!=="undefined"?faceSwapData:null}catch{return null}}
  function jobs(){return Array.isArray(data()?.jobs)?data().jobs:[]}
  function productionStarted(job){
    const p=job?.production||{};
    return Boolean(
      job?.production_job_id||
      job?.meta?.production_job_id||
      p?.id||
      String(p?.status||"").trim()
    );
  }
  function processing(job){
    const a=String(job?.status||"");
    const b=String(job?.production?.status||"");
    return ["uploading","queued","running","processing"].includes(a)||["uploading","queued","running","processing"].includes(b);
  }
  function visibleJobs(){return jobs().filter(j=>!productionStarted(j))}
  function toastSafe(msg,type="ok"){try{if(typeof toast==="function")toast(msg,type)}catch{}}

  async function refresh(){
    try{if(typeof loadFaceSwapData==="function")await loadFaceSwapData()}catch{}
    try{if(typeof faceSwapPage==="function")faceSwapPage()}catch{}
    setTimeout(decorate,0);
  }

  async function cancelIfNeeded(job){
    if(!processing(job))return;
    try{
      await cloudFetch("?action=face-swap-job",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:job.id,operation:"cancel"})
      });
    }catch{}
  }

  async function removeJob(job){
    try{
      await cloudFetch("?action=face-swap-job",{
        method:"DELETE",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:job.id})
      });
      return true;
    }catch(first){
      await cancelIfNeeded(job);
      await cloudFetch("?action=face-swap-job",{
        method:"DELETE",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:job.id})
      });
      return true;
    }
  }

  window.cloudentPauseFaceSwap=async function(id,button){
    if(!id||bulkBusy)return;
    if(button){button.disabled=true;button.textContent="Pausando…"}
    try{
      await cloudFetch("?action=face-swap-job",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,operation:"cancel"})});
      toastSafe("Job pausado.");
      await refresh();
    }catch(e){toastSafe(e?.message||"Não foi possível pausar.","err");if(button){button.disabled=false;button.textContent="⏸ Pausar"}}
  };

  window.cloudentResumeFaceSwap=async function(id,button){
    if(!id||bulkBusy)return;
    if(button){button.disabled=true;button.textContent="Retomando…"}
    try{
      await cloudFetch("?action=face-swap-job",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,operation:"retry"})});
      toastSafe("Job retomado.");
      await refresh();
    }catch(e){toastSafe(e?.message||"Não foi possível retomar.","err");if(button){button.disabled=false;button.textContent="▶ Retomar"}}
  };

  window.cloudentDeleteFaceSwapNow=async function(id){
    if(!id||bulkBusy)return;
    const job=jobs().find(j=>String(j.id)===String(id));
    if(!job)return;
    if(!confirm("Excluir este item do Face Swap?"))return;
    bulkBusy=true;decorateToolbar();
    try{await removeJob(job);selected.delete(String(id));toastSafe("Item excluído.")}catch(e){toastSafe(e?.message||"Não foi possível excluir.","err")}
    bulkBusy=false;await refresh();
  };

  window.cloudentToggleFaceSwapSelection=function(id,checked){if(checked)selected.add(String(id));else selected.delete(String(id));decorateToolbar()};
  window.cloudentFaceSwapSelectAll=function(checked){
    const list=visibleJobs();
    if(checked)list.forEach(j=>selected.add(String(j.id)));else list.forEach(j=>selected.delete(String(j.id)));
    document.querySelectorAll('.cloudent-fs-select').forEach(el=>el.checked=checked);
    decorateToolbar();
  };

  window.cloudentFaceSwapBulkDelete=async function(){
    const list=visibleJobs().filter(j=>selected.has(String(j.id)));
    if(!list.length)return;
    if(!confirm("Excluir "+list.length+" item(ns) selecionado(s)?"))return;
    bulkBusy=true;decorateToolbar();
    let ok=0,fail=0;
    for(const job of list){try{await removeJob(job);selected.delete(String(job.id));ok++}catch{fail++}}
    bulkBusy=false;toastSafe(fail?ok+" excluído(s), "+fail+" falhou(aram).":ok+" item(ns) excluído(s).",fail?"err":"ok");
    await refresh();
  };

  window.cloudentFaceSwapDeleteAll=async function(){
    const list=visibleJobs();
    if(!list.length){toastSafe("A fila já está vazia.","warn");return}
    if(!confirm("Apagar TODOS os "+list.length+" job(s) que ainda estão no Face Swap?"))return;
    bulkBusy=true;decorateToolbar();
    let ok=0,fail=0;
    for(const job of list){try{await removeJob(job);selected.delete(String(job.id));ok++}catch{fail++}}
    bulkBusy=false;toastSafe(fail?ok+" apagado(s), "+fail+" falhou(aram).":"Fila do Face Swap limpa.",fail?"err":"ok");
    await refresh();
  };

  window.cloudentFaceSwapBulkPause=async function(){
    const list=visibleJobs().filter(j=>selected.has(String(j.id))&&processing(j));
    if(!list.length){toastSafe("Nenhum selecionado está processando.","warn");return}
    bulkBusy=true;decorateToolbar();
    let ok=0,fail=0;
    for(const job of list){try{await cloudFetch("?action=face-swap-job",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:job.id,operation:"cancel"})});ok++}catch{fail++}}
    bulkBusy=false;toastSafe(fail?ok+" pausado(s), "+fail+" falhou(aram).":ok+" item(ns) pausado(s).",fail?"err":"ok");
    await refresh();
  };

  function injectStyle(){
    let style=document.getElementById("cloudent-face-swap-queue-patch-style");
    if(style)style.remove();
    style=document.createElement("style");
    style.id="cloudent-face-swap-queue-patch-style";
    style.textContent=`
      .cloudent-fs-toolbar{display:flex!important;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 12px;padding:10px;border:1px solid #252525;border-radius:11px;background:#0b0b0b}
      .cloudent-fs-toolbar label{display:flex;align-items:center;gap:7px;color:#aaa;font-size:8px;font-weight:800;cursor:pointer;margin-right:auto}
      .cloudent-fs-toolbar button{min-height:34px;padding:0 11px;border:1px solid #303030;border-radius:8px;background:#141414;color:#ddd;font-size:8px;font-weight:850;cursor:pointer}
      .cloudent-fs-toolbar button:disabled{opacity:.42;cursor:not-allowed}.cloudent-fs-toolbar .danger{color:#ff858b;border-color:#4a282c}.cloudent-fs-toolbar .danger-all{background:#211012!important}
      .cloudent-fs-select-wrap{display:inline-flex!important;align-items:center;gap:5px;padding:6px 8px!important;border:1px solid #2b2b2b;border-radius:7px;background:#101010;color:#969696;font-size:7px!important;cursor:pointer}
      .cloudent-fs-select-wrap input,.cloudent-fs-toolbar input{accent-color:#fff}.cloudent-fs-pause{color:#e8d48b!important}.cloudent-fs-resume{color:#90e7ac!important}.cloudent-fs-force-delete{color:#ff858b!important}
      .face-swap-job[data-cloudent-hidden-production="1"]{display:none!important}
      @media(max-width:760px){.cloudent-fs-toolbar{position:sticky;top:8px;z-index:15}.cloudent-fs-toolbar label{width:100%;margin:0}.cloudent-fs-toolbar button{flex:1;min-width:120px}}
    `;
    document.head.appendChild(style);
  }

  function queueCard(){
    const box=document.querySelector('.face-swap-jobs');
    if(!box)return null;
    return box.closest('.face-swap-card')||box.parentElement;
  }

  function decorateToolbar(){
    const box=document.querySelector('.face-swap-jobs');
    const card=queueCard();
    if(!box||!card)return;
    let bar=card.querySelector('.cloudent-fs-toolbar');
    if(!bar){bar=document.createElement('div');bar.className='cloudent-fs-toolbar';box.before(bar)}
    const list=visibleJobs();
    for(const id of [...selected])if(!list.some(j=>String(j.id)===String(id)))selected.delete(id);
    const count=[...selected].length;
    const all=list.length>0&&count===list.length;
    bar.innerHTML=`<label><input type="checkbox" ${all?'checked':''} onchange="cloudentFaceSwapSelectAll(this.checked)"> Selecionar todos <span>(${count}/${list.length})</span></label>`+
      `<button ${count?'':'disabled'} onclick="cloudentFaceSwapBulkPause()">⏸ Pausar selecionados</button>`+
      `<button class="danger" ${count?'':'disabled'} onclick="cloudentFaceSwapBulkDelete()">Excluir selecionados</button>`+
      `<button class="danger danger-all" ${list.length?'':'disabled'} onclick="cloudentFaceSwapDeleteAll()">🗑 Apagar tudo</button>`;
    if(bulkBusy)bar.querySelectorAll('button,input').forEach(el=>el.disabled=true);
    const head=card.querySelector('.ui3-panel-head h3');if(head)head.textContent=list.length+' job'+(list.length===1?'':'s');
  }

  function decorateRows(){
    const list=jobs();
    const rows=[...document.querySelectorAll('.face-swap-jobs .face-swap-job')];
    rows.forEach((row,index)=>{
      const job=list[index];if(!job)return;
      const id=String(job.id||'');row.dataset.cloudentJobId=id;
      const rowText=(row.textContent||'').toLowerCase();
      if(productionStarted(job)||rowText.includes('motion concluído')||rowText.includes('vídeo final pronto')){
        row.dataset.cloudentHiddenProduction='1';selected.delete(id);return;
      }
      delete row.dataset.cloudentHiddenProduction;
      const actions=row.querySelector('.face-swap-job-actions');if(!actions)return;
      if(!actions.querySelector('.cloudent-fs-select-wrap')){
        const label=document.createElement('label');label.className='cloudent-fs-select-wrap';label.innerHTML=`<input class="cloudent-fs-select" type="checkbox" ${selected.has(id)?'checked':''}>Selecionar`;
        label.querySelector('input').addEventListener('change',e=>window.cloudentToggleFaceSwapSelection(id,e.target.checked));actions.prepend(label);
      }
      if(processing(job)&&!actions.querySelector('.cloudent-fs-pause')){const b=document.createElement('button');b.className='cloudent-fs-pause';b.textContent='⏸ Pausar';b.onclick=()=>window.cloudentPauseFaceSwap(id,b);actions.appendChild(b)}
      if(String(job.status||'')==='cancelled'){
        const retry=[...actions.querySelectorAll('button')].find(b=>/Refazer Face Swap/i.test(b.textContent||''));
        if(retry){retry.textContent='▶ Retomar';retry.classList.add('cloudent-fs-resume');retry.onclick=()=>window.cloudentResumeFaceSwap(id,retry)}
      }
      if(![...actions.querySelectorAll('button')].some(b=>/^(Excluir|🗑)/i.test((b.textContent||'').trim()))){const b=document.createElement('button');b.className='danger cloudent-fs-force-delete';b.textContent='Excluir';b.onclick=()=>window.cloudentDeleteFaceSwapNow(id);actions.appendChild(b)}
    });
  }

  function decorate(){injectStyle();if(!document.querySelector('.face-swap-jobs'))return;decorateRows();decorateToolbar()}
  let queued=false;const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;decorate()})};
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
  setInterval(()=>{if(document.querySelector('.face-swap-jobs'))decorate()},1500);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule);else schedule();
})();
