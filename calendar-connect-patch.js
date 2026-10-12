(()=>{
  if(window.__cfCloudentRuntimeBootstrapV1)return;
  window.__cfCloudentRuntimeBootstrapV1=true;

  const loadScript=(src,key)=>{
    if(document.querySelector('script[data-cloudent-runtime="'+key+'"]'))return;
    const script=document.createElement('script');
    script.src=src;
    script.async=false;
    script.dataset.cloudentRuntime=key;
    script.onerror=()=>console.error('CloudentFlow: falha ao carregar '+key);
    document.head.appendChild(script);
  };

  // Este arquivo já é carregado diretamente pelo app em todas as instalações.
  // Mantemos o conector do calendário no core e usamos o mesmo ponto de entrada
  // para garantir que a aba Virais exista mesmo quando o PWA estiver com um
  // app-shell antigo no cache.
  loadScript('/calendar-connect-core.js?v=8','calendar-core');
  loadScript('/virals-patch.js?v=2','virals');
})();
