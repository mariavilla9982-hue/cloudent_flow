(()=>{
  if(window.__cfDashboardOverviewV4)return;
  window.__cfDashboardOverviewV4=true;

  // Presentation only: these are the two existing account identities, not new accounts.
  const identities=[
    {id:'c5f2fdd6-00e8-4ca7-adb8-281aa922ad0a',name:'Jujuh',username:'jujuhmartinss'},
    {id:'7160f95b-a23c-4f28-a5b8-9502a856e091',name:'Sahry Japah',username:'sahryjapah'}
  ];
  const mediaCache=new Map(),followersCache=new Map(),pending=new Map();
  const periods={'1':'Hoje','7':'Últimos 7 dias','30':'Últimos 30 dias','90':'Últimos 90 dias'};
  let period='30',viewer='',generation=0,refreshing=false;
  const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>value===null||value===undefined||value===''||typeof value==='boolean'?null:(Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null);
  const format=value=>value===null?'—':value.toLocaleString('pt-BR');
  const sessionKey=()=>cloudSession?.user?.id||cloudSession?.access_token||'';
  const permitted=()=>!!cloudSession&&typeof cloudAccess!=='undefined'&&cloudAccess?.role==='admin';
  function resetViewer(){
    const key=permitted()?sessionKey():'';
    if(key===viewer)return;
    viewer=key;generation++;mediaCache.clear();followersCache.clear();pending.clear();refreshing=false;period='30';
  }
  function accounts(){
    if(!permitted()||!Array.isArray(platformAccounts))return [];
    return identities.flatMap(identity=>{
      const account=platformAccounts.find(a=>String(a.id)===identity.id&&a.platform==='instagram'&&a.enabled!==false);
      return account?[{...account,displayName:identity.name}]:[];
    });
  }
  function dateLabel(value){
    const date=new Date(value);
    if(!value||!Number.isFinite(date.getTime()))return 'aguardando coleta';
    return date.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  }
  function expectedSince(days){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get=key=>parts.find(p=>p.type===key)?.value;
    const cutoff=new Date(get('year')+'-'+get('month')+'-'+get('day')+'T03:00:00Z');
    cutoff.setUTCDate(cutoff.getUTCDate()-(Number(days)-1));return cutoff.toISOString();
  }
  function matchingPeriod(data,days){return data?.summary?.since===expectedSince(days)}
  function rangeLabel(summary){
    if(!summary?.since||!summary?.until)return '';
    const fmt=value=>new Date(value).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
    return fmt(summary.since)+' a '+fmt(summary.until);
  }
  function currentRequest(key,epoch,id){
    return permitted()&&sessionKey()===key&&viewer===key&&generation===epoch&&accounts().some(a=>a.id===id);
  }
  async function read(account,kind,days,force,key,epoch){
    const id=String(account.id),cache=kind==='media'?mediaCache:followersCache;
    const cacheId=kind==='media'?id+':'+days:id;
    const previous=cache.get(cacheId);
    if(!force&&previous&&(kind!=='media'||matchingPeriod(previous.data,days))&&Date.now()-previous.loadedAt<60000)return;
    const requestKey=kind+':'+cacheId;
    if(pending.has(requestKey))return pending.get(requestKey);
    const task=(async()=>{
      try{
        const endpoint=kind==='media'?IG_METRICS_URL:IG_FOLLOWERS_STATUS_URL;
        // Account insights use the server five-minute cache; no media scans or jobs.
        const result=await edgeFetch(endpoint+'?timezone=America/Sao_Paulo&days='+(kind==='media'?days:1)+(kind==='media'?'&summary=1':'')+'&account_id='+encodeURIComponent(id),{method:'GET'});
        if(!currentRequest(key,epoch,id))return;
        if(!result||result.ok===false||String(result.account_id)!==id||(kind==='media'&&(!Array.isArray(result.media)||typeof result.summary?.available!=='boolean'||!matchingPeriod(result,days))))throw new Error('invalid_account_metrics');
        cache.set(cacheId,{data:result,error:!!result.error,loadedAt:Date.now()});
      }catch{
        if(currentRequest(key,epoch,id))cache.set(cacheId,{data:kind==='media'&&!matchingPeriod(previous?.data,days)?null:previous?.data||null,error:true,loadedAt:Date.now()});
      }
    })();
    pending.set(requestKey,task);
    try{await task}finally{if(pending.get(requestKey)===task)pending.delete(requestKey)}
  }
  async function load(force=false){
    resetViewer();
    if(!permitted())return;
    const key=viewer,epoch=generation,days=period;
    await Promise.allSettled(accounts().flatMap(account=>[
      read(account,'media',days,force,key,epoch),read(account,'followers',days,force,key,epoch)
    ]));
    if(permitted()&&sessionKey()===key&&generation===epoch&&currentPage==='overview')overview();
  }
  function accountStats(account){
    const stored=mediaCache.get(account.id+':'+period),followers=followersCache.get(account.id);
    const data=matchingPeriod(stored?.data,period)?stored.data:null;
    const summary=data?.summary;
    const views=summary?.available?number(summary.views):null;
    const reels=summary?.available?number(summary.reels):null;
    const stories=summary?.available?number(summary.stories):null;
    return {account,views,reels,stories,range:rangeLabel(summary),followers:number(followers?.data?.current?.followers_count),
      collected:data?.last_collected_at||null,followersAt:followers?.data?.current?.last_checked_at||null,
      mediaError:!!stored?.error||!!summary?.error,followersError:!!followers?.error,
      waiting:!stored||!followers};
  }
  const total=(rows,key)=>rows.length&&rows.every(row=>row[key]!==null)?rows.reduce((sum,row)=>sum+row[key],0):null;
  function render(){
    resetViewer();
    const host=document.getElementById('overview');
    if(!host)return;
    if(!permitted()){host.innerHTML='';return}
    if(cloudLoading){host.innerHTML=loadingShell('Carregando dashboard');return}
    const title=document.getElementById('pageTitle');
    if(currentPage==='overview'&&title)title.textContent='Dashboard';
    const rows=accounts().map(accountStats),views=total(rows,'views'),reels=total(rows,'reels'),stories=total(rows,'stories'),followers=total(rows,'followers');
    const available=rows.filter(row=>row.views!==null).length;
    const oldest=rows.map(row=>row.collected).filter(Boolean).sort()[0];
    const waiting=rows.some(row=>row.waiting);
    const issue=rows.some(row=>row.mediaError||row.followersError);
    const updated=waiting?'Carregando métricas…':issue?'Algumas métricas não puderam ser atualizadas':available+'/'+rows.length+' contas com métricas do Instagram'+(oldest?' · Coleta mais antiga '+dateLabel(oldest):'');
    host.innerHTML=`<div class="cf-dash">
      <header class="cf-dash-heading"><h2>Visão geral</h2><button type="button" class="cf-dash-refresh" onclick="refreshDashboardMultiAccount(true)" ${refreshing?'disabled':''}>${refreshing?'Atualizando…':'Atualizar'}</button></header>
      <section class="cf-dash-panel" aria-label="Resumo do Instagram" aria-busy="${waiting||refreshing}">
        <div class="cf-dash-panel-head"><h3><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8"/></svg>Instagram</h3><label class="cf-dash-period"><span class="cf-dash-sr">Período das visualizações</span><select aria-label="Período das visualizações" onchange="setDashboardAnalyticsPeriod(this.value)">${Object.entries(periods).map(([value,label])=>`<option value="${value}" ${value===period?'selected':''}>${label}</option>`).join('')}</select></label></div>
        <div class="cf-dash-primary"><span>Visualizações</span><strong>${format(views)}</strong><small>Visualizações recebidas no período selecionado</small></div>
        <div class="cf-dash-breakdown"><div><span>Reels</span><b>${format(reels)}</b></div><div><span>Stories</span><b>${format(stories)}</b>${stories===null?'<small>Não foi possível consultar</small>':''}</div><div><span>Seguidores totais</span><b>${format(followers)}</b><small>Total atual das contas</small></div></div>
        <p class="cf-dash-updated" role="status">${rows.length?safe(updated):'Conecte Jujuh ou Sahry Japah em Contas para ver as métricas.'}</p>
      </section>
      <p class="cf-dash-updated">Fonte: Instagram (Meta) · Cache de até 5 minutos · O total inclui Reels, Stories e outras publicações.</p>
      <section class="cf-dash-panel cf-dash-accounts" aria-label="Métricas por conta"><h3>Visualizações por conta</h3><div class="cf-dash-account-grid">${rows.map(row=>`<article class="cf-dash-account"><h4><i aria-hidden="true"></i>${safe(row.account.displayName)}</h4><span class="cf-dash-username">@${safe(row.account.config?.username||row.account.account_label||'Instagram')}</span><strong>${format(row.views)}</strong><span class="cf-dash-caption">visualizações no período</span><p>${row.followers===null?'Seguidores indisponíveis':format(row.followers)+' seguidores'}</p><small>${safe(row.range)}</small><small>Visualizações: ${safe(dateLabel(row.collected))}</small><small>Seguidores: ${safe(dateLabel(row.followersAt))}</small>${row.mediaError||row.followersError?'<small class="cf-dash-warning">Atualização indisponível · último dado preservado</small>':''}</article>`).join('')||'<p class="cf-dash-empty">Nenhuma das duas contas está conectada. <button type="button" onclick="showPage(\'settings\')">Gerenciar contas</button></p>'}</div></section>
    </div>`;
    if(rows.some(row=>row.waiting)&&!refreshing)void load(false);
  }
  window.setDashboardAnalyticsPeriod=value=>{
    if(!Object.hasOwn(periods,String(value)))return;
    period=String(value);render();void load(false);
  };
  window.refreshDashboardMultiAccount=async(force=false)=>{
    resetViewer();if(!permitted()||refreshing)return;
    const key=viewer,epoch=generation;refreshing=true;render();
    try{
      if(force&&typeof loadPlatformAccounts==='function')await loadPlatformAccounts();
      if(!permitted()||sessionKey()!==key||generation!==epoch)return;
      await load(force);
    }finally{
      if(sessionKey()===key&&generation===epoch){refreshing=false;if(currentPage==='overview')render()}
    }
  };
  // Reuse the existing refresh cadence; no extra polling loop or observers.
  const nativeSync=syncDashboardLiveMetrics;
  syncDashboardLiveMetrics=async(force=false)=>{
    if(currentPage==='overview')return load(false);
    return nativeSync(force);
  };
  overview=render;

  const style=document.createElement('style');style.id='cf-dashboard-overview-style';
  style.textContent=`
    #overview .cf-dash{max-width:1280px;margin:28px auto 0;color:#f3f3f3;font-family:inherit}
    #overview .cf-dash-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:24px}
    #overview .cf-dash-heading h2{font-size:28px!important;line-height:1.2!important;font-weight:600;letter-spacing:-.04em;margin:0!important;color:#f5f5f5}
    #overview .cf-dash-refresh{background:transparent;border:1px solid #292929;color:#aaa;border-radius:8px;padding:9px 13px;font:inherit;font-size:12px;cursor:pointer;transition:background .15s,border-color .15s}
    #overview .cf-dash-refresh:hover{background:#171717;border-color:#555;color:#fff}
    #overview .cf-dash-refresh:disabled{cursor:wait;opacity:.6}
    #overview .cf-dash-panel{padding:28px 32px;background:#0b0c0d;border:1px solid #202225;border-radius:14px;margin:0 0 18px}
    #overview .cf-dash-panel-head{display:flex;justify-content:space-between;align-items:center;gap:16px}
    #overview .cf-dash h3{display:flex;align-items:center;gap:12px;font-size:16px!important;line-height:1.4!important;font-weight:600;margin:0!important;color:#f3f3f3;letter-spacing:-.02em}
    #overview .cf-dash h3 svg{width:24px;height:24px;fill:none;stroke:#a6a6ad;stroke-width:1.6;flex-shrink:0}
    #overview .cf-dash-period select{font:inherit;font-size:12px!important;color:#ddd!important;background:#101112!important;border:1px solid #2c2e31!important;border-radius:8px!important;min-height:38px;padding:7px 30px 7px 12px!important;width:auto!important;cursor:pointer}
    #overview .cf-dash-primary{margin:30px 0 27px}
    #overview .cf-dash-primary>span,#overview .cf-dash-breakdown span{color:#a0a1a6;font-size:13px;display:block}
    #overview .cf-dash-primary strong{display:block;font-size:clamp(38px,5.4vw,68px);font-weight:600;letter-spacing:-.055em;line-height:1.15;margin:9px 0 7px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    #overview .cf-dash small{display:block;font-size:11px;color:#777d85;line-height:1.6}
    #overview .cf-dash-breakdown{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid #25272a;padding-top:24px;gap:24px}
    #overview .cf-dash-breakdown>div+div{border-left:1px solid #242629;padding-left:26px}
    #overview .cf-dash-breakdown b{display:block;color:#f3f3f3;font-size:clamp(20px,2.5vw,31px);font-weight:600;line-height:1.25;letter-spacing:-.03em;margin:9px 0 3px;overflow-wrap:anywhere}
    #overview .cf-dash-updated{margin:23px 0 0;color:#81858c;font-size:11px;line-height:1.6}
    #overview .cf-dash-account-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:32px;margin-top:26px}
    #overview .cf-dash-account{min-width:0}
    #overview .cf-dash-account+article{padding-left:32px;border-left:1px solid #25272a}
    #overview .cf-dash-account h4{display:flex;gap:10px;align-items:center;font-size:14px!important;font-weight:500;margin:0!important;color:#d5d5d8}
    #overview .cf-dash-account h4 i{height:8px;width:8px;flex-shrink:0;border-radius:50%;background:#65c7b4}
    #overview .cf-dash-username{display:block;color:#7e838b;font-size:11px;margin:5px 0 15px;overflow-wrap:anywhere}
    #overview .cf-dash-account strong{display:block;font-size:clamp(26px,3.3vw,42px);font-weight:600;letter-spacing:-.045em;line-height:1.2;overflow-wrap:anywhere}
    #overview .cf-dash-caption{display:block;font-size:12px;color:#999fa8;margin-top:4px}
    #overview .cf-dash-account p{font-size:12px;color:#aaaeb6;margin:12px 0 14px}
    #overview .cf-dash-warning{color:#c4b59b!important}
    #overview .cf-dash-empty{font-size:13px;line-height:1.6;color:#999;grid-column:1/-1;margin:0}
    #overview .cf-dash-empty button{font:inherit;color:#eee;background:none;border:0;text-decoration:underline;cursor:pointer}
    #overview .cf-dash-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
    #overview .cf-dash button:focus-visible,#overview .cf-dash select:focus-visible{outline:2px solid #e5e5e5;outline-offset:3px}
    body:has(#overview:not(.hidden)) .saas-topbar .top-search-trigger,body:has(#overview:not(.hidden)) .saas-topbar .live-worker-pill,body:has(#overview:not(.hidden)) .saas-topbar #newVideoBtn,body:has(#overview:not(.hidden)) #pageSubtitle{display:none!important}
    body:has(#overview:not(.hidden)) .saas-topbar{grid-template-columns:1fr auto!important}
    @media(max-width:760px){#overview .cf-dash{margin-top:18px}#overview .cf-dash-heading h2{font-size:24px!important}#overview .cf-dash-panel{padding:22px 20px}#overview .cf-dash-breakdown{gap:12px}#overview .cf-dash-breakdown>div+div{padding-left:12px}#overview .cf-dash-breakdown span{font-size:11px}#overview .cf-dash h3{font-size:15px!important}#overview .cf-dash-account-grid{gap:22px}#overview .cf-dash-account+article{padding-left:22px}#overview .cf-dash-period select{max-width:170px}}
    @media(max-width:480px){#overview .cf-dash-panel{padding:20px 16px}#overview .cf-dash-breakdown{grid-template-columns:repeat(2,minmax(0,1fr));row-gap:20px}#overview .cf-dash-breakdown>div:last-child{grid-column:1/-1;border-left:0;padding:18px 0 0;border-top:1px solid #25272a}#overview .cf-dash-account-grid{grid-template-columns:1fr;gap:24px}#overview .cf-dash-account+article{padding:24px 0 0;border-left:0;border-top:1px solid #25272a}#overview .cf-dash-account strong{font-size:34px}}
    @media(prefers-reduced-motion:reduce){#overview .cf-dash-refresh{transition:none}}
  `;
  document.head.appendChild(style);
  if(currentPage==='overview')render();
})();
