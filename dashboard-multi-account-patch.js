(()=>{
  if(window.__cfDashboardMultiAccountPatchV1)return;
  window.__cfDashboardMultiAccountPatchV1=true;

  const metricCache=new Map();
  let metricsLoading=false;

  const accountId=a=>String(a?.id||a?.platform_account_id||"");
  const accountName=a=>String(a?.account_label||a?.config?.username||a?.username||"Instagram").replace(/^@/,"");
  const activeInstagramAccounts=()=>Array.isArray(platformAccounts)
    ? platformAccounts.filter(a=>String(a?.platform||"").toLowerCase()==="instagram"&&a?.enabled!==false)
    : [];
  const rowAccountId=row=>String(row?.platformAccountId||row?.platform_account_id||"");
  const accountForRow=row=>activeInstagramAccounts().find(a=>accountId(a)===rowAccountId(row))||null;
  const safe=value=>typeof esc==="function"?esc(value):String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const metricRowsForPeriod=rows=>dashboardPeriod==="all"?rows:rows.filter(m=>dashboardDateInPeriod(m.timestamp,dashboardPeriod));
  const sumMetrics=rows=>rows.reduce((a,m)=>({views:a.views+(+m.views||0),reach:a.reach+(+m.reach||0)}),{views:0,reach:0});

  function ageLabel(value){
    if(!value)return "Conectada · aguardando métricas";
    const ms=Date.now()-new Date(value).getTime();
    if(!Number.isFinite(ms)||ms<0)return "Métricas sincronizadas";
    const min=Math.floor(ms/60000);
    if(min<1)return "Métricas atualizadas agora";
    if(min<60)return "Métricas atualizadas há "+min+" min";
    const h=Math.floor(min/60);
    if(h<24)return "Métricas atualizadas há "+h+" h";
    return "Métricas atualizadas há "+Math.floor(h/24)+" d";
  }

  async function loadAccountMetric(account,force=false){
    const id=accountId(account);
    if(!id)return;
    const current=metricCache.get(id);
    if(!force&&current&&Date.now()-current.loadedAt<60000)return;
    try{
      const suffix="&account_id="+encodeURIComponent(id);
      if(force){
        await edgeFetch(IG_METRICS_URL+"?timezone=America/Sao_Paulo&days=1"+suffix,{method:"POST"});
      }
      const stored=await edgeFetch(IG_METRICS_URL+"?timezone=America/Sao_Paulo&days=120"+suffix,{method:"GET"});
      metricCache.set(id,{media:Array.isArray(stored?.media)?stored.media:[],last:stored?.last_collected_at||null,error:"",loadedAt:Date.now()});
    }catch(error){
      metricCache.set(id,{media:current?.media||[],last:current?.last||null,error:error?.message||"metrics_unavailable",loadedAt:Date.now()});
    }
  }

  async function loadDashboardAccountMetrics(force=false){
    if(metricsLoading)return;
    metricsLoading=true;
    try{
      await Promise.allSettled(activeInstagramAccounts().map(a=>loadAccountMetric(a,force)));
    }finally{
      metricsLoading=false;
    }
  }

  async function patchedLoadDashboardScheduleRows(){
    if(!cloudSession)return;
    try{
      const rows=await cloudFetch("?resource=queue&compact=1&from="+encodeURIComponent("2020-01-01T00:00:00.000Z"));
      dashboardScheduleRows=(Array.isArray(rows)?rows:[]).map(row=>{
        const v=row.videos||{};
        return {
          scheduleId:row.id,
          videoId:row.video_id,
          platformAccountId:row.platform_account_id||null,
          name:v.file_name||"Vídeo",
          scheduledAt:row.scheduled_at,
          publishedAt:row.published_at||null,
          status:row.status||"scheduled",
          smartMode:row.smart_mode||"manual",
          platform:row.platform||"instagram"
        };
      });
    }catch(error){
      console.warn("Dashboard history unavailable:",error);
    }
  }

  async function refreshDashboardMultiAccount(force=false){
    if(!cloudSession)return;
    await Promise.allSettled([
      typeof loadPlatformAccounts==="function"?loadPlatformAccounts():Promise.resolve(),
      patchedLoadDashboardScheduleRows()
    ]);
    await loadDashboardAccountMetrics(force);
    if(currentPage==="overview")overview();
  }
  window.refreshDashboardMultiAccount=refreshDashboardMultiAccount;

  try{loadDashboardScheduleRows=patchedLoadDashboardScheduleRows}catch{}

  function accountCard(account,future){
    const id=accountId(account);
    const name=accountName(account);
    const displayName=dashboardHideNames?"••••••••":"@"+name;
    const photo=String(account?.config?.profile_picture_url||account?.profile_picture_url||"").trim();
    const avatar=photo
      ?'<img src="'+safe(photo)+'" alt="" referrerpolicy="no-referrer">'
      :'<span>'+safe(name.slice(0,1).toUpperCase()||"I")+'</span>';
    const cached=metricCache.get(id);
    const fallback=id===String(metricsAccountId||"")?liveInstagramMetrics:[];
    const media=metricRowsForPeriod(cached?.media?.length?cached.media:(Array.isArray(fallback)?fallback:[]));
    const totals=sumMetrics(media);
    const queue=future.filter(x=>rowAccountId(x)===id).length;
    const status=account?.enabled!==false?"Conta conectada · operação ativa":"Conta desativada";
    const live=cached?.error?(cached?.media?.length?ageLabel(cached.last):"Métricas indisponíveis"):ageLabel(cached?.last);
    return `<div class="sr-account-card cf-dashboard-account-card">
      <div class="sr-account-icon cf-dashboard-avatar">${avatar}</div>
      <div><b>${safe(displayName)}</b><span>${safe(status)}</span><small class="sr-live-label">${safe(live)}</small></div>
      <div class="sr-account-metrics">
        <span>Views <b>${totals.views.toLocaleString("pt-BR")}</b></span>
        <span>Alcance <b>${totals.reach.toLocaleString("pt-BR")}</b></span>
        <span>Fila <b>${queue}</b></span>
      </div>
    </div>`;
  }

  function patchedOverview(){
    if(cloudLoading){$("#overview").innerHTML=loadingShell("Carregando sua operação");return}
    const scheduled=dashboardScheduleRows.length?dashboardScheduleRows:allScheduled();
    const filtered=scheduled.filter(x=>{
      const status=getStatus(x);
      const reference=status==="publicado"?(x.publishedAt||x.scheduledAt):x.scheduledAt;
      return dashboardDateInPeriod(reference,dashboardPeriod);
    });
    const now=Date.now();
    const future=scheduled.filter(x=>
      new Date(x.scheduledAt).getTime()>=now &&
      !["publicado","erro","cancelado"].includes(getStatus(x)) &&
      dashboardDateInPeriod(x.scheduledAt,dashboardPeriod)
    );
    const counts={
      total:filtered.length,
      scheduled:filtered.filter(x=>["agendado","fila","publicando"].includes(getStatus(x))).length,
      published:filtered.filter(x=>getStatus(x)==="publicado").length,
      error:filtered.filter(x=>getStatus(x)==="erro").length
    };
    const accounts=activeInstagramAccounts();
    const greetingName=dashboardHideNames||accounts.length!==1?"Cloudent":accountName(accounts[0]).split(/[._]/)[0];
    const today=new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).toUpperCase();
    const next=future.slice(0,8);
    const periodCaption=dashboardPeriodCaption(dashboardPeriod);
    const periodNoun=dashboardPeriod==="today"?"hoje":dashboardPeriod==="7d"?"nos próximos 7 dias":dashboardPeriod==="month"?"neste mês":dashboardPeriod==="year"?"neste ano":"no histórico";
    const cardLabels={
      total:dashboardPeriod==="today"?"PROGRAMADOS HOJE":"POSTS "+periodNoun.toUpperCase(),
      scheduled:dashboardPeriod==="today"?"A PUBLICAR HOJE":"A PUBLICAR",
      published:dashboardPeriod==="today"?"PUBLICADOS HOJE":"PUBLICADOS",
      error:dashboardPeriod==="today"?"ERROS HOJE":"ERROS"
    };
    const cards=accounts.length
      ?accounts.map(a=>accountCard(a,future)).join("")
      :`<div class="sr-account-card cf-dashboard-account-card"><div class="sr-account-icon">◎</div><div><b>Instagram</b><span>Nenhuma conta conectada</span><small class="sr-live-label">Conecte uma conta nas configurações</small></div><div class="sr-account-metrics"><span>Views <b>0</b></span><span>Alcance <b>0</b></span><span>Fila <b>${future.length}</b></span></div></div>`;

    $("#overview").innerHTML=`
      <div class="sr-dashboard-top">
        <div class="sr-greeting">Bom dia, <b>${safe(greetingName)}</b><small>${today}</small></div>
      </div>

      <div class="sr-dashboard-head">
        <div><h2>Dashboard</h2><p>Visão geral das postagens</p></div>
        <div class="sr-head-actions">
          <button onclick="refreshDashboardMultiAccount(true)">↻ Atualizar ao vivo</button>
          <button onclick="showPage('settings')">Ajuda</button>
        </div>
      </div>

      <div class="sr-periods">
        <button class="${dashboardPeriod==="today"?"active":""}" onclick="setDashboardPeriod('today')">Hoje</button>
        <button class="${dashboardPeriod==="7d"?"active":""}" onclick="setDashboardPeriod('7d')">Próximos 7 dias</button>
        <button class="${dashboardPeriod==="month"?"active":""}" onclick="setDashboardPeriod('month')">Mês</button>
        <button class="${dashboardPeriod==="year"?"active":""}" onclick="setDashboardPeriod('year')">Ano</button>
        <button class="${dashboardPeriod==="all"?"active":""}" onclick="setDashboardPeriod('all')">Tudo</button>
        <span>${safe(periodCaption)}</span>
      </div>

      <div class="sr-stat-grid">
        <div class="sr-stat"><span>${cardLabels.total}</span><strong>${counts.total}</strong><small>${counts.scheduled} restantes · ${counts.published} publicados</small></div>
        <div class="sr-stat blue"><span>${cardLabels.scheduled}</span><strong>${counts.scheduled}</strong><small>pendentes no período</small></div>
        <div class="sr-stat green"><span>${cardLabels.published}</span><strong>${counts.published}</strong><small>publicações concluídas</small></div>
        <div class="sr-stat red"><span>${cardLabels.error}</span><strong>${counts.error}</strong><small>falhas de publicação</small></div>
      </div>

      <div class="sr-operation">
        <div class="sr-section-head">
          <div><span>OPERAÇÃO POR CONTA</span><p>${accounts.length} conta${accounts.length===1?"":"s"} do Instagram conectada${accounts.length===1?"":"s"}, com fila separada.</p></div>
          <button onclick="toggleDashboardNames()">${dashboardHideNames?"Mostrar nomes":"Esconder nomes"}</button>
        </div>
        <div class="cf-dashboard-account-list">${cards}</div>
      </div>

      <div class="sr-next">
        <div class="sr-next-title">PRÓXIMOS POSTS</div>
        <div class="sr-table-head"><span>CONTA</span><span>STATUS</span><span>AGENDADO</span><span>ARQUIVO</span></div>
        ${next.length?next.map(x=>{
          const linked=accountForRow(x);
          const label=linked?"@"+accountName(linked):"Instagram";
          const shown=dashboardHideNames&&linked?"••••••••":label;
          return `<div class="sr-table-row"><span>${safe(shown)}</span><span><i class="sr-dot"></i>${statusLabel(getStatus(x))}</span><span>${fmtDateTime(x.scheduledAt)}</span><b>${safe(x.name||"Vídeo")}</b></div>`;
        }).join(""):`<div class="sr-empty"><b>Nenhum post agendado</b><span>A fila está vazia.</span></div>`}
      </div>`;

    if(accounts.some(a=>!metricCache.has(accountId(a)))&&!metricsLoading){
      setTimeout(()=>loadDashboardAccountMetrics(false).then(()=>{if(currentPage==="overview")patchedOverview()}),0);
    }
  }

  try{overview=patchedOverview}catch{}

  const style=document.createElement("style");
  style.textContent=`
    .cf-dashboard-account-list{display:grid;gap:10px}
    .cf-dashboard-avatar{overflow:hidden;padding:0}
    .cf-dashboard-avatar img{width:100%;height:100%;object-fit:cover;display:block}
    .cf-dashboard-avatar span{width:100%;height:100%;display:grid;place-items:center;font-weight:900}
    @media(min-width:1180px){.cf-dashboard-account-list:has(.cf-dashboard-account-card:nth-child(2)){grid-template-columns:repeat(2,minmax(0,1fr))}.cf-dashboard-account-list .sr-account-card{margin:0}}
    @media(max-width:760px){.cf-dashboard-account-list{grid-template-columns:1fr!important}.cf-dashboard-account-list .sr-account-card{min-width:0}.cf-dashboard-account-list .sr-account-metrics{gap:12px}}
  `;
  document.head.appendChild(style);

  setTimeout(()=>{
    if(!cloudSession)return;
    refreshDashboardMultiAccount(false).catch(error=>console.warn("Dashboard multi-account patch",error));
  },0);
})();
