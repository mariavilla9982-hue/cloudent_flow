(()=>{
  if(window.__cloudentViralsPatchV1)return;
  window.__cloudentViralsPatchV1=true;

  const VIRAL_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2s1 4-2 6c-2 1.4-3 3.1-3 5.2A5 5 0 0 0 18 14c0-2.3-1.1-4.2-3.2-5.8.1 2.2-.7 3.6-2 4.4.2-3.5-2.8-5.5.2-10.6Z"></path><path d="M9.6 18.4c.7 2.1 4.2 2.2 5 0 .5-1.5-.2-2.7-1.4-3.7.1 1.2-.4 1.9-1 2.3 0-1.7-1.3-2.5-2.2-3.1.3 1.8-.9 2.8-.4 4.5Z"></path></svg>';
  const state={tab:'reels',loading:false,data:null,error:'',query:localStorage.getItem('cloudentflow-virals-profile')||''};

  const style=document.createElement('style');
  style.id='cloudent-virals-style';
  style.textContent=`
    .virals-shell{max-width:1180px;margin:0 auto;padding:2px 0 42px}
    .virals-hero{border:1px solid #242424;border-radius:22px;background:linear-gradient(145deg,#0b0b0b,#090909);padding:22px;overflow:hidden;position:relative}
    .virals-hero:after{content:'';position:absolute;width:220px;height:220px;border-radius:50%;right:-90px;top:-120px;background:radial-gradient(circle,rgba(255,255,255,.09),transparent 68%);pointer-events:none}
    .virals-kicker{display:inline-flex;align-items:center;gap:7px;font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#8a8a92;margin-bottom:8px}
    .virals-title{margin:0;color:#f6f6f6;font-size:25px;line-height:1.08;letter-spacing:-.04em}
    .virals-sub{max-width:720px;margin:8px 0 0;color:#818188;font-size:12px;line-height:1.55}
    .virals-search{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;margin-top:18px}
    .virals-search input{width:100%;min-width:0;height:48px;border:1px solid #2b2b2b;border-radius:13px;background:#101010;color:#f4f4f4;padding:0 14px;font-size:14px;box-sizing:border-box;outline:none}
    .virals-search input:focus{border-color:#707070;box-shadow:0 0 0 3px rgba(255,255,255,.04)}
    .virals-search button{height:48px;padding:0 20px;border-radius:13px;border:1px solid #ededed;background:#ededed;color:#080808;font-size:12px;font-weight:900;cursor:pointer;white-space:nowrap}
    .virals-search button:disabled{opacity:.55;cursor:wait}
    .virals-profile{display:flex;align-items:center;gap:11px;margin-top:13px;padding:11px 12px;border:1px solid #202020;border-radius:14px;background:#0c0c0c}
    .virals-profile img{width:42px;height:42px;border-radius:50%;object-fit:cover;background:#151515}
    .virals-profile-avatar{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:#171717;color:#8d8d94;font-size:15px;font-weight:900}
    .virals-profile>div{min-width:0;flex:1}.virals-profile b{display:block;color:#f0f0f0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.virals-profile small{display:block;color:#717179;font-size:10px;margin-top:3px}
    .virals-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:16px 0 13px;padding:5px;background:#0c0c0c;border:1px solid #202020;border-radius:15px}
    .virals-tab{min-height:42px;border:0;border-radius:11px;background:transparent;color:#777780;font-size:11px;font-weight:850;cursor:pointer}
    .virals-tab.active{background:#ededed;color:#090909;box-shadow:0 2px 10px rgba(0,0,0,.28)}
    .virals-tab span{opacity:.68;margin-left:4px}
    .virals-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 2px 10px;color:#6d6d74;font-size:10px}
    .virals-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .viral-card{min-width:0;border:1px solid #242424;border-radius:17px;background:#0c0c0c;overflow:hidden;position:relative}
    .viral-cover{aspect-ratio:9/12;position:relative;background:#121212;overflow:hidden}
    .viral-cover img{width:100%;height:100%;display:block;object-fit:cover}
    .viral-cover-placeholder{height:100%;display:grid;place-items:center;color:#48484d;font-size:11px}
    .viral-rank{position:absolute;left:9px;top:9px;min-width:30px;height:30px;padding:0 8px;border-radius:10px;background:rgba(5,5,5,.84);border:1px solid rgba(255,255,255,.16);display:grid;place-items:center;color:#fff;font-size:11px;font-weight:950;backdrop-filter:blur(8px)}
    .viral-score{position:absolute;right:9px;top:9px;height:30px;padding:0 8px;border-radius:10px;background:rgba(5,5,5,.84);border:1px solid rgba(255,255,255,.16);display:flex;align-items:center;color:#f4f4f4;font-size:9px;font-weight:900;backdrop-filter:blur(8px)}
    .viral-body{padding:11px}
    .viral-stats{display:flex;gap:9px;flex-wrap:wrap;color:#8b8b92;font-size:9px;font-weight:800;margin-bottom:8px}
    .viral-caption{height:34px;overflow:hidden;color:#c7c7cb;font-size:10px;line-height:1.65;margin-bottom:10px}
    .viral-caption.empty{color:#55555b}
    .viral-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .viral-actions button,.viral-actions a{height:34px;border:1px solid #292929;border-radius:10px;background:#101010;color:#d7d7db;font-size:9px;font-weight:850;text-decoration:none;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0 8px;box-sizing:border-box}
    .viral-actions .primary{background:#ededed;color:#080808;border-color:#ededed}
    .virals-empty{min-height:260px;border:1px dashed #292929;border-radius:18px;background:#0a0a0a;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:26px;color:#777780}
    .virals-empty b{color:#d7d7db;font-size:13px;margin-bottom:5px}.virals-empty span{max-width:460px;font-size:10px;line-height:1.6}
    .virals-loader{width:30px;height:30px;border:3px solid #272727;border-top-color:#e8e8e8;border-radius:50%;animation:viralsSpin .75s linear infinite;margin-bottom:12px}@keyframes viralsSpin{to{transform:rotate(360deg)}}
    .virals-error{margin-top:12px;padding:11px 12px;border:1px solid #482424;background:#190d0d;border-radius:12px;color:#dca9a9;font-size:10px;line-height:1.5}
    .virals-highlight-note{min-height:240px;border:1px solid #242424;border-radius:18px;background:#0b0b0b;padding:24px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start}
    .virals-highlight-note b{font-size:14px;color:#efefef;margin-bottom:7px}.virals-highlight-note p{max-width:620px;color:#777780;font-size:10px;line-height:1.65;margin:0}
    #nav [data-page='virals'] .nav-icon svg{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    @media(max-width:760px){
      .virals-shell{padding:0 0 110px}.virals-hero{border-radius:0;border-left:0;border-right:0;padding:16px 14px}.virals-title{font-size:21px}.virals-sub{font-size:11px}
      .virals-search{grid-template-columns:1fr}.virals-search button{width:100%}.virals-tabs{margin-left:14px;margin-right:14px}.virals-meta{margin-left:16px;margin-right:16px}
      .virals-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding:0 8px}.viral-card{border-radius:13px}.viral-body{padding:9px}.viral-cover{aspect-ratio:9/13}.viral-actions{grid-template-columns:1fr}.viral-actions button,.viral-actions a{height:33px}.virals-empty,.virals-highlight-note{margin:0 10px;min-height:230px}
      .virals-profile{margin-left:0;margin-right:0}
    }
    @media(max-width:390px){.virals-grid{gap:5px;padding:0 6px}.viral-stats{gap:6px}.viral-caption{font-size:9px}.viral-score{font-size:8px}.virals-tabs{gap:4px}}
  `;
  document.head.appendChild(style);

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function fmt(n){n=Number(n||0);if(n>=1e6)return (n/1e6).toFixed(n>=1e7?0:1).replace('.0','')+' mi';if(n>=1e3)return (n/1e3).toFixed(n>=1e4?0:1).replace('.0','')+' mil';return String(n)}

  function ensurePage(){
    let page=document.getElementById('virals');
    if(page)return page;
    page=document.createElement('section');
    page.id='virals';page.className='page hidden';
    const anchor=document.getElementById('frameExtractor')||document.getElementById('production');
    if(anchor?.parentNode)anchor.parentNode.insertBefore(page,anchor.nextSibling);else document.body.appendChild(page);
    return page;
  }

  function registerNavItem(){
    try{
      if(typeof navItems!=='undefined'&&!navItems.some(x=>x[0]==='virals'))navItems.push(['virals',VIRAL_ICON,'Virais']);
      if(typeof pageSubtitles!=='undefined')pageSubtitles.virals='Cole um perfil e veja somente os conteúdos que realmente viralizaram.';
    }catch{}
  }

  function insertDesktopNav(){
    const root=document.getElementById('nav');if(!root||root.querySelector("[data-page='virals']"))return;
    const anchor=root.querySelector("[data-page='frameExtractor']")||root.querySelector("[data-page='production']");
    if(!anchor)return;
    const btn=document.createElement('button');
    btn.dataset.page='virals';btn.dataset.label='Virais';btn.title='Virais';
    btn.innerHTML='<span class="nav-icon">'+VIRAL_ICON+'</span><b>Virais</b>';
    btn.onclick=()=>window.showPage?.('virals');
    anchor.insertAdjacentElement('afterend',btn);
  }

  function patchNavigation(){
    registerNavItem();ensurePage();
    if(typeof window.nav==='function'&&!window.nav.__viralsWrapped){
      const original=window.nav;
      const wrapped=function(){const out=original.apply(this,arguments);insertDesktopNav();return out};
      wrapped.__viralsWrapped=true;window.nav=wrapped;
    }
    if(typeof window.mobileMoreItems==='function'&&!window.mobileMoreItems.__viralsWrapped){
      const original=window.mobileMoreItems;
      const wrapped=function(){const list=original.apply(this,arguments)||[];if(!list.includes('virals')){const i=list.indexOf('frameExtractor');list.splice(i>=0?i+1:list.length,0,'virals')}return list};
      wrapped.__viralsWrapped=true;window.mobileMoreItems=wrapped;
    }
    if(typeof window.showPage==='function'&&!window.showPage.__viralsWrapped){
      const original=window.showPage;
      const wrapped=function(id){const out=original.apply(this,arguments);if(id==='virals')render();return out};
      wrapped.__viralsWrapped=true;window.showPage=wrapped;
    }
    try{window.nav?.();window.renderMobileNav?.()}catch{}
    insertDesktopNav();
  }

  function listForTab(){return state.data?.[state.tab]||[]}

  function profileMarkup(){
    const p=state.data?.profile;if(!p)return '';
    const avatar=p.profile_pic_url?'<img src="'+esc(p.profile_pic_url)+'" alt="" referrerpolicy="no-referrer">':'<span class="virals-profile-avatar">@</span>';
    return '<div class="virals-profile">'+avatar+'<div><b>@'+esc(p.username||'instagram')+(p.full_name?' · '+esc(p.full_name):'')+'</b><small>'+fmt(p.followers)+' seguidores · '+Number(state.data?.scanned||0)+' conteúdos analisados</small></div></div>';
  }

  function tabsMarkup(){
    const counts={reels:state.data?.reels?.length||0,posts:state.data?.posts?.length||0,highlights:state.data?.highlights?.length||0};
    return '<div class="virals-tabs">'+[
      ['reels','Reels'],['posts','Posts'],['highlights','Destaques']
    ].map(([id,label])=>'<button class="virals-tab '+(state.tab===id?'active':'')+'" onclick="window.CloudentVirals.setTab(\''+id+'\')">'+label+' <span>'+counts[id]+'</span></button>').join('')+'</div>';
  }

  function card(item){
    const cover=item.cover_url?'<img loading="lazy" src="'+esc(item.cover_url)+'" alt="" referrerpolicy="no-referrer">':'<div class="viral-cover-placeholder">Sem capa</div>';
    const stats=[];
    if(item.views)stats.push('▶ '+fmt(item.views));
    if(item.likes)stats.push('♥ '+fmt(item.likes));
    if(item.comments)stats.push('💬 '+fmt(item.comments));
    const score=item.viral_score>0?'🔥 '+Number(item.viral_score).toFixed(1)+'×':'🔥 Top';
    return '<article class="viral-card">'+
      '<div class="viral-cover">'+cover+'<span class="viral-rank">#'+Number(item.rank||1)+'</span><span class="viral-score">'+score+'</span></div>'+
      '<div class="viral-body"><div class="viral-stats">'+(stats.join('<span>·</span>')||'Métrica pública limitada')+'</div>'+
      '<div class="viral-caption '+(!item.caption?'empty':'')+'">'+esc(item.caption||'Sem legenda pública')+'</div>'+
      '<div class="viral-actions"><button class="primary" onclick="window.CloudentVirals.download(\''+esc(item.shortcode)+'\')">↓ Baixar</button><button onclick="window.CloudentVirals.copy(\''+esc(item.shortcode)+'\')">Copiar legenda</button><a href="'+esc(item.permalink)+'" target="_blank" rel="noopener">Abrir no Instagram</a></div></div></article>';
  }

  function contentMarkup(){
    if(state.loading)return '<div class="virals-empty"><div class="virals-loader"></div><b>Analisando o perfil</b><span>Separando apenas os conteúdos que ficaram acima do padrão da própria conta.</span></div>';
    if(!state.data)return '<div class="virals-empty"><b>Cole um perfil do Instagram</b><span>O CloudentFlow vai separar Reels e Posts e esconder o conteúdo comum. Aqui entram somente os que ficaram no topo da conta.</span></div>';
    if(state.tab==='highlights'){
      const reason=state.data?.availability?.highlights_reason||'Destaques não possuem métricas públicas suficientes para um ranking viral confiável.';
      return '<div class="virals-highlight-note"><b>Destaques</b><p>'+esc(reason)+'</p></div>';
    }
    const rows=listForTab();
    if(!rows.length)return '<div class="virals-empty"><b>Nenhum viral encontrado nessa aba</b><span>Não apareceu conteúdo com dados públicos suficientes para ficar entre os mais fortes desse perfil.</span></div>';
    return '<div class="virals-grid">'+rows.map(card).join('')+'</div>';
  }

  function render(){
    const page=ensurePage();
    page.innerHTML='<div class="virals-shell"><section class="virals-hero"><span class="virals-kicker">🔥 Descoberta de conteúdo</span><h2 class="virals-title">Virais</h2><p class="virals-sub">Cole o link de uma conta. O CloudentFlow elimina o conteúdo normal e deixa só os posts que realmente ficaram acima do padrão daquela conta.</p><div class="virals-search"><input id="viralsProfileInput" value="'+esc(state.query)+'" placeholder="https://instagram.com/usuario ou @usuario" onkeydown="if(event.key===\'Enter\')window.CloudentVirals.analyze()"><button id="viralsAnalyzeBtn" onclick="window.CloudentVirals.analyze()" '+(state.loading?'disabled':'')+'>'+(state.loading?'Analisando…':'Analisar virais')+'</button></div>'+profileMarkup()+(state.error?'<div class="virals-error">'+esc(state.error)+'</div>':'')+'</section>'+tabsMarkup()+'<div class="virals-meta"><span>Somente os mais virais</span><span>'+listForTab().length+' selecionado(s)</span></div>'+contentMarkup()+'</div>';
  }

  async function analyze(){
    const input=document.getElementById('viralsProfileInput');
    const query=String(input?.value||state.query||'').trim();
    if(!query){state.error='Cole o link ou @ do perfil.';render();return}
    state.query=query;state.loading=true;state.error='';state.data=null;localStorage.setItem('cloudentflow-virals-profile',query);render();
    try{
      const response=await fetch('/api/virals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile:query})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data?.ok)throw new Error(data?.message||'Não consegui analisar esse perfil.');
      state.data=data;state.tab=(data.reels?.length?'reels':data.posts?.length?'posts':'reels');
    }catch(e){state.error=e?.message||'Falha ao analisar o perfil.'}
    finally{state.loading=false;render()}
  }

  function findItem(code){
    if(!state.data)return null;
    return [...(state.data.reels||[]),...(state.data.posts||[]),...(state.data.highlights||[])].find(x=>String(x.shortcode)===String(code))||null;
  }

  async function download(code){
    const item=findItem(code);if(!item)return;
    try{
      let url='';let ext=item.is_video?'mp4':'jpg';
      if(item.is_video){
        const r=await fetch('/api/instagram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:item.permalink})});
        const d=await r.json().catch(()=>({}));if(!r.ok||!d?.proxy_url)throw new Error(d?.message||'Não consegui preparar esse vídeo.');
        url=d.proxy_url;ext=d.extension||'mp4';
      }else if(item.cover_url){
        url='/api/instagram?media='+encodeURIComponent(item.cover_url);
      }
      if(!url)throw new Error('Mídia indisponível para download.');
      const response=await fetch(url);if(!response.ok)throw new Error('Falha ao baixar a mídia.');
      const blob=await response.blob();const object=URL.createObjectURL(blob);const a=document.createElement('a');a.href=object;a.download='viral-'+(item.rank||1)+'-'+item.shortcode+'.'+ext;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(object),1500);
      if(typeof toast==='function')toast('Download iniciado.','ok');
    }catch(e){if(typeof toast==='function')toast(e?.message||'Falha no download.','err');else alert(e?.message||'Falha no download.')}
  }

  async function copy(code){
    const item=findItem(code);if(!item)return;
    try{await navigator.clipboard.writeText(item.caption||'');if(typeof toast==='function')toast('Legenda copiada.','ok')}catch{if(typeof toast==='function')toast('Não consegui copiar a legenda.','err')}
  }

  window.CloudentVirals={
    analyze,download,copy,
    setTab(id){if(['reels','posts','highlights'].includes(id)){state.tab=id;render()}},
    render
  };

  patchNavigation();
  const watcher=new MutationObserver(()=>insertDesktopNav());
  const navRoot=document.getElementById('nav');if(navRoot)watcher.observe(navRoot,{childList:true,subtree:true});
})();
