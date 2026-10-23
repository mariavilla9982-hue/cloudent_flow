/* Shared controller for three image/video pipelines. */
(()=>{
  const style=document.createElement('style');style.textContent='[data-pipeline-mounted] form{display:grid;gap:18px}[data-pipeline-mounted] form label{display:grid;gap:10px;min-width:0}[data-pipeline-mounted] input[type=file]{max-width:100%;width:100%;font-size:12px}[data-pipeline-mounted] article{min-width:0;overflow-wrap:anywhere}[data-pipeline-mounted] .toolbar{flex-wrap:wrap}';document.head.appendChild(style);
  style.textContent+=`.pipeline-job{display:grid;grid-template-columns:92px minmax(0,1fr);gap:18px;padding:18px!important;background:#0d0d0d;border:1px solid #292929;border-radius:16px;overflow:hidden}
.pipeline-job-preview{position:relative;aspect-ratio:3/4;border-radius:11px;overflow:hidden;background:#171717;margin:0;align-self:start;border:1px solid #292929}
.pipeline-job-preview a{display:block;width:100%;height:100%;cursor:zoom-in}.pipeline-job-preview a:focus-visible{outline:2px solid #fff;outline-offset:-3px}
.pipeline-job-preview img,.pipeline-job-preview video{width:100%;height:100%;object-fit:cover;display:block}
.pipeline-job-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:#777;font-size:10px;text-align:center;padding:8px}
.pipeline-job-placeholder svg{width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:1.4}
.pipeline-preview-tag{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.85));padding:22px 8px 8px;font-size:9px;letter-spacing:.04em;color:#eee;pointer-events:none}
.pipeline-job-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.pipeline-job-name{font-size:13px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;color:#f5f5f5}.pipeline-job-badge{white-space:nowrap;font-size:9px;font-weight:700;letter-spacing:.08em;padding:5px 8px;border:1px solid #383838;border-radius:6px;color:#bbb}.pipeline-job-badge.ready{background:#eee;color:#111;border-color:#eee}.pipeline-job-badge.failed{color:#f3a5a5;border-color:#543434}
.pipeline-job-current{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:600;color:#eee;margin:0 0 5px}.pipeline-status-dot{width:7px;height:7px;flex:none;border-radius:50%;background:#eee;box-shadow:0 0 0 4px #ffffff0a}.pipeline-job-subtitle{font-size:11px;color:#8a8a8a;margin:0 0 18px}
.pipeline-stage-track{display:grid;grid-template-columns:repeat(var(--stages),minmax(0,1fr));gap:5px;margin-bottom:12px}.pipeline-stage-segment{height:5px;border-radius:8px;background:#262626;position:relative;overflow:hidden}.pipeline-stage-segment.done{background:#eee}.pipeline-stage-segment.active::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,#aaa,transparent);transform:translateX(-100%);animation:pipeline-stage-sweep 1.8s linear infinite}.pipeline-stage-segment.failed{background:#8c5454}
.pipeline-step-list{display:grid;grid-template-columns:repeat(var(--stages),minmax(0,1fr));list-style:none;padding:0;margin:0 0 18px;gap:5px}.pipeline-step{display:flex;gap:6px;align-items:center;min-width:0;color:#686868;font-size:10px}.pipeline-step-icon{display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;border:1px solid #333;flex:none;font-size:9px}.pipeline-step.done{color:#ccc}.pipeline-step.done .pipeline-step-icon{background:#ddd;border-color:#ddd;color:#111}.pipeline-step.active{color:#fff}.pipeline-step.active .pipeline-step-icon{border-color:#aaa}.pipeline-step.failed{color:#e9a3a3}.pipeline-job-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;border-top:1px solid #222;padding-top:13px}.pipeline-job-actions .btn{font-size:11px;min-height:33px}.pipeline-job-actions .pipeline-delete{margin-left:auto;color:#888}.pipeline-job-error{font-size:11px;line-height:1.5;color:#dea5a5;background:#201616;border:1px solid #3e2929;border-radius:8px;padding:10px;margin:10px 0}.pipeline-job [data-result]:not(:empty){grid-column:1/-1;padding-top:8px}.pipeline-job [data-result] img,.pipeline-job [data-result] video{border-radius:10px}
.face-swap-jobs{display:grid;gap:12px;width:100%;max-width:1120px;margin:0 auto}.pipeline-queue-summary{display:flex;gap:18px;flex-wrap:wrap;padding:14px 16px;border:1px solid #292929;border-radius:12px;background:#101010;font-size:12px;color:#aaa}.pipeline-queue-summary strong{color:#eee}.pipeline-group-title{margin:16px 0 2px;font-size:12px;font-weight:600;color:#aaa;letter-spacing:.03em}.pipeline-step.queued{color:#aaa}.pipeline-step.queued .pipeline-step-icon{border-style:dashed}.pipeline-stage-segment.queued{background:#444}.pipeline-job-number{color:#777;font-size:10px;white-space:nowrap}.pipeline-job-notice{font-size:11px;line-height:1.5;color:#aaa;background:#151515;border:1px solid #292929;border-radius:8px;padding:10px;margin:10px 0}
@keyframes pipeline-stage-sweep{to{transform:translateX(100%)}}
@media(max-width:600px){.pipeline-job{grid-template-columns:74px minmax(0,1fr);gap:12px;padding:12px!important}.pipeline-job-head{flex-wrap:wrap;gap:6px;margin-bottom:10px}.pipeline-job-name{width:100%;font-size:11px}.pipeline-job-current{font-size:12px}.pipeline-job-subtitle{font-size:10px;margin-bottom:14px}.pipeline-step{flex-direction:column;align-items:flex-start;gap:5px;font-size:9px}.pipeline-job-actions{gap:6px}.pipeline-job-actions .btn{font-size:10px;padding:6px 9px}.pipeline-job-actions .pipeline-delete{margin-left:0}}
@media(prefers-reduced-motion:reduce){.pipeline-stage-segment.active::after{animation:none;transform:none;background:#777}}
`;
  const sources={faceSwap:'face_swap_natural',upscale:'upscale_manual',faceSwapPhoto:'face_swap_photo'};
  const titles={faceSwap:'Produção automática',upscale:'Upscale de imagem',faceSwapPhoto:'Face Swap de imagem'};
  const characters=[{id:'jujuh',name:'Jujuh'},{id:'sahry_japah',name:'Sahry japah'},{id:'sahry_gravida',name:'Sahry grávida'}];
  let characterRequest=null;
  function characterSelector(){
    return '<fieldset class="pipeline-characters"><legend>Para qual modelo é este vídeo?</legend><p>Selecione uma, duas ou as três. Cada modelo escolhida gera um vídeo separado.</p><div class="pipeline-character-grid">'+characters.map(c=>'<label class="pipeline-character"><input type="checkbox" name="character" value="'+c.id+'"><img data-character-preview="'+c.id+'" alt="Folha de '+c.name+'" hidden><strong>'+c.name+'</strong><a data-character-open="'+c.id+'" target="_blank" rel="noopener" hidden>Abrir folha ↗</a></label>').join('')+'</div><p data-character-count>Escolha pelo menos uma modelo.</p></fieldset>';
  }
  style.textContent+='.pipeline-characters{border:1px solid #333;border-radius:12px;padding:16px;min-width:0}.pipeline-characters p{font-size:12px;color:#aaa}.pipeline-character-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.pipeline-character{border:1px solid #333;border-radius:10px;padding:10px;cursor:pointer;font-size:12px;align-content:start}.pipeline-character:has(input:checked){border-color:#fff;background:#202020}.pipeline-character img{width:100%;aspect-ratio:16/9;object-fit:contain;background:#111;border-radius:6px}.pipeline-character input{width:18px;height:18px;accent-color:#fff}.pipeline-character a{font-size:10px;color:#bbb}.pipeline-character-tag{display:inline-block;border:1px solid #555;padding:4px 8px;border-radius:6px;font-size:10px;margin-bottom:10px}@media(max-width:420px){.pipeline-character-grid{gap:6px}.pipeline-character{padding:7px;font-size:11px}}';
  async function loadCharacters(root){
    const uid=owner;
    try{
      if(!characterRequest)characterRequest=cloudFetch('?resource=image-pipeline-characters').catch(err=>{characterRequest=null;throw err;});
      const r=await characterRequest;if(uid!==cloudSession?.user?.id||!root.isConnected)return;
      for(const c of r.characters||[]){for(const img of root.querySelectorAll('[data-character-preview="'+c.id+'"]')){img.src=c.preview_url;img.hidden=false;const a=img.parentElement.querySelector('[data-character-open="'+c.id+'"]');a.href=c.preview_url;a.hidden=false;a.onclick=evt=>{evt.preventDefault();evt.stopPropagation();const win=window.open('','_blank');if(win){win.opener=null;const image=win.document.createElement('img');image.src=c.preview_url;image.style.maxWidth='100%';win.document.body.append(image);}};}}
    }catch(err){if(uid===cloudSession?.user?.id)root.querySelector('[data-pipeline-error]').textContent='Não foi possível carregar as folhas: '+err.message;}
  }
  style.textContent+='[data-batch-list]{display:grid;gap:16px}.pipeline-upload-entry{border:1px solid #303030;background:#111;border-radius:12px;padding:14px;display:grid;gap:12px;min-width:0}.pipeline-upload-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.pipeline-upload-head strong{min-width:0;font-size:12px;overflow-wrap:anywhere}.pipeline-upload-head .btn{flex:none;font-size:11px}.pipeline-upload-entry [data-entry-status]{font-size:12px;color:#aaa;margin:0}@media(max-width:420px){.pipeline-upload-head{align-items:flex-start;flex-direction:column}.pipeline-upload-entry{padding:10px}}';
  const drafts={},busy=new Set(),previewCache=new Map(),viewFilters={},searchTerms={},resultCache=new Map();let jobs=[],loading=false,timer=null,generation=0,owner=cloudSession?.user?.id||'';
  function batchDraft(){return drafts.faceSwap||(drafts.faceSwap={id:crypto.randomUUID(),urls:{},entries:[]});}
  function addBatchFiles(files){
    const d=batchDraft();d.entries=d.entries||[];
    for(const f of files){
      if(!f.type.startsWith('video/'))throw new Error('Selecione somente vídeos.');
      if(!f.size||f.size>500*1024*1024)throw new Error('Cada vídeo deve ter até 500 MB.');
    }
    for(const f of files){if(d.entries.some(x=>x.original.name===f.name&&x.original.size===f.size&&x.original.lastModified===f.lastModified))continue;d.entries.push({id:crypto.randomUUID(),original:f,urls:{original:URL.createObjectURL(f)},characters:[],variantIds:{}});}
  }
  function drawBatch(root){
    const list=root.querySelector('[data-batch-list]');if(!list)return;
    const entries=drafts.faceSwap?.entries||[];
    list.innerHTML=entries.map((d,i)=>'<article class="pipeline-upload-entry" data-entry="'+d.id+'"><div class="pipeline-upload-head"><div><strong>'+String(i+1).padStart(2,'0')+' · '+e(d.original.name)+'</strong><div class="studio-entry-tags">'+characters.filter(c=>d.characters.includes(c.id)).map(c=>'<span>'+e(c.name)+'</span>').join('')+'</div></div><button type="button" class="btn" data-remove-entry="'+d.id+'" aria-label="Remover '+e(d.original.name)+'">Remover</button></div><video class="studio-entry-media" controls playsinline preload="metadata" src="'+e(d.urls.original)+'"></video>'+characterSelector()+'<p role="status" data-entry-status>'+e(d.error||'Aguardando envio')+'</p></article>').join('')||'<p class="muted">Adicione os vídeos. Escolha uma ou mais modelos para cada arquivo.</p>';
    for(const d of entries){const row=list.querySelector('[data-entry="'+d.id+'"]');for(const c of row.querySelectorAll('input[name=character]'))c.checked=d.characters.includes(c.value);row.querySelector('[data-character-count]').textContent=d.characters.length?d.characters.length+' vídeo(s) serão gerados para este arquivo.':'Escolha pelo menos uma modelo.';}
    if(entries.length)loadCharacters(list);
    const count=root.querySelector('[data-batch-count]');if(count)count.textContent=entries.length+' vídeo(s) selecionado(s)';
  }
  async function submitBatch(root){
    if(busy.has('faceSwap'))return;
    const form=root.querySelector('form'),status=form.querySelector('[data-pipeline-status]'),error=form.querySelector('[data-pipeline-error]');
    const d=drafts.faceSwap,entries=d?.entries||[],uid=owner;
    error.textContent='';
    if(!entries.length){error.textContent='Selecione os vídeos.';return;}
    const missing=entries.find(x=>!x.characters.length);if(missing){error.textContent='Escolha pelo menos uma modelo para '+missing.original.name+'.';return;}
    busy.add('faceSwap');form.querySelectorAll('input,button').forEach(x=>x.disabled=true);
    const submitButton=form.querySelector('button[type=submit]');if(submitButton)submitButton.setAttribute?.('aria-busy','true');
    let completed=0,failures=0;
    const describe=f=>({name:f.name,size:f.size,type:f.type});
    try{
      for(const [index,entry] of entries.entries()){
        const row=root.querySelector('[data-entry="'+entry.id+'"] [data-entry-status]');
        try{
          if(uid!==cloudSession?.user?.id)throw new Error('Sessão alterada; selecione os vídeos novamente.');
          status.textContent='Vídeo '+(index+1)+' de '+entries.length+' · '+entry.original.name;
          if(row)row.textContent='Preparando envio…';
          entry.reference=entry.reference||new File([await extractFirstFrameBlob(entry.urls.original)],'primeiro-frame.jpg',{type:'image/jpeg'});
          for(const c of characters.filter(c=>entry.characters.includes(c.id))){
            if(uid!==cloudSession?.user?.id)throw new Error('Sessão alterada durante o envio.');
            const id=entry.variantIds[c.id]||(entry.variantIds[c.id]=crypto.randomUUID());
            if(row)row.textContent='Enviando para '+c.name+'…';
            const ticket=await request('image-pipeline-ticket',{source:sources.faceSwap,job_id:id,character_id:c.id,original:describe(entry.original),reference:describe(entry.reference)});
            if(!ticket.registered){await uploadFaceSwapPart(ticket.original,entry.original,()=>{});if(!ticket.same_input)await uploadFaceSwapPart(ticket.reference,entry.reference,()=>{});if(uid!==cloudSession?.user?.id)throw new Error('Sessão alterada durante o envio.');await request('image-pipeline-complete',{job_id:ticket.job_id});}
          }
          entry.sent=true;entry.error='';completed++;if(row)row.textContent='Envio confirmado. Processamento automático na fila.';
        }catch(err){failures++;entry.error=err.message;if(row)row.textContent=err.message;if(uid!==cloudSession?.user?.id)break;}
      }
      if(uid===cloudSession?.user?.id&&drafts.faceSwap===d){
        for(const entry of entries.filter(x=>x.sent))Object.values(entry.urls).forEach(url=>URL.revokeObjectURL(url));
        d.entries=entries.filter(x=>!x.sent);drawBatch(root);
        status.textContent=completed+' vídeo(s) enviado(s).'+(failures?' '+failures+' com envio pendente; tente novamente.':' O processamento continua automaticamente.');
        if(failures)error.textContent='Os envios confirmados foram preservados. Confira os vídeos restantes.';
      }
      await refresh();
    }finally{busy.delete('faceSwap');form.querySelectorAll('input,button').forEach(x=>x.disabled=false);submitButton?.removeAttribute?.('aria-busy');}
  }
  function resetOwner(){
    const id=cloudSession?.user?.id||'';if(id===owner)return;
    owner=id;generation++;jobs=[];previewCache.clear();resultCache.clear();characterRequest=null;
    for(const key of Object.keys(viewFilters))delete viewFilters[key];for(const key of Object.keys(searchTerms))delete searchTerms[key];
    for(const [key,d] of Object.entries(drafts)){Object.values(d.urls||{}).forEach(url=>URL.revokeObjectURL(url));for(const entry of d.entries||[])Object.values(entry.urls||{}).forEach(url=>URL.revokeObjectURL(url));delete drafts[key];}
    for(const id of Object.keys(sources)){const root=document.getElementById(id);if(root){root.replaceChildren();delete root.dataset.pipelineMounted;}}
  }
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const request=(action,body,method='POST')=>cloudFetch('?action='+action,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  function resultRequest(path){
    const key=owner+':'+path,cached=resultCache.get(key);
    if(cached&&cached.until>Date.now())return cached.promise;
    const promise=cloudFetch(path).catch(err=>{resultCache.delete(key);throw err;});
    resultCache.set(key,{promise,until:Date.now()+10*60000});
    if(resultCache.size>80)resultCache.delete(resultCache.keys().next().value);
    return promise;
  }
  async function showResult(root,id){
    const uid=owner,token=crypto.randomUUID(),box=root.querySelector('[data-studio-result]')||root.querySelector('[data-result="'+id+'"]');
    if(!box)return;box.dataset.resultToken=token;box.dataset.selectedJob=id;
    box.innerHTML='<p class="studio-empty" role="status">Carregando resultado…</p>';
    const valid=()=>uid===cloudSession?.user?.id&&box.isConnected&&box.dataset.resultToken===token;
    try{
      const r=await resultRequest('?resource=image-pipeline-result&id='+encodeURIComponent(id));if(!valid())return;
      box.innerHTML='<div class="studio-result-body"></div><div class="studio-result-actions"><button type="button" class="btn" data-enlarge="'+e(id)+'">Ampliar</button><button type="button" class="btn primary" data-download="'+e(id)+'">Baixar '+(r.type==='video'?'vídeo':'imagem')+'</button>'+(r.type==='video'?'<button type="button" class="btn" data-calendar="'+e(id)+'">Calendário</button>':'')+'</div>';
      const body=box.querySelector('.studio-result-body');
      if(r.type==='video'){body.innerHTML='<video controls playsinline preload="metadata" aria-label="Vídeo final"></video>';body.firstChild.src=r.url;return;}
      try{
        // The native frame endpoint returns the actual target/reference, never the model sheet.
        const before=await resultRequest('?resource=face-swap-preview&kind=frame&id='+encodeURIComponent(id));if(!valid())return;
        if(!window.CloudentStudio?.comparison)throw new Error('Comparador indisponível');
        window.CloudentStudio.comparison(body,before.url,r.url);
      }catch{if(valid()){body.innerHTML='<img alt="Imagem final"><p class="studio-compare-hint">Original indisponível para comparação. Resultado preservado.</p>';body.firstChild.src=r.url;}}
    }catch(err){if(valid()){box.replaceChildren();const msg=document.createElement('p');msg.className='studio-empty';msg.textContent='Não foi possível abrir o resultado: '+err.message;box.append(msg);}}
  }
  async function showComparison(root,id){
    const uid=owner,box=root.querySelector('[data-studio-result]')||root.querySelector('[data-result="'+id+'"]');if(!box)return;
    const token=crypto.randomUUID();box.dataset.resultToken=token;box.dataset.selectedJob=id;box.innerHTML='<p class="studio-empty" role="status">Carregando comparação…</p>';
    const valid=()=>uid===cloudSession?.user?.id&&box.isConnected&&box.dataset.resultToken===token;
    try{
      const [before,after]=await Promise.all([resultRequest('?resource=face-swap-preview&kind=frame&id='+encodeURIComponent(id)),resultRequest('?resource=image-pipeline-preview&id='+encodeURIComponent(id))]);if(!valid())return;
      box.innerHTML='<div class="studio-result-body"></div><div class="studio-result-actions"><button type="button" class="btn" data-open="'+e(id)+'">Ver vídeo final</button></div>';
      window.CloudentStudio.comparison(box.querySelector('.studio-result-body'),before.url,after.url);
    }catch(err){if(valid()){box.replaceChildren();const p=document.createElement('p');p.className='studio-empty';p.textContent='Comparação indisponível: '+err.message;box.append(p);}}
  }
  async function refresh(){
    if(loading||!cloudSession||!sources[currentPage])return;loading=true;
    const g=++generation,uid=cloudSession.user?.id;
    try{if(typeof loadPanelViews==='function')await loadPanelViews();const r=await cloudFetch('?resource=image-pipeline');if(g!==generation||uid!==cloudSession?.user?.id)return;jobs=r.jobs||[];drawJobs();}
    catch(err){const root=document.querySelector('#'+currentPage+' [data-pipeline-error]');if(root)root.textContent=err.message;}
    finally{loading=false;}
  }
  function label(j){
    const m=j.meta||{};
    if(j.production?.status==='ready')return 'Vídeo pronto';
    if(j.status==='ready')return m.source==='face_swap_natural'?'Vídeo pronto':'Imagem pronta';
    if(j.status==='failed'||j.production?.status==='failed')return 'Falha em '+({face_swap:'Face Swap',upscale:'Upscale',control_motion:'Control Motion'}[m.error_stage||m.stage]||'processamento');
    return {UPLOADING:'Aguardando upload',UPLOADED:'Arquivos enviados',FACE_SWAP_RUNNING:'Face Swap processando…',FACE_SWAP_COMPLETED:'Face Swap ✓ · Upscale aguardando',UPSCALE_RUNNING:'Face Swap ✓ · Upscale processando…',CONTROL_MOTION_RUNNING:'Face Swap ✓ · Upscale ✓ · Control Motion processando…',COMPLETED:'Concluído'}[m.pipeline_status]||'Aguardando';
  }
  function queueState(j){
    const p=j.meta?.stage==='control_motion'?j.production:null;
    const status=p?.status||j.status;
    return !['failed','ready','cancelled'].includes(status)&&(
      ['waiting','motion_waiting','queued'].includes(status)||p?.meta?.provider_queue_waiting===true||j.meta?.stage!=='control_motion'&&j.meta?.provider_queue_waiting===true);
  }
  function pipelineSteps(j){
    const m=j.meta||{},ready=j.status==='ready'||j.production?.status==='ready';
    const natural=m.source==='face_swap_natural',manual=m.source==='upscale_manual';
    const steps=[{key:'upload',name:manual?'Imagem':natural?'Upload':'Imagens',done:m.stage!=='upload'}];
    if(!manual)steps.push({key:'face_swap',name:'Face Swap',done:!!m.face_swap_result});
    steps.push({key:'upscale',name:'Upscale',done:!!m.upscale_result||ready&&!natural});
    if(natural)steps.push({key:'control_motion',name:'Motion V7',done:ready});
    if(ready)steps.forEach(step=>step.done=true);
    const failed=j.status==='failed'||j.production?.status==='failed',queued=!ready&&!failed&&queueState(j);
    const current=steps.findIndex(step=>!step.done);
    steps.forEach((step,index)=>step.state=step.done?'done':index===current?(failed?'failed':queued?'queued':'active'):'waiting');
    return {steps,ready,failed,queued,done:steps.filter(step=>step.done).length,current};
  }
  async function fillJobPreviews(node,rows){
    const uid=owner;
    for(const j of rows){
      const target=node.querySelector('[data-pipeline-preview="'+j.id+'"]');if(!target)continue;
      const version=j.meta?.upscale_result?.path||j.meta?.face_swap_result?.path||j.frame_storage_path;
      const key=uid+':'+j.id+':'+version;
      try{
        let saved=previewCache.get(key);
        if(!saved||saved.expires<Date.now()){
          const pending=cloudFetch('?resource=image-pipeline-preview&id='+encodeURIComponent(j.id));
          saved={pending,expires:Date.now()+15*60*1000};previewCache.set(key,saved);
        }
        const preview=await saved.pending;
        if(uid!==cloudSession?.user?.id||!target.isConnected)continue;
        let link=target.querySelector('a');if(!link){link=document.createElement('a');link.target='_blank';link.rel='noopener noreferrer';target.prepend(link);}
        link.href=preview.url;link.title='Abrir imagem em tamanho original';link.setAttribute('aria-label','Abrir '+preview.label+' em tamanho original (nova aba)');
        let img=link.querySelector('img');if(!img){img=document.createElement('img');img.alt='Prévia do processamento';img.loading='lazy';link.append(img);}
        img.onload=()=>target.querySelector('.pipeline-job-placeholder')?.remove();
        img.onerror=()=>{img.remove();const hint=target.querySelector('.pipeline-job-placeholder span');if(hint)hint.textContent='Prévia indisponível';};
        img.src=preview.url;
        const tag=target.querySelector('.pipeline-preview-tag');if(tag)tag.textContent=preview.label+' · Ampliar ↗';
      }catch{previewCache.delete(key);const hint=target.querySelector('.pipeline-job-placeholder span');if(hint)hint.textContent='Prévia indisponível';}
    }
  }
  function drawJobs(){
    const node=document.querySelector('#'+currentPage+' [data-pipeline-jobs]');if(!node)return;
    const rank=j=>j.status==='ready'||j.production?.status==='ready'?2:j.status==='failed'||j.production?.status==='failed'?3:queueState(j)?1:0;
    const stageRank=j=>({face_swap:0,upscale:1,control_motion:2}[j.meta?.stage]??3);
    const allRows=jobs.filter(j=>j.meta.source===sources[currentPage]);
    const visibleRows=(typeof panelVisibleRows==='function'?panelVisibleRows(currentPage,allRows):allRows).sort((a,b)=>rank(a)-rank(b)||(rank(a)===1?stageRank(a)-stageRank(b):0)||String(a.created_at||'').localeCompare(String(b.created_at||''))||a.id.localeCompare(b.id));
    const dock=document.querySelector('#'+currentPage+' [data-studio-result]');
    if(dock?.dataset.selectedJob&&!visibleRows.some(j=>j.id===dock.dataset.selectedJob)){delete dock.dataset.selectedJob;delete dock.dataset.resultToken;dock.innerHTML='<p class="studio-empty">Selecione um resultado na lista.</p>';}
    const filter=viewFilters[currentPage]||'all',term=(searchTerms[currentPage]||'').trim().toLocaleLowerCase('pt-BR');
    const rows=visibleRows.filter(j=>(filter==='all'||filter==='active'&&rank(j)<2||filter==='ready'&&rank(j)===2||filter==='failed'&&rank(j)===3)&&(!term||String(j.original_file_name+' '+(j.meta?.character_name||'')).toLocaleLowerCase('pt-BR').includes(term)));
    const signature=JSON.stringify([filter,term,typeof panelViews==='undefined'?null:panelViews[currentPage],rows.map(j=>[j.id,j.status,j.meta?.pipeline_status,j.meta?.face_swap_result?.path,j.meta?.upscale_result?.path,j.last_error,j.meta?.provider_queue_waiting,j.meta?.queue_reason,j.production?.meta?.provider_queue_waiting,j.production?.status,j.production?.progress])]);
    if(node.dataset.signature===signature)return;node.dataset.signature=signature;
    const groups=['Em processamento','Na fila','Concluídos','Precisam de atenção'];
    const counts=groups.map((_,i)=>rows.filter(j=>rank(j)===i).length);
    let previous=-1,previousStage='',queuePositions={};
    const stageNames={face_swap:'Face Swap',upscale:'Upscale',control_motion:'Motion V7'};
    const stageSummary='<div class="pipeline-queue-summary" aria-label="Filas por etapa">'+Object.entries(stageNames).map(([stage,name])=>'<span>'+name+' · <strong>'+rows.filter(j=>rank(j)<2&&j.meta.stage===stage).length+'</strong> pendentes</span>').join('')+'</div>';
    const summary=stageSummary+'<div class="pipeline-queue-summary" role="status">'+['Processando','Aguardando','Concluídos','Atenção'].map((name,i)=>'<span><strong>'+counts[i]+'</strong> '+name+'</span>').join('')+'</div>';
    node.innerHTML=(typeof panelViewToolbar==='function'?panelViewToolbar(currentPage,rows):'')+(rows.length?summary+rows.map((j,index)=>{
      const group=rank(j),stage=j.meta.stage;let heading=previous!==group?'<h3 class="pipeline-group-title">'+groups[group]+'</h3>':'';
      if(group===1&&(previous!==group||previousStage!==stage))heading+='<h4 class="pipeline-group-title">Fila de '+e(stageNames[stage]||'processamento')+'</h4>';
      previous=group;previousStage=stage;
      const state=pipelineSteps(j),{ready,failed,steps,queued}=state;
      const retry=j.status==='failed'&&j.meta.provider_failed&&!j.meta.dispatch_uncertain;
      const current=state.current>=0?steps[state.current].name:'';
      if(queued)queuePositions[stage]=(queuePositions[stage]||0)+1;
      const preparing=queued&&stage==='upscale'&&!j.runninghub_task_id&&!j.meta.provider_queue_waiting&&j.meta.queue_reason!=='provider_capacity';
      const title=ready?(j.meta.source==='face_swap_natural'?'Vídeo final pronto':'Imagem final pronta'):failed?'Falha em '+current:preparing?'Preparando Upscale':queued?'Na fila de '+current:current+' em processamento';
      const subtitle=ready?'Concluído · resultado disponível para visualizar e baixar':failed?'As etapas concluídas foram preservadas':preparing?'Imagem salva · encaminhamento automático ao Upscale.':queued?(stage==='upscale'?(j.meta.source==='upscale_manual'?'Imagem enviada · aguardando sua vez no Upscale.':'Face Swap salvo · aguardando vaga confirmada no provedor.'):stage==='control_motion'?'Imagem final salva · aguardando na fila do Motion V7.':'Fila própria de Face Swap · inicia quando houver vaga na RunningHub.'):state.done+' de '+steps.length+' etapas concluídas · processamento automático';
      const deletable=['ready','failed','cancelled'].includes(j.status)&&!j.meta.dispatch_uncertain;
      return heading+'<article class="card pipeline-job" style="--stages:'+steps.length+'">'+
        '<figure class="pipeline-job-preview" data-pipeline-preview="'+j.id+'"><div class="pipeline-job-placeholder"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m4 17 5-5 4 4 3-3 5 5"/><circle cx="15" cy="8" r="2"/></svg><span>Carregando prévia</span></div><figcaption class="pipeline-preview-tag">Prévia</figcaption></figure>'+
        '<div class="pipeline-job-info"><div class="pipeline-job-head"><span class="pipeline-job-number">'+(queued?'FILA '+String(queuePositions[stage]).padStart(2,'0'):'VÍDEO '+String(jobs.filter(x=>x.meta.source===sources[currentPage]).slice().sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))||a.id.localeCompare(b.id)).findIndex(x=>x.id===j.id)+1).padStart(2,'0'))+'</span><strong class="pipeline-job-name" title="'+e(j.original_file_name)+'">'+e(j.original_file_name)+'</strong><span class="pipeline-job-badge '+(ready?'ready':failed?'failed':'')+'">'+(ready?'CONCLUÍDO':failed?'ATENÇÃO':preparing?'PREPARANDO':queued?'NA FILA':'PROCESSANDO')+'</span></div>'+
        (j.meta.character_name?'<span class="pipeline-character-tag">'+e(j.meta.character_name)+'</span>':'')+'<p class="pipeline-job-current"><span class="pipeline-status-dot"></span>'+e(title)+'</p><p class="pipeline-job-subtitle">'+e(subtitle)+'</p>'+
        '<div class="pipeline-stage-track" role="progressbar" aria-label="Etapas concluídas" aria-valuemin="0" aria-valuemax="'+steps.length+'" aria-valuenow="'+state.done+'" aria-valuetext="'+e(title)+'">'+steps.map(step=>'<span class="pipeline-stage-segment '+step.state+'"></span>').join('')+'</div>'+
        '<ol class="pipeline-step-list">'+steps.map((step,i)=>'<li class="pipeline-step '+step.state+'" '+(step.state==='active'?'aria-current="step"':'')+'><span class="pipeline-step-icon">'+(step.done?'✓':step.state==='failed'?'!':i+1)+'</span><span>'+step.name+'</span></li>').join('')+'</ol>'+
        (j.last_error?'<p class="'+(failed?'pipeline-job-error':'pipeline-job-notice')+'">'+e(j.last_error)+'</p>':'')+
        '<div class="pipeline-job-actions">'+(j.meta.source==='face_swap_natural'?'<button type="button" class="btn" data-original="'+j.id+'">▷ Vídeo original</button>':'')+(j.meta.source==='face_swap_natural'&&(j.meta.upscale_result||j.meta.face_swap_result)?'<button type="button" class="btn" data-compare="'+j.id+'">Comparar imagem</button>':'')+(ready?'<button type="button" class="btn primary" data-open="'+j.id+'">Ver resultado</button><button type="button" class="btn" data-download="'+j.id+'">↓ Baixar</button>':'')+(ready&&j.meta.source==='face_swap_natural'?'<button type="button" class="btn" data-calendar="'+j.id+'">Adicionar ao calendário</button>':'')+(retry?'<button type="button" class="btn" data-retry="'+j.id+'">Tentar etapa novamente</button>':'')+'<button type="button" class="btn pipeline-delete" data-delete="'+j.id+'" '+(deletable?'':'disabled title="Disponível após o processamento"')+'>Excluir</button></div></div><div data-result="'+j.id+'"></div></article>';
    }).join(''):'<div class="card"><p class="muted">Envie um arquivo para acompanhar as etapas e a prévia aqui.</p></div>');
    fillJobPreviews(node,rows);
  }
  async function loadPinnedModel(root){
    const page='faceSwapPhoto',uid=owner;
    const draft=drafts[page]||(drafts[page]={id:crypto.randomUUID(),urls:{}});
    if(draft.original)return;
    const originalRevision=draft.id;
    try{
      const saved=await cloudFetch('?resource=image-pipeline-model');
      const response=await fetch(saved.url);if(!response.ok)throw new Error('Não foi possível carregar a modelo fixada.');
      const blob=await response.blob();
      if(uid!==cloudSession?.user?.id||drafts[page]!==draft||draft.id!==originalRevision||draft.original)return;
      draft.original=new File([blob],saved.name,{type:saved.type});draft.urls.original=URL.createObjectURL(blob);
      const preview=root.querySelector('[data-preview="original"]');
      preview.innerHTML='<img alt="Modelo raiz fixada" style="max-width:100%;max-height:220px"><small>Modelo raiz fixada</small>';
      preview.querySelector('img').src=draft.urls.original;
    }catch(err){if(uid===cloudSession?.user?.id)root.querySelector('[data-pipeline-error]').textContent=err.message;}
  }
  function render(page){
    resetOwner();if(!sources[page])return;
    const root=document.getElementById(page);if(!root)return;
    if(root.dataset.pipelineMounted==='10'){drawJobs();refresh();return;}
    root.dataset.pipelineMounted='10';
    const photo=page==='faceSwapPhoto',natural=page==='faceSwap';
    const tabs='<div class="studio-tabs" role="tablist" aria-label="Modo de produção">'+[['faceSwap','Produção automática'],['faceSwapPhoto','Apenas foto'],['upscale','Upscale']].map(([id,label])=>'<button type="button" role="tab" aria-selected="'+(id===page)+'" class="btn '+(id===page?'primary':'')+'" data-mode="'+id+'">'+label+'</button>').join('')+'</div>';
    const upload=(kind,title,help)=>'<div class="studio-form-inputs"><label class="studio-upload"><input name="'+kind+'" type="file" accept="'+(natural?'video/*':'image/jpeg,image/png,image/webp')+'" '+(natural?'multiple':photo&&kind==='original'?'':'required')+'><span><b>'+title+'</b><small>'+help+'</small></span><span class="studio-upload-action">Escolher '+(natural?'vídeos':'foto')+'</span><div data-preview="'+kind+'"></div></label><button class="btn" type="button" data-remove="'+kind+'">Remover '+(kind==='reference'?'foto alvo':natural?'vídeos':'imagem')+'</button></div>';
    root.classList?.add('studio-page');
    root.innerHTML='<div class="face-swap-shell"><div class="studio-page-header"><div><span class="studio-eyebrow">FACE SWAP</span><h2>'+titles[page]+'</h2><p>'+(natural?'Envie seus vídeos e escolha uma ou mais modelos para cada arquivo.':photo?'Escolha a modelo e a foto alvo. Compare o original com a imagem final.':'Melhore a imagem e confira a diferença antes de baixar.')+'</p></div></div>'+tabs+'<div class="'+(natural?'':'studio-image-workspace')+'"><div class="card studio-input-card"><form data-pipeline-form><div class="studio-form-inputs">'+upload('original',natural?'Adicionar vídeos':photo?'Foto da modelo':'Imagem para upscale',natural?'Selecione vários arquivos de uma vez.':photo?'Modelo fixada ou uma foto enviada por você.':'JPG, PNG ou WebP')+(photo?upload('reference','Foto alvo','A imagem onde a personagem será aplicada.'):'')+'</div>'+(natural?'<div data-batch-list></div>':'')+'<div class="studio-submit-bar"><small '+(natural?'data-batch-count':'')+'>'+(natural?'0 vídeos selecionados':'O processamento continua no servidor.')+'</small><button class="btn primary" type="submit">'+(natural?'Iniciar produção':photo?'Gerar imagem':'Iniciar upscale')+'</button></div><p role="status" data-pipeline-status></p><p role="alert" data-pipeline-error></p></form></div>'+(natural?'':'<aside class="card studio-result-dock"><h3>Comparar resultado</h3><div data-studio-result><div class="studio-empty"><span>↔</span><b>Antes e depois, no mesmo lugar</b><p>Abra um resultado concluído abaixo para comparar arrastando a linha central.</p></div></div></aside>')+'</div><div class="studio-queue-head"><h3>'+(natural?'Fila de produção':'Resultados recentes')+'</h3><button class="btn" type="button" data-refresh>Atualizar</button></div><div class="studio-filters" aria-label="Filtrar resultados">'+[['all','Todos'],['active','Em produção'],['ready','Prontos'],['failed','Erro']].map(([key,label])=>'<button type="button" class="btn" data-filter="'+key+'" aria-pressed="'+((viewFilters[page]||'all')===key)+'">'+label+'</button>').join('')+'<input type="search" data-pipeline-search aria-label="Buscar por nome ou modelo" placeholder="Buscar vídeo ou modelo" value="'+e(searchTerms[page]||'')+'"></div><div class="'+(natural?'studio-queue-workspace':'')+'"><div class="face-swap-jobs" data-pipeline-jobs></div>'+(natural?'<aside class="card studio-result-dock"><h3>Resultado selecionado</h3><div data-studio-result><div class="studio-empty"><span>▷</span><b>Confira imagem ou vídeo</b><p>Selecione Comparar imagem ou Ver resultado em um dos vídeos da fila.</p></div></div></aside>':'')+'</div></div>';
    root.oninput=evt=>{if(evt.target.hasAttribute('data-pipeline-search')){searchTerms[page]=evt.target.value;drawJobs();}};
    root.onchange=evt=>{
      if(busy.has(page))return;
      if(page==='faceSwap'&&evt.target.name==='original'){try{addBatchFiles([...evt.target.files]);evt.target.value='';drawBatch(root);}catch(err){root.querySelector('[data-pipeline-error]').textContent=err.message;}return;}
      if(page==='faceSwap'&&evt.target.name==='character'){
        const entry=drafts.faceSwap?.entries?.find(x=>x.id===evt.target.closest('[data-entry]')?.dataset.entry);if(!entry)return;const row=evt.target.closest('[data-entry]');entry.characters=[...row.querySelectorAll('input[name=character]:checked')].map(x=>x.value);const tags=row.querySelector('.studio-entry-tags');if(tags)tags.innerHTML=characters.filter(c=>entry.characters.includes(c.id)).map(c=>'<span>'+e(c.name)+'</span>').join('');row.querySelector('[data-character-count]').textContent=entry.characters.length?entry.characters.length+' vídeo(s) serão gerados para este arquivo.':'Escolha pelo menos uma modelo.';return;
      }
      if(evt.target.name==='character'){
        const d=drafts[page]||(drafts[page]={id:crypto.randomUUID(),urls:{}});d.characters=[...root.querySelectorAll('input[name=character]:checked')].map(x=>x.value);
        root.querySelector('[data-character-count]').textContent=d.characters.length?d.characters.length+' modelo(s) selecionada(s) · '+d.characters.length+' vídeo(s) serão gerados.':'Escolha pelo menos uma modelo.';return;
      }
      const f=evt.target.files?.[0];if(!f)return;
      const d=drafts[page]||(drafts[page]={id:crypto.randomUUID(),urls:{}});d.id=crypto.randomUUID();d.variantIds={};d[evt.target.name]=f;
      const k=evt.target.name;if(d.urls[k])URL.revokeObjectURL(d.urls[k]);d.urls[k]=URL.createObjectURL(f);
      const p=root.querySelector('[data-preview="'+k+'"]');p.innerHTML=f.type.startsWith('video/')?'<video controls style="max-width:100%;max-height:220px"></video>':'<img alt="Prévia da imagem selecionada" style="max-width:100%;max-height:220px">';p.firstChild.src=d.urls[k];
    };
    root.querySelector('form').addEventListener('submit',evt=>{evt.preventDefault();submit(page,root);});
    root.onclick=async evt=>{
      const b=evt.target.closest('button');if(!b||(b.closest('form')&&b.type==='submit')||b.hasAttribute('data-panel-clear')||b.hasAttribute('data-panel-restore')||b.disabled||b.getAttribute('aria-busy')==='true')return;
      b.setAttribute('aria-busy','true');
      try{
        if(busy.has(page)&&b.closest('form'))return;
        if(b.dataset.removeEntry){const d=drafts.faceSwap,entry=d?.entries?.find(x=>x.id===b.dataset.removeEntry);if(entry){Object.values(entry.urls).forEach(url=>URL.revokeObjectURL(url));d.entries=d.entries.filter(x=>x!==entry);drawBatch(root);}return;}
        if(page==='faceSwap'&&b.dataset.remove==='original'){for(const entry of drafts.faceSwap?.entries||[])Object.values(entry.urls).forEach(url=>URL.revokeObjectURL(url));if(drafts.faceSwap)drafts.faceSwap.entries=[];drawBatch(root);return;}
        if(b.dataset.mode){if(busy.has(page))return;showPage(b.dataset.mode);return;}
        if(b.dataset.remove){const k=b.dataset.remove,d=drafts[page];if(d?.urls[k])URL.revokeObjectURL(d.urls[k]);if(d){delete d[k];delete d.urls[k];d.id=crypto.randomUUID();d.variantIds={};}root.querySelector('input[name="'+k+'"]').value='';root.querySelector('[data-preview="'+k+'"]').replaceChildren();return;}
        if(b.hasAttribute('data-refresh'))return await refresh();
        if(b.dataset.original){
          b.disabled=true;const id=b.dataset.original;
          const r=await cloudFetch('?resource=image-pipeline-preview&kind=original&id='+encodeURIComponent(id));
          const box=root.querySelector('[data-result="'+id+'"]');box.innerHTML='<video controls preload="metadata" style="width:100%;max-height:520px"></video>';box.querySelector('video').src=r.url;return;
        }
        if(b.dataset.filter){viewFilters[page]=b.dataset.filter;root.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));drawJobs();return;}
        if(b.dataset.compare){await showComparison(root,b.dataset.compare);return;}
        if(b.dataset.open){await showResult(root,b.dataset.open);return;}
        if(b.dataset.enlarge){const result=await resultRequest('?resource=image-pipeline-result&id='+encodeURIComponent(b.dataset.enlarge));if(owner!==cloudSession?.user?.id)return;const modal=document.getElementById('modalHost');if(modal){modal.innerHTML='<div class="modal production-preview-modal"><div class="modal-box production-preview-box"><div class="modal-head"><b>Resultado final</b><button type="button" class="btn" onclick="closeModal()">Fechar</button></div>'+(result.type==='video'?'<video controls playsinline></video>':'<img alt="Imagem final">')+'</div></div>';modal.querySelector('img,video').src=result.url;}return;}
        const id=b.dataset.download;
        if(id){
          b.disabled=true;const r=await resultRequest('?resource=image-pipeline-result&id='+encodeURIComponent(id));
          if(b.dataset.download){const response=await fetch(r.url);if(!response.ok)throw new Error('Falha no download');const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(jobs.find(j=>j.id===id)?.meta?.character_name||'cloudentflow')+'-'+id+(r.type==='video'?'.mp4':blob.type==='image/jpeg'?'.jpg':blob.type==='image/webp'?'.webp':'.png');a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
          else{const p=root.querySelector('[data-result="'+id+'"]');p.innerHTML=r.type==='video'?'<video controls style="max-width:100%;max-height:520px"></video>':'<a target="_blank" rel="noopener"><img alt="Imagem final" style="max-width:100%;max-height:520px"></a>';const media=p.querySelector('img,video');media.src=r.url;const a=p.querySelector('a');if(a)a.href=r.url;}
        }
        if(b.dataset.retry){b.disabled=true;await request('image-pipeline-retry',{id:b.dataset.retry},'PATCH');await refresh();}
        if(b.dataset.delete){b.disabled=true;await request('image-pipeline-job',{id:b.dataset.delete},'DELETE');await refresh();}
        if(b.dataset.calendar){await loadProductionData();await openProductionScheduleModal(b.dataset.calendar,1);}
      }catch(err){root.querySelector('[data-pipeline-error]').textContent=err.message;}finally{if(b.isConnected){b.disabled=false;b.removeAttribute('aria-busy');}}
    };
    if(photo)loadPinnedModel(root);
    if(natural)drawBatch(root);
    drawJobs();refresh();
    if(!timer)timer=setInterval(()=>{resetOwner();if(sources[currentPage]&&cloudSession)refresh();else if(!cloudSession){jobs=[];generation++;}},8000);
  }
  async function submit(page,root){
    if(page==='faceSwap'&&drafts.faceSwap?.entries)return submitBatch(root);
    if(busy.has(page))return;busy.add(page);
    const form=root.querySelector('form'),button=form.querySelector('button'),status=form.querySelector('[data-pipeline-status]'),error=form.querySelector('[data-pipeline-error]');
    form.querySelectorAll('input,button').forEach(x=>x.disabled=true);error.textContent='';form.querySelector('button[type=submit]')?.setAttribute?.('aria-busy','true');
    try{
      const submitOwner=owner;const d=drafts[page];if(!d?.original)throw new Error('Selecione o arquivo de entrada.');
      if(page==='faceSwap'&&!(d.characters||[]).length)throw new Error('Escolha pelo menos uma modelo.');
      let reference=d.reference;
      if(page==='faceSwap'){status.textContent='Extraindo primeiro frame…';reference=new File([await extractFirstFrameBlob(d.urls.original)],'primeiro-frame.jpg',{type:'image/jpeg'});}
      const describe=f=>({name:f.name,size:f.size,type:f.type});
      status.textContent='Preparando envio…';
      if(submitOwner!==cloudSession?.user?.id)throw new Error('Sessão alterada; selecione os arquivos novamente.');
      const selected=page==='faceSwap'?characters.filter(c=>(d.characters||[]).includes(c.id)):[null];
      if(!selected.length)throw new Error('Escolha pelo menos uma modelo.');
      d.variantIds=d.variantIds||{};let completed=0;
      for(const character of selected){
        if(submitOwner!==cloudSession?.user?.id)throw new Error('Sessão alterada; selecione os arquivos novamente.');
        const jobId=character?(d.variantIds[character.id]||(d.variantIds[character.id]=crypto.randomUUID())):d.id;
        status.textContent='Enviando '+(character?.name||'arquivos')+' · '+(completed+1)+' de '+selected.length+'…';
        const ticket=await request('image-pipeline-ticket',{source:sources[page],job_id:jobId,character_id:character?.id,original:describe(d.original),reference:reference?describe(reference):null});
        if(!ticket.registered){
          await uploadFaceSwapPart(ticket.original,d.original,()=>{});
          if(!ticket.same_input)await uploadFaceSwapPart(ticket.reference,reference,()=>{});
          if(submitOwner!==cloudSession?.user?.id)throw new Error('Sessão alterada durante o envio.');
          await request('image-pipeline-complete',{job_id:ticket.job_id});
        }
        completed++;
      }
      status.textContent=selected.length+' envio(s) confirmado(s). O processamento continua automaticamente.';
      if(page==='faceSwapPhoto'){
        if(d.urls.reference)URL.revokeObjectURL(d.urls.reference);delete d.urls.reference;delete d.reference;d.id=crypto.randomUUID();form.reset();root.querySelector('[data-preview="reference"]').replaceChildren();
      }else{
        Object.values(d.urls).forEach(url=>URL.revokeObjectURL(url));delete drafts[page];form.reset();root.querySelectorAll('[data-preview]').forEach(p=>p.replaceChildren());if(page==='faceSwap')root.querySelector('[data-character-count]').textContent='Escolha pelo menos uma modelo.';
      }
      await refresh();
    }catch(err){error.textContent=err.message;status.textContent='Envio interrompido. Os vídeos já confirmados continuam na fila; tente novamente para concluir os restantes.';refresh();}
    finally{busy.delete(page);form.querySelectorAll('input,button').forEach(x=>x.disabled=false);form.querySelector('button[type=submit]')?.removeAttribute?.('aria-busy');}
  }
  window.ImagePipeline={render,refresh,draw:drawJobs,rowsForPage:page=>jobs.filter(j=>j.meta.source===sources[page])};
  if(sources[currentPage])render(currentPage);
})();


