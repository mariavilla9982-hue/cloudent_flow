(()=>{
  if(window.CloudentGenjutsu)return;
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let draft={},owner='',entries=[],jobs=[],busy=false,loading=false,timer=null,characters=[],readiness=null,lastCheck=0,revision=0;
  const previewCache=new Map(),verifiedMenus=new WeakSet(),pendingActions=new Set(),pendingRetries=new Set();
  let previewObserver=null,jobsMarkup='',mediaRevision=0,jobsRevision=0,retryingAll=false,refreshAgain=false;
  const active=()=>currentPage==='production'&&window.CloudentMotionControl?.mode==='genjutsu';
  const canSend=entry=>entry?.manualPrompt?.trim()?(readiness?.runninghub?.available??readiness?.ready)===true:readiness?.ready===true;
  const root=()=>document.querySelector('#production [data-genjutsu-root]');
  const request=(action,body,method='POST')=>cloudFetch('?action='+action,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  function reset(){
    const uid=cloudSession?.user?.id||'';if(uid===owner)return;
    if(document.querySelector('#modalHost [data-gen-modal]'))closeModal();
    owner=uid;revision++;mediaRevision++;pendingActions.clear();pendingRetries.clear();retryingAll=false;refreshAgain=false;previewCache.clear();previewObserver?.disconnect();jobsMarkup='';for(const entry of entries)URL.revokeObjectURL(entry.url);
    for(const key of ['url','frameUrl'])if(draft[key])URL.revokeObjectURL(draft[key]);draft={};
    entries=[];jobs=[];characters=[];readiness=null;lastCheck=0;loading=false;
  }
  function message(text,error=false){const box=root()?.querySelector(error?'[data-gen-error]':'[data-gen-status]');if(box)box.textContent=text;}
  function drawDraft(){
    const section=root();if(!section)return;
    for(const kind of ['video','frame']){
      const file=kind==='video'?draft.file:draft.frame,url=kind==='video'?draft.url:draft.frameUrl;
      const box=section.querySelector('[data-gen-drop="'+kind+'"]');if(!box)continue;
      box.classList.toggle('has-preview',!!file);
      const preview=box.querySelector('.production-upload-preview');
      const previewKey=file?url:'';
      if(preview.dataset.source!==previewKey){preview.dataset.source=previewKey;preview.innerHTML=file?(kind==='video'?'<video controls playsinline preload="metadata" src="'+e(url)+'"></video>':'<img alt="Frame da personagem" src="'+e(url)+'">'):'<span class="production-drop-icon">'+(kind==='video'?'▶':'▧')+'</span>';}
      box.querySelector('input').disabled=busy||!!draft.locked;
      box.querySelector('[data-clear]').disabled=busy;
      box.querySelector('.production-upload-meta').textContent=file?file.name:'Clique para escolher o arquivo';
    }
    const prompt=section.querySelector('[data-manual-prompt]');
    if(prompt){prompt.disabled=busy||!!draft.locked;if(prompt.value!==(draft.manualPrompt||''))prompt.value=draft.manualPrompt||'';}
    const button=section.querySelector('[data-send-manual]');if(button){button.disabled=busy||!canSend(draft);button.textContent=busy?'Enviando…':'Adicionar à fila';button.setAttribute('aria-busy',String(busy));}
    const error=section.querySelector('[data-draft-error]');if(error)error.textContent=draft.error||'';
  }
  async function sendManual(){
    if(busy)return;
    if(!draft.file||!draft.frame){message('Escolha o vídeo e o frame da personagem.',true);return;}
    if(!canSend(draft))return;
    draft.id=draft.id||crypto.randomUUID();draft.inputMode='manual_frame';
    const entry=draft;if(!entries.includes(entry))entries.push(entry);
    await send(entry);
    if(!entries.includes(entry)&&draft===entry){if(draft.frameUrl)URL.revokeObjectURL(draft.frameUrl);draft={};}
    drawDraft();
  }
  function drawEntries(){
    const list=root()?.querySelector('[data-gen-entries]');if(!list)return;
    list.innerHTML=entries.filter(item=>item.inputMode!=='manual_frame').map((item,i)=>'<article class="card" data-entry="'+item.id+'"><div class="toolbar"><strong>Vídeo '+(i+1)+' · '+e(item.file.name)+'</strong><button type="button" class="btn" data-remove="'+item.id+'" '+(busy?'disabled':'')+'>Remover</button></div><video controls playsinline preload="metadata" src="'+e(item.url)+'" style="max-width:100%;max-height:230px;margin:12px 0"></video><label>Modelo<select data-model="'+item.id+'" '+(busy||item.locked?'disabled':'')+'><option value="">Escolha a modelo</option>'+characters.map(c=>'<option value="'+e(c.id)+'" '+(item.character===c.id?'selected':'')+'>'+e(c.name)+'</option>').join('')+'</select></label>'+(item.error?'<p role="alert">'+e(item.error)+'</p>':'')+'</article>').join('');
    const button=root()?.querySelector('[data-send]');if(button){button.disabled=busy||!entries.some(x=>x.inputMode!=='manual_frame')||readiness?.ready!==true;button.textContent=busy?'Enviando…':'Adicionar à fila';button.setAttribute('aria-busy',String(busy));}
    const input=root()?.querySelector('[data-auto-videos]');if(input)input.disabled=busy;
    drawDraft();
  }
  function phase(job){
    const display=job.production?.genjutsu?.display;
    if(display?.key==='recovering')return 'Prompt · aguardando nova tentativa automática';
    if(display?.label)return display.label;
    const child=job.production,m=job.meta||{},state=child?.genjutsu;
    if(child?.result_video_id)return child.status==='ready'?'Vídeo pronto':'Vídeo salvo · encerrando task';
    if(child?.genjutsu?.stopRequested)return 'Genjutsu · aguardando parada';
    if(child?.status==='failed'||job.status==='failed')return 'Precisa de atenção';
    if(m.stage==='control_motion'){
      if(state?.phase==='provider_waiting')return 'Prompt · aguardando nova tentativa automática';
      if(state?.phase==='quota_waiting')return 'Aguardando cota do Gemini';
      if(state?.phase==='generating')return 'Gemini · preparando prompt';
      if(state?.phase==='processing'||state?.phase==='preparing')return 'Gemini · analisando as mídias';
      if(child?.status==='running')return 'Genjutsu · gerando vídeo';
      if(child?.status==='queued')return 'Na fila da RunningHub';
      return state?.phase==='complete'?'Prompt pronto · aguardando vaga':'Na fila do Gemini';
    }
    if(m.stage==='upscale')return job.status==='waiting'?'Na fila do Upscale':'Preparando foto · Upscale';
    if(m.stage==='face_swap')return job.status==='waiting'?'Na fila do Face Swap':'Preparando foto · Face Swap';
    if(m.stage==='frame_ready')return 'Frame pronto · aguardando a fila';
    return 'Preparando envio';
  }
  function retryMarkup(job){
    const p=job.production,d=p?.genjutsu?.display;
    const waiting=d?d.key==='recovering':p?.status==='motion_waiting'&&['provider_waiting','quota_waiting'].includes(p?.genjutsu?.phase);
    const at=Date.parse(d?.retryAt||p?.genjutsu?.retryAt||'');
    return waiting&&Number.isFinite(at)?'<small class="genjutsu-retry" data-gen-retry="'+at+'"></small>':'';
  }
  function elapsedMarkup(job,terminal){
    const p=job.production,d=p?.genjutsu?.display;
    const start=Date.parse(d?.executionStartedAt||p?.started_at),end=Date.parse(d?.completedAt||p?.completed_at);
    const execution=(d?d.executionConfirmed:p?.execution_confirmed)&&Number.isFinite(start);
    const clock=execution?'<span class="genjutsu-elapsed" data-gen-start="'+start+'" data-gen-end="'+(Number.isFinite(end)?end:0)+'" data-gen-done="'+(terminal?'1':'0')+'"></span>':
      '<span class="genjutsu-elapsed">'+(terminal?'Execução · não iniciada':'Execução · aguardando início')+'</span>';
    const wait=Date.parse(d?.waitingStartedAt||p?.created_at||job.created_at),waitEnd=Date.parse(d?.waitingEndedAt||p?.started_at||(terminal?p?.completed_at:null));
    return clock+(Number.isFinite(wait)?'<span class="genjutsu-wait" data-gen-wait="'+wait+'" data-gen-wait-end="'+(Number.isFinite(waitEnd)?waitEnd:0)+'">Espera · 00:00</span>':'');
  }
  function tickElapsed(){
    if(!active()||document.hidden)return;
    const format=seconds=>{const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return (h?String(h).padStart(2,'0')+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');};
    for(const el of root()?.querySelectorAll?.('[data-gen-retry]')||[]){
      const seconds=Math.max(0,Math.ceil((Number(el.dataset.genRetry)-Date.now())/1000));
      el.textContent=seconds?'Próxima tentativa do prompt em '+format(seconds):'Retomada do prompt pendente · aguardando o servidor';
    }
    for(const el of root()?.querySelectorAll?.('[data-gen-wait]')||[])el.textContent='Espera · '+format(Math.max(0,Math.floor(((Number(el.dataset.genWaitEnd)||Date.now())-Number(el.dataset.genWait))/1000)));
    for(const el of root()?.querySelectorAll?.('[data-gen-start]')||[]){
      const seconds=Math.max(0,Math.floor(((Number(el.dataset.genEnd)||Date.now())-Number(el.dataset.genStart))/1000));
      const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
      el.textContent=(el.dataset.genDone==='1'?'Tempo total · ':'Decorrido · ')+(h?String(h).padStart(2,'0')+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
    }
  }
  function canRetry(job){
    const child=job.production;
    return !job.meta?.dispatch_uncertain&&(job.meta?.stage==='control_motion'
      ?child?.status==='failed'&&child.genjutsu?.canRetry
      :job.status==='failed'&&job.meta?.provider_failed);
  }
  function drawJobs(){
    const section=root(),node=section?.querySelector('[data-gen-jobs]');if(!node)return;
    const count=section.querySelector('[data-gen-count]');if(count)count.textContent=jobs.length+' vídeo(s)';
    const retryAll=section.querySelector('[data-retry-all]');
    if(retryAll){
      const failedCount=jobs.filter(canRetry).length;
      retryAll.hidden=!failedCount&&!retryingAll;retryAll.disabled=retryingAll||!!pendingRetries.size;
      retryAll.textContent=retryingAll?'Retomando…':'Tentar todos novamente ('+failedCount+')';
      retryAll.setAttribute('aria-busy',String(retryingAll));
    }
    const markup=jobs.map((job,i)=>{
      const child=job.production,hasResult=!!child?.result_video_id,failed=child?.status==='failed'||job.status==='failed';
      const retry=canRetry(job),retrying=pendingRetries.has(job.id);
      const cancelled=job.status==='cancelled'||child?.status==='cancelled';
      const stopping=!!child?.genjutsu?.stopRequested;
      const finished=child?.status==='ready'||job.status==='ready'||cancelled;
      const old503=(child?.last_error||job.last_error)==='Gemini recusou a operação (HTTP 503).';
      const error=old503?'Gemini temporariamente indisponível (503). Seus arquivos foram preservados.':child?.last_error||job.last_error;
      const state=cancelled?'cancelled':failed?'failed':finished?'ready':child?.status==='running'?'running':'waiting';
      const label=retrying?'Retomando…':cancelled?'Cancelado':phase(job);
      const canStop=!finished&&!failed&&!stopping&&job.meta?.stage==='control_motion';
      const live=!finished&&!failed,d=child?.genjutsu?.display;
      const activity=live&&(d?d.activity:['generating','processing','preparing'].includes(child?.genjutsu?.phase)||['uploading','running'].includes(child?.status));
      const value=d?.progress,validProgress=live&&value&&Number.isFinite(value.value)&&Number.isFinite(value.max)&&value.max>0;
      const progress=validProgress?Math.round(value.value/value.max*100):null;
      const bar=live?'<div class="production-progress genjutsu-track '+(activity&&!validProgress?'indeterminate animated':'')+' '+(!activity?'is-waiting':'')+'" role="progressbar" aria-label="'+e(label)+'"'+(validProgress?' aria-valuemin="0" aria-valuemax="'+value.max+'" aria-valuenow="'+value.value+'"':'')+' aria-valuetext="'+e(label)+'"><i'+(validProgress?' style="width:'+progress+'%"':'')+'></i></div>':'';
      const execution=Boolean(d?.executionConfirmed??child?.execution_confirmed);
      const steps=activity&&execution&&child?.status==='running'
        ?'<small class="studio-active-steps">Prompt ✓ <span aria-hidden="true">→</span> <b>Gerando vídeo</b> <span aria-hidden="true">→</span> Resultado</small>':'';
      const detail=validProgress?'<small class="genjutsu-node-progress">Etapa atual · node '+e(value.node)+' · '+value.value+'/'+value.max+'</small>':'';
      const id=e(job.id),n=jobs.length-i,model=job.meta?.character_name||(job.meta?.input_mode==='manual_frame'?'Frame enviado':'Modelo');
      const media=job.media,hasFrame=media?.frame!==false,hasOriginal=media?.original!==false;
      const actions=(hasResult?'<button type="button" class="btn" data-download="'+id+'">Baixar vídeo</button>':'')+
        (hasFrame?'<button type="button" class="btn studio-frame-action" data-frame="'+id+'">Ver frame</button><button type="button" class="btn" hidden data-verified-frame data-download-frame="'+id+'">Baixar frame</button><small data-missing-frame hidden>Frame indisponível</small>':'<small>Frame indisponível</small>')+
        (hasOriginal?'<button type="button" class="btn" data-original="'+id+'">Vídeo original</button><button type="button" class="btn" hidden data-verified-original data-download-original="'+id+'">Baixar vídeo original</button>':'')+
        (failed&&media?.reuseOriginal?'<button type="button" class="btn" hidden data-verified-original data-use-video="'+id+'">Usar vídeo</button>':'')+
        (failed&&media?.reuseFrame?'<button type="button" class="btn" hidden data-verified-frame data-use-frame="'+id+'">Usar frame</button>':'')+
        '<button type="button" class="btn" data-prompt="'+id+'">Visualizar prompt</button>'+
        (child?.status==='ready'?'<button type="button" class="btn" data-trial="'+id+'">Reels Teste</button><button type="button" class="btn" data-bulk="'+id+'">Mandar para lote</button>':'')+
        (canStop?'<button type="button" class="btn danger" data-stop="'+id+'">Parar</button>':'')+
        (finished||failed?'<button type="button" class="btn danger" data-delete="'+id+'">Excluir</button>':'');
      return '<article class="production-job genjutsu-card '+(finished?'is-complete':'')+'" data-studio-state="'+(activity?'active':state==='cancelled'?'failed':state)+'" data-gen-state="'+e(d?.key||state)+'" data-gen-job="'+id+'">'+
        '<div class="production-job-num">'+String(n).padStart(2,'0')+'</div>'+
        '<button type="button" class="production-media-cell" '+(hasResult?'data-preview':'data-original')+'="'+id+'" aria-label="'+(hasResult?'Ver resultado':'Ver vídeo original')+' · Vídeo '+n+'" title="'+e(job.meta?.source_file_name||job.original_file_name)+'">'+
        '<span class="production-media-preview-shell" data-job-media="'+id+'" style="width:42px;height:58px;overflow:hidden"><span class="genjutsu-preview-placeholder">▶</span></span><div><b>Vídeo '+n+'</b><small>'+e(model)+'</small></div></button>'+
        '<div class="production-job-state">'+(job.meta?.character_name?'<span class="studio-identity studio-model-tag" data-character="'+e(window.CloudentStudio?.modelOf?.(job)||job.meta?.character_id||job.meta?.character?.id||'')+'">'+e(job.meta.character_name)+'</span>':'')+bar+
        '<span class="production-status '+state+'" role="status">'+(activity?'<i class="genjutsu-activity" aria-hidden="true"></i>':'')+e(label)+'</span>'+steps+detail+retryMarkup(job)+
        (!finished?'<div class="genjutsu-times">'+elapsedMarkup(job,failed||cancelled)+'</div>':'')+
        (error?'<em role="alert" title="'+e(error)+'">'+e(error)+'</em>':'')+'</div>'+
        '<div class="production-job-actions">'+(hasResult?'<button type="button" class="btn studio-select-result" data-preview="'+id+'">Ver resultado</button>':'')+
                (child?.status==='ready'?'<button type="button" class="btn" data-calendar="'+id+'">Calendário</button>':'')+
        (retry?'<button type="button" class="btn" data-retry="'+id+'"'+(retrying?' disabled aria-busy="true"':'')+'>'+(retrying?'Retomando…':'Tentar novamente')+'</button>':'')+
        '<details class="genjutsu-more"><summary aria-label="Ações do Vídeo '+n+'" title="Mais ações">⋯</summary><div class="genjutsu-menu">'+actions+'</div></details></div></article>';
    }).join('')||'<div class="production-empty"><span>◎</span><b>Sua fila está vazia</b><small>Adicione vídeo + frame acima para começar.</small></div>';
    if(markup===jobsMarkup&&node.innerHTML)return;
    const openMenu=node.querySelector?.('.genjutsu-more[open]')?.closest?.('[data-gen-job]')?.dataset.genJob;
    jobsMarkup=markup;previewObserver?.disconnect();node.innerHTML=markup;tickElapsed();
    if(openMenu){const details=node.querySelector?.('[data-gen-job="'+openMenu+'"] .genjutsu-more');if(details)details.open=true;}
    for(const row of node.querySelectorAll?.('[data-gen-job]')||[])if(pendingActions.has(row.dataset.genJob))for(const button of row.querySelectorAll('button')){button.disabled=true;button.setAttribute('aria-busy','true');}
    const targets=node.querySelectorAll?.('[data-job-media]')||[];
    if(typeof IntersectionObserver!=='undefined'){
      previewObserver=new IntersectionObserver(items=>{for(const item of items)if(item.isIntersecting){previewObserver.unobserve(item.target);loadPreviews(item.target);}},{rootMargin:'100px'});
      targets.forEach(target=>previewObserver.observe(target));
    }else [...targets].slice(0,6).forEach(loadPreviews);
  }

  const verifiedMedia=(id,kind)=>cloudFetch('?resource=image-pipeline-preview&id='+encodeURIComponent(id)+'&verified=1'+(kind==='original'?'&kind=original':''));
  async function verifyMenu(menu){
    const id=menu.closest('[data-gen-job]')?.dataset.genJob,rev=revision;
    if(!menu.open||!id||verifiedMenus.has(menu))return;
    verifiedMenus.add(menu);
    for(const kind of ['frame','original']){
      const buttons=menu.querySelectorAll('[data-verified-'+kind+']');
      if(!buttons.length)continue;
      try{
        const result=await verifiedMedia(id,kind);
        if(rev!==revision||!menu.isConnected)return;
        for(const button of buttons)button.hidden=!(button.dataset.downloadFrame||button.dataset.downloadOriginal||result.reusable);
      }catch(error){
        if(rev!==revision||!menu.isConnected)return;
        const missing=menu.querySelector('[data-missing-frame]');
        if(kind==='frame'&&missing&&error.message==='Frame indisponível.')missing.hidden=false;
        else if(error.message!=='Vídeo original indisponível.')verifiedMenus.delete(menu);
      }
    }
  }

  function previewURL(id,kind='frame'){
    const job=jobs.find(j=>j.id===id),stamp=job?.meta?.upscale_result?.path||job?.meta?.face_swap_result?.path||job?.frame_storage_path||'';
    const key=id+':'+kind+':'+(kind==='result'?job?.production?.result_video_id:stamp);let cached=previewCache.get(key);
    if(!cached||cached.expires<Date.now()){
      const path=kind==='result'?'?resource=image-pipeline-result&workflow=genjutsu&id='+encodeURIComponent(job?.production?.id||id)
        :'?resource=image-pipeline-preview&id='+encodeURIComponent(id)+(kind==='original'?'&kind=original':'');
      cached={expires:Date.now()+15*60*1000,promise:cloudFetch(path,{signal:AbortSignal.timeout(15000)})};
      previewCache.set(key,cached);const entry=cached;
      cached.promise.catch(()=>{if(previewCache.get(key)===entry)previewCache.delete(key);});
    }return cached.promise;
  }
  async function loadPreviews(target){
    const uid=owner,rev=revision,id=target.dataset.jobMedia;
    try{
      const result=await previewURL(id);
      if(uid!==cloudSession?.user?.id||rev!==revision||!target.isConnected)return;
      const img=document.createElement('img');img.src=result.url;img.alt='Frame do vídeo';img.loading='lazy';
      img.style.cssText='display:block;width:100%;height:100%;object-fit:contain';
      target.querySelector('.genjutsu-preview-placeholder')?.replaceWith(img);
    }catch{if(target.isConnected)target.title='Prévia indisponível. Use Ver frame para tentar novamente.';}
  }
  async function showMedia(id,kind){
    const uid=owner,rev=revision,seq=++mediaRevision,host=document.getElementById('modalHost');if(!host)return;
    closeModal();
    const title={result:'Resultado GENJUTSU',original:'Vídeo original',frame:'Frame / personagem',prompt:'Prompt gerado · somente leitura'}[kind];
    host.innerHTML='<div class="modal production-preview-modal" data-gen-modal role="dialog" aria-modal="true" aria-label="'+title+'"><div class="modal-box production-preview-box"><div class="modal-head"><b>'+title+'</b><button type="button" class="btn" data-gen-close>Fechar</button></div><div data-gen-canvas role="status" aria-live="polite">Carregando prévia…</div></div></div>';
    const modal=host.querySelector('[data-gen-modal]'),canvas=modal.querySelector('[data-gen-canvas]'),button=modal.querySelector('[data-gen-close]');
    modal.mediaController=new AbortController();
    const dismiss=()=>{if(modal.isConnected)closeModal();};
    modal.onclick=event=>{if(event.target===modal||event.target.closest('[data-gen-close]'))dismiss();};
    modal.onkeydown=event=>{
      if(event.key==='Escape'){event.preventDefault();dismiss();}
      if(event.key==='Tab'){
        const focusable=[...modal.querySelectorAll('button,video[controls],a[href]')];
        if(event.shiftKey&&document.activeElement===focusable[0]){event.preventDefault();focusable.at(-1)?.focus();}
        else if(!event.shiftKey&&document.activeElement===focusable.at(-1)){event.preventDefault();focusable[0]?.focus();}
      }
    };
    button.focus();
    try{
      const result=kind==='prompt'?await cloudFetch('?resource=image-pipeline-prompt&id='+encodeURIComponent(id)):await previewURL(id,kind);
      if(uid!==cloudSession?.user?.id||rev!==revision||seq!==mediaRevision||!modal.isConnected||modal.mediaController.signal.aborted||!active())return;
      if(kind==='prompt'){
        if(result.source==='manual')modal.querySelector('.modal-head b')?.replaceChildren('Prompt manual · somente leitura');
        const text=document.createElement('pre');text.className='genjutsu-prompt-text';text.textContent=result.prompt;canvas.removeAttribute('role');canvas.replaceChildren(text);return;
      }
      const media=document.createElement(kind==='frame'?'img':'video');
      if(kind==='frame')media.alt='Frame da personagem';else{media.controls=true;media.playsInline=true;media.preload='metadata';media.setAttribute('aria-label',title);}
      media.addEventListener('error',()=>{
        if(kind==='result')previewCache.delete(id+':result:'+jobs.find(j=>j.id===id)?.production?.result_video_id);
        if(modal.isConnected)canvas.textContent='Não foi possível abrir a prévia. Feche e tente novamente.';
      },{once:true});
      media.src=result.url;canvas.removeAttribute('role');canvas.replaceChildren(media);if(kind!=='frame')media.play()?.catch(()=>{});
    }catch(error){if(uid===cloudSession?.user?.id&&rev===revision&&seq===mediaRevision&&modal.isConnected)canvas.textContent=error.message||'Não foi possível abrir a prévia.';}
  }
  async function showStudioResult(id){
    const dock=root()?.querySelector('.studio-gen-result');
    if(!dock||!window.matchMedia?.('(min-width: 1100px)').matches)return showMedia(id,'result');
    const job=jobs.find(item=>item.id===id);
    if(!job?.production?.result_video_id)return;
    const seq=++mediaRevision,uid=owner,rev=revision;
    const current=()=>dock.isConnected&&seq===mediaRevision&&uid===cloudSession?.user?.id&&rev===revision&&active();
    dock.hidden=false;
    dock.innerHTML='<div class="studio-result-head"><h3>Vídeo '+(jobs.length-jobs.indexOf(job))+'</h3></div>'+
      '<div class="studio-result-canvas" data-gen-dock-media role="status">Carregando prévia…</div>'+
      '<div class="studio-result-actions"><button class="btn" data-download="'+e(id)+'">Baixar</button>'+
      (job.production.status==='ready'?'<button class="btn primary" data-calendar="'+e(id)+'">Adicionar ao calendário</button>':'')+'</div>';
    const canvas=dock.querySelector('[data-gen-dock-media]');
    try{
      const result=await previewURL(id,'result');
      if(!current())return;
      const video=document.createElement('video');
      video.controls=true;video.playsInline=true;video.preload='metadata';
      video.setAttribute('aria-label','Vídeo final');
      video.addEventListener('error',()=>{if(current())canvas.textContent='Prévia indisponível. Tente abrir o resultado novamente.';},{once:true});
      canvas.removeAttribute('role');canvas.replaceChildren(video);video.src=result.url;
    }catch(error){if(current())canvas.textContent=error.message||'Não foi possível abrir a prévia.';}
  }
  async function refresh(afterMutation=false){
    reset();if(!owner||!active())return;
    if(loading){if(afterMutation)refreshAgain=true;return;}
    loading=true;const uid=owner,rev=revision,queueRev=jobsRevision;
    try{
      const result=await cloudFetch('?resource=image-pipeline&workflow=genjutsu');
      if(uid!==cloudSession?.user?.id||rev!==revision)return;
      if(queueRev===jobsRevision){jobs=(result.jobs||[]).filter(j=>j.meta?.video_workflow?.key==='genjutsu');drawJobs();}
      if(!characters.length){const r=await cloudFetch('?resource=image-pipeline-characters&metadata=1');if(uid!==cloudSession?.user?.id||rev!==revision)return;characters=(r.characters||[]).map(c=>({id:c.id,name:c.name}));drawEntries();}
      if(Date.now()-lastCheck>60000){
        const url=(window.CloudentConfig?.supabaseUrl||'')+'/functions/v1/cloudent-genjutsu';
        const response=await fetch(url,{headers:{Authorization:'Bearer '+cloudSession.access_token,apikey:SUPABASE_KEY},cache:'no-store',signal:AbortSignal.timeout(15000)});
        if(uid!==cloudSession?.user?.id||rev!==revision)return;
        if(!response.ok)throw new Error('Não foi possível confirmar a configuração do Genjutsu.');
        const status=await response.json();const limit=root()?.querySelector('[data-gen-prompt-limit]');if(limit)limit.value=String(status.queue?.promptConcurrency||2);readiness=status.active?status.readiness:null;lastCheck=Date.now();
        const label=root()?.querySelector('[data-gen-config]');if(label)label.textContent=readiness?.ready?'Gemini conectado · Ultra 84 GB · até 2 vídeos · prompts independentes':readiness?.runninghub?.available?'RunningHub disponível · use um prompt manual enquanto o Gemini estiver indisponível.':'Configuração pendente no servidor. Nenhum envio será iniciado.';drawEntries();
      }
    }catch(error){if(uid===cloudSession?.user?.id&&rev===revision)message(error.message,true);}
    finally{if(rev===revision){loading=false;if(refreshAgain){refreshAgain=false;void refresh();}}}
  }
  async function duration(entry){
    if(entry.duration)return entry.duration;
    entry.duration=await new Promise((resolve,reject)=>{
      const video=document.createElement('video');let done=false;
      const finish=(error)=>{if(done)return;done=true;clearTimeout(timeout);video.removeAttribute('src');video.load();error?reject(error):resolve(value);};let value;
      const timeout=setTimeout(()=>finish(new Error('Não consegui ler a duração do vídeo.')),15000);
      video.onloadedmetadata=()=>{value=video.duration;finish(Number.isFinite(value)&&value>0?null:new Error('Vídeo com duração inválida.'));};
      video.onerror=()=>finish(new Error('Não consegui abrir o vídeo.'));video.preload='metadata';video.src=entry.url;
    });return entry.duration;
  }
  async function send(onlyEntry){
    reset();if(busy||!entries.length||!canSend(onlyEntry))return;
    const pending=onlyEntry?[onlyEntry]:entries.filter(x=>x.inputMode!=='manual_frame');
    if(pending.some(x=>x.inputMode!=='manual_frame'&&!x.character)){message('Escolha a modelo de cada vídeo.',true);return;}
    busy=true;drawEntries();const uid=owner,rev=revision;message('',true);
    try{
      for(const entry of pending){
        try{
          if(uid!==cloudSession?.user?.id||rev!==revision)throw new Error('Sessão alterada.');
          entry.locked=true;drawEntries();message('Preparando '+entry.file.name+'…');
          const seconds=await duration(entry);
          if(entry.inputMode==='manual_frame'&&!entry.frame)throw new Error('Escolha o frame da personagem.');
          entry.frame=entry.frame||new File([await extractFirstFrameBlob(entry.url)],'primeiro-frame.jpg',{type:'image/jpeg'});
          if(uid!==cloudSession?.user?.id||rev!==revision)throw new Error('Sessão alterada.');
          const describe=file=>({name:file.name,type:file.type,size:file.size});
          const ticket=await request('image-pipeline-ticket',{source:'face_swap_natural',job_id:entry.id,...(entry.inputMode==='manual_frame'?{input_mode:'manual_frame',manual_prompt:entry.manualPrompt||undefined,reuse:entry.reuse}:{character_id:entry.character}),workflow_key:'genjutsu',duration_seconds:seconds,original:describe(entry.file),reference:describe(entry.frame)});
          if(!ticket.registered){if(!entry.reuse?.original)await uploadFaceSwapPart(ticket.original,entry.file,()=>{});if(!entry.reuse?.reference)await uploadFaceSwapPart(ticket.reference,entry.frame,()=>{});if(uid!==cloudSession?.user?.id||rev!==revision)throw new Error('Sessão alterada.');await request('image-pipeline-complete',{job_id:entry.id});}
          if(uid!==cloudSession?.user?.id||rev!==revision)break;
          entries=entries.filter(x=>x!==entry);URL.revokeObjectURL(entry.url);message('Envio confirmado. A produção continua na nuvem.');
        }catch(error){entry.error=error.message;message(error.message,true);if(uid!==cloudSession?.user?.id||rev!==revision)break;}
      }
    }finally{busy=false;drawEntries();await refresh();}
  }
  function setDraftMedia(kind,file,url,reused){
    const video=kind==='video',key=video?'url':'frameUrl',part=video?'original':'reference';
    if(draft[key]?.startsWith('blob:'))URL.revokeObjectURL(draft[key]);
    draft[video?'file':'frame']=file;draft[key]=url;
    if(draft.reuse)delete draft.reuse[part];
    if(reused)(draft.reuse||={})[part]=reused;
    if(video)delete draft.duration;
    delete draft.error;
    drawDraft();
  }
  async function downloadMedia(address,name,stillCurrent){
    const response=await fetch(address);
    if(!response.ok)throw new Error('Não foi possível baixar o arquivo.');
    const blob=await response.blob();if(!stillCurrent())return;
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function retryJobs(ids,all=false){
    if(!ids.length||retryingAll||ids.some(id=>pendingRetries.has(id)||pendingActions.has(id)))return;
    const rev=revision;retryingAll=all;
    ids.forEach(id=>pendingRetries.add(id));drawJobs();message('',true);
    message(all?'Retomando '+ids.length+' vídeos…':'Retomando vídeo…');
    try{
      const result=all?await request('image-pipeline-retry-genjutsu',{ids},'PATCH')
        :await request('image-pipeline-retry',{id:ids[0]},'PATCH');
      if(rev!==revision||owner!==cloudSession?.user?.id)return;
      const results=all?result.results:[{id:ids[0],...result}];
      const confirmed=new Set(results.filter(r=>r.ok).map(r=>r.id));
      const failures=results.filter(r=>!r.ok);
      if(confirmed.size){
        jobsRevision++;
        jobs=jobs.map(j=>{
          if(!confirmed.has(j.id)||!canRetry(j))return j;
          const production=j.production;
          return {...j,status:'waiting',last_error:null,meta:{...j.meta,provider_failed:false},
            production:j.meta.stage==='control_motion'?{...production,status:'motion_waiting',last_error:null,
              genjutsu:{display:{key:'waiting',label:'Na fila para nova tentativa'}}}:production};
        });
      }
      message(confirmed.size?(all?confirmed.size+' de '+ids.length+' vídeos voltaram à fila.':'Vídeo voltou à fila.'):'');
      if(failures.length)message(failures.map(f=>f.error).filter(Boolean).filter((value,index,items)=>items.indexOf(value)===index).join(' ')||'Não foi possível retomar os vídeos.',true);
      void refresh(true);
    }catch(error){if(rev===revision){message('');message(error.message,true);}}
    finally{if(rev===revision){retryingAll=false;ids.forEach(id=>pendingRetries.delete(id));drawJobs();}}
  }
  async function action(button){
    const menu=button.closest?.('.genjutsu-more');if(menu)menu.open=false;
    const id=button.dataset.preview||button.dataset.original||button.dataset.frame||button.dataset.prompt||button.dataset.download||button.dataset.downloadFrame||button.dataset.downloadOriginal||button.dataset.useVideo||button.dataset.useFrame||button.dataset.calendar||button.dataset.trial||button.dataset.bulk||button.dataset.retry||button.dataset.stop||button.dataset.delete;
    if(!id||pendingActions.has(id)||pendingRetries.has(id))return;
    if(button.dataset.retry)return retryJobs([id]);
    pendingActions.add(id);
    const label=button.textContent;button.disabled=true;button.setAttribute('aria-busy','true');const uid=owner,rev=revision;
    button.textContent=button.dataset.download?'Baixando…':button.dataset.calendar?'Abrindo…':button.dataset.delete?'Excluindo…':button.dataset.stop?'Parando…':label;
    try{
      if(button.dataset.downloadFrame||button.dataset.downloadOriginal||button.dataset.useVideo||button.dataset.useFrame){
        const reuse=!!(button.dataset.useVideo||button.dataset.useFrame),video=!!(button.dataset.downloadOriginal||button.dataset.useVideo);
        if(reuse&&(busy||draft.locked))throw new Error('Finalize ou limpe o envio atual para reutilizar outro arquivo.');
        const stillCurrent=()=>uid===cloudSession?.user?.id&&rev===revision&&active();
        const result=await verifiedMedia(id,video?'original':'frame');
        if(!stillCurrent())return;
        if(!reuse){await downloadMedia(result.url,result.name,stillCurrent);return;}
        if(busy||draft.locked)return;
        if(!result.reusable)throw new Error('Este arquivo está disponível para download.');
        setDraftMedia(video?'video':'frame',{name:result.name,type:result.mime,size:result.size},result.url,{id,asset:result.asset});
        if(video&&Number.isFinite(result.duration)&&result.duration>0)draft.duration=result.duration;
        const form=root()?.querySelector('.studio-v2-upload');if(form)form.open=true;
        root()?.querySelector('.genjutsu-upload-workspace')?.scrollIntoView?.({block:'nearest'});
        message(video?'Vídeo original preenchido no formulário.':'Frame preenchido no formulário.');
        return;
      }
      if(button.dataset.preview){await showStudioResult(id);return;}
      if(button.dataset.original||button.dataset.frame||button.dataset.prompt){await showMedia(id,button.dataset.prompt?'prompt':button.dataset.original?'original':'frame');return;}
      if(button.dataset.stop){
        if(!confirm('Parar esta produção do GENJUTSU? A geração em andamento pode ser perdida. Seus arquivos não serão excluídos.'))return;
        const result=await request('image-pipeline-stop',{id},'PATCH');
        message(result.result_ready?'Vídeo salvo antes da parada.':result.stopped?'Produção parada.':result.already_finished?'A tarefa já terminou.':'Parada solicitada ao RunningHub. Aguarde a confirmação.');
      }
      else if(button.dataset.delete){if(!confirm('Remover este item da fila? O vídeo já preservado no calendário será mantido.'))return;await request('image-pipeline-job',{id},'DELETE');}
      else if(button.dataset.calendar){
        const job=jobs.find(j=>j.id===id),production=job?.production;
        if(production)await openProductionScheduleModal(production.id||id,jobs.length-jobs.indexOf(job),production);
        return;
      }
      else if(button.dataset.trial||button.dataset.bulk){
        const job=jobs.find(j=>j.id===id),productionId=job?.production?.id||id;
        await loadProductionData();if(uid!==cloudSession?.user?.id||rev!==revision)return;
        if(button.dataset.trial)await openProductionTrialModal(productionId);
        else await sendProductionResultToBulk(productionId,button);
      }
      else{
        const result=await previewURL(id,'result');if(uid!==cloudSession?.user?.id||rev!==revision)return;
        if(button.dataset.download){
          await downloadMedia(result.url,'genjutsu-'+id+'.mp4',()=>uid===cloudSession?.user?.id&&rev===revision);
        }
      }
      await refresh();
    }catch(error){if(uid===cloudSession?.user?.id&&rev===revision)message(error.message,true);}
    finally{
      if(rev===revision){
        pendingActions.delete(id);button.disabled=false;button.textContent=label;button.removeAttribute('aria-busy');
        for(const row of root()?.querySelectorAll?.('[data-gen-job]')||[])if(row.dataset.genJob===id){
          for(const control of row.querySelectorAll('button[aria-busy="true"]')){control.disabled=false;control.removeAttribute('aria-busy');}
        }
      }
    }
  }
  function render(container){
    reset();const existing=root();if(existing&&existing.dataset.owner===owner){refresh();return;}
    container.classList.remove('motion-control-mode');container.classList.add('studio-page');mediaRevision++;
    const tabs=[['standard','Vídeo 7 minutos'],['motion_control','Motion Control v7'],['genjutsu','GENJUTSU']].map(([key,name])=>'<button class="production-workflow-tab '+(key==='genjutsu'?'active':'')+'" type="button" role="tab" aria-selected="'+(key==='genjutsu')+'" onclick="CloudentMotionControl.setMode(\''+key+'\')">'+name+'</button>').join('');
    const inputs=[['video','Vídeo de referência','video/mp4,video/webm,video/quicktime','▶'],['frame','Frame / personagem','image/jpeg,image/png,image/webp','▧']].map(([kind,label,accept,icon])=>'<div class="production-drop production-drop-live" data-gen-drop="'+kind+'" tabindex="0" role="button" aria-label="Escolher '+label+'"><input id="genjutsu-'+kind+'" type="file" data-gen-file="'+kind+'" accept="'+accept+'" hidden><div class="production-upload-preview"><span class="production-drop-icon">'+icon+'</span></div><button type="button" class="production-draft-clear" data-clear="'+kind+'" aria-label="Remover '+label+'">×</button><label class="production-upload-overlay" for="genjutsu-'+kind+'"><b class="production-upload-title">'+label+'</b><small class="production-upload-meta">Clique para escolher o arquivo</small></label></div>').join('');
    container.innerHTML='<div class="ui3-page-head production-head"><div><span class="ui3-eyebrow">PRODUÇÃO IA</span><h2>GENJUTSU</h2><p>Prepare seus arquivos, acompanhe a fila e confira o resultado.</p></div></div><div class="production-workflow-tabs" role="tablist" aria-label="Fluxo da Produção IA">'+tabs+'</div>'+
      '<section data-genjutsu-root data-owner="'+e(owner)+'"><div class="genjutsu-upload-workspace"><div class="production-main-grid production-only-upload"><div class="card production-upload-card"><div class="ui3-panel-head"><div><span>Novo job</span><h3>Preparar geração</h3></div></div><div class="production-input-grid">'+inputs+'</div><details class="studio-prompt"><summary>Prompt manual (opcional)</summary><label class="genjutsu-manual-prompt"><textarea aria-label="Prompt manual" data-manual-prompt rows="4" maxlength="64000" placeholder="Deixe em branco para gerar o prompt automaticamente."></textarea></label></details><button type="button" class="btn primary production-add-btn" data-send-manual disabled>Adicionar à fila</button><div class="production-note">O processamento continua no servidor. Acompanhe as etapas na fila abaixo.</div><p data-draft-error role="alert"></p></div></div></div>'+
      '<details class="studio-diagnostics"><summary>Controles da fila e informações de uso</summary><div><p class="muted" data-gen-config role="status">Conferindo configuração…</p><p class="muted">Vídeo até 30 MiB · frame JPG, PNG ou WebP até 10 MiB.</p><label class="genjutsu-limit">Prompts em preparação <select data-gen-prompt-limit aria-label="Limite de prompts simultâneos"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option><option value="4">4</option></select></label><button type="button" class="btn" data-refresh>↻ Atualizar</button><details class="genjutsu-auto"><summary>Preparar com uma modelo salva</summary><label>Vídeos de referência<input data-auto-videos type="file" accept="video/mp4,video/webm,video/quicktime" multiple></label><div data-gen-entries></div><button type="button" class="btn primary" data-send disabled>Adicionar à fila</button></details></div></details>'+
      '<p data-gen-status role="status" aria-live="polite"></p><p data-gen-error role="alert"></p><div class="card production-queue-card"><div class="ui3-panel-head"><div><span>Fila</span><h3 data-gen-count>0 vídeo(s)</h3></div><button type="button" class="btn" data-retry-all hidden>Tentar todos novamente</button></div><div class="production-queue" data-gen-jobs></div></div></section>';
    const section=root();
    section.addEventListener?.('toggle',event=>{if(event.target.matches?.('.genjutsu-more'))verifyMenu(event.target);},true);
    section.oninput=event=>{
      if(!event.target.hasAttribute?.('data-manual-prompt')||busy||draft.locked)return;
      draft.manualPrompt=event.target.value;drawDraft();
    };
    section.onchange=async event=>{
      if(busy)return;
      if(event.target.hasAttribute?.('data-gen-prompt-limit')){
        const input=event.target;input.disabled=true;
        try{const response=await fetch((window.CloudentConfig?.supabaseUrl||'')+'/functions/v1/cloudent-genjutsu',{method:'POST',headers:{Authorization:'Bearer '+cloudSession.access_token,apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({action:'prompt-concurrency',value:Number(input.value)}),signal:AbortSignal.timeout(15000)});
          if(!response.ok)throw new Error('Não foi possível alterar o limite dos prompts.');message('Limite de preparação atualizado.');
        }catch(error){message(error.message,true);lastCheck=0;await refresh();}finally{input.disabled=false;}return;
      }
      if(event.target.dataset.genFile){
        const kind=event.target.dataset.genFile,file=event.target.files[0];if(!file)return;
        if(draft.locked){message('Remova o par e escolha os arquivos novamente para iniciar outro envio.',true);return;}
        try{
          const video=kind==='video',allowed=video?['video/mp4','video/webm','video/quicktime']:['image/jpeg','image/png','image/webp'];
          if(!allowed.includes(file.type)||!file.size||file.size>(video?30:10)*1024*1024)throw new Error(video?'Envie um vídeo MP4, WebM ou MOV de até 30 MiB.':'Envie um frame JPG, PNG ou WebP de até 10 MiB.');
          if(draft.id){entries=entries.filter(x=>x!==draft);delete draft.id;}
          setDraftMedia(kind,file,URL.createObjectURL(file));message('',true);
        }catch(error){message(error.message,true);}finally{event.target.value='';}
      }else if(event.target.type==='file'){
        try{const files=[...event.target.files];for(const file of files)if(!['video/mp4','video/webm','video/quicktime'].includes(file.type)||!file.size||file.size>30*1024*1024)throw new Error('Selecione vídeos de até 30 MiB em MP4, WebM ou MOV.');
          for(const file of files)if(!entries.some(x=>x.file.name===file.name&&x.file.size===file.size&&x.file.lastModified===file.lastModified))entries.push({id:crypto.randomUUID(),file,url:URL.createObjectURL(file),character:''});
          event.target.value='';message('',true);drawEntries();
        }catch(error){message(error.message,true);}
      }else if(event.target.dataset.model){const entry=entries.find(x=>x.id===event.target.dataset.model);if(entry&&!entry.locked)entry.character=event.target.value;}
    };
    section.onkeydown=event=>{if((event.key==='Enter'||event.key===' ')&&event.target.dataset.genDrop){event.preventDefault();event.target.querySelector('input').click();}};
    section.onclick=event=>{
      const button=event.target.closest('button');if(!button){const box=event.target.closest('[data-gen-drop]');if(box&&!event.target.closest('video,label,input,a'))box.querySelector('input').click();return;}
      if(button.hasAttribute('data-send-manual'))return sendManual();
      if(button.hasAttribute('data-refresh'))return refresh();
      if(button.hasAttribute('data-retry-all'))return retryJobs(jobs.filter(canRetry).map(job=>job.id),true);
      if(button.dataset.clear){
        if(busy)return;entries=entries.filter(x=>x!==draft);
        const video=button.dataset.clear==='video',key=video?'url':'frameUrl';if(draft[key])URL.revokeObjectURL(draft[key]);
        if(draft.reuse)delete draft.reuse[video?'original':'reference'];
        delete draft[video?'file':'frame'];delete draft[key];delete draft.duration;delete draft.error;delete draft.id;delete draft.locked;drawDraft();return;
      }
      if(button.hasAttribute('data-send'))return send();
      if(button.dataset.remove){if(busy)return;const entry=entries.find(x=>x.id===button.dataset.remove);if(entry){URL.revokeObjectURL(entry.url);entries=entries.filter(x=>x!==entry);}drawEntries();return;}
      return action(button);
    };
    drawEntries();drawJobs();refresh();
    if(!timer){timer=setInterval(()=>{reset();if(active()&&cloudSession&&!document.hidden)refresh();},10000);setInterval(tickElapsed,1000);}
  }
  document.addEventListener?.('visibilitychange',()=>{if(!document.hidden&&cloudSession&&active()){reset();refresh();tickElapsed();}});
  function scheduled(productionId){
    if(!jobs.some(job=>(job.production?.id||job.id)===productionId))return;
    jobsRevision++;
    jobs=jobs.filter(job=>(job.production?.id||job.id)!==productionId);
    drawJobs();
  }
  window.CloudentGenjutsu={render,refresh,scheduled,get busy(){return busy;}};
})();
