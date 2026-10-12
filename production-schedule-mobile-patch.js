(()=>{
  if(window.__cfProductionScheduleMobilePatchV3)return;
  window.__cfProductionScheduleMobilePatchV3=true;

  const oldStyle=document.getElementById('cf-production-schedule-mobile-style');
  if(oldStyle)oldStyle.remove();

  const style=document.createElement('style');
  style.id='cf-production-schedule-mobile-style';
  style.textContent=`
    @keyframes cfProductionCalendarUp{
      from{transform:translate3d(0,100%,0);opacity:.96}
      to{transform:translate3d(0,0,0);opacity:1}
    }

    @media(max-width:760px){
      html.production-schedule-open,
      body.production-schedule-open{
        width:100%!important;
        height:100%!important;
        overflow:hidden!important;
        overscroll-behavior:none!important;
      }

      body.production-schedule-open .mobile-appbar,
      body.production-schedule-open .mobile-bottom-nav{
        display:none!important;
      }

      #modalHost.cf-production-schedule-host{
        position:fixed!important;
        inset:0!important;
        top:0!important;
        right:0!important;
        bottom:0!important;
        left:0!important;
        z-index:2147483000!important;
        width:100vw!important;
        min-width:100vw!important;
        max-width:100vw!important;
        height:100dvh!important;
        min-height:100dvh!important;
        max-height:100dvh!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
        border-radius:0!important;
        background:#080808!important;
        overflow:hidden!important;
        transform:none!important;
        box-sizing:border-box!important;
      }

      #modalHost.cf-production-schedule-host>.modal.production-schedule-mobile-shell{
        position:absolute!important;
        inset:0!important;
        top:0!important;
        right:0!important;
        bottom:0!important;
        left:0!important;
        z-index:1!important;
        display:block!important;
        width:100%!important;
        min-width:100%!important;
        max-width:100%!important;
        height:100%!important;
        min-height:100%!important;
        max-height:100%!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
        border-radius:0!important;
        background:#080808!important;
        backdrop-filter:none!important;
        overflow:hidden!important;
        transform:none!important;
        box-sizing:border-box!important;
      }

      #modalHost.cf-production-schedule-host .production-schedule-modal{
        position:absolute!important;
        inset:0!important;
        top:0!important;
        right:0!important;
        bottom:0!important;
        left:0!important;
        width:100%!important;
        min-width:100%!important;
        max-width:100%!important;
        height:100dvh!important;
        min-height:100dvh!important;
        max-height:100dvh!important;
        margin:0!important;
        padding:max(12px,env(safe-area-inset-top)) 14px calc(14px + env(safe-area-inset-bottom))!important;
        border:0!important;
        border-radius:0!important;
        background:#080808!important;
        box-shadow:none!important;
        overflow-x:hidden!important;
        overflow-y:auto!important;
        overscroll-behavior:contain!important;
        -webkit-overflow-scrolling:touch!important;
        box-sizing:border-box!important;
        animation:cfProductionCalendarUp .24s cubic-bezier(.22,.78,.25,1) both!important;
      }

      #modalHost.cf-production-schedule-host .production-schedule-modal .modal-head{
        position:sticky!important;
        top:calc(-1 * max(12px,env(safe-area-inset-top)))!important;
        z-index:30!important;
        display:grid!important;
        grid-template-columns:minmax(0,1fr) 42px!important;
        align-items:start!important;
        gap:12px!important;
        margin:calc(-1 * max(12px,env(safe-area-inset-top))) -14px 15px!important;
        padding:max(13px,env(safe-area-inset-top)) 14px 12px!important;
        background:rgba(8,8,8,.98)!important;
        border-bottom:1px solid #202020!important;
        backdrop-filter:blur(14px)!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .modal-head>div{min-width:0!important}
      #modalHost.cf-production-schedule-host .production-schedule-modal .modal-head b{
        display:block!important;
        margin:0 0 4px!important;
        color:#f4f4f4!important;
        font-size:18px!important;
        line-height:1.2!important;
        letter-spacing:-.025em!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .modal-head .muted{
        color:#85858c!important;
        font-size:11px!important;
        line-height:1.4!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .modal-head>.btn{
        width:42px!important;
        min-width:42px!important;
        height:42px!important;
        min-height:42px!important;
        padding:0!important;
        border:1px solid #292929!important;
        border-radius:12px!important;
        background:#111!important;
        color:#f3f3f3!important;
        font-size:0!important;
        display:grid!important;
        place-items:center!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .modal-head>.btn:before{
        content:'×';
        font-size:25px!important;
        font-weight:400!important;
        line-height:1!important;
      }

      #modalHost.cf-production-schedule-host .production-schedule-modal .field{
        min-width:0!important;
        margin:0!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .field>label{
        display:block!important;
        margin:0 0 7px!important;
        color:#a8a8af!important;
        font-size:11px!important;
        font-weight:800!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .field>select,
      #modalHost.cf-production-schedule-host .production-schedule-modal .field>input,
      #modalHost.cf-production-schedule-host .production-schedule-modal .field>textarea{
        width:100%!important;
        box-sizing:border-box!important;
        border:1px solid #292929!important;
        border-radius:12px!important;
        background:#0d0d0d!important;
        color:#f3f3f3!important;
        box-shadow:none!important;
        font-size:14px!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .field>select,
      #modalHost.cf-production-schedule-host .production-schedule-modal .field>input{
        height:48px!important;
        min-height:48px!important;
        padding:0 12px!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .field>textarea{
        min-height:96px!important;
        padding:12px!important;
        resize:vertical!important;
        line-height:1.45!important;
      }

      #modalHost.cf-production-schedule-host .production-schedule-modal>.production-calendar-fields{
        margin:0 0 14px!important;
      }

      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-capacity{
        display:flex!important;
        grid-template-columns:none!important;
        gap:8px!important;
        width:100%!important;
        max-width:100%!important;
        margin:0 0 15px!important;
        padding:0 0 5px!important;
        overflow-x:auto!important;
        overflow-y:hidden!important;
        scroll-snap-type:x mandatory!important;
        scrollbar-width:none!important;
        -webkit-overflow-scrolling:touch!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-capacity::-webkit-scrollbar{display:none!important}
      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-day{
        flex:0 0 112px!important;
        width:112px!important;
        min-width:112px!important;
        min-height:80px!important;
        padding:10px!important;
        border:1px solid #282828!important;
        border-radius:13px!important;
        background:#0e0e0e!important;
        display:flex!important;
        flex-direction:column!important;
        align-items:flex-start!important;
        justify-content:center!important;
        gap:3px!important;
        text-align:left!important;
        scroll-snap-align:start!important;
        box-sizing:border-box!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-day.selected{
        border-color:#e1e1e1!important;
        background:#151515!important;
        box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-day:disabled{opacity:.42!important}
      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-day>span{font-size:9px!important;color:#74747d!important;font-weight:850!important}
      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-day>b{font-size:13px!important;color:#eee!important;line-height:1.2!important}
      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-day>small{font-size:8px!important;color:#62636b!important}

      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-fields.formgrid{
        display:grid!important;
        grid-template-columns:minmax(0,1fr) minmax(110px,.72fr)!important;
        gap:12px 9px!important;
        margin:0!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-fields.formgrid .field.full{
        grid-column:1/-1!important;
      }

      #modalHost.cf-production-schedule-host .production-schedule-modal .production-scheduled-summary{
        margin:5px 0 12px!important;
        padding:12px!important;
        border-radius:12px!important;
      }

      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-modal-actions{
        position:sticky!important;
        z-index:25!important;
        bottom:calc(-14px - env(safe-area-inset-bottom))!important;
        width:auto!important;
        margin:18px -14px calc(-14px - env(safe-area-inset-bottom))!important;
        padding:11px 14px calc(11px + env(safe-area-inset-bottom))!important;
        display:grid!important;
        grid-template-columns:1fr!important;
        gap:8px!important;
        background:rgba(8,8,8,.98)!important;
        border-top:1px solid #202020!important;
        backdrop-filter:blur(14px)!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-modal-actions>.btn{
        width:100%!important;
        min-height:51px!important;
        border-radius:12px!important;
        font-size:12px!important;
      }
      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-modal-actions>.btn.primary{
        background:#f0f0f0!important;
        border-color:#f0f0f0!important;
        color:#090909!important;
      }
    }

    @media(max-width:760px) and (max-height:650px){
      #modalHost.cf-production-schedule-host .production-schedule-modal .modal-head b{font-size:16px!important}
      #modalHost.cf-production-schedule-host .production-schedule-modal .modal-head .muted{font-size:10px!important}
      #modalHost.cf-production-schedule-host .production-schedule-modal .production-calendar-day{min-height:70px!important}
      #modalHost.cf-production-schedule-host .production-schedule-modal .field>textarea{min-height:72px!important}
    }
  `;
  document.head.appendChild(style);

  const mobileQuery=window.matchMedia?.('(max-width:760px)');
  let host=null;
  let originalParent=null;
  let originalNext=null;
  let movedToBody=false;

  const isMobile=()=>mobileQuery?mobileQuery.matches:window.innerWidth<=760;

  function rememberHostPosition(){
    if(!host||originalParent)return;
    originalParent=host.parentNode;
    originalNext=host.nextSibling;
  }

  function moveHostToBody(){
    if(!host||!document.body||host.parentNode===document.body)return;
    rememberHostPosition();
    document.body.appendChild(host);
    movedToBody=true;
  }

  function restoreHost(){
    if(!host||!movedToBody||!originalParent)return;
    try{
      if(originalNext&&originalNext.parentNode===originalParent)originalParent.insertBefore(host,originalNext);
      else originalParent.appendChild(host);
    }catch{}
    movedToBody=false;
  }

  function clearState(){
    document.documentElement.classList.remove('production-schedule-open');
    document.body?.classList.remove('production-schedule-open');
    host?.classList.remove('cf-production-schedule-host');
    host?.querySelectorAll('.production-schedule-mobile-shell').forEach(el=>el.classList.remove('production-schedule-mobile-shell'));
    restoreHost();
  }

  function promoteProductionSchedule(){
    host=document.getElementById('modalHost');
    if(!host||!document.body)return;

    const box=host.querySelector('.production-schedule-modal');
    const modal=box?.closest('.modal');
    const active=Boolean(box&&modal&&isMobile());

    if(!active){
      clearState();
      return;
    }

    rememberHostPosition();
    moveHostToBody();

    document.documentElement.classList.add('production-schedule-open');
    document.body.classList.add('production-schedule-open');
    host.classList.add('cf-production-schedule-host');
    modal.classList.add('production-schedule-mobile-shell');

    // Fallback inline para vencer qualquer CSS legado do app/PWA.
    host.style.setProperty('position','fixed','important');
    host.style.setProperty('inset','0','important');
    host.style.setProperty('width','100vw','important');
    host.style.setProperty('height','100dvh','important');
    host.style.setProperty('z-index','2147483000','important');
    host.style.setProperty('margin','0','important');
    host.style.setProperty('padding','0','important');
    host.style.setProperty('background','#080808','important');
    host.style.setProperty('overflow','hidden','important');

    modal.style.setProperty('position','absolute','important');
    modal.style.setProperty('inset','0','important');
    modal.style.setProperty('width','100%','important');
    modal.style.setProperty('height','100%','important');
    modal.style.setProperty('margin','0','important');
    modal.style.setProperty('padding','0','important');
    modal.style.setProperty('display','block','important');
    modal.style.setProperty('background','#080808','important');
    modal.style.setProperty('overflow','hidden','important');

    box.style.setProperty('position','absolute','important');
    box.style.setProperty('inset','0','important');
    box.style.setProperty('width','100%','important');
    box.style.setProperty('height','100dvh','important');
    box.style.setProperty('max-width','none','important');
    box.style.setProperty('max-height','none','important');
    box.style.setProperty('margin','0','important');
    box.style.setProperty('border','0','important');
    box.style.setProperty('border-radius','0','important');
    box.style.setProperty('background','#080808','important');
    box.style.setProperty('overflow-y','auto','important');
    box.style.setProperty('box-sizing','border-box','important');
  }

  function installObserver(){
    host=document.getElementById('modalHost');
    if(!host)return false;
    rememberHostPosition();
    promoteProductionSchedule();
    if(typeof MutationObserver==='function'){
      new MutationObserver(()=>{
        promoteProductionSchedule();
        requestAnimationFrame(promoteProductionSchedule);
      }).observe(host,{childList:true,subtree:true});
    }
    return true;
  }

  if(!installObserver()){
    const waiter=new MutationObserver(()=>{
      if(installObserver())waiter.disconnect();
    });
    waiter.observe(document.documentElement,{childList:true,subtree:true});
  }

  window.addEventListener('resize',promoteProductionSchedule,{passive:true});
  window.addEventListener('orientationchange',()=>setTimeout(promoteProductionSchedule,80),{passive:true});
  if(mobileQuery?.addEventListener)mobileQuery.addEventListener('change',promoteProductionSchedule);
})();