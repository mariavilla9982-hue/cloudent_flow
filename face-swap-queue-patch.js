(()=>{
  if(window.__cloudentFaceSwapQueuePatchV1)return;
  window.__cloudentFaceSwapQueuePatchV1=true;

  const selected=new Set();
  let bulkBusy=false;

  function getData(){
    try{return typeof faceSwapData!=="undefined"?faceSwapData:null}catch{return null}
  }
  function getJobs(){return Array.isArray(getData()?.jobs)?getData().jobs:[]}
  function isProcessing(job){
    const s=String(job?.status||"");
    const ps=String(job?.production?.status||"");
    return ["uploading","queued","running","processing"].includes(s)||["uploading","queued","running","processing"].includes(ps);
  }
  function isSentToProduction(job){return Boolean(job?.production_job_id)}
  function toastSafe(msg,type="ok"){
    try{if(typeof toast==="function")toast(msg,type)}catch{}
  }
  async function refresh(){
    try{if(typeof loadFaceSwapData==="function")await loadFaceSwapData()}catch{}
    try{if(typeof faceSwapPage==="function")faceSwapPage()}catch{}
    setTimeout(decorate,0);
  }

  window.cloudentPauseFaceSwap=async function(id,button){
    if(!id||bulkBusy)return;
    if(button){button.disabled=true;button.textContent="Pausando…"}
    try{
      await cloudFetch("?action=face-swap-job",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,operation:"cancel"})});
      toastSafe("Job pausado. Você pode retomar quando quiser.");
      await refresh();
    }catch(e){
      toastSafe(e?.message||"Não foi possível pausar o job.","err");
      if(button){button.disabled=false;button.textContent="⏸ Pausar"}
    }
  };

  window.cloudentResumeFaceSwap=async function(id,button){
    if(!id||bulkBusy)return;
    if(button){button.disabled=true;button.textContent="Retomando…"}
    try{
      await cloudFetch("?action=face-swap-job",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,operation:"retry"})});
      toastSafe("Job retomado.");
      await refresh();
    }catch(e){
      toastSafe(e?.message||"Não foi possível retomar o job.","err");
      if(button){button.disabled=false;button.textContent="▶ Retomar"}
    }
  };

  window.cloudentDeleteFaceSwapNow=async function(id){
    if(!id||bulkBusy)return;
    if(!confirm("Excluir este item do Face Swap agora?"))return;
    try{
      await cloudFetch("?action=face-swap-job",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});
      selected.delete(id);
      toastSafe("Item excluído do Face Swap.");
      await refresh();
    }catch(e){toastSafe(e?.message||"Não foi possível excluir o item.","err")}
  };

  window.cloudentToggleFaceSwapSelection=function(id,checked){
    if(checked)selected.add(id);else selected.delete(id);
    decorateToolbar();
  };

  async function bulkDelete(){
    const ids=[...selected];
    if(!ids.length)return;
    if(!confirm("Excluir "+ids.length+" item"+(ids.length===1?"":"s")+" selecionado"+(ids.length===1?"":"s")+" do Face Swap?"))return;
    bulkBusy=true;decorateToolbar();
    let ok=0,fail=0;
    for(const id of ids){
      try{
        await cloudFetch("?action=face-swap-job",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});
        selected.delete(id);ok++;
      }catch{fail++}
    }
    bulkBusy=false;
    toastSafe(fail?ok+" excluído(s), "+fail+" falhou(aram).":ok+" item(ns) excluído(s).",fail?"err":"ok");
    await refresh();
  }

  async function bulkPause(){
    const jobs=getJobs();
    const ids=[...selected].filter(id=>isProcessing(jobs.find(j=>String(j.id)===String(id))));
    if(!ids.length){toastSafe("Nenhum selecionado está processando.","err");return}
    bulkBusy=true;decorateToolbar();
    let ok=0,fail=0;
    for(const id of ids){
      try{
        await cloudFetch("?action=face-swap-job",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,operation:"cancel"})});ok++;
      }catch{fail++}
    }
    bulkBusy=false;
    toastSafe(fail?ok+" pausado(s), "+fail+" falhou(aram).":ok+" item(ns) pausado(s).",fail?"err":"ok");
    await refresh();
  }

  window.cloudentFaceSwapBulkDelete=bulkDelete;
  window.cloudentFaceSwapBulkPause=bulkPause;
  window.cloudentFaceSwapSelectAll=function(checked){
    const jobs=getJobs().filter(j=>!isSentToProduction(j));
    if(checked)jobs.forEach(j=>selected.add(String(j.id)));else jobs.forEach(j=>selected.delete(String(j.id)));
    document.querySelectorAll('.cloudent-fs-select').forEach(el=>{el.checked=checked});
    decorateToolbar();
  };

  function injectStyle(){
    if(document.getElementById("cloudent-face-swap-queue-patch-style"))return;
    const style=document.createElement("style");
    style.id="cloudent-face-swap-queue-patch-style";
    style.textContent=`
      .cloudent-fs-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 12px;padding:10px;border:1px solid #252525;border-radius:11px;background:#0b0b0b}
      .cloudent-fs-toolbar label{display:flex;align-items:center;gap:7px;color:#a8a8a8;font-size:8px;font-weight:800;cursor:pointer;margin-right:auto}
      .cloudent-fs-toolbar button{min-height:34px;padding:0 11px;border:1px solid #303030;border-radius:8px;background:#141414;color:#d7d7d7;font-size:8px;font-weight:800;cursor:pointer}
      .cloudent-fs-toolbar button:disabled{opacity:.42;cursor:not-allowed}.cloudent-fs-toolbar .danger{color:#ff858b;border-color:#46262a}
      .cloudent-fs-select-wrap{display:inline-flex!important;align-items:center;gap:5px;padding:6px 8px!important;border:1px solid #2b2b2b;border-radius:7px;background:#101010;color:#969696;font-size:7px!important;cursor:pointer}
      .cloudent-fs-select-wrap input,.cloudent-fs-toolbar input{accent-color:#fff}
      .cloudent-fs-pause{color:#e8d48b!important}.cloudent-fs-resume{color:#90e7ac!important}.cloudent-fs-force-delete{color:#ff858b!important}
      .face-swap-job[data-cloudent-hidden-production="1"]{display:none!important}
      @media(max-width:760px){.cloudent-fs-toolbar{position:sticky;top:8px;z-index:8}.cloudent-fs-toolbar label{width:100%;margin:0 0 2px}.cloudent-fs-toolbar button{flex:1}.cloudent-fs-select-wrap{flex:0 0 auto!important}}
    `;
    document.head.appendChild(style);
  }

  function decorateToolbar(){
    const jobsBox=document.querySelector('.face-swap-jobs');
    if(!jobsBox)return;
    const card=jobsBox.closest('.face-swap-card');
    if(!card)return;
    let bar=card.querySelector('.cloudent-fs-toolbar');
    if(!bar){
      bar=document.createElement('div');bar.className='cloudent-fs-toolbar';
      jobsBox.before(bar);
    }
    const visible=getJobs().filter(j=>!isSentToProduction(j));
    const count=[...selected].filter(id=>visible.some(j=>String(j.id)===String(id))).length;
    const all=visible.length>0&&count===visible.length;
    bar.innerHTML=`<label><input type="checkbox" ${all?'checked':''} onchange="cloudentFaceSwapSelectAll(this.checked)"> Selecionar todos <span>(${count}/${visible.length})</span></label>`+
      `<button ${count?'':'disabled'} onclick="cloudentFaceSwapBulkPause()">⏸ Pausar selecionados</button>`+
      `<button class="danger" ${count?'':'disabled'} onclick="cloudentFaceSwapBulkDelete()">Excluir selecionados</button>`;
    if(bulkBusy)bar.querySelectorAll('button,input').forEach(el=>el.disabled=true);

    const head=card.querySelector('.ui3-panel-head h3');
    if(head)head.textContent=visible.length+' job'+(visible.length===1?'':'s');
  }

  function decorateRows(){
    const jobs=getJobs();
    const rows=[...document.querySelectorAll('.face-swap-jobs .face-swap-job')];
    rows.forEach((row,index)=>{
      const job=jobs[index];
      if(!job)return;
      const id=String(job.id||'');
      row.dataset.cloudentJobId=id;
      if(isSentToProduction(job)){
        row.dataset.cloudentHiddenProduction='1';
        selected.delete(id);
        return;
      }
      delete row.dataset.cloudentHiddenProduction;
      const actions=row.querySelector('.face-swap-job-actions');
      if(!actions)return;

      if(!actions.querySelector('.cloudent-fs-select-wrap')){
        const label=document.createElement('label');
        label.className='cloudent-fs-select-wrap';
        label.innerHTML=`<input class="cloudent-fs-select" type="checkbox" ${selected.has(id)?'checked':''}>Selecionar`;
        label.querySelector('input').addEventListener('change',e=>window.cloudentToggleFaceSwapSelection(id,e.target.checked));
        actions.prepend(label);
      }else{
        const cb=actions.querySelector('.cloudent-fs-select');if(cb)cb.checked=selected.has(id);
      }

      const status=String(job.status||'');
      if(isProcessing(job)&&!actions.querySelector('.cloudent-fs-pause')){
        const b=document.createElement('button');b.className='cloudent-fs-pause';b.textContent='⏸ Pausar';b.onclick=()=>window.cloudentPauseFaceSwap(id,b);actions.appendChild(b);
      }
      if(status==='cancelled'){
        const retry=[...actions.querySelectorAll('button')].find(b=>/Refazer Face Swap/i.test(b.textContent||''));
        if(retry){retry.textContent='▶ Retomar';retry.classList.add('cloudent-fs-resume');retry.onclick=()=>window.cloudentResumeFaceSwap(id,retry)}
      }
      if(!actions.querySelector('.cloudent-fs-force-delete')){
        const hasExisting=[...actions.querySelectorAll('button')].some(b=>/^(Excluir|🗑)/i.test((b.textContent||'').trim()));
        if(!hasExisting){
          const b=document.createElement('button');b.className='danger cloudent-fs-force-delete';b.textContent='Excluir';b.onclick=()=>window.cloudentDeleteFaceSwapNow(id);actions.appendChild(b);
        }
      }
    });
  }

  function decorate(){
    injectStyle();
    if(!document.querySelector('.face-swap-jobs'))return;
    decorateRows();
    decorateToolbar();
  }

  let queued=false;
  const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;decorate()})};
  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule);else schedule();
})();
