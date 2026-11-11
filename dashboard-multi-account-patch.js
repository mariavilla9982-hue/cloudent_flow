(()=>{
  if(window.__cfDashboardOverviewV5)return;
  window.__cfDashboardOverviewV5=true;

  // Optional display names only; membership always comes from the authorized API.
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
    return platformAccounts.filter(a=>a.platform==='instagram'&&a.enabled===true).map(account=>({
      ...account,displayName:identities.find(identity=>identity.id===account.id)?.name||account.account_label||'Instagram'
    }));
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
    const queue=accounts();
    // At most three accounts in flight, independent failures and no extra polling.
    await Promise.allSettled(Array.from({length:Math.min(3,queue.length)},async()=>{
      while(queue.length&&permitted()&&sessionKey()===key&&generation===epoch){
        const account=queue.shift();
        await Promise.allSettled([read(account,'media',days,force,key,epoch),read(account,'followers',days,force,key,epoch)]);
        if(refreshing&&currentPage==='overview'&&currentRequest(key,epoch,account.id))render();
      }
    }));
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
  const total=(rows,key)=>rows.some(row=>row[key]!==null)?rows.reduce((sum,row)=>sum+(row[key]??0),0):null;
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
    const ranked=[...rows].sort((a,b)=>(b.views??-1)-(a.views??-1));
    host.innerHTML=`<div class="cf-dash">
      <header class="cf-dash-heading"><h2>Visão geral</h2><div class="cf-dash-tools"><label class="cf-dash-period"><span class="cf-dash-sr">Período das visualizações</span><select aria-label="Período das visualizações" onchange="setDashboardAnalyticsPeriod(this.value)">${Object.entries(periods).map(([value,label])=>`<option value="${value}" ${value===period?'selected':''}>${label}</option>`).join('')}</select></label><button type="button" class="cf-dash-refresh" aria-label="Atualizar métricas" title="Atualizar métricas" onclick="refreshDashboardMultiAccount(true)" ${refreshing?'disabled':''}>↻</button></div></header>
      <section class="cf-dash-panel" aria-label="Resumo do Instagram" aria-busy="${waiting||refreshing}">
        <div class="cf-dash-summary">
          <div class="cf-dash-primary"><strong>${format(views)}</strong><span>Visualizações</span></div>
          <div class="cf-dash-breakdown"><div><span>Reels</span><b>${format(reels)}</b></div><div><span>Stories</span><b>${format(stories)}</b></div><div><span>Seguidores</span><b>${format(followers)}</b></div></div>
        </div>
        <p class="cf-dash-updated" role="status">${rows.length?safe(updated):'Conecte uma conta Instagram na Central de Contas para ver as métricas.'}</p>
        ${rows.some(row=>['views','reels','stories','followers'].some(key=>row[key]===null))?'<p class="cf-dash-warning">Totais parciais: somam somente os dados disponíveis. Visualizações: '+available+'/'+rows.length+' contas · Seguidores: '+rows.filter(row=>row.followers!==null).length+'/'+rows.length+' contas.</p>':''}
      </section>
      <section class="cf-dash-accounts" aria-label="Métricas por conta"><h3>Por conta</h3><div class="cf-dash-account-grid">${ranked.map((row,index)=>`
        <article class="cf-dash-account">
          <span class="cf-dash-rank" aria-hidden="true">${index+1}</span>
          <span class="cf-dash-avatar" aria-hidden="true">${safe(Array.from(row.account.displayName)[0]?.toUpperCase()||'?')}</span>
          <div class="cf-dash-account-info"><h4>${safe(row.account.displayName)}</h4>
            <span class="cf-dash-username">@${safe(row.account.config?.username||row.account.account_label||'Instagram')}</span>
            <p>${row.views===null?'Visualizações indisponíveis':format(row.views)+' visualizações'}</p>
            <p>${row.followers===null?'Seguidores indisponíveis':format(row.followers)+' seguidores'}</p>
            <small>${safe(row.range)}</small>
            ${row.mediaError||row.followersError?'<small class="cf-dash-warning">'+(row.views!==null||row.followers!==null?'Atualização indisponível · último dado preservado':'Atualização indisponível')+'</small>':''}
          </div>
          ${views>0&&row.views!==null?`<div class="cf-dash-bar" aria-label="${Math.round(row.views/views*100)}% das visualizações disponíveis" role="img"><span style="width:${row.views/views*100}%"></span></div>`:''}
        </article>`).join('')||'<p class="cf-dash-empty">Nenhuma conta Instagram está conectada. <button type="button" onclick="showPage(\'accounts\')">Gerenciar contas</button></p>'}</div></section>
      <footer class="cf-dash-footer"><div><button type="button" onclick="showPage('metrics')">Ver métricas →</button><button type="button" onclick="showPage('admin')">Painel de admin</button></div><small>Fonte: Instagram (Meta) · Cache de até 5 min</small></footer>
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
    :is(#overview,#xStudio) .cf-dash{max-width:1160px;margin:26px auto 0;padding:24px 30px;color:#f4f4f4;background:#101010;border:1px solid #262626;border-radius:14px;font-family:inherit;min-width:0}
    .cf-dash-heading,.cf-dash-tools,.cf-dash-footer,.cf-dash-footer>div{display:flex;align-items:center;gap:12px}
    .cf-dash-heading,.cf-dash-footer{justify-content:space-between;flex-wrap:wrap}
    .cf-dash-heading{padding-bottom:22px;border-bottom:1px solid #343434}
    .cf-dash-heading h2{font-size:clamp(25px,4vw,40px)!important;line-height:1.1;font-weight:700;letter-spacing:-.045em;margin:0!important;color:#f5f5f5}
    .cf-dash-refresh,.cf-dash-period select,.cf-dash-period-label{border:1px solid #404040;border-radius:8px;background:#151515;color:#eee;min-height:42px;padding:8px 12px;font:inherit;font-size:13px}
    .cf-dash-refresh{cursor:pointer;font-size:20px;width:44px}
    .cf-dash-refresh:hover{background:#262626}
    .cf-dash-refresh:disabled{cursor:wait;opacity:.55}
    .cf-dash-period-label{display:inline-flex;align-items:center}
    .cf-dash-summary{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:22px;padding:28px 0 16px}
    .cf-dash-primary strong{display:block;font-size:clamp(34px,6.2vw,78px);line-height:1;letter-spacing:-.055em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .cf-dash-primary>span{display:block;color:#c2c2c2;margin-top:8px;font-size:15px}
    .cf-dash-breakdown{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
    .cf-dash-x .cf-dash-breakdown{grid-template-columns:repeat(2,minmax(0,1fr))}
    .cf-dash-breakdown>div{padding:8px 14px;border-left:1px solid #353535}
    .cf-dash-breakdown span{display:block;font-size:12px;color:#bababa}
    .cf-dash-breakdown b{display:block;margin-top:6px;font-size:clamp(14px,2vw,25px);overflow-wrap:anywhere;letter-spacing:-.025em}
    .cf-dash small,.cf-dash-updated,.cf-dash-warning{color:#a6a6a6;font-size:11px;line-height:1.5}
    .cf-dash-updated,.cf-dash-warning{margin:0 0 10px}
    .cf-dash-accounts{margin-top:18px;padding-top:18px;border-top:1px solid #343434}
    .cf-dash-accounts h3{margin:0 0 8px!important;font-size:21px!important;color:#eee}
    .cf-dash-account{display:grid;grid-template-columns:20px 42px minmax(0,1fr) minmax(80px,.9fr);align-items:center;gap:12px;padding:16px 0;border-bottom:1px solid #2d2d2d}
    .cf-dash-rank{font-size:13px;color:#aaa}
    .cf-dash-avatar{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:#282828;font-weight:650;font-size:19px}
    .cf-dash-account-info{min-width:0}
    .cf-dash-account h4{margin:0 0 4px!important;font-size:15px!important;color:#eee;overflow-wrap:anywhere}
    .cf-dash-account p{margin:2px 0;color:#c4c4c4;font-size:12px;line-height:1.45}
    .cf-dash-username{font-size:11px;color:#aaa;overflow-wrap:anywhere}
    .cf-dash-bar{height:8px;border-radius:4px;background:#353535;overflow:hidden}
    .cf-dash-bar>span{display:block;height:100%;background:#ddd;border-radius:inherit}
    .cf-dash-footer{padding-top:16px}
    .cf-dash-footer button,.cf-dash-empty button{border:0;background:transparent;color:#eee;padding:8px 0;text-decoration:underline;cursor:pointer;font:inherit;font-size:12px}
    .cf-dash-empty{font-size:13px;color:#bbb}
    .cf-dash-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    .cf-dash button:focus-visible,.cf-dash select:focus-visible{outline:2px solid #eee;outline-offset:3px}
    #xStudio .x-studio-dashboard .x-summary{display:none}
    body:has(#overview:not(.hidden)) .saas-topbar .top-search-trigger,body:has(#overview:not(.hidden)) .saas-topbar .live-worker-pill,body:has(#overview:not(.hidden)) .saas-topbar #newVideoBtn,body:has(#overview:not(.hidden)) #pageSubtitle{display:none!important}
    body:has(#overview:not(.hidden)) .saas-topbar{grid-template-columns:1fr auto!important}
    @media(max-width:760px){
      :is(#overview,#xStudio) .cf-dash{margin-top:12px;padding:16px}
      .cf-dash-heading{padding-bottom:14px}
      .cf-dash-summary{grid-template-columns:minmax(0,1fr);gap:18px;padding:18px 0 12px}
      .cf-dash-breakdown{border-top:1px solid #343434;padding-top:10px}
      .cf-dash-breakdown>div{padding:4px 8px}
      .cf-dash-breakdown>div:first-child{border:0;padding-left:0}
      .cf-dash-breakdown span{font-size:10px}
      .cf-dash-account{grid-template-columns:14px 36px minmax(0,1fr);gap:8px}
      .cf-dash-avatar{width:36px;height:36px;font-size:16px}
      .cf-dash-bar{grid-column:3}
    }
  `;
  document.head.appendChild(style);
  if(currentPage==='overview')render();
})();
