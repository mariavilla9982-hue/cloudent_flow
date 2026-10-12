(()=>{
  if(window.__cfCloudentRuntimeBootstrapV3)return;
  window.__cfCloudentRuntimeBootstrapV3=true;

  const loadScript=(src,key)=>{
    if(document.querySelector('script[data-cloudent-runtime="'+key+'"]'))return;
    const script=document.createElement('script');
    script.src=src;
    script.async=false;
    script.dataset.cloudentRuntime=key;
    script.onerror=()=>console.error('CloudentFlow: falha ao carregar '+key);
    document.head.appendChild(script);
  };

  loadScript('/calendar-connect-core.js?v=8','calendar-core');
  loadScript('/virals-patch.js?v=3','virals');
  loadScript('/virals-foryou-patch.js?v=1','virals-foryou');
  loadScript('/virals-foryou-watchdog.js?v=1','virals-foryou-watchdog');
})();