/* Shared presentation controls. Generation, storage and scheduling stay native. */
(()=>{
  const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const user=()=>typeof cloudSession==='undefined'?'':cloudSession?.user?.id||'';
  let owner=user(),selected='',mode='',revision=0,mediaURL='',dockNode=null;
  let modelFilter='all';
  const models=[{id:'jujuh',name:'Jujuh'},{id:'sahry_japah',name:'Sahry Japah'},{id:'sahry_gravida',name:'Sahry Grávida'}];
  const normalizeModel=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  function modelOf(job){
    const m=job.meta||{},id=m.character_id||m.character?.id;
    if(id)return models.some(c=>c.id===id)?id:'';
    const aliases={jujuh:'jujuh','sahry japah':'sahry_japah','sahry gravida':'sahry_gravida','sahry gravidinha':'sahry_gravida'};
    const name=aliases[normalizeModel(m.character_name||m.character?.name)];if(name)return name;
    const tags=new Set((Array.isArray(m.tags)?m.tags:[]).map(t=>aliases[normalizeModel(t)]).filter(Boolean));
    return tags.size===1?[...tags][0]:'';
  }
  function filterRows(rows){if(owner!==user())modelFilter='all';return modelFilter==='all'?rows:rows.filter(j=>modelOf(j)===modelFilter);}
  function setModelFilter(id){
    if(id!=='all'&&!models.some(m=>m.id===id)||id===modelFilter)return;
    modelFilter=id;selected='';dockNode=null;revision++;releaseMedia();
    if(typeof productionSelectedJobs!=='undefined')productionSelectedJobs.clear();
    if(typeof productionPage==='function')productionPage();
  }
  const busyButtons=new WeakSet();
  function busy(button,value){
    if(!button)return;
    if(value){button.dataset.studioDisabled=String(button.disabled);button.disabled=true;button.setAttribute('aria-busy','true');}
    else{button.disabled=button.dataset.studioDisabled==='true';delete button.dataset.studioDisabled;button.removeAttribute('aria-busy');}
  }
  function comparison(container,before,after){
    container.innerHTML='<div class="studio-compare" style="--split:50%"><img class="studio-compare-after" alt="Resultado"><div class="studio-compare-before"><img alt="Original"></div><span class="studio-compare-label before">Original</span><span class="studio-compare-label after">Resultado</span><div class="studio-compare-line"><span>‹ ›</span></div><input type="range" min="0" max="100" value="50" step="1" aria-label="Comparar original e resultado"></div><p class="studio-compare-hint">Arraste a linha para comparar</p>';
    const canvas=container.querySelector('.studio-compare'),images=canvas.querySelectorAll('img'),range=canvas.querySelector('input');
    images[0].src=after;images[1].src=before;
    range.addEventListener('input',()=>canvas.style.setProperty('--split',range.value+'%'));
    images[0].addEventListener('load',()=>{if(images[0].naturalWidth&&images[0].naturalHeight)canvas.style.aspectRatio=images[0].naturalWidth+'/'+images[0].naturalHeight;},{once:true});
    for(const img of images)img.addEventListener('error',()=>{container.innerHTML='<p class="studio-empty" role="status">Não foi possível carregar a comparação. Tente abrir o resultado novamente.</p>';},{once:true});
  }
  function releaseMedia(){if(mediaURL){URL.revokeObjectURL(mediaURL);mediaURL='';}}
  function modeJobs(){
    if(typeof productionData==='undefined')return [];
    const scope=typeof productionPanelScope==='function'?productionPanelScope():'production_standard';
    const rows=typeof panelVisibleRows==='function'?panelVisibleRows(scope,productionData?.jobs||[]):productionData?.jobs||[];
    const motion=document.getElementById('production')?.classList.contains('motion-control-mode');
    return rows.filter(j=>(j.meta?.workflow_key==='motion_control')===!!motion);
  }
  function currentJobs(){return filterRows(modeJobs());}
  function resultMarkup(job){
    return '<div class="studio-result-head"><div><span class="studio-eyebrow">RESULTADO</span><h3>'+safe(job?.meta?.character_name||'Prévia do vídeo')+'</h3></div></div><div class="studio-result-canvas" data-studio-canvas>'+(job?'<button type="button" class="studio-play" data-studio-play="'+safe(job.id)+'" aria-label="Carregar e reproduzir vídeo final"><span>▶</span><b>Ver vídeo final</b><small>Carregar prévia</small></button>':'<div class="studio-empty"><span>▷</span><b>Seu resultado aparece aqui</b><p>Selecione um vídeo concluído na lista abaixo.</p></div>')+'</div><p class="studio-result-name">'+safe(job?.original_file_name||'Vídeo + frame → resultado')+'</p>'+(job?'<div class="studio-result-actions"><button class="btn" type="button" onclick="previewProductionJob(\''+safe(job.id)+'\')">Ampliar</button><button class="btn" type="button" onclick="downloadProductionResult(\''+safe(job.id)+'\',1)">Baixar vídeo</button><button class="btn" type="button" onclick="openProductionScheduleModal(\''+safe(job.id)+'\',1)">Calendário</button></div>':'');
  }
  function showProduction(id){
    const root=document.getElementById('production'),dock=root?.querySelector('.studio-production-result');
    if(!dock)return;
    const job=currentJobs().find(j=>j.id===id&&j.status==='ready');
    selected=job?.id||'';revision++;releaseMedia();dock.innerHTML=resultMarkup(job);
    root.querySelectorAll('[data-studio-select]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.studioSelect===selected)));
  }
  async function playProduction(button){
    if(busyButtons.has(button))return;busyButtons.add(button);busy(button,true);
    const uid=user(),r=++revision,id=button.dataset.studioPlay;
    try{
      const url=await getProductionResultBlobUrl(id,'preview-'+id.slice(0,8)+'.mp4');
      if(uid!==user()||r!==revision||!button.isConnected){URL.revokeObjectURL(url);return;}
      releaseMedia();mediaURL=url;
      const canvas=button.closest('[data-studio-canvas]');canvas.innerHTML='<video controls playsinline preload="metadata" aria-label="Vídeo final"></video>';
      const video=canvas.querySelector('video');video.src=url;video.play().catch(()=>{});
    }catch(err){if(uid===user()&&button.isConnected)toast(err.message,'err');}
    finally{busyButtons.delete(button);busy(button,false);}
  }
  function enhanceProduction(){
    const root=document.getElementById('production');if(!root||typeof currentPage==='undefined'||currentPage!=='production')return;
    if(owner!==user()){owner=user();modelFilter='all';selected='';dockNode=null;revision++;releaseMedia();}
    const nextMode=root.classList.contains('motion-control-mode')?'motion':'standard';
    if(mode!==nextMode){mode=nextMode;selected='';dockNode=null;revision++;releaseMedia();}
    root.classList.add('studio-page');
    const queue=root.querySelector('.production-queue');
    if(queue&&!root.querySelector('.studio-model-filters')){
      const all=modeJobs(),bar=document.createElement('div');bar.className='studio-model-filters';
      bar.setAttribute('role','group');bar.setAttribute('aria-label','Filtrar vídeos por modelo');
      bar.innerHTML=[{id:'all',name:'Todos'},...models].map(m=>'<button type="button" class="btn" data-studio-model="'+m.id+'" aria-pressed="'+(modelFilter===m.id)+'">'+m.name+'<span>'+ (m.id==='all'?all.length:all.filter(j=>modelOf(j)===m.id).length)+'</span></button>').join('')+(all.some(j=>!modelOf(j))?'<small>Vídeos sem modelo identificada aparecem em Todos.</small>':'');
      queue.before(bar);
    }
    // Global cleanup endpoints do not accept a model. Require Todos for those actions.
    root.querySelectorAll('[data-panel-clear],button[onclick*="clearCompletedProductionJobs"]').forEach(b=>{
      if(modelFilter!=='all'){b.disabled=true;b.title='Selecione Todos para limpar a aba inteira.';}
    });
    if(!root.dataset.modelFilterNative&&modelFilter!=='all')root.querySelectorAll('input[onchange*="toggleAllReadyProduction"]').forEach(b=>b.disabled=true);
    const filteredIds=new Set(currentJobs().map(j=>String(j.id)));
    const countHeading=root.querySelector('.production-queue-card .ui3-panel-head h3');if(countHeading)countHeading.textContent=filteredIds.size+' vídeo(s)';
    if(!filteredIds.size&&modelFilter!=='all'){
      const empty=root.querySelector('.production-empty b');if(empty)empty.textContent='Nenhum vídeo desta modelo neste fluxo';
    }
    const head=root.querySelector('.production-head');if(head?.querySelector('h2'))head.querySelector('h2').textContent='Produção IA';
    const subtitle=head?.querySelector('p');if(subtitle)subtitle.textContent='Prepare seus arquivos, acompanhe a fila e confira o resultado.';
    root.querySelectorAll('.production-workflow-tab').forEach((b,i)=>{b.textContent=i?'Motion Control v7':'Vídeo 7 minutos';b.setAttribute('role','tab');b.setAttribute('aria-selected',String(b.classList.contains('active')));});
    for(const [selector,label,kind] of [['#productionVideoBox','Vídeo de referência','video'],['#productionFrameBox','Frame / personagem','frame']]){
      const box=root.querySelector(selector),title=box?.querySelector('.production-upload-title'),meta=box?.querySelector('.production-upload-meta');
      if(title)title.textContent=label;
      if(meta)meta.textContent=typeof productionDraft!=='undefined'&&productionDraft?.[kind]?fmtSize(productionDraft[kind].size)+' · clique para trocar':'Clique para escolher o arquivo';
    }
    const note=root.querySelector('.production-note');if(note)note.textContent='O processamento continua no servidor. Acompanhe as etapas na fila abaixo.';
    const upload=root.querySelector('.production-main-grid');
    if(upload&&!root.querySelector('.studio-workspace')){
      const workspace=document.createElement('div');workspace.className='studio-workspace';upload.before(workspace);workspace.append(upload);
      const keepResult=dockNode&&selected&&currentJobs().some(j=>j.id===selected&&j.status==='ready');
      const dock=keepResult?dockNode:document.createElement('aside');dock.className='card studio-production-result';dock.setAttribute('aria-label','Resultado selecionado');workspace.append(dock);dockNode=dock;
      const heading=upload.querySelector('h3');if(heading)heading.textContent='Preparar geração';
      const add=upload.querySelector('.production-add-btn');if(add&&!add.disabled)add.textContent='Adicionar à fila';
      const diagnostics=document.createElement('details');diagnostics.className='studio-diagnostics';diagnostics.innerHTML='<summary>Controles da fila e informações de uso</summary>';
      const items=root.querySelectorAll('.runninghub-commandbar,.production-stats,.production-cost-dashboard,.motion-workflow-map,.motion-workflow-state');
      if(items.length){workspace.after(diagnostics);items.forEach(el=>diagnostics.append(el));}
      for(const [selector,label] of [['#productionVideoBox','Vídeo de referência'],['#productionFrameBox','Frame / personagem']]){
        const box=root.querySelector(selector),title=box?.querySelector('.production-upload-title');if(title)title.textContent=label;
        if(box){box.tabIndex=0;box.setAttribute('role','button');box.setAttribute('aria-label','Escolher ou trocar '+label.toLowerCase());box.addEventListener('keydown',evt=>{if(evt.target===box&&(evt.key==='Enter'||evt.key===' ')){evt.preventDefault();box.querySelector('input')?.click();}});}
      }
      const jobs=currentJobs();if(!jobs.some(j=>j.id===selected&&j.status==='ready'))selected=jobs.find(j=>j.status==='ready')?.id||'';
      if(!keepResult)showProduction(selected);
    }
    root.querySelectorAll('.production-job').forEach(row=>{
      if(!row.dataset.productionId)row.dataset.productionId=row.querySelector('[data-id]')?.dataset.id||'';
      const id=row.dataset.productionId,job=currentJobs().find(j=>j.id===id);
      row.hidden=!filteredIds.has(String(id));
      const actions=row.querySelector('.production-job-actions');
      const frame=row.querySelector('.production-media-cell.frame');
      if(frame&&actions){frame.className='btn studio-frame-action';frame.textContent='Ver frame';actions.append(frame);}
      if(job?.meta?.character_name&&!row.querySelector('.studio-identity')){const tag=document.createElement('span');tag.className='studio-identity';tag.textContent=job.meta.character_name;row.querySelector('.production-job-state')?.prepend(tag);}
      if(job?.status==='ready'&&!row.querySelector('[data-studio-select]')){
        const b=document.createElement('button');b.type='button';b.className='btn studio-select-result';b.dataset.studioSelect=id;b.textContent='Ver no painel';b.setAttribute('aria-pressed',String(selected===id));row.querySelector('.production-job-actions')?.prepend(b);
      }
      if(actions&&!actions.querySelector('.studio-more-actions')){
        const advanced=[...actions.querySelectorAll('button,label')].filter(el=>el.matches('label')||/teste|lote|excluir/i.test(el.textContent));
        if(advanced.length){const more=document.createElement('details');more.className='studio-more-actions';more.innerHTML='<summary>Mais ações</summary><div></div>';advanced.forEach(el=>more.lastChild.append(el));actions.append(more);}
      }
    });
  }
  // Wrap only explicit async entry points; no document-wide delayed disabling.
  function installFeedback(){
    for(const name of ['addProductionJob','previewProductionJob','downloadProductionResult','openProductionScheduleModal','controlRunningHub','productionAction']){
      const original=window[name];if(typeof original!=='function'||original.studioFeedback)continue;
      const wrapped=async function(...args){
        const b=document.activeElement?.closest?.('#production button');
        if(b&&busyButtons.has(b))return;
        if(b){busyButtons.add(b);b.setAttribute('aria-busy','true');}
        try{return await original.apply(this,args);}finally{if(b){busyButtons.delete(b);b.removeAttribute('aria-busy');}}
      };wrapped.studioFeedback=true;
      // These functions are declared by the existing classic SPA script.
      window[name]=wrapped;
    }
  }
  document.addEventListener('click',evt=>{
    const button=evt.target.closest('button');if(!button)return;
    if(button.dataset.studioSelect)showProduction(button.dataset.studioSelect);
    if(button.dataset.studioPlay)playProduction(button);
    if(button.dataset.studioModel)setModelFilter(button.dataset.studioModel);
  });
  let scheduled=false;
  const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;observer.disconnect();enhanceProduction();observe();});});
  function observe(){const root=document.getElementById('production');if(root)observer.observe(root,{childList:true,subtree:true});}
  observe();installFeedback();enhanceProduction();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)enhanceProduction();});
  setInterval(()=>{if(owner!==user()){owner=user();modelFilter='all';selected='';dockNode=null;revision++;releaseMedia();document.querySelector('.studio-production-result')?.replaceChildren();}},2000);
  window.CloudentStudio={comparison,busy,enhanceProduction,filterRows,currentJobs,setModelFilter,modelOf};
})();
