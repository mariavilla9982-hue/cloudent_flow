(()=>{
  if(window.CloudentGenjutsu)return;
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let owner='',entries=[],jobs=[],busy=false,loading=false,timer=null,characters=[],readiness=null,lastCheck=0,revision=0;
  const active=()=>currentPage==='production'&&window.CloudentMotionControl?.mode==='genjutsu';
  const root=()=>document.querySelector('#production [data-genjutsu-root]');
  const request=(action,body,method='POST')=>cloudFetch('?action='+action,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  function reset(){
    const uid=cloudSession?.user?.id||'';if(uid===owner)return;
    owner=uid;revision++;for(const entry of entries)URL.revokeObjectURL(entry.url);
    entries=[];jobs=[];characters=[];readiness=null;lastCheck=0;loading=false;
  }
  function message(text,error=false){const box=root()?.querySelector(error?'[data-gen-error]':'[data-gen-status]');if(box)box.textContent=text;}
  function drawEntries(){
    const list=root()?.querySelector('[data-gen-entries]');if(!list)return;
    list.innerHTML=entries.map((item,i)=>'<article class="card" data-entry="'+item.id+'"><div class="toolbar"><strong>Vídeo '+(i+1)+' · '+e(item.file.name)+'</strong><button type="button" class="btn" data-remove="'+item.id+'" '+(busy?'disabled':'')+'>Remover</button></div><video controls playsinline preload="metadata" src="'+e(item.url)+'" style="max-width:100%;max-height:230px;margin:12px 0"></video><label>Modelo<select data-model="'+item.id+'" '+(busy||item.locked?'disabled':'')+'><option value="">Escolha a modelo</option>'+characters.map(c=>'<option value="'+e(c.id)+'" '+(item.character===c.id?'selected':'')+'>'+e(c.name)+'</option>').join('')+'</select></label>'+(item.error?'<p role="alert">'+e(item.error)+'</p>':'')+'</article>').join('');
    const button=root()?.querySelector('[data-send]');if(button){button.disabled=busy||!entries.length||readiness?.ready!==true;button.textContent=busy?'Enviando…':'Adicionar à fila';button.setAttribute('aria-busy',String(busy));}
    const input=root()?.querySelector('input[type=file]');if(input)input.disabled=busy;
  }
  function phase(job){
    const child=job.production,m=job.meta||{},state=child?.genjutsu;
    if(child?.result_video_id)return child.status==='ready'?'Vídeo pronto':'Vídeo salvo · encerrando task';
    if(child?.status==='failed'||job.status==='failed')return 'Precisa de atenção';
    if(m.stage==='control_motion'){
      if(state?.phase==='quota_waiting')return 'Aguardando cota do Gemini';
      if(state?.phase==='generating')return 'Gemini · preparando prompt';
      if(state?.phase==='processing'||state?.phase==='preparing')return 'Gemini · analisando as mídias';
      if(child?.status==='running')return 'Genjutsu · gerando vídeo';
      if(child?.status==='queued')return 'Na fila da RunningHub';
      return state?.phase==='complete'?'Prompt pronto · aguardando vaga':'Na fila do Gemini';
    }
    if(m.stage==='upscale')return job.status==='waiting'?'Na fila do Upscale':'Preparando foto · Upscale';
    if(m.stage==='face_swap')return job.status==='waiting'?'Na fila do Face Swap':'Preparando foto · Face Swap';
    return 'Preparando envio';
  }
  function drawJobs(){
    const node=root()?.querySelector('[data-gen-jobs]');if(!node)return;
    node.innerHTML=jobs.map(job=>{
      const child=job.production,hasResult=!!child?.result_video_id,failed=child?.status==='failed'||job.status==='failed';
      const retry=failed&&!job.meta?.dispatch_uncertain&&(job.meta?.provider_failed||child?.genjutsu?.canRetry);
      const finished=child?.status==='ready'||['ready','cancelled'].includes(job.status);
      const progress=hasResult?100:job.meta?.upscale_result?65:job.meta?.face_swap_result?35:10;
      return '<article class="card"><div class="toolbar"><strong>'+e(job.meta?.character_name||'Modelo')+' · '+e(job.meta?.source_file_name||job.original_file_name)+'</strong><span role="status">'+e(phase(job))+'</span></div><progress value="'+progress+'" max="100" aria-label="Etapas da produção" style="width:100%;margin:14px 0;accent-color:#fff"></progress><p class="muted">Face Swap → Upscale → Gemini → Genjutsu</p>'+((child?.last_error||job.last_error)?'<p role="alert">'+e(child?.last_error||job.last_error)+'</p>':'')+'<div class="toolbar">'+(hasResult?'<button class="btn" data-preview="'+job.id+'">Ver resultado</button><button class="btn" data-download="'+job.id+'">Baixar</button>':'')+(child?.status==='ready'?'<button class="btn" data-calendar="'+job.id+'">Adicionar ao calendário</button>':'')+(retry?'<button class="btn" data-retry="'+job.id+'">Repetir etapa</button>':'')+(finished||failed?'<button class="btn" data-delete="'+job.id+'">Excluir</button>':'')+'</div></article>';
    }).join('')||'<p class="muted">Sua fila Genjutsu aparecerá aqui.</p>';
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
  async function send(){
    reset();if(busy||!entries.length||!readiness?.ready)return;
    if(entries.some(x=>!x.character)){message('Escolha a modelo de cada vídeo.',true);return;}
    busy=true;drawEntries();const uid=owner,rev=revision;message('',true);
    try{
      for(const entry of [...entries]){
        try{
          if(uid!==cloudSession?.user?.id||rev!==revision)throw new Error('Sessão alterada.');
          entry.locked=true;drawEntries();message('Preparando '+entry.file.name+'…');
          const seconds=await duration(entry);
          entry.frame=entry.frame||new File([await extractFirstFrameBlob(entry.url)],'primeiro-frame.jpg',{type:'image/jpeg'});
          if(uid!==cloudSession?.user?.id||rev!==revision)throw new Error('Sessão alterada.');
          const describe=file=>({name:file.name,type:file.type,size:file.size});
          const ticket=await request('image-pipeline-ticket',{source:'face_swap_natural',job_id:entry.id,character_id:entry.character,workflow_key:'genjutsu',duration_seconds:seconds,original:describe(entry.file),reference:describe(entry.frame)});
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
    container.innerHTML='<div class="production-head"><div><h2>GENJUTSU</h2><p>Prepare a modelo e gere o vídeo automaticamente.</p></div></div><div class="production-workflow-tabs" role="tablist" aria-label="Fluxo da Produção IA">'+[['standard','Vídeo 7 minutos'],['motion_control','Motion Control v7'],['genjutsu','GENJUTSU']].map(([key,name])=>'<button class="production-workflow-tab '+(key==='genjutsu'?'active':'')+'" type="button" role="tab" aria-selected="'+(key==='genjutsu')+'" onclick="CloudentMotionControl.setMode(\''+key+'\')">'+name+'</button>').join('')+'</div><section data-genjutsu-root data-owner="'+e(owner)+'"><p class="muted" data-gen-config role="status">Conferindo configuração…</p><div class="card"><label>Vídeos de referência<input type="file" accept="video/mp4,video/webm,video/quicktime" multiple></label><p class="muted">Até 30 MiB por vídeo. Escolha uma modelo para cada arquivo.</p><div data-gen-entries></div><button type="button" class="btn primary" data-send disabled>Adicionar à fila</button><p data-gen-status role="status" aria-live="polite"></p><p data-gen-error role="alert"></p></div><div data-gen-jobs style="display:grid;gap:14px;margin-top:20px"></div></section>';
    const section=root();
    section.onchange=event=>{
      if(busy)return;
      if(event.target.type==='file'){
        try{const files=[...event.target.files];for(const file of files)if(!['video/mp4','video/webm','video/quicktime'].includes(file.type)||!file.size||file.size>30*1024*1024)throw new Error('Selecione vídeos de até 30 MiB em MP4, WebM ou MOV.');
          for(const file of files)if(!entries.some(x=>x.file.name===file.name&&x.file.size===file.size&&x.file.lastModified===file.lastModified))entries.push({id:crypto.randomUUID(),file,url:URL.createObjectURL(file),character:''});
          event.target.value='';message('',true);drawEntries();
        }catch(error){message(error.message,true);}
      }else if(event.target.dataset.model){const entry=entries.find(x=>x.id===event.target.dataset.model);if(entry&&!entry.locked)entry.character=event.target.value;}
    };
    section.onclick=event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.hasAttribute('data-send'))return send();
      if(button.dataset.remove){if(busy)return;const entry=entries.find(x=>x.id===button.dataset.remove);if(entry){URL.revokeObjectURL(entry.url);entries=entries.filter(x=>x!==entry);}drawEntries();return;}
      return action(button);
    };
    drawEntries();drawJobs();refresh();
    if(!timer)timer=setInterval(()=>{reset();if(active()&&cloudSession&&!document.hidden)refresh();},10000);
  }
  window.CloudentGenjutsu={render,refresh,get busy(){return busy;}};
})();
