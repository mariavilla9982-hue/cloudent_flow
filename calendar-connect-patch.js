(()=>{
  if(window.__cfCloudentRuntimeBootstrapV4)return;
  window.__cfCloudentRuntimeBootstrapV4=true;

  const loadScript=(src,key)=>{
    if(document.querySelector('script[data-cloudent-runtime="'+key+'"]'))return;
    const script=document.createElement('script');
    script.src=src;
    script.async=false;
    script.dataset.cloudentRuntime=key;
    script.onerror=()=>console.error('CloudentFlow: falha ao carregar '+key);
    document.head.appendChild(script);
  };

  // Hotfix mobile: o modal de calendario da Producao IA aplica estilos inline
  // fullscreen no #modalHost. Quando o agendamento termina, o conteudo do modal
  // some antes desses estilos serem removidos e o host continua cobrindo o app
  // com uma tela preta. Este guard limpa somente os estilos do fullscreen quando
  // nao existe mais um .production-schedule-modal ativo.
  const fullscreenHostProps=[
    'position','inset','top','right','bottom','left','width','min-width','max-width',
    'height','min-height','max-height','z-index','margin','padding','background',
    'overflow','border','border-radius','transform','box-sizing'
  ];
  const fullscreenModalProps=[
    'position','inset','top','right','bottom','left','width','min-width','max-width',
    'height','min-height','max-height','margin','padding','display','background',
    'overflow','overflow-x','overflow-y','border','border-radius','box-sizing'
  ];

  function clearProductionScheduleBlackScreen(){
    const host=document.getElementById('modalHost');
    if(!host)return;
    if(host.querySelector('.production-schedule-modal'))return;

    document.documentElement.classList.remove('production-schedule-open');
    document.body?.classList.remove('production-schedule-open');
    host.classList.remove('cf-production-schedule-host');

    fullscreenHostProps.forEach(prop=>host.style.removeProperty(prop));

    host.querySelectorAll('.production-schedule-mobile-shell').forEach(el=>{
      el.classList.remove('production-schedule-mobile-shell');
      fullscreenModalProps.forEach(prop=>el.style.removeProperty(prop));
    });
  }

  let guardQueued=false;
  const queueGuard=()=>{
    if(guardQueued)return;
    guardQueued=true;
    requestAnimationFrame(()=>{
      guardQueued=false;
      clearProductionScheduleBlackScreen();
    });
  };

  if(typeof MutationObserver==='function'){
    const guard=new MutationObserver(queueGuard);
    guard.observe(document.documentElement,{childList:true,subtree:true});
  }
  window.addEventListener('pageshow',queueGuard,{passive:true});
  window.addEventListener('focus',queueGuard,{passive:true});
  queueGuard();

  loadScript('/calendar-connect-core.js?v=8','calendar-core');
  loadScript('/virals-patch.js?v=3','virals');
  loadScript('/virals-foryou-patch.js?v=1','virals-foryou');
  loadScript('/virals-foryou-watchdog.js?v=1','virals-foryou-watchdog');
})();