(()=>{
  if(window.__cloudentFaceSwapCharacterClickHotfixV2)return;
  window.__cloudentFaceSwapCharacterClickHotfixV2=true;

  const SUPABASE_URL='https://dxrhvudvutmgrmfkmzxo.supabase.co';
  const SUPABASE_KEY='sb_publishable_eu6EGnAw7H-Y5q6w6pmSKQ_88GUR9HI';
  let busy=false;
  let queuedPreset='';
  let activePreset=String(window.__cloudentForcedFaceSwapPreset||'').toLowerCase();

  function toastSafe(message,type='ok'){
    try{if(typeof toast==='function')toast(message,type)}catch{}
  }

  function token(){
    try{return String(cloudSession?.access_token||'')}catch{return ''}
  }

  function normalize(name){
    name=String(name||'').trim().toLowerCase();
    return ['julia','sahry'].includes(name)?name:'';
  }

  function detectActive(){
    const forced=normalize(window.__cloudentForcedFaceSwapPreset);
    if(forced)return forced;
    try{
      const file=normalize(faceSwapData?.workflow?.character?.file_name);
      if(file)return file;
    }catch{}
    const btn=document.querySelector('[data-face-swap-preset].active');
    return normalize(btn?.dataset?.faceSwapPreset)||'sahry';
  }

  function setVisual(name,loading=false){
    name=normalize(name)||detectActive();
    document.querySelectorAll('[data-face-swap-preset]').forEach(btn=>{
      const preset=normalize(btn.dataset.faceSwapPreset);
      const active=preset===name;
      btn.classList.toggle('active',active);
      // Nunca deixa os botões travados. O clique seguinte entra na fila.
      btn.disabled=false;
      btn.setAttribute('aria-busy',loading&&active?'true':'false');
      const status=btn.querySelector('.face-swap-preset-copy span');
      if(status)status.textContent=active?(loading?'Trocando…':'Em uso'):'Usar esta folha';
    });
  }

  async function fetchWithTimeout(url,options,ms=8000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),ms);
    try{return await fetch(url,{...options,signal:controller.signal})}
    finally{clearTimeout(timer)}
  }

  async function rpcSelect(name,allowRefresh=true){
    const access=token();
    if(!access)throw new Error('Sessão expirada. Entre no CloudentFlow novamente.');

    let res;
    try{
      res=await fetchWithTimeout(SUPABASE_URL+'/rest/v1/rpc/set_face_swap_character_preset',{
        method:'POST',
        headers:{
          apikey:SUPABASE_KEY,
          Authorization:'Bearer '+access,
          'Content-Type':'application/json'
        },
        body:JSON.stringify({p_preset:name}),
        cache:'no-store'
      },8000);
    }catch(error){
      if(error?.name==='AbortError')throw new Error('A troca demorou demais. Tente novamente.');
      throw error;
    }

    if(res.status===401&&allowRefresh&&typeof refreshCloudSession==='function'){
      const refreshed=await Promise.race([
        refreshCloudSession().catch(()=>false),
        new Promise(resolve=>setTimeout(()=>resolve(false),3500))
      ]);
      if(refreshed)return rpcSelect(name,false);
    }

    const data=await res.json().catch(()=>({}));
    if(!res.ok||data?.ok===false){
      throw new Error(data?.message||data?.error||('Erro '+res.status+' ao trocar personagem.'));
    }
    return data;
  }

  function refreshFaceSwapInBackground(){
    if(typeof loadFaceSwapData!=='function')return;
    Promise.race([
      Promise.resolve().then(()=>loadFaceSwapData()),
      new Promise(resolve=>setTimeout(resolve,3500))
    ]).catch(()=>{}).finally(()=>{
      const wanted=normalize(window.__cloudentForcedFaceSwapPreset)||activePreset;
      setVisual(wanted,false);
    });
  }

  async function runSelection(name){
    name=normalize(name);
    if(!name)return;

    if(busy){
      queuedPreset=name;
      window.__cloudentForcedFaceSwapPreset=name;
      setVisual(name,true);
      return;
    }

    busy=true;
    const previous=activePreset||detectActive();
    activePreset=name;
    window.__cloudentForcedFaceSwapPreset=name;
    setVisual(name,true);

    try{
      const data=await rpcSelect(name,true);
      activePreset=name;
      window.__cloudentForcedFaceSwapPreset=name;

      try{
        if(typeof faceSwapData!=='undefined'&&faceSwapData){
          faceSwapData.workflow=faceSwapData.workflow||{};
          faceSwapData.workflow.character=data.character||faceSwapData.workflow.character||{};
        }
      }catch{}

      setVisual(name,false);
      toastSafe((name==='julia'?'Julia':'Sahry')+' selecionada. Próximos vídeos usarão essa folha.','ok');
      refreshFaceSwapInBackground();
    }catch(error){
      activePreset=previous;
      window.__cloudentForcedFaceSwapPreset=previous;
      setVisual(previous,false);
      toastSafe(error?.message||'Não foi possível trocar a personagem.','err');
    }finally{
      busy=false;
      const next=normalize(queuedPreset);
      queuedPreset='';
      if(next&&next!==activePreset)setTimeout(()=>runSelection(next),0);
      else setVisual(activePreset||detectActive(),false);
    }
  }

  document.addEventListener('click',event=>{
    const btn=event.target?.closest?.('[data-face-swap-preset]');
    if(!btn)return;
    event.preventDefault();
    event.stopPropagation();
    if(typeof event.stopImmediatePropagation==='function')event.stopImmediatePropagation();
    runSelection(btn.dataset.faceSwapPreset);
  },true);

  const observer=new MutationObserver(()=>{
    const wanted=normalize(window.__cloudentForcedFaceSwapPreset)||activePreset||detectActive();
    setVisual(wanted,busy);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});

  activePreset=activePreset||detectActive();
  window.__cloudentForcedFaceSwapPreset=activePreset;
  setVisual(activePreset,false);
})();
