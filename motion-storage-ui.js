(()=>{
  if(window.CloudentMotionStorage)return;
  const CACHE="cloudent-motion-thumbnails-v1",TTL=7*86400000,MAX=128,MAX_BYTES=8*1024*1024;
  const EDGE="https://dxrhvudvutmgrmfkmzxo.supabase.co/functions/v1/cloudent-motion-control";
  const inflight=new Map(),failed=new Map(),urls=new Map();
  let health=null,lastRefresh=0,refreshing=null;
  const userId=()=>String(typeof cloudSession!=="undefined"?cloudSession?.user?.id||"":"");
  const motion=()=>window.CloudentMotionControl?.mode==="motion_control";
  async function request(path,retry=true){
    if(!userId())throw Error("Sessão indisponível");
    const r=await fetch(EDGE+path,{headers:{Authorization:"Bearer "+cloudSession.access_token,apikey:SUPABASE_KEY},cache:"no-store"});
    if(r.status===401&&retry&&typeof refreshCloudSession==="function"&&await refreshCloudSession())return request(path,false);
    return r;
  }
  async function cacheOpen(){try{return await caches.open(CACHE)}catch{return null}}
  async function clear(){
    for(const u of urls.values())URL.revokeObjectURL(u);urls.clear();failed.clear();inflight.clear();health=null;lastRefresh=0;
    try{await caches.delete(CACHE)}catch{}
  }
  async function trim(cache){
    const keys=await cache.keys();let bytes=0;
    for(let i=keys.length-1;i>=0;i--){
      const r=await cache.match(keys[i]);const size=Number(r?.headers.get("content-length")||0);
      bytes+=size;
      if(keys.length-i>MAX||bytes>MAX_BYTES||Date.now()-Number(r?.headers.get("x-cloudent-cached-at")||0)>TTL)await cache.delete(keys[i]);
    }
  }
  async function thumbnail(uid,id,kind,path){
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(path)))).map(x=>x.toString(16).padStart(2,"0")).join("");
    const key=location.origin+"/__motion_thumb_cache__/"+encodeURIComponent(uid)+"/"+encodeURIComponent(id)+"/"+kind+"/"+hash;
    if(urls.has(key))return urls.get(key);
    if(inflight.has(key))return inflight.get(key);
    const promise=(async()=>{
      const cache=await cacheOpen();let r=await cache?.match(key);
      if(r&&Date.now()-Number(r.headers.get("x-cloudent-cached-at")||0)>TTL){await cache.delete(key);r=null;}
      let blob;
      if(r)blob=await r.blob();
      else{
        if((failed.get(key)||0)>Date.now())throw Error("Miniatura temporariamente indisponível");
        const response=await request("?resource=thumbnail&id="+encodeURIComponent(id)+"&kind="+encodeURIComponent(kind));
        if(!response.ok){failed.set(key,Date.now()+5*60000);if(failed.size>200)failed.delete(failed.keys().next().value);throw Error("Miniatura temporariamente indisponível");}
        blob=await response.blob();
        if(blob.size>256*1024||!blob.type.startsWith("image/"))throw Error("Miniatura inválida");
        if(userId()!==uid)throw Error("Conta alterada");
        if(cache){
          await cache.put(key,new Response(blob,{headers:{"Content-Type":blob.type,"Content-Length":String(blob.size),"x-cloudent-cached-at":String(Date.now())}}));
          await trim(cache);
        }
      }
      if(userId()!==uid)throw Error("Conta alterada");
      const url=URL.createObjectURL(blob);urls.set(key,url);
      if(urls.size>MAX){const old=urls.keys().next().value;URL.revokeObjectURL(urls.get(old));urls.delete(old);}
      return url;
    })().finally(()=>inflight.delete(key));
    inflight.set(key,promise);return promise;
  }
  function installThumbs(){
    if(typeof loadProductionThumb!=="function")return;
    const native=loadProductionThumb;
    loadProductionThumb=async function(el){
      const id=el?.dataset?.productionThumbId,kind=el?.dataset?.productionThumbKind;
      const job=(productionData?.jobs||[]).find(j=>String(j.id)===String(id));
      if(job?.meta?.workflow_key!=="motion_control")return native.call(this,el);
      if(!el||el.dataset.loaded==="1"||el.dataset.loading==="1")return;
      const uid=userId(),path=String(kind==="video-thumb"?job.meta?.original_thumbnail_path||"":job.meta?.frame_thumbnail_path||"");
      if(!uid||!path)return;
      el.dataset.loading="1";
      try{
        const url=await thumbnail(uid,String(id),String(kind),path);
        if(userId()!==uid||el.isConnected===false)return;
        el.innerHTML='<img src="'+esc(url)+'" alt="" decoding="async">'+(kind==="video-thumb"?'<span class="production-thumb-play">▶</span>':'')+'<span class="production-thumb-label">'+(kind==="video-thumb"?'VÍDEO':'FRAME')+'</span>';
        el.dataset.loaded="1";delete el.dataset.motionStorageUnavailable;
      }catch{
        el.querySelector("img")?.remove();el.title="Miniatura indisponível. A fila foi preservada.";el.dataset.loaded="1";el.dataset.motionStorageUnavailable="1";
      }finally{delete el.dataset.loading;}
    };
  }
  function paint(){
    const root=document.getElementById("production");if(!root)return;
    let banner=root.querySelector(".motion-storage-banner");
    if(!motion()){banner?.remove();return;}
    if(!banner){banner=document.createElement("div");banner.className="motion-storage-banner";banner.setAttribute("role","status");banner.style.cssText="margin:0 0 16px;padding:12px 14px;border:1px solid #353535;border-radius:12px;background:#111;color:#ddd;font-size:12px;line-height:1.6";root.querySelector(".production-workflow-tabs")?.insertAdjacentElement("afterend",banner);}
    const available=health?.phase==="healthy",used=Number(health?.reserve_allocated_bytes||0)/1048576;
    const title=!health?"Verificando proteção do armazenamento":available?"Armazenamento disponível · fila automática":"Armazenamento protegido · novas gerações pausadas";
    const next=health?.next_probe_at?new Date(health.next_probe_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}):"";
    const detail=available?"Miniaturas em cache reduzem leituras repetidas.":"Sua fila está preservada. Uploads de até 12 MB podem aguardar na reserva."+(next?" Próxima verificação: "+next+".":"");
    const estimate=health?' Leituras monitoradas: '+Number(health.managed_reads||0)+'/'+Number(health.daily_read_budget||1000)+' (estimativa local).':"";
    banner.innerHTML="<b>"+esc(title)+"</b><div>"+esc(detail)+"</div><small>"+esc("Reserva: "+used.toFixed(1)+"/160 MB."+estimate)+"</small>";
  }
  async function refresh(force=false){
    if(!userId()||!motion()||typeof currentPage!=="undefined"&&currentPage!=="production")return;
    if(refreshing)return refreshing;if(!force&&Date.now()-lastRefresh<30000){paint();return;}
    const uid=userId();lastRefresh=Date.now();
    refreshing=(async()=>{try{
      const r=await request("?resource=storage-health");if(!r.ok)return;
      const data=await r.json();if(userId()!==uid)return;
      const before=health?.phase;health=data.storage;paint();
      if(before&&before!=="healthy"&&health?.phase==="healthy"){
        failed.clear();for(const el of document.querySelectorAll('[data-motion-storage-unavailable="1"]')){delete el.dataset.loaded;delete el.dataset.motionStorageUnavailable;loadProductionThumb(el);}
        if(typeof productionPage==="function")productionPage();
      }
    }catch{}finally{refreshing=null;}})();return refreshing;
  }
  if(typeof productionPage==="function"){
    const native=productionPage;productionPage=function(...args){const result=native.apply(this,args);paint();refresh();return result;};
  }
  if(typeof productionJobRow==="function"){
    const native=productionJobRow;productionJobRow=function(job,...args){let html=native.call(this,job,...args);
      if(job.meta?.workflow_key==="motion_control"&&!job.runninghub_task_id&&["waiting","motion_waiting"].includes(job.status)&&health&&health.phase!=="healthy")html=html.replace(/>Aguardando envio</g,">Aguardando armazenamento<").replace(/Aguardando vaga do Motion Control/g,"Fila preservada · retomada automática");return html;};
  }
  if(typeof signOutCloud==="function"){const native=signOutCloud;signOutCloud=async function(...args){try{return await native.apply(this,args)}finally{await clear()}};}
  window.CloudentMotionStorage={clear,refresh,get state(){return health;}};
  installThumbs();paint();refresh();setInterval(()=>refresh(),30000);
})();
