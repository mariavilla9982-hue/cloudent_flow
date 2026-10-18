/* Shared controller for three image/video pipelines. */
(()=>{
  const style=document.createElement('style');style.textContent='[data-pipeline-mounted] form{display:grid;gap:18px}[data-pipeline-mounted] form label{display:grid;gap:10px;min-width:0}[data-pipeline-mounted] input[type=file]{max-width:100%;width:100%;font-size:12px}[data-pipeline-mounted] article{min-width:0;overflow-wrap:anywhere}[data-pipeline-mounted] .toolbar{flex-wrap:wrap}';document.head.appendChild(style);
  const sources={faceSwap:'face_swap_natural',upscale:'upscale_manual',faceSwapPhoto:'face_swap_photo'};
  const titles={faceSwap:'Face Swap Natural',upscale:'Upscale',faceSwapPhoto:'Face Swap Foto'};
  const drafts={},busy=new Set();let jobs=[],loading=false,timer=null,generation=0,owner=cloudSession?.user?.id||'';
  function resetOwner(){
    const id=cloudSession?.user?.id||'';if(id===owner)return;
    owner=id;generation++;jobs=[];
    for(const [key,d] of Object.entries(drafts)){Object.values(d.urls||{}).forEach(url=>URL.revokeObjectURL(url));delete drafts[key];}
    for(const id of Object.keys(sources)){const root=document.getElementById(id);if(root){root.replaceChildren();delete root.dataset.pipelineMounted;}}
  }
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const request=(action,body,method='POST')=>cloudFetch('?action='+action,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  async function refresh(){
    if(loading||!cloudSession||!sources[currentPage])return;loading=true;
    const g=++generation,uid=cloudSession.user?.id;
    try{const r=await cloudFetch('?resource=image-pipeline');if(g!==generation||uid!==cloudSession?.user?.id)return;jobs=r.jobs||[];drawJobs();}
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
  function drawJobs(){
    const node=document.querySelector('#'+currentPage+' [data-pipeline-jobs]');if(!node)return;
    const rows=jobs.filter(j=>j.meta.source===sources[currentPage]);
    const signature=JSON.stringify(rows.map(j=>[j.id,j.status,j.meta?.pipeline_status,j.last_error,j.production?.status,j.production?.progress]));
    if(node.dataset.signature===signature)return;node.dataset.signature=signature;
    node.innerHTML=rows.length?rows.map(j=>{
      const ready=j.status==='ready'||j.production?.status==='ready';
      const retry=j.status==='failed'&&j.meta.provider_failed&&!j.meta.dispatch_uncertain;
      return '<article class="card"><strong>'+e(j.original_file_name)+'</strong><p>'+e(label(j))+'</p>'+(j.last_error?'<p class="muted">'+e(j.last_error)+'</p>':'')+'<div class="toolbar">'+(ready?'<button class="btn" data-open="'+j.id+'">Ver resultado</button><button class="btn" data-download="'+j.id+'">Baixar</button>':'')+(ready&&j.meta.source==='face_swap_natural'?'<button class="btn" data-calendar="'+j.id+'">Adicionar ao calendário</button>':'')+(retry?'<button class="btn" data-retry="'+j.id+'">Tentar etapa novamente</button>':'')+'<button class="btn" data-delete="'+j.id+'">Excluir</button></div><div data-result="'+j.id+'"></div></article>';
    }).join(''):'<p class="muted">Nenhum job neste fluxo.</p>';
  }
  function render(page){
    resetOwner();if(!sources[page])return;
    const root=document.getElementById(page);if(!root)return;
    if(root.dataset.pipelineMounted==='true'){drawJobs();refresh();return;}
    root.dataset.pipelineMounted='true';
    const photo=page==='faceSwapPhoto',natural=page==='faceSwap';
    root.innerHTML='<div class="face-swap-shell"><div class="face-swap-hero"><div><span class="ui3-eyebrow">PRODUÇÃO IA</span><h2>'+titles[page]+'</h2><p>'+(natural?'Envie um vídeo. Modelo raiz fixa → Face Swap → Upscale → Control Motion V7.':photo?'Escolha a modelo e a referência. Face Swap e Upscale entregam a foto final.':'Envie uma imagem para ampliar e baixar o resultado.')+'</p></div></div><div class="card"><form data-pipeline-form><div class="face-swap-grid"><label>'+(natural?'Vídeo original':photo?'Foto da modelo raiz':'Imagem')+'<input name="original" type="file" accept="'+(natural?'video/*':'image/jpeg,image/png,image/webp')+'" required><div data-preview="original"></div><button class="btn" type="button" data-remove="original">Remover</button></label>'+(photo?'<label>Foto de referência<input name="reference" type="file" accept="image/jpeg,image/png,image/webp" required><div data-preview="reference"></div><button class="btn" type="button" data-remove="reference">Remover</button></label>':'')+'</div><button class="btn primary" type="submit">'+(natural?'Gerar vídeo':photo?'Gerar Face Swap':'Gerar Upscale')+'</button><p role="status" data-pipeline-status></p><p role="alert" data-pipeline-error></p></form></div><div class="toolbar"><button class="btn" data-refresh>Atualizar</button></div><div class="face-swap-jobs" data-pipeline-jobs></div></div>';
    root.onchange=evt=>{
      const f=evt.target.files?.[0];if(!f)return;
      const d=drafts[page]||(drafts[page]={id:crypto.randomUUID(),urls:{}});d.id=crypto.randomUUID();d[evt.target.name]=f;
      const k=evt.target.name;if(d.urls[k])URL.revokeObjectURL(d.urls[k]);d.urls[k]=URL.createObjectURL(f);
      const p=root.querySelector('[data-preview="'+k+'"]');p.innerHTML=f.type.startsWith('video/')?'<video controls style="max-width:100%;max-height:220px"></video>':'<img alt="Prévia da imagem selecionada" style="max-width:100%;max-height:220px">';p.firstChild.src=d.urls[k];
    };
    root.querySelector('form').addEventListener('submit',evt=>{evt.preventDefault();submit(page,root);});
    root.onclick=async evt=>{
      const b=evt.target.closest('button');if(!b||(b.closest('form')&&b.type==='submit'))return;
      try{
        if(b.dataset.remove){const k=b.dataset.remove,d=drafts[page];if(d?.urls[k])URL.revokeObjectURL(d.urls[k]);if(d){delete d[k];delete d.urls[k];d.id=crypto.randomUUID();}root.querySelector('input[name="'+k+'"]').value='';root.querySelector('[data-preview="'+k+'"]').replaceChildren();return;}
        if(b.hasAttribute('data-refresh'))return await refresh();
        const id=b.dataset.open||b.dataset.download;
        if(id){
          b.disabled=true;const r=await cloudFetch('?resource=image-pipeline-result&id='+encodeURIComponent(id));
          if(b.dataset.download){const response=await fetch(r.url);if(!response.ok)throw new Error('Falha no download');const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='cloudentflow-'+id+(r.type==='video'?'.mp4':blob.type==='image/jpeg'?'.jpg':blob.type==='image/webp'?'.webp':'.png');a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
          else{const p=root.querySelector('[data-result="'+id+'"]');p.innerHTML=r.type==='video'?'<video controls style="max-width:100%;max-height:520px"></video>':'<a target="_blank" rel="noopener"><img alt="Imagem final" style="max-width:100%;max-height:520px"></a>';const media=p.querySelector('img,video');media.src=r.url;const a=p.querySelector('a');if(a)a.href=r.url;}
        }
        if(b.dataset.retry){b.disabled=true;await request('image-pipeline-retry',{id:b.dataset.retry},'PATCH');await refresh();}
        if(b.dataset.delete){b.disabled=true;await request('image-pipeline-job',{id:b.dataset.delete},'DELETE');await refresh();}
        if(b.dataset.calendar){await loadProductionData();await openProductionScheduleModal(b.dataset.calendar,1);}
      }catch(err){root.querySelector('[data-pipeline-error]').textContent=err.message;}finally{b.disabled=false;}
    };
    drawJobs();refresh();
    if(!timer)timer=setInterval(()=>{resetOwner();if(sources[currentPage]&&cloudSession)refresh();else if(!cloudSession){jobs=[];generation++;}},8000);
  }
  async function submit(page,root){
    if(busy.has(page))return;busy.add(page);
    const form=root.querySelector('form'),button=form.querySelector('button'),status=form.querySelector('[data-pipeline-status]'),error=form.querySelector('[data-pipeline-error]');
    form.querySelectorAll('input,button').forEach(x=>x.disabled=true);error.textContent='';
    try{
      const submitOwner=owner;const d=drafts[page];if(!d?.original)throw new Error('Selecione o arquivo de entrada.');
      let reference=d.reference;
      if(page==='faceSwap'){status.textContent='Extraindo primeiro frame…';reference=new File([await extractFirstFrameBlob(d.urls.original)],'primeiro-frame.jpg',{type:'image/jpeg'});}
      const describe=f=>({name:f.name,size:f.size,type:f.type});
      status.textContent='Preparando envio…';
      if(submitOwner!==cloudSession?.user?.id)throw new Error('Sessão alterada; selecione os arquivos novamente.');
      const ticket=await request('image-pipeline-ticket',{source:sources[page],job_id:d.id,original:describe(d.original),reference:reference?describe(reference):null});
      if(!ticket.registered){
        status.textContent='Enviando arquivos…';
        await uploadFaceSwapPart(ticket.original,d.original,()=>{});
        if(!ticket.same_input)await uploadFaceSwapPart(ticket.reference,reference,()=>{});
        status.textContent='Confirmando envio…';if(submitOwner!==cloudSession?.user?.id)throw new Error('Sessão alterada durante o envio.');await request('image-pipeline-complete',{job_id:ticket.job_id});
      }
      status.textContent='Arquivos enviados. O processamento continua automaticamente.';
      Object.values(d.urls).forEach(url=>URL.revokeObjectURL(url));delete drafts[page];form.reset();root.querySelectorAll('[data-preview]').forEach(p=>p.replaceChildren());await refresh();
    }catch(err){error.textContent=err.message;status.textContent='Envio não concluído.';}
    finally{busy.delete(page);form.querySelectorAll('input,button').forEach(x=>x.disabled=false);}
  }
  window.ImagePipeline={render,refresh};
  if(sources[currentPage])render(currentPage);
})();
