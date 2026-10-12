(()=>{
  if(window.__cloudentViralsForYouWatchdogV1)return;
  window.__cloudentViralsForYouWatchdogV1=true;

  let wrapped=false;
  let lastMode='profile';
  let timer=null;

  function reelsActive(tabs){
    const active=tabs?.querySelector('.virals-tab.active');
    if(!active)return false;
    const onclick=String(active.getAttribute('onclick')||'');
    return onclick.includes("'reels'")||onclick.includes('"reels"')||/^Reels\b/i.test(active.textContent||'');
  }

  function wrapMode(){
    const api=window.CloudentForYou;
    if(!api||wrapped||typeof api.setMode!=='function')return;
    const original=api.setMode.bind(api);
    api.setMode=function(mode){
      lastMode=mode==='foryou'?'foryou':'profile';
      return original(lastMode);
    };
    wrapped=true;
  }

  function repair(){
    wrapMode();
    const api=window.CloudentForYou;
    if(!api||typeof api.setMode!=='function')return false;
    const shell=document.querySelector('#virals .virals-shell');
    const tabs=shell?.querySelector('.virals-tabs');
    if(!shell||!tabs||!reelsActive(tabs))return false;
    if(shell.querySelector('.virals-reels-subtabs'))return true;
    api.setMode(lastMode);
    return Boolean(shell.querySelector('.virals-reels-subtabs'));
  }

  const observer=new MutationObserver(()=>{
    clearTimeout(timer);
    timer=setTimeout(repair,30);
  });

  const start=()=>{
    try{observer.observe(document.body,{childList:true,subtree:true})}catch{}
    repair();
    setTimeout(repair,250);
    setTimeout(repair,900);
  };

  if(document.body)start();
  else document.addEventListener('DOMContentLoaded',start,{once:true});
})();