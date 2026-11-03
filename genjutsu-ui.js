(()=>{
  if(window.CloudentGenjutsu)return;
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let draft={},owner='',entries=[],jobs=[],busy=false,loading=false,timer=null,characters=[],readiness=null,lastCheck=0,revision=0;
  const previewCache=new Map();let previewObserver=null,jobsMarkup='';
  const active=()=>currentPage==='production'&&window.CloudentMotionControl?.mode==='genjutsu';
  const root=()=>document.querySelector('#production [data-genjutsu-root]');
  const request=(action,body,method='POST')=>cloudFetch('?action='+action,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  function reset(){
    const uid=cloudSession?.user?.id||'';if(uid===owner)return;
    owner=uid;revision++;previewCache.clear();previewObserver?.disconnect();jobsMarkup='';for(const entry of entries)URL.revokeObjectURL(entry.url);
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
    const button=section.querySelector('[data-send-manual]');if(button){button.disabled=busy||readiness?.ready!==true;button.textContent=busy?'Enviando…':'Adicionar à fila';button.setAttribute('aria-busy',String(busy));}
    const error=section.querySelector('[data-draft-error]');if(error)error.textContent=draft.error||'';
  }
  async function sendManual(){
    if(busy)return;
    if(!draft.file||!draft.frame){message('Escolha o vídeo e o frame da personagem.',true);return;}
    if(!readiness?.ready)return;
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
    const child=job.production,m=job.meta||{},state=child?.genjutsu;
    if(child?.result_video_id)return child.status==='ready'?'Vídeo pronto':'Vídeo salvo · encerrando task';
    if(child?.status==='failed'||job.status==='failed')return 'Precisa de atenção';
    if(m.stage==='control_motion'){
      if(state?.phase==='provider_waiting')return 'Gemini indisponível · nova tentativa agendada';
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
  function steps(job){
    const m=job.meta||{},child=job.production,state=child?.genjutsu;
    const ready=!!child?.result_video_id;
    const labels=m.input_mode==='manual_frame'?['Arquivos','Gemini','GENJUTSU']:['Face Swap','Upscale','Gemini','GENJUTSU'];
    let index=m.input_mode==='manual_frame'?1:m.stage==='control_motion'?2:m.stage==='upscale'?1:0;
    if(state?.phase==='complete'||child?.runninghub_task_id)index=labels.length-1;
    const failed=child?.status==='failed'||job.status==='failed';
    return '<ol class="genjutsu-steps" aria-label="Etapas da produção">'+labels.map((label,i)=>'<li class="'+(ready||i<index?'done':i===index?(failed?'error':'current'):'')+'" '+(i===index&&!ready?'aria-current="step"':'')+'><span>'+(ready||i<index?'✓':i+1)+'</span>'+label+'</li>').join('')+'</ol>';
  }
  function drawJobs(){
    const node=root()?.querySelector('[data-gen-jobs]');if(!node)return;
    const markup=jobs.map((job,i)=>{
      const child=job.production,hasResult=!!child?.result_video_id,failed=child?.status==='failed'||job.status==='failed';
      const retry=failed&&!job.meta?.dispatch_uncertain&&(job.meta?.provider_failed||child?.genjutsu?.canRetry);
      const finished=child?.status==='ready'||['ready','cancelled'].includes(job.status);
      const old503=(child?.last_error||job.last_error)==='Gemini recusou a operação (HTTP 503).';
      const error=old503?'Gemini temporariamente indisponível (503). Seus arquivos foram preservados.':child?.last_error||job.last_error;
      return '<article class="card genjutsu-job" data-gen-job="'+e(job.id)+'"><div class="genjutsu-job-head"><div><small>VÍDEO '+(i+1)+'</small><strong>'+e(job.meta?.source_file_name||job.original_file_name)+'</strong></div><span class="genjutsu-job-model">'+e(job.meta?.character_name||(job.meta?.input_mode==='manual_frame'?'Frame enviado':'Modelo'))+'</span></div><div class="genjutsu-job-previews" data-job-media="'+e(job.id)+'"><figure data-media-kind="original"><div class="genjutsu-preview-placeholder">▷</div><figcaption>Vídeo de referência</figcaption></figure><figure data-media-kind="frame"><div class="genjutsu-preview-placeholder">▧</div><figcaption>Frame / personagem</figcaption></figure></div>'+steps(job)+'<p class="genjutsu-job-status" role="status">'+e(phase(job))+'</p>'+(error?'<p class="genjutsu-job-error" role="alert">'+e(error)+'</p>':'')+'<div class="genjutsu-job-actions">'+(hasResult?'<button class="btn" data-preview="'+job.id+'">Ver resultado</button><button class="btn" data-download="'+job.id+'">Baixar</button>':'')+(child?.status==='ready'?'<button class="btn" data-calendar="'+job.id+'">Adicionar ao calendário</button>':'')+(retry?'<button class="btn primary" data-retry="'+job.id+'">Tentar novamente</button>':'')+(finished||failed?'<button class="btn" data-delete="'+job.id+'">Excluir</button>':'')+'</div></article>';
    }).join('')||'<p class="muted">Sua fila GENJUTSU aparecerá aqui.</p>';
    if(markup===jobsMarkup&&node.innerHTML)return;
    jobsMarkup=markup;previewObserver?.disconnect();node.innerHTML=markup;
    const targets=node.querySelectorAll?.('[data-job-media]')||[];
    if(typeof IntersectionObserver!=='undefined'){
      previewObserver=new IntersectionObserver(items=>{for(const item of items)if(item.isIntersecting){previewObserver.unobserve(item.target);loadPreviews(item.target);}},{rootMargin:'100px'});
      targets.forEach(target=>previewObserver.observe(target));
    }else [...targets].slice(0,6).forEach(loadPreviews);
  }
  async function loadPreviews(target){
    const uid=owner,rev=revision,id=target.dataset.jobMedia,job=jobs.find(j=>j.id===id);if(!job)return;
    const stamp=job.meta?.upscale_result?.path||job.meta?.face_swap_result?.path||job.frame_storage_path||'';
    const get=kind=>{
      const key=id+':'+kind+':'+stamp;let cached=previewCache.get(key);
      if(!cached||cached.expires<Date.now()){
        cached={expires:Date.now()+15*60*1000,promise:cloudFetch('?resource=image-pipeline-preview&id='+encodeURIComponent(id)+(kind==='original'?'&kind=original':''))};
        previewCache.set(key,cached);cached.promise.catch(()=>previewCache.delete(key));
      }return cached.promise;
    };
    const results=await Promise.allSettled([get('original'),get('frame')]);
    if(uid!==cloudSession?.user?.id||rev!==revision||!target.isConnected)return;
    results.forEach((result,i)=>{
      const box=target.querySelector('[data-media-kind="'+(i?'frame':'original')+'"]');
      if(result.status!=='fulfilled'){box.querySelector('.genjutsu-preview-placeholder').textContent='Prévia indisponível';return;}
      const media=document.createElement(i?'a':'video');
      if(i){media.href=result.value.url;media.target='_blank';media.rel='noopener';media.setAttribute('aria-label','Abrir frame da personagem');const img=document.createElement('img');img.src=result.value.url;img.alt='Frame da personagem';img.loading='lazy';media.appendChild(img);}
      else{media.src=result.value.url;media.controls=true;media.playsInline=true;media.preload='none';if(results[1].status==='fulfilled')media.poster=results[1].value.url;}
      box.querySelector('.genjutsu-preview-placeholder').replaceWith(media);
    });
  }
  async function refresh(){
    reset();if(!owner||loading||!active())return;loading=true;const uid=owner,rev=revision;
    try{
      const result=await cloudFetch('?resource=image-pipeline&workflow=genjutsu');
      if(uid!==cloudSession?.user?.id||rev!==revision)return;
      jobs=(result.jobs||[]).filter(j=>j.meta?.video_workflow?.key==='genjutsu');drawJobs();
      if(!characters.length){const r=await cloudFetch('?resource=image-pipeline-characters&metadata=1');if(uid!==cloudSession?.user?.id||rev!==revision)return;characters=(r.characters||[]).map(c=>({id:c.id,name:c.name}));drawEntries();}
      if(Date.now()-lastCheck>60000){
        const url=(window.CloudentConfig?.supabaseUrl||'')+'/functions/v1/cloudent-genjutsu';
        const response=await fetch(url,{headers:{Authorization:'Bearer '+cloudSession.access_token,apikey:SUPABASE_KEY},cache:'no-store',signal:AbortSignal.timeout(15000)});
        if(uid!==cloudSession?.user?.id||rev!==revision)return;
        if(!response.ok)throw new Error('Não foi possível confirmar a configuração do Genjutsu.');
        const status=await response.json();readiness=status.active?status.readiness:null;lastCheck=Date.now();
        const label=root()?.querySelector('[data-gen-config]');if(label)label.textContent=readiness?.ready?'Gemini conectado · Ultra 84 GB · um trabalho por vez':'Configuração pendente no servidor. Nenhum envio será iniciado.';drawEntries();
      }
    }catch(error){if(uid===cloudSession?.user?.id&&rev===revision)message(error.message,true);}
    finally{if(rev===revision)loading=false;}
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
    reset();if(busy||!entries.length||!readiness?.ready)return;
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
          const ticket=await request('image-pipeline-ticket',{source:'face_swap_natural',job_id:entry.id,...(entry.inputMode==='manual_frame'?{input_mode:'manual_frame'}:{character_id:entry.character}),workflow_key:'genjutsu',duration_seconds:seconds,original:describe(entry.file),reference:describe(entry.frame)});
          if(!ticket.registered){await uploadFaceSwapPart(ticket.original,entry.file,()=>{});await uploadFaceSwapPart(ticket.reference,entry.frame,()=>{});if(uid!==cloudSession?.user?.id||rev!==revision)throw new Error('Sessão alterada.');await request('image-pipeline-complete',{job_id:entry.id});}
          if(uid!==cloudSession?.user?.id||rev!==revision)break;
          entries=entries.filter(x=>x!==entry);URL.revokeObjectURL(entry.url);message('Envio confirmado. A produção continua na nuvem.');
        }catch(error){entry.error=error.message;message(error.message,true);if(uid!==cloudSession?.user?.id||rev!==revision)break;}
      }
    }finally{busy=false;drawEntries();await refresh();}
  }
  async function action(button){
    button.disabled=true;button.setAttribute('aria-busy','true');const uid=owner,rev=revision;
    try{
      const id=button.dataset.preview||button.dataset.download||button.dataset.calendar||button.dataset.retry||button.dataset.delete;
      if(button.dataset.retry)await request('image-pipeline-retry',{id},'PATCH');
      else if(button.dataset.delete){if(!confirm('Remover este item da fila? O vídeo já preservado no calendário será mantido.'))return;await request('image-pipeline-job',{id},'DELETE');}
      else if(button.dataset.calendar){await loadProductionData();if(uid===cloudSession?.user?.id)await openProductionScheduleModal(id,1);}
      else{
        const result=await cloudFetch('?resource=image-pipeline-result&id='+encodeURIComponent(id));if(uid!==cloudSession?.user?.id||rev!==revision)return;
        if(button.dataset.download){
          const response=await fetch(result.url);if(!response.ok)throw new Error('Não consegui baixar o vídeo.');const blob=await response.blob();if(uid!==cloudSession?.user?.id||rev!==revision)return;
          const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='genjutsu-'+id+'.mp4';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
        }else{const host=document.getElementById('modalHost');host.innerHTML='<div class="modal production-preview-modal"><div class="modal-box production-preview-box"><div class="modal-head"><b>Resultado Genjutsu</b><button class="btn" onclick="closeModal()">Fechar</button></div><video controls playsinline style="max-width:100%;max-height:75vh"></video></div></div>';host.querySelector('video').src=result.url;}
      }
      await refresh();
    }catch(error){if(uid===cloudSession?.user?.id&&rev===revision)message(error.message,true);}
    finally{button.disabled=false;button.removeAttribute('aria-busy');}
  }
  function render(container){
    reset();const existing=root();if(existing&&existing.dataset.owner===owner){refresh();return;}
    container.classList.remove('motion-control-mode');
    container.innerHTML='<div class="production-head"><div><h2>GENJUTSU</h2><p>Envie o vídeo e o frame da personagem que você quer usar.</p></div></div><div class="production-workflow-tabs" role="tablist" aria-label="Fluxo da Produção IA">'+[['standard','Vídeo 7 minutos'],['motion_control','Motion Control v7'],['genjutsu','GENJUTSU']].map(([key,name])=>'<button class="production-workflow-tab '+(key==='genjutsu'?'active':'')+'" type="button" role="tab" aria-selected="'+(key==='genjutsu')+'" onclick="CloudentMotionControl.setMode(\''+key+'\')">'+name+'</button>').join('')+'</div><section data-genjutsu-root data-owner="'+e(owner)+'"><p class="muted" data-gen-config role="status">Conferindo configuração…</p><div class="card production-upload-card genjutsu-upload-card"><div class="ui3-panel-head"><div><span>Novo job</span><h3>Vídeo + frame</h3></div></div><div class="production-input-grid genjutsu-input-grid">'+[['video','Vídeo de referência','video/mp4,video/webm,video/quicktime','▶'],['frame','Frame / personagem','image/jpeg,image/png,image/webp','▧']].map(([kind,label,accept,icon])=>'<div class="production-drop production-drop-live" data-gen-drop="'+kind+'" tabindex="0" role="button" aria-label="Escolher '+label+'"><input id="genjutsu-'+kind+'" type="file" data-gen-file="'+kind+'" accept="'+accept+'" hidden><div class="production-upload-preview"><span class="production-drop-icon">'+icon+'</span></div><button type="button" class="production-draft-clear" data-clear="'+kind+'" aria-label="Remover '+label+'">×</button><label class="production-upload-overlay" for="genjutsu-'+kind+'"><b class="production-upload-title">'+label+'</b><small class="production-upload-meta">Clique para escolher o arquivo</small></label></div>').join('')+'</div><button type="button" class="btn primary production-add-btn" data-send-manual disabled>Adicionar à fila</button><p class="muted">Vídeo até 30 MiB · frame JPG, PNG ou WebP até 10 MiB.</p><div class="production-note">O frame enviado vai direto para a análise e a geração. O processamento continua na nuvem.</div><p data-draft-error role="alert"></p></div><details class="genjutsu-auto"><summary>Preparar com uma modelo salva</summary><div class="card"><label>Vídeos de referência<input data-auto-videos type="file" accept="video/mp4,video/webm,video/quicktime" multiple></label><p class="muted">Até 30 MiB por vídeo. Escolha uma modelo para cada arquivo.</p><div data-gen-entries></div><button type="button" class="btn primary" data-send disabled>Adicionar à fila</button></div></details><p data-gen-status role="status" aria-live="polite"></p><p data-gen-error role="alert"></p><div data-gen-jobs style="display:grid;gap:14px;margin-top:20px"></div></section>';
    const section=root();
    section.onchange=event=>{
      if(busy)return;
      if(event.target.dataset.genFile){
        const kind=event.target.dataset.genFile,file=event.target.files[0];if(!file)return;
        if(draft.locked){message('Remova o par e escolha os arquivos novamente para iniciar outro envio.',true);return;}
        try{
          const video=kind==='video',allowed=video?['video/mp4','video/webm','video/quicktime']:['image/jpeg','image/png','image/webp'];
          if(!allowed.includes(file.type)||!file.size||file.size>(video?30:10)*1024*1024)throw new Error(video?'Envie um vídeo MP4, WebM ou MOV de até 30 MiB.':'Envie um frame JPG, PNG ou WebP de até 10 MiB.');
          if(draft.id){entries=entries.filter(x=>x!==draft);delete draft.id;}
          const key=video?'url':'frameUrl';if(draft[key])URL.revokeObjectURL(draft[key]);
          draft[video?'file':'frame']=file;draft[key]=URL.createObjectURL(file);delete draft.duration;delete draft.error;
          message('',true);drawDraft();
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
      if(button.dataset.clear){
        if(busy)return;entries=entries.filter(x=>x!==draft);
        const video=button.dataset.clear==='video',key=video?'url':'frameUrl';if(draft[key])URL.revokeObjectURL(draft[key]);
        delete draft[video?'file':'frame'];delete draft[key];delete draft.duration;delete draft.error;delete draft.id;delete draft.locked;drawDraft();return;
      }
      if(button.hasAttribute('data-send'))return send();
      if(button.dataset.remove){if(busy)return;const entry=entries.find(x=>x.id===button.dataset.remove);if(entry){URL.revokeObjectURL(entry.url);entries=entries.filter(x=>x!==entry);}drawEntries();return;}
      return action(button);
    };
    drawEntries();drawJobs();refresh();
    if(!timer)timer=setInterval(()=>{reset();if(active()&&cloudSession&&!document.hidden)refresh();},10000);
  }
  window.CloudentGenjutsu={render,refresh,get busy(){return busy;}};
})();
