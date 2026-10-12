(()=>{
  if(window.__cloudentViralsForYouPatchV1)return;
  window.__cloudentViralsForYouPatchV1=true;

  const ext={mode:'profile',loading:false,data:null,error:'',syncing:false,booted:false};
  const ENDPOINT=()=>{
    try{return SUPABASE_URL+'/functions/v1/cloudent-virals-foryou'}catch{return ''}
  };

  const style=document.createElement('style');
  style.id='cloudent-virals-foryou-style';
  style.textContent=`
    .virals-reels-subtabs{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:-3px 0 13px;padding:5px;border:1px solid #202020;border-radius:14px;background:#090909}
    .virals-reels-subtab{min-height:39px;border:0;border-radius:10px;background:transparent;color:#74747c;font-size:10px;font-weight:900;cursor:pointer;transition:.16s ease}
    .virals-reels-subtab.active{background:#171717;color:#f1f1f1;box-shadow:inset 0 0 0 1px #292929}
    .virals-reels-subtab b{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;margin-left:5px;padding:0 5px;border-radius:999px;background:#202020;color:#a9a9af;font-size:8px}
    .virals-foryou-panel{display:none;margin:0 0 16px}
    .virals-shell.foryou-mode>.virals-foryou-panel{display:block}
    .virals-shell.foryou-mode>.virals-meta,
    .virals-shell.foryou-mode>.virals-grid,
    .virals-shell.foryou-mode>.virals-empty,
    .virals-shell.foryou-mode>.virals-highlight-note{display:none!important}
    .foryou-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:17px;border:1px solid #242424;border-radius:18px;background:linear-gradient(145deg,#0d0d0d,#090909);margin-bottom:10px}
    .foryou-kicker{display:block;margin-bottom:5px;color:#71717a;font-size:9px;font-weight:900;letter-spacing:.11em;text-transform:uppercase}
    .foryou-head h3{margin:0;color:#f3f3f4;font-size:18px;letter-spacing:-.025em}
    .foryou-head p{max-width:620px;margin:6px 0 0;color:#777780;font-size:10px;line-height:1.55}
    .foryou-refresh{flex:0 0 auto;min-height:39px;padding:0 12px;border:1px solid #2b2b2b;border-radius:10px;background:#111;color:#d8d8dc;font-size:9px;font-weight:900;cursor:pointer}
    .foryou-refresh:disabled{opacity:.5;cursor:wait}
    .foryou-controls{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;margin-bottom:10px}
    .foryou-rule,.foryou-target{border:1px solid #232323;border-radius:15px;background:#0b0b0b;padding:13px}
    .foryou-rule{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
    .foryou-rule div{min-width:0;padding:9px;border:1px solid #202020;border-radius:11px;background:#0e0e0e}
    .foryou-rule span,.foryou-target>span{display:block;color:#64646c;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
    .foryou-rule b{display:block;color:#e7e7e9;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .foryou-target{min-width:170px}
    .foryou-target-buttons{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .foryou-target-buttons button{height:36px;border:1px solid #292929;border-radius:9px;background:#111;color:#888891;font-size:10px;font-weight:900;cursor:pointer}
    .foryou-target-buttons button.active{background:#ededed;border-color:#ededed;color:#090909}
    .foryou-status{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 13px;border:1px solid #242424;border-radius:14px;background:#0b0b0b;margin-bottom:10px}
    .foryou-status-main{display:flex;align-items:center;gap:9px;min-width:0}
    .foryou-dot{width:8px;height:8px;border-radius:50%;background:#6d7480;box-shadow:0 0 0 5px rgba(109,116,128,.08);flex:0 0 auto}
    .foryou-status.ready .foryou-dot{background:#47c98a;box-shadow:0 0 0 5px rgba(71,201,138,.08)}
    .foryou-status.running .foryou-dot{background:#efbf58;box-shadow:0 0 0 5px rgba(239,191,88,.08)}
    .foryou-status.error .foryou-dot{background:#ef6578;box-shadow:0 0 0 5px rgba(239,101,120,.08)}
    .foryou-status-main b{display:block;color:#e2e2e5;font-size:10px;margin-bottom:2px}
    .foryou-status-main small{display:block;color:#66666e;font-size:8px;line-height:1.45}
    .foryou-progress{text-align:right;flex:0 0 auto}.foryou-progress b{display:block;color:#f2f2f3;font-size:16px;line-height:1}.foryou-progress small{display:block;color:#66666e;font-size:8px;margin-top:4px}
    .foryou-connect-card{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px;border:1px solid #2b2b2b;border-radius:14px;background:#0c0c0c;margin-bottom:10px}
    .foryou-connect-copy{min-width:0}.foryou-connect-copy b{display:block;color:#efeff1;font-size:10px;margin-bottom:3px}.foryou-connect-copy span{display:block;color:#707078;font-size:8px;line-height:1.5}
    .foryou-connect-btn{flex:0 0 auto;min-height:42px;padding:0 14px;border:1px solid #ededed;border-radius:11px;background:#ededed;color:#090909;font-size:9px;font-weight:950;cursor:pointer}
    .foryou-warning{padding:14px;border:1px solid #3a3120;border-radius:14px;background:#17130b;color:#a89b7b;font-size:9px;line-height:1.6;margin-bottom:10px}
    .foryou-warning b{color:#d9c795}
    .foryou-error{padding:12px;border:1px solid #47252a;border-radius:13px;background:#180d0f;color:#d39ca5;font-size:9px;line-height:1.55;margin-bottom:10px}
    .foryou-empty{min-height:210px;border:1px dashed #292929;border-radius:17px;background:#0a0a0a;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;color:#71717a}
    .foryou-empty b{color:#d9d9dd;font-size:12px;margin-bottom:5px}.foryou-empty span{max-width:480px;font-size:9px;line-height:1.6}
    .foryou-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .foryou-card{min-width:0;border:1px solid #242424;border-radius:16px;background:#0c0c0c;overflow:hidden}
    .foryou-cover{aspect-ratio:9/12;position:relative;background:#111;overflow:hidden}.foryou-cover img{width:100%;height:100%;display:block;object-fit:cover}
    .foryou-cover-empty{height:100%;display:grid;place-items:center;color:#505057;font-size:9px}
    .foryou-view-badge{position:absolute;left:8px;bottom:8px;padding:6px 8px;border:1px solid rgba(255,255,255,.15);border-radius:9px;background:rgba(5,5,5,.84);color:#fff;font-size:9px;font-weight:900;backdrop-filter:blur(7px)}
    .foryou-body{padding:10px}.foryou-caption{height:34px;overflow:hidden;color:#bdbdc2;font-size:9px;line-height:1.65;margin-bottom:9px}.foryou-caption.empty{color:#55555c}
    .foryou-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}.foryou-actions button,.foryou-actions a{height:34px;border:1px solid #292929;border-radius:9px;background:#101010;color:#d4d4d8;text-decoration:none;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;cursor:pointer}.foryou-actions button.primary{background:#ededed;border-color:#ededed;color:#090909}
    .foryou-connect-overlay{position:fixed;inset:0;z-index:2147483500;display:grid;place-items:end center;padding:14px;background:rgba(0,0,0,.72);backdrop-filter:blur(8px)}
    .foryou-connect-modal{width:min(520px,100%);border:1px solid #2b2b2b;border-radius:20px;background:#0b0b0b;box-shadow:0 24px 80px rgba(0,0,0,.55);padding:18px}
    .foryou-connect-modal h3{margin:0 0 7px;color:#f3f3f4;font-size:17px}.foryou-connect-modal p{margin:0;color:#85858d;font-size:10px;line-height:1.6}
    .foryou-connect-state{margin:14px 0;padding:12px;border:1px solid #2a2a2a;border-radius:13px;background:#101010}.foryou-connect-state b{display:block;color:#e4e4e7;font-size:10px;margin-bottom:4px}.foryou-connect-state span{display:block;color:#707078;font-size:9px;line-height:1.55}
    .foryou-connect-steps{margin:0;padding:0;list-style:none;display:grid;gap:7px}.foryou-connect-steps li{display:flex;gap:9px;align-items:flex-start;padding:9px 10px;border:1px solid #202020;border-radius:11px;background:#0d0d0d;color:#92929a;font-size:9px;line-height:1.5}.foryou-connect-steps i{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:#1b1b1b;color:#e9e9eb;font-size:8px;font-style:normal;font-weight:900;flex:0 0 auto}
    .foryou-connect-actions{display:grid;grid-template-columns:1fr;gap:8px;margin-top:14px}.foryou-connect-actions button{height:46px;border-radius:11px;border:1px solid #2b2b2b;background:#111;color:#e5e5e8;font-size:10px;font-weight:900;cursor:pointer}.foryou-connect-actions button.primary{background:#ededed;border-color:#ededed;color:#090909}
    @media(max-width:760px){
      .virals-reels-subtabs{margin-left:14px;margin-right:14px}
      .virals-foryou-panel{margin:0 10px 14px}
      .foryou-head{padding:14px;border-radius:15px}.foryou-head h3{font-size:16px}.foryou-head p{font-size:9px}.foryou-refresh{padding:0 10px}
      .foryou-controls{grid-template-columns:1fr}.foryou-target{min-width:0}.foryou-rule{grid-template-columns:1fr 1fr}.foryou-rule div:last-child{grid-column:1/-1}
      .foryou-connect-card{align-items:stretch;flex-direction:column}.foryou-connect-btn{width:100%;min-height:46px}
      .foryou-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.foryou-card{border-radius:13px}.foryou-actions{grid-template-columns:1fr}
      .foryou-connect-overlay{padding:0;align-items:end}.foryou-connect-modal{width:100%;border-left:0;border-right:0;border-bottom:0;border-radius:20px 20px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom))}
    }
  `;
  document.head.appendChild(style);

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>{n=Number(n||0);if(n>=1e6)return(n/1e6).toFixed(n>=1e7?0:1).replace('.0','')+' mi';if(n>=1e3)return(n/1e3).toFixed(n>=1e4?0:1).replace('.0','')+' mil';return String(Math.trunc(n))};
  const toastSafe=(m,t='ok')=>{try{if(typeof toast==='function')toast(m,t)}catch{}};

  function authHeaders(){
    try{
      if(typeof cloudSession==='undefined'||!cloudSession?.access_token)return null;
      return {'Content-Type':'application/json',Authorization:'Bearer '+cloudSession.access_token,apikey:SUPABASE_KEY};
    }catch{return null}
  }

  async function request(method='GET',body=null){
    const endpoint=ENDPOINT();const headers=authHeaders();
    if(!endpoint||!headers)throw new Error('Entre no CloudentFlow para usar o radar ForYou.');
    const res=await fetch(endpoint,{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store'});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||!data?.ok)throw new Error(data?.message||data?.error||'Falha ao carregar o radar ForYou.');
    return data;
  }

  function statusInfo(){
    const s=String(ext.data?.settings?.collector_status||'needs_browser_session');
    if(s==='ready')return{cls:'ready',title:'Coletor conectado',desc:'A sessão da Jujuh está disponível para o radar.'};
    if(s==='running')return{cls:'running',title:'Coletando agora',desc:'O radar está percorrendo a ForYou da Jujuh.'};
    if(s==='error')return{cls:'error',title:'Falha no coletor',desc:ext.data?.settings?.last_error||'A sessão precisa ser verificada.'};
    if(s==='paused')return{cls:'',title:'Radar pausado',desc:'A coleta automática está pausada.'};
    return{cls:'',title:'Aguardando sessão da Jujuh',desc:'A ForYou personalizada só existe dentro de uma sessão logada do Instagram.'};
  }

  function card(item,index){
    const cover=item.cover_url?'<img loading="lazy" src="'+esc(item.cover_url)+'" alt="" referrerpolicy="no-referrer">':'<div class="foryou-cover-empty">Sem capa</div>';
    return '<article class="foryou-card"><div class="foryou-cover">'+cover+'<span class="foryou-view-badge">▶ '+fmt(item.views)+'</span></div><div class="foryou-body"><div class="foryou-caption '+(!item.caption?'empty':'')+'">'+esc(item.caption||'Sem legenda pública')+'</div><div class="foryou-actions"><button class="primary" onclick="window.CloudentForYou.download('+index+')">↓ Baixar</button><a href="'+esc(item.permalink)+'" target="_blank" rel="noopener">Instagram</a></div></div></article>';
  }

  function panelMarkup(){
    if(ext.loading&&!ext.data)return '<div class="foryou-empty"><b>Carregando ForYou Jujuh…</b><span>Buscando a configuração e os virais de hoje.</span></div>';
    const d=ext.data||{};const settings=d.settings||{};const target=Number(settings.daily_target||5)===10?10:5;const count=Number(d.count||0);const st=statusInfo();const items=Array.isArray(d.items)?d.items:[];
    const last=settings.last_collected_at?new Date(settings.last_collected_at).toLocaleString('pt-BR'):'Ainda não coletou';
    const needsSession=String(settings.collector_status||'needs_browser_session')==='needs_browser_session';
    const connect=needsSession
      ?'<div class="foryou-connect-card"><div class="foryou-connect-copy"><b>Conectar a sessão da Jujuh</b><span>O CloudentFlow precisa de um navegador remoto autenticado para ler a ForYou personalizada.</span></div><button class="foryou-connect-btn" onclick="window.CloudentForYou.connect()">Conectar Jujuh</button></div>'
      :'';
    const warning=needsSession
      ?'<div class="foryou-warning"><b>A sessão remota ainda não está ativa.</b> A Meta não disponibiliza a ForYou personalizada pela API oficial. O login precisa acontecer em um Browser Worker separado; sua senha não deve ser salva nem enviada pelo CloudentFlow.</div>'
      :'';
    const error=ext.error?'<div class="foryou-error">'+esc(ext.error)+'</div>':'';
    const body=items.length?'<div class="foryou-grid">'+items.map(card).join('')+'</div>':'<div class="foryou-empty"><b>Nenhum Reel da ForYou salvo hoje</b><span>Assim que o coletor encontrar Reels com 400 mil visualizações ou mais, eles aparecem aqui automaticamente — sem repetidos.</span></div>';
    return '<div class="foryou-head"><div><span class="foryou-kicker">Radar personalizado · Instagram</span><h3>ForYou da Jujuh</h3><p>Somente Reels recomendados para @jujuhmartinss que baterem 400 mil visualizações ou mais.</p></div><button class="foryou-refresh" onclick="window.CloudentForYou.refresh()" '+(ext.loading?'disabled':'')+'>'+(ext.loading?'Atualizando…':'↻ Atualizar')+'</button></div>'+
      '<div class="foryou-controls"><div class="foryou-rule"><div><span>Origem</span><b>@jujuhmartinss</b></div><div><span>Mínimo</span><b>400 mil views</b></div><div><span>Repetidos</span><b>Bloqueados</b></div></div><div class="foryou-target"><span>Meta por dia</span><div class="foryou-target-buttons"><button class="'+(target===5?'active':'')+'" onclick="window.CloudentForYou.setTarget(5)">5</button><button class="'+(target===10?'active':'')+'" onclick="window.CloudentForYou.setTarget(10)">10</button></div></div></div>'+
      '<div class="foryou-status '+esc(st.cls)+'"><div class="foryou-status-main"><i class="foryou-dot"></i><div><b>'+esc(st.title)+'</b><small>'+esc(st.desc)+'</small></div></div><div class="foryou-progress"><b>'+count+'/'+target+'</b><small>hoje · '+esc(last)+'</small></div></div>'+connect+error+warning+body;
  }

  function closeConnect(){
    document.querySelector('.foryou-connect-overlay')?.remove();
  }

  function connect(){
    closeConnect();
    const overlay=document.createElement('div');
    overlay.className='foryou-connect-overlay';
    overlay.innerHTML='<div class="foryou-connect-modal" role="dialog" aria-modal="true" aria-label="Conectar Jujuh"><h3>Conectar Jujuh</h3><p>Essa conexão precisa acontecer em um navegador remoto que fica ligado mesmo com seu celular e PC desligados.</p><div class="foryou-connect-state"><b>Browser Worker ainda não configurado</b><span>O painel e o banco já estão prontos. Falta provisionar o navegador remoto que mantém a sessão do Instagram e coleta a ForYou. Não envie sua senha para o CloudentFlow nem para o chat.</span></div><ul class="foryou-connect-steps"><li><i>1</i><span>Provisionar o Browser Worker em nuvem.</span></li><li><i>2</i><span>Você faz o login da @jujuhmartinss diretamente nesse navegador.</span></li><li><i>3</i><span>O CloudentFlow recebe somente o estado do coletor e os Reels encontrados com 400 mil+ views.</span></li></ul><div class="foryou-connect-actions"><button class="primary" onclick="window.CloudentForYou.closeConnect()">Entendi</button></div></div>';
    overlay.addEventListener('click',e=>{if(e.target===overlay)closeConnect()});
    document.body.appendChild(overlay);
  }

  function mainReelsActive(tabs){
    const active=tabs?.querySelector('.virals-tab.active');
    if(!active)return false;
    const onclick=String(active.getAttribute('onclick')||'');
    return onclick.includes("'reels'")||onclick.includes('"reels"')||/^Reels\b/i.test(active.textContent||'');
  }

  function sync(){
    if(ext.syncing)return;
    ext.syncing=true;
    try{
      const page=document.getElementById('virals');const shell=page?.querySelector('.virals-shell');const tabs=shell?.querySelector('.virals-tabs');
      if(!page||!shell||!tabs)return;
      const reels=mainReelsActive(tabs);
      let sub=shell.querySelector('.virals-reels-subtabs');
      let panel=shell.querySelector('.virals-foryou-panel');
      if(!reels){
        shell.classList.remove('foryou-mode');sub?.remove();panel?.remove();ext.mode='profile';return;
      }
      if(!sub){
        sub=document.createElement('div');sub.className='virals-reels-subtabs';
        tabs.insertAdjacentElement('afterend',sub);
      }
      const count=Number(ext.data?.count||0);
      const target=Number(ext.data?.settings?.daily_target||5)===10?10:5;
      sub.innerHTML='<button class="virals-reels-subtab '+(ext.mode==='profile'?'active':'')+'" onclick="window.CloudentForYou.setMode(\'profile\')">Perfil</button><button class="virals-reels-subtab '+(ext.mode==='foryou'?'active':'')+'" onclick="window.CloudentForYou.setMode(\'foryou\')">ForYou Jujuh <b>'+count+'/'+target+'</b></button>';
      if(!panel){panel=document.createElement('section');panel.className='virals-foryou-panel';sub.insertAdjacentElement('afterend',panel)}
      shell.classList.toggle('foryou-mode',ext.mode==='foryou');
      if(ext.mode==='foryou')panel.innerHTML=panelMarkup();
    }finally{ext.syncing=false}
  }

  async function refresh(silent=false){
    ext.loading=true;if(!silent){ext.error='';sync()}
    try{ext.data=await request('GET');ext.error=''}catch(e){ext.error=e?.message||'Falha ao atualizar.'}finally{ext.loading=false;sync()}
  }

  async function setTarget(value){
    const target=Number(value)===10?10:5;ext.loading=true;ext.error='';sync();
    try{
      ext.data=await request('POST',{action:'settings',daily_target:target,enabled:true});
      toastSafe('Meta diária alterada para '+target+' Reels.','ok');
    }catch(e){ext.error=e?.message||'Não consegui salvar a meta.';toastSafe(ext.error,'err')}
    finally{ext.loading=false;sync()}
  }

  async function download(index){
    const item=ext.data?.items?.[Number(index)];if(!item)return;
    try{
      const prep=await fetch('/api/instagram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:item.permalink})});
      const info=await prep.json().catch(()=>({}));if(!prep.ok||!info?.proxy_url)throw new Error(info?.message||'Não consegui preparar esse Reel.');
      const response=await fetch(info.proxy_url);if(!response.ok)throw new Error('Falha ao baixar o Reel.');
      const blob=await response.blob();const object=URL.createObjectURL(blob);const a=document.createElement('a');a.href=object;a.download='foryou-jujuh-'+item.shortcode+'.'+(info.extension||'mp4');document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(object),1500);toastSafe('Download iniciado.','ok');
    }catch(e){toastSafe(e?.message||'Falha no download.','err')}
  }

  function hookVirals(){
    if(ext.booted||!window.CloudentVirals)return false;
    ext.booted=true;
    for(const name of ['render','analyze','setTab']){
      const original=window.CloudentVirals[name];if(typeof original!=='function')continue;
      window.CloudentVirals[name]=function(){
        let out;
        try{out=original.apply(this,arguments)}finally{requestAnimationFrame(sync)}
        if(out&&typeof out.then==='function')out.finally(()=>requestAnimationFrame(sync));
        return out;
      };
    }
    requestAnimationFrame(sync);
    refresh(true);
    return true;
  }

  window.CloudentForYou={
    refresh:()=>refresh(false),setTarget,download,connect,closeConnect,
    setMode(mode){ext.mode=mode==='foryou'?'foryou':'profile';sync();if(ext.mode==='foryou'&&!ext.data)refresh(false)}
  };

  const boot=setInterval(()=>{if(hookVirals())clearInterval(boot)},80);
  setTimeout(()=>clearInterval(boot),12000);
})();