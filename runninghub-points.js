(()=>{
  if(window.CloudentPoints)return;
  let viewer='',data=null,error='',loading=false,loadedAt=0,inflight=null;
  let statement=null,statementLoading=false,statementError='',page=0,period='month',module='all',statementRev=0;
  const allowed=()=>typeof cloudSession!=='undefined'&&!!cloudSession&&typeof cloudAccess!=='undefined'&&cloudAccess?.role==='admin';
  const key=()=>allowed()?(cloudSession.access_token||cloudSession.user?.id||''):'';
  const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const format=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('pt-BR',{maximumFractionDigits:3}):'—';
  const date=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Aguardando leitura';
  const label=m=>m==='GENJUTSU legado'?'GENJUTSU LLM':m;
  const endpoint=()=> (window.CloudentConfig?.supabaseUrl||'')+'/functions/v1/cloudent-points';
  function reset(){const next=key();if(next===viewer)return;viewer=next;data=null;error='';loading=false;loadedAt=0;inflight=null;statement=null;page=0;period='month';module='all';statementRev++;statementLoading=false;}
  const relevant=()=>['overview','faceSwap','faceSwapPhoto','production','settings'].includes(currentPage);
  function paint(){
    if(!allowed())return;
    for(const node of document.querySelectorAll('[data-points-balance]'))node.innerHTML=balanceMarkup();
    for(const node of document.querySelectorAll('[data-points-dashboard]'))node.innerHTML=dashboardBody();
    if(currentPage==='settings'&&typeof settingsTab!=='undefined'&&settingsTab==='expenses'){
      const node=document.querySelector('[data-points-statement]');if(node)node.innerHTML=statementBody();
    }
  }
  async function load(force=false){
    reset();if(!viewer||!relevant())return;if(inflight)return inflight;
    if(!force&&loadedAt&&Date.now()-loadedAt<60000){paint();return;}
    const session=viewer;loading=true;paint();
    const task=(async()=>{try{
      const result=await edgeFetch(endpoint()+(force?'?action=refresh':''),{method:force?'POST':'GET'});
      if(key()!==session)return;
      if(!result?.balance||!Array.isArray(result.totals)||!Array.isArray(result.modules))throw Error('invalid_response');
      data=result;error='';
    }catch{if(key()===session)error='Consulta indisponível. Última leitura preservada.'}
    finally{if(key()===session){loading=false;loadedAt=Date.now();inflight=null;paint();}}})();inflight=task;return task;
  }
  const total=id=>data?.totals?.find(r=>r.module==='all'&&r.key===id);
  function balanceMarkup(){const b=data?.balance;return `<div class="cf-points-wallet"><span>Saldo RunningHub</span><strong>${format(b?.points)} <small>pontos</small></strong><button type="button" onclick="CloudentPoints.refresh()" ${loading?'disabled':''} aria-label="Atualizar saldo">${loading?'Atualizando…':'Atualizar'}</button><small>${safe(error||b?.error||'Consultado em '+date(b?.fetched_at))}</small></div>`;}
  function dashboardBody(){
    const card=(id,title)=>{const t=total(id);return `<article><span>${title}</span><strong>${format(t?.points)} <small>pontos</small></strong><p>${t?(t.pending?t.pending+' cobrança(s) pendente(s)':'Cobranças confirmadas'):'Aguardando consulta'}</p></article>`};
    return `<header class="cf-points-head"><h3>Pontos da produção</h3><button type="button" onclick="CloudentPoints.openExpenses()">Ver extrato</button></header><div class="cf-points-cards"><article class="cf-points-balance"><span>SALDO DISPONÍVEL</span><strong>${format(data?.balance?.points)} <small>pontos</small></strong><p>Conta RunningHub</p></article>${card('today','GASTO HOJE')}${card('yesterday','GASTO ONTEM')}${card('month','GASTO NO MÊS')}</div><p class="cf-points-note">${safe(error||data?.balance?.error||'Saldo consultado em '+date(data?.balance?.fetched_at))} · Consumo pendente não é considerado zero.</p>`;
  }
  function markup(){reset();return viewer?'<section class="cf-points" data-points-dashboard aria-label="Pontos RunningHub">'+dashboardBody()+'</section>':'';}
  function header(){reset();return viewer?'<div data-points-balance>'+balanceMarkup()+'</div>':'';}
  function statementBody(){
    const rows=statement?.rows||[];
    const modules=[...new Set(['Face Swap','Upscale','GENJUTSU legado','GENJUTSU V3','Motion Control','Produção',...(data?.modules||[]).map(m=>m.module)])];
    const filters=`<div class="cf-points-filters"><label>Período<select onchange="CloudentPoints.filter('period',this.value)">${[['today','Hoje'],['yesterday','Ontem'],['month','Este mês'],['all','Todo o histórico']].map(([v,n])=>`<option value="${v}" ${v===period?'selected':''}>${n}</option>`).join('')}</select></label><label>Fluxo<select onchange="CloudentPoints.filter('module',this.value)"><option value="all">Todos os fluxos</option>${modules.map(m=>`<option value="${safe(m)}" ${m===module?'selected':''}>${safe(label(m))}</option>`).join('')}</select></label><button type="button" onclick="CloudentPoints.refreshStatement()" ${statementLoading?'disabled':''}>${statementLoading?'Consultando…':'Atualizar extrato'}</button></div>`;
    return `${balanceMarkup()}${filters}<p role="status">${safe(statementError)}${statementLoading?' Carregando extrato…':''}</p><div class="cf-points-scroll"><table><thead><tr><th>Data da execução</th><th>Fluxo</th><th>Pontos</th><th>Estado</th><th>Tarefa RunningHub</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${safe(date(r.started_at))}</td><td>${safe(label(r.module))}</td><td>${r.settled?format(r.points):'Pendente'}</td><td>${safe(r.provider_status||'Aguardando')} · ${r.settled?'Cobrança confirmada':'Aguardando cobrança'}</td><td><code>${safe(r.task_id)}</code></td></tr>`).join('')||`<tr><td colspan="5">${statementLoading?'Carregando…':'Nenhuma execução neste filtro.'}</td></tr>`}</tbody></table></div><div class="cf-points-pagination"><button type="button" onclick="CloudentPoints.turn(-1)" ${!page||statementLoading?'disabled':''}>Anterior</button><span>Página ${page+1} · ${statement?.count??0} execuções</span><button type="button" onclick="CloudentPoints.turn(1)" ${statementLoading||!statement||((page+1)*50>=statement.count)?'disabled':''}>Próxima</button></div><p class="cf-points-note">Pontos por tarefa, sem duplicar variantes do mesmo vídeo. Cada tentativa com novo ID aparece no extrato. Datas no horário de Brasília. Gastos de fora do Cloudent e IDs antigos não registrados não estão incluídos. Valores ausentes continuam pendentes. LLM: tokens não comprovam cobrança em pontos.</p>`;
  }
  function expenses(){reset();return viewer?'<section class="cf-points" data-points-statement aria-label="Extrato de gastos">'+statementBody()+'</section>':'<p>Acesso restrito ao administrador.</p>';}
  async function loadStatement(){reset();if(!viewer)return;const rev=++statementRev,session=viewer;statementLoading=true;statementError='';paint();
    try{const result=await edgeFetch(endpoint()+'?'+new URLSearchParams({action:'statement',period,module,page:String(page)}),{method:'GET'});if(rev!==statementRev||session!==key())return;if(!Array.isArray(result?.rows))throw Error();statement=result;}
    catch{if(rev===statementRev)statementError='Não foi possível consultar o extrato. Tente atualizar.'}
    finally{if(rev===statementRev){statementLoading=false;paint();}}
  }
  window.CloudentPoints={get balance(){return data?.balance?.points??null;},markup,header,expenses,load,loadStatement,refresh:()=>load(true),openExpenses:()=>{showPage('settings');setSettingsTab('expenses');},refreshStatement:()=>{void load(true);return loadStatement();},filter:(kind,value)=>{if(kind==='period')period=value;else module=value;page=0;statement=null;void loadStatement();},turn:delta=>{if(statementLoading)return;page=Math.max(0,page+delta);void loadStatement();}};
  const style=document.createElement('style');style.textContent=`
.cf-points{--point-border:#343434;margin:20px 0;padding:20px;background:#141414;border:1px solid var(--point-border);border-radius:16px;color:#eee;min-width:0}.cf-points-head,.cf-points-pagination,.cf-points-filters{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.cf-points-head h3{font-size:18px!important;margin:0 0 12px}.cf-points button,.cf-points select,.cf-points-wallet button{font:inherit;font-size:13px;padding:10px 13px;border:1px solid #414141;border-radius:10px;background:#202020;color:#eee;cursor:pointer}.cf-points button:disabled,.cf-points-wallet button:disabled{opacity:.45;cursor:wait}.cf-points-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.cf-points-cards article{padding:18px;border:1px solid #383838;border-radius:14px;min-width:0;background:#101010}.cf-points-cards .cf-points-balance{background:#eee;color:#111}.cf-points-cards span{font-size:11px}.cf-points-cards strong{display:block;margin:12px 0;font-size:clamp(22px,3vw,34px);overflow-wrap:anywhere}.cf-points strong small{font-size:12px;font-weight:400}.cf-points-cards p,.cf-points-note{font-size:12px;line-height:1.65;opacity:.7}.cf-points-wallet{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#171717;border:1px solid #3b3b3b;border-radius:14px;padding:14px 18px;margin:14px 0;color:#eee}.cf-points-wallet>span{font-size:13px}.cf-points-wallet>strong{font-size:22px;margin-right:auto}.cf-points-wallet>small{width:100%;font-size:11px;color:#aaa}.cf-points-filters label{display:grid;gap:7px;font-size:13px}.cf-points-scroll{overflow:auto;max-width:100%}.cf-points table{width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap;margin:14px 0}.cf-points th,.cf-points td{text-align:left;padding:13px 10px;border-bottom:1px solid #303030}.cf-points th{color:#aaa;font-weight:500}.cf-points-pagination{font-size:13px}.cf-points code{font-size:12px}@media(max-width:900px){.cf-points-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:540px){.cf-points{padding:14px}.cf-points-cards{gap:8px}.cf-points-cards article{padding:13px}.cf-points-filters label{flex:1;min-width:120px}}
`;document.head.appendChild(style);
  setInterval(()=>{if(allowed()&&relevant()&&!document.hidden)void load();},60000);
})();
