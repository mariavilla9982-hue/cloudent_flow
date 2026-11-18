(()=>{
  if(window.CloudentPoints)return;
  let viewer='',data=null,error='',loading=false,loadedAt=0,inflight=null,scope='all';
  const allowed=()=>typeof cloudSession!=='undefined'&&!!cloudSession&&typeof cloudAccess!=='undefined'&&cloudAccess?.role==='admin';
  const key=()=>allowed()?(cloudSession.access_token||cloudSession.user?.id||''):'';
  const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const format=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('pt-BR',{maximumFractionDigits:2}):'—';
  const date=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Aguardando leitura';
  function reset(){
    const next=key();if(next===viewer)return;
    viewer=next;data=null;error='';loading=false;loadedAt=0;inflight=null;scope='all';
  }
  const redraw=()=>{if(allowed()&&currentPage==='overview'&&typeof overview==='function')overview()};
  async function load(force=false){
    reset();if(!viewer||currentPage!=='overview')return;
    if(inflight)return inflight;
    if(!force&&loadedAt&&Date.now()-loadedAt<60000)return;
    const session=viewer;loading=true;
    const task=(async()=>{
      try{
        const url=(window.CloudentConfig?.supabaseUrl||'')+'/functions/v1/cloudent-points'+(force?'?action=refresh':'');
        const result=await edgeFetch(url,{method:force?'POST':'GET'});
        if(key()!==session)return;
        if(!result?.balance||!Array.isArray(result.totals)||!Array.isArray(result.modules)||!Array.isArray(result.recent))throw Error('invalid_response');
        data=result;error='';
      }catch{if(key()===session)error='Não foi possível atualizar. Última leitura preservada.'}
      finally{if(key()===session){loading=false;loadedAt=Date.now();inflight=null;redraw()}}
    })();
    inflight=task;return task;
  }
  function markup(){
    reset();if(!viewer)return '';
    const balance=data?.balance,totals=data?.totals||[],rows=scope==='all'?data?.modules||[]:(data?.modules||[]).filter(r=>r.module===scope);
    const period=id=>totals.find(r=>r.module===scope&&r.key===id);
    const card=(id,label)=>{const value=period(id);return `<article><span>${label}</span><strong>${format(value?.points)} <small>pts</small></strong><p>${value?value.tasks+' tarefas'+(value.pending?' · '+value.pending+' sem cobrança confirmada':' · Cobranças confirmadas'):'Aguardando consulta'}${typeof value?.coins==='number'?' · '+format(value.coins)+' RH coins':''}</p></article>`};
    const pending=period('month')?.pending||0;
    const stale=balance?.fetched_at&&Date.now()-Date.parse(balance.fetched_at)>10*60000;
    return `<section class="cf-points" aria-label="Pontos do RunningHub" aria-busy="${loading}">
      <div class="cf-points-head"><div><small>PRODUÇÃO IA</small><h3>Pontos RunningHub</h3></div><div><select aria-label="Filtrar consumo" onchange="CloudentPoints.select(this.value)"><option value="all" ${scope==='all'?'selected':''}>Todos os fluxos</option><option value="GENJUTSU V3" ${scope==='GENJUTSU V3'?'selected':''}>GENJUTSU V3</option></select><button type="button" onclick="CloudentPoints.refresh()" ${loading?'disabled':''}>${loading?'Atualizando…':'↻ Atualizar'}</button></div></div>
      <div class="cf-points-cards"><article class="cf-points-balance"><span>SALDO DA CONTA</span><strong>${format(balance?.points)} <small>pts</small></strong><p>${typeof balance?.coins==='number'?format(balance.coins)+' RH coins · ':''}${balance?.points===null?'Pontos não informados pelo RunningHub':'Saldo informado pelo RunningHub'}</p></article>${card('today','GASTOU HOJE')}${card('yesterday','GASTOU ONTEM')}${card('month','GASTOU NO MÊS')}</div>
      <p class="cf-points-status" role="status">${safe(error||balance?.error||(stale?'Saldo desatualizado · última leitura em ':'Atualizado em ')+date(balance?.fetched_at))}${pending?' · Totais parciais: '+pending+' cobranças ainda sem confirmação.':''}</p>
      <details><summary>Onde gastou no mês</summary><div class="cf-points-scroll"><table><thead><tr><th>Fluxo</th><th>Pontos</th><th>RH coins</th><th>Tarefas</th><th>Pendentes</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${safe(r.module)}</td><td>${format(r.points)}</td><td>${format(r.coins)}</td><td>${r.tasks}</td><td>${r.pending}</td></tr>`).join('')||'<tr><td colspan="5">Nenhuma tarefa registrada no período.</td></tr>'}</tbody></table></div></details>
      <details><summary>Últimas cobranças</summary><div class="cf-points-scroll"><table><thead><tr><th>Execução</th><th>Fluxo</th><th>Pontos</th><th>RH coins</th><th>Estado</th></tr></thead><tbody>${(data?.recent||[]).filter(r=>scope==='all'||r.module===scope).map(r=>`<tr><td title="Tarefa ${safe(r.task_id)}">${safe(date(r.started_at))}</td><td>${safe(r.module)}</td><td>${format(r.points)}</td><td>${format(r.coins)}</td><td>${r.settled?'Confirmada':'Aguardando cobrança'}</td></tr>`).join('')||'<tr><td colspan="5">Sem cobranças disponíveis.</td></tr>'}</tbody></table></div></details>
      <p class="cf-points-note">Por início da execução · Horário de Brasília · Saldo da conta inteira; gastos apenas do Cloudent. Histórico anterior à ativação pode estar incompleto. Atualização automática a cada 5 min.</p>
    </section>`;
  }
  window.CloudentPoints={markup,load,refresh:()=>{const promise=load(true);redraw();return promise},select:value=>{if(['all','GENJUTSU V3'].includes(value)){scope=value;redraw()}}};
  const style=document.createElement('style');style.textContent=`
    .cf-points{margin-top:24px;padding:22px 0 0;border-top:1px solid #343434;color:#eee;min-width:0}
    .cf-points-head,.cf-points-head>div:last-child{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
    .cf-points-head small{font-size:9px;letter-spacing:.15em;color:#888}.cf-points-head h3{font-size:20px!important;letter-spacing:-.03em;margin:5px 0 18px!important}
    .cf-points select,.cf-points button{font:inherit;font-size:11px;padding:9px 12px;color:#eee;background:#181818;border:1px solid #393939;border-radius:8px}.cf-points button{cursor:pointer}.cf-points button:disabled{opacity:.55;cursor:wait}
    .cf-points-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:8px}.cf-points-cards article{padding:18px 15px;background:#171717;border:1px solid #333;border-radius:12px;min-width:0}.cf-points-cards .cf-points-balance{background:#ededed;color:#111;border-color:#ededed}
    .cf-points-cards span{font-size:9px;letter-spacing:.07em;opacity:.65}.cf-points-cards strong{display:block;font-size:clamp(22px,2.5vw,32px);letter-spacing:-.04em;margin:10px 0;overflow-wrap:anywhere}.cf-points-cards small{font-size:11px;font-weight:400;letter-spacing:0;opacity:.6}.cf-points-cards p{font-size:10px;line-height:1.6;opacity:.65;margin:0}
    .cf-points-status,.cf-points-note{font-size:10px;color:#999;line-height:1.6}.cf-points-note{font-size:9px;color:#777;margin-bottom:0}.cf-points details{border-top:1px solid #2c2c2c;padding:12px 0}.cf-points summary{cursor:pointer;font-size:11px}.cf-points-scroll{overflow-x:auto}.cf-points table{width:100%;border-collapse:collapse;font-size:10px;white-space:nowrap;margin-top:12px}.cf-points th,.cf-points td{padding:10px 8px;text-align:left;border-bottom:1px solid #292929}.cf-points th{font-weight:500;color:#999}
    @media(max-width:900px){.cf-points-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:420px){.cf-points-cards{gap:7px}.cf-points-cards article{padding:14px 10px}.cf-points-head>div:last-child{width:100%;margin-bottom:10px}.cf-points select{flex:1;min-width:0}}
  `;document.head.appendChild(style);
})();
