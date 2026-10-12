(()=>{
  if(window.__cloudentForYouBrowserHotfixV1)return;
  window.__cloudentForYouBrowserHotfixV1=true;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function cloudToken(){
    try{return String(cloudSession?.access_token||'')}catch{return ''}
  }

  function removeOverlay(){document.querySelector('.foryou-connect-overlay')?.remove()}

  async function prepareBrowser(overlay){
    const state=overlay.querySelector('[data-foryou-browser-state]');
    const actions=overlay.querySelector('[data-foryou-browser-actions]');
    try{
      const token=cloudToken();
      if(!token)throw new Error('Entre no CloudentFlow novamente para abrir o navegador.');
      const response=await fetch('/api/foryou-browser',{
        method:'POST',
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        cache:'no-store'
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data?.ok||!data?.url)throw new Error(data?.message||'Não consegui iniciar o navegador remoto.');
      if(!overlay.isConnected)return;

      state.innerHTML='<b>Browser Worker pronto</b><span>O Instagram está aberto em um navegador privado na nuvem. Entre na @jujuhmartinss por lá. A sessão fica salva no navegador remoto.</span>';
      actions.innerHTML='<button type="button" data-foryou-check>Já entrei · verificar</button><button type="button" class="primary" data-foryou-open>Abrir Instagram da Jujuh</button>';

      const open=actions.querySelector('[data-foryou-open]');
      const check=actions.querySelector('[data-foryou-check]');
      open?.addEventListener('click',()=>{
        const tab=window.open(data.url,'_blank','noopener,noreferrer');
        if(!tab)window.location.href=data.url;
      });
      check?.addEventListener('click',async()=>{
        check.disabled=true;check.textContent='Verificando…';
        try{
          if(window.CloudentForYou?.refresh)await window.CloudentForYou.refresh();
          await sleep(800);
          removeOverlay();
        }finally{check.disabled=false}
      });
    }catch(error){
      if(!overlay.isConnected)return;
      const message=String(error?.message||error||'Falha ao preparar navegador.');
      state.innerHTML='<b>Não consegui abrir o Browser Worker</b><span>'+esc(message)+'</span>';
      actions.innerHTML='<button type="button" data-foryou-close>Fechar</button><button type="button" class="primary" data-foryou-retry>Tentar novamente</button>';
      actions.querySelector('[data-foryou-close]')?.addEventListener('click',removeOverlay);
      actions.querySelector('[data-foryou-retry]')?.addEventListener('click',()=>{
        state.innerHTML='<b>Preparando navegador seguro…</b><span>Acordando o Browser Worker e restaurando a sessão persistente.</span>';
        actions.innerHTML='<button type="button" disabled>Preparando…</button>';
        prepareBrowser(overlay);
      });
    }
  }

  function connect(){
    removeOverlay();
    const overlay=document.createElement('div');
    overlay.className='foryou-connect-overlay';
    overlay.innerHTML='<div class="foryou-connect-modal" role="dialog" aria-modal="true" aria-label="Conectar Jujuh">'+
      '<h3>Conectar Jujuh</h3>'+
      '<p>O CloudentFlow usa um navegador remoto persistente. Sua senha e eventual código de verificação são digitados diretamente no Instagram, não no CloudentFlow.</p>'+
      '<div class="foryou-connect-state" data-foryou-browser-state><b>Preparando navegador seguro…</b><span>Acordando o Browser Worker e restaurando a sessão persistente da Jujuh.</span></div>'+
      '<ul class="foryou-connect-steps"><li><i>1</i><span>Abra o Instagram no navegador remoto.</span></li><li><i>2</i><span>Faça login na @jujuhmartinss diretamente no Instagram.</span></li><li><i>3</i><span>Depois disso o radar coleta a ForYou e mantém somente Reels com 400 mil+ visualizações.</span></li></ul>'+
      '<div class="foryou-connect-actions" data-foryou-browser-actions><button type="button" disabled>Preparando…</button></div>'+
    '</div>';
    overlay.addEventListener('click',event=>{if(event.target===overlay)removeOverlay()});
    document.body.appendChild(overlay);
    prepareBrowser(overlay);
  }

  function install(){
    if(!window.CloudentForYou)return false;
    window.CloudentForYou.connect=connect;
    window.CloudentForYou.closeConnect=removeOverlay;
    return true;
  }

  if(!install()){
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      if(install()||tries>120)clearInterval(timer);
    },100);
  }
})();
