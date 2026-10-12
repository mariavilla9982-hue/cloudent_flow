(()=>{
  if(window.__cloudentFaceSwapCharacterClickHotfixV1)return;
  window.__cloudentFaceSwapCharacterClickHotfixV1=true;

  const SUPABASE_URL='https://dxrhvudvutmgrmfkmzxo.supabase.co';
  const SUPABASE_KEY='sb_publishable_eu6EGnAw7H-Y5q6w6pmSKQ_88GUR9HI';
  let busy=false;

  function toastSafe(message,type='ok'){
    try{if(typeof toast==='function')toast(message,type)}catch{}
  }

  function token(){
    try{return String(cloudSession?.access_token||'')}catch{return ''}
  }

  function setVisual(name,busyState=false){
    document.querySelectorAll('[data-face-swap-preset]').forEach(btn=>{
      const preset=String(btn.dataset.faceSwapPreset||'').toLowerCase();
      const active=preset===name;
      btn.classList.toggle('active',active);
      btn.disabled=!!busyState;
      const status=btn.querySelector('.face-swap-preset-copy span');
      if(status)status.textContent=active?'Em uso':'Usar esta folha';
    });
  }

  async function rpcSelect(name,allowRefresh=true){
    const access=token();
    if(!access)throw new Error('Sessão expirada. Entre no CloudentFlow novamente.');
    const res=await fetch(SUPABASE_URL+'/rest/v1/rpc/set_face_swap_character_preset',{
      method:'POST',
      headers:{
        apikey:SUPABASE_KEY,
        Authorization:'Bearer '+access,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({p_preset:name}),
      cache:'no-store'
    });

    if(res.status===401&&allowRefresh&&typeof refreshCloudSession==='function'){
      const refreshed=await refreshCloudSession().catch(()=>false);
      if(refreshed)return rpcSelect(name,false);
    }

    const data=await res.json().catch(()=>({}));
    if(!res.ok||data?.ok===false){
      throw new Error(data?.message||data?.error||('Erro '+res.status+' ao trocar personagem.'));
    }
    return data;
  }

  async function selectPreset(name){
    name=String(name||'').toLowerCase();
    if(!['julia','sahry'].includes(name)||busy)return;

    let previous='sahry';
    try{
      const active=document.querySelector('[data-face-swap-preset].active');
      if(active?.dataset?.faceSwapPreset)previous=String(active.dataset.faceSwapPreset).toLowerCase();
    }catch{}

    busy=true;
    window.__cloudentForcedFaceSwapPreset=name;
    setVisual(name,true);

    try{
      const data=await rpcSelect(name,true);

      try{
        if(typeof faceSwapData!=='undefined'&&faceSwapData){
          faceSwapData.workflow=faceSwapData.workflow||{};
          faceSwapData.workflow.character=data.character||faceSwapData.workflow.character||{};
        }
      }catch{}

      try{if(typeof loadFaceSwapData==='function')await loadFaceSwapData()}catch{}
      setVisual(name,false);
      toastSafe((name==='julia'?'Julia':'Sahry')+' selecionada. Próximos vídeos usarão essa folha.','ok');
    }catch(error){
      window.__cloudentForcedFaceSwapPreset=previous;
      setVisual(previous,false);
      toastSafe(error?.message||'Não foi possível trocar a personagem.','err');
    }finally{
      busy=false;
    }
  }

  document.addEventListener('click',event=>{
    const btn=event.target?.closest?.('[data-face-swap-preset]');
    if(!btn)return;
    event.preventDefault();
    event.stopPropagation();
    if(typeof event.stopImmediatePropagation==='function')event.stopImmediatePropagation();
    selectPreset(btn.dataset.faceSwapPreset);
  },true);

  // Mantém o estado visual correto mesmo quando a tela é redesenhada.
  const observer=new MutationObserver(()=>{
    const forced=String(window.__cloudentForcedFaceSwapPreset||'').toLowerCase();
    if(['julia','sahry'].includes(forced)&&!busy)setVisual(forced,false);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
})();
