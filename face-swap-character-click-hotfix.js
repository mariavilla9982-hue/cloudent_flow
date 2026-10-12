(()=>{
  if(window.__cloudentFaceSwapCharacterClickHotfixV3)return;
  window.__cloudentFaceSwapCharacterClickHotfixV3=true;

  const SUPABASE_URL='https://dxrhvudvutmgrmfkmzxo.supabase.co';
  const SUPABASE_KEY='sb_publishable_eu6EGnAw7H-Y5q6w6pmSKQ_88GUR9HI';
  const VALID=new Set(['julia','sahry']);
  let requestSeq=0;
  let controller=null;
  let confirmed='';

  function toastSafe(message,type='ok'){
    try{if(typeof toast==='function')toast(message,type)}catch{}
  }

  function token(){
    try{return String(cloudSession?.access_token||'')}catch{return ''}
  }

  function visiblePreset(){
    const forced=String(window.__cloudentForcedFaceSwapPreset||'').toLowerCase();
    if(VALID.has(forced))return forced;
    const active=document.querySelector('[data-face-swap-preset].active');
    const activeName=String(active?.dataset?.faceSwapPreset||'').toLowerCase();
    if(VALID.has(activeName))return activeName;
    try{
      const current=String(faceSwapData?.workflow?.character?.file_name||'').trim().toLowerCase();
      if(VALID.has(current))return current;
    }catch{}
    return 'sahry';
  }

  function setVisual(name,pending=''){
    if(!VALID.has(name))return;
    document.querySelectorAll('[data-face-swap-preset]').forEach(btn=>{
      const preset=String(btn.dataset.faceSwapPreset||'').toLowerCase();
      const active=preset===name;
      btn.classList.toggle('active',active);
      // Nunca trava os dois cards por uma chamada de rede.
      btn.disabled=false;
      btn.classList.toggle('cf-preset-saving',preset===pending);
      btn.setAttribute('aria-busy',preset===pending?'true':'false');
      const status=btn.querySelector('.face-swap-preset-copy span');
      if(status){
        status.textContent=preset===pending?'Salvando…':(active?'Em uso':'Usar esta folha');
      }
    });
  }

  async function rpcSelect(name,signal,allowRefresh=true){
    const access=token();
    if(!access)throw new Error('Sessão expirada. Entre no CloudentFlow novamente.');
    const timeout=new AbortController();
    const timer=setTimeout(()=>timeout.abort('timeout'),8000);
    const abort=()=>timeout.abort(signal?.reason||'cancelled');
    if(signal)signal.addEventListener('abort',abort,{once:true});
    try{
      const res=await fetch(SUPABASE_URL+'/rest/v1/rpc/set_face_swap_character_preset',{
        method:'POST',
        headers:{
          apikey:SUPABASE_KEY,
          Authorization:'Bearer '+access,
          'Content-Type':'application/json'
        },
        body:JSON.stringify({p_preset:name}),
        cache:'no-store',
        signal:timeout.signal
      });
      if(res.status===401&&allowRefresh&&typeof refreshCloudSession==='function'){
        const refreshed=await refreshCloudSession().catch(()=>false);
        if(refreshed)return rpcSelect(name,signal,false);
      }
      const data=await res.json().catch(()=>({}));
      if(!res.ok||data?.ok===false){
        throw new Error(data?.message||data?.error||('Erro '+res.status+' ao trocar personagem.'));
      }
      return data;
    }finally{
      clearTimeout(timer);
      if(signal)signal.removeEventListener('abort',abort);
    }
  }

  async function selectPreset(name){
    name=String(name||'').toLowerCase();
    if(!VALID.has(name))return;

    const before=confirmed||visiblePreset();
    if(name===before&&!controller){
      window.__cloudentForcedFaceSwapPreset=name;
      setVisual(name,'');
      return;
    }

    // Último clique vence. Cancela apenas a espera local da troca anterior;
    // se o backend já recebeu a chamada, a nova chamada gravará a escolha final.
    if(controller)controller.abort('superseded');
    controller=new AbortController();
    const mine=++requestSeq;
    const localController=controller;

    window.__cloudentForcedFaceSwapPreset=name;
    setVisual(name,name);

    try{
      const data=await rpcSelect(name,localController.signal,true);
      if(mine!==requestSeq)return;

      confirmed=name;
      window.__cloudentForcedFaceSwapPreset=name;
      try{
        if(typeof faceSwapData!=='undefined'&&faceSwapData){
          faceSwapData.workflow=faceSwapData.workflow||{};
          faceSwapData.workflow.character=data?.character||faceSwapData.workflow.character||{};
        }
      }catch{}

      // Não espera loadFaceSwapData aqui: era isso que podia deixar o seletor
      // permanentemente bloqueado. O backend já lê a folha salva no app_settings
      // quando o próximo job de Face Swap é criado.
      setVisual(name,'');
      toastSafe((name==='julia'?'Julia':'Sahry')+' selecionada. Próximos vídeos usarão essa folha.','ok');
    }catch(error){
      if(mine!==requestSeq)return;
      const aborted=localController.signal.aborted||error?.name==='AbortError';
      if(aborted&&localController.signal.reason==='superseded')return;
      const fallback=confirmed||before;
      window.__cloudentForcedFaceSwapPreset=fallback;
      setVisual(fallback,'');
      toastSafe(error?.message==='timeout'?'A troca demorou demais. Tente novamente.':(error?.message||'Não foi possível trocar a personagem.'),'err');
    }finally{
      if(mine===requestSeq){
        controller=null;
        setVisual(window.__cloudentForcedFaceSwapPreset||confirmed||before,'');
      }
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

  // Inicializa com o estado já renderizado e mantém somente o visual sincronizado.
  confirmed=visiblePreset();
  window.__cloudentForcedFaceSwapPreset=confirmed;
  setVisual(confirmed,'');

  let queued=false;
  const observer=new MutationObserver(()=>{
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{
      queued=false;
      const forced=String(window.__cloudentForcedFaceSwapPreset||confirmed||'').toLowerCase();
      if(VALID.has(forced))setVisual(forced,controller?forced:'');
    });
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
})();
