(()=>{
  if(window.__cfProductionScheduleMobilePatchV1)return;
  window.__cfProductionScheduleMobilePatchV1=true;

  const style=document.createElement('style');
  style.id='cf-production-schedule-mobile-style';
  style.textContent=`
    @media(max-width:760px){
      body.production-schedule-open{overflow:hidden!important;overscroll-behavior:none!important}
      body.production-schedule-open .mobile-appbar,
      body.production-schedule-open .mobile-bottom-nav{display:none!important}

      .production-schedule-mobile-shell{
        z-index:10050!important;
        inset:0!important;
        align-items:stretch!important;
        justify-content:stretch!important;
        padding:0!important;
        background:#080808!important;
        backdrop-filter:none!important;
      }

      .production-schedule-mobile-shell .production-schedule-modal{
        width:100%!important;
        max-width:none!important;
        height:100dvh!important;
        min-height:100dvh!important;
        max-height:100dvh!important;
        margin:0!important;
        padding:max(12px,env(safe-area-inset-top)) 14px calc(14px + env(safe-area-inset-bottom))!important;
        border:0!important;
        border-radius:0!important;
        background:#080808!important;
        overflow-x:hidden!important;
        overflow-y:auto!important;
        overscroll-behavior:contain!important;
        -webkit-overflow-scrolling:touch!important;
        box-shadow:none!important;
      }

      .production-schedule-modal .modal-head{
        position:sticky!important;
        top:0!important;
        z-index:15!important;
        display:grid!important;
        grid-template-columns:minmax(0,1fr) 38px!important;
        align-items:start!important;
        gap:12px!important;
        margin:0 -2px 14px!important;
        padding:2px 2px 13px!important;
        background:linear-gradient(180deg,#080808 0%,#080808 84%,rgba(8,8,8,.94) 100%)!important;
        border-bottom:1px solid #1e1e1e!important;
      }
      .production-schedule-modal .modal-head>div{min-width:0!important}
      .production-schedule-modal .modal-head b{
        display:block!important;
        margin:0 0 5px!important;
        font-size:18px!important;
        line-height:1.2!important;
        letter-spacing:-.03em!important;
        color:#f4f4f4!important;
      }
      .production-schedule-modal .modal-head .muted{
        max-width:100%!important;
        font-size:11px!important;
        line-height:1.4!important;
        color:#7f7f84!important;
      }
      .production-schedule-modal .modal-head>.btn{
        width:38px!important;
        min-width:38px!important;
        height:38px!important;
        min-height:38px!important;
        padding:0!important;
        border-radius:11px!important;
        font-size:0!important;
        display:grid!important;
        place-items:center!important;
        background:#111!important;
        border-color:#2c2c2c!important;
        color:#f5f5f5!important;
      }
      .production-schedule-modal .modal-head>.btn:before{content:'×';font-size:23px!important;font-weight:400!important;line-height:1!important}

      .production-schedule-modal .field{margin:0!important;min-width:0!important}
      .production-schedule-modal .field>label{
        display:block!important;
        margin:0 0 7px!important;
        color:#a7a7ad!important;
        font-size:10px!important;
        font-weight:850!important;
        letter-spacing:.01em!important;
      }
      .production-schedule-modal .field>select,
      .production-schedule-modal .field>input,
      .production-schedule-modal .field>textarea{
        width:100%!important;
        box-sizing:border-box!important;
        border-radius:11px!important;
        border:1px solid #292929!important;
        background:#0d0d0d!important;
        color:#f5f5f5!important;
        font-size:14px!important;
        box-shadow:none!important;
      }
      .production-schedule-modal .field>select,
      .production-schedule-modal .field>input{height:47px!important;min-height:47px!important;padding:0 12px!important}
      .production-schedule-modal .field>textarea{min-height:92px!important;padding:12px!important;resize:vertical!important;line-height:1.45!important}

      .production-schedule-modal>.production-calendar-fields{
        margin:0 0 13px!important;
      }

      .production-schedule-modal .production-calendar-capacity{
        display:flex!important;
        grid-template-columns:none!important;
        gap:8px!important;
        width:100%!important;
        margin:0 0 15px!important;
        padding:0 0 6px!important;
        overflow-x:auto!important;
        overflow-y:hidden!important;
        scroll-snap-type:x mandatory!important;
        scrollbar-width:none!important;
        -webkit-overflow-scrolling:touch!important;
      }
      .production-schedule-modal .production-calendar-capacity::-webkit-scrollbar{display:none!important}
      .production-schedule-modal .production-calendar-day{
        flex:0 0 112px!important;
        width:112px!important;
        min-width:112px!important;
        min-height:78px!important;
        padding:10px!important;
        border-radius:12px!important;
        display:flex!important;
        flex-direction:column!important;
        align-items:flex-start!important;
        justify-content:center!important;
        gap:3px!important;
        scroll-snap-align:start!important;
        background:#0e0e0e!important;
        border:1px solid #262626!important;
        text-align:left!important;
      }
      .production-schedule-modal .production-calendar-day.selected{
        border-color:#d7d7d7!important;
        background:#141414!important;
        box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)!important;
      }
      .production-schedule-modal .production-calendar-day:disabled{opacity:.45!important}
      .production-schedule-modal .production-calendar-day>span{
        font-size:9px!important;
        color:#74747d!important;
        font-weight:850!important;
      }
      .production-schedule-modal .production-calendar-day>b{
        font-size:13px!important;
        color:#ededf0!important;
        line-height:1.2!important;
      }
      .production-schedule-modal .production-calendar-day>small{
        font-size:8px!important;
        color:#5f6068!important;
      }

      .production-schedule-modal .production-calendar-fields.formgrid{
        display:grid!important;
        grid-template-columns:minmax(0,1fr) minmax(108px,.72fr)!important;
        gap:11px 9px!important;
        margin:0!important;
      }
      .production-schedule-modal .production-calendar-fields.formgrid .field.full{
        grid-column:1/-1!important;
      }

      .production-schedule-modal .production-scheduled-summary{
        margin:4px 0 12px!important;
        padding:12px!important;
        border-radius:12px!important;
      }

      .production-schedule-modal .production-calendar-modal-actions{
        position:sticky!important;
        z-index:20!important;
        bottom:calc(-14px - env(safe-area-inset-bottom))!important;
        width:auto!important;
        margin:18px -14px calc(-14px - env(safe-area-inset-bottom))!important;
        padding:11px 14px calc(11px + env(safe-area-inset-bottom))!important;
        display:grid!important;
        grid-template-columns:1fr!important;
        gap:8px!important;
        background:rgba(8,8,8,.96)!important;
        border-top:1px solid #202020!important;
        backdrop-filter:blur(10px)!important;
      }
      .production-schedule-modal .production-calendar-modal-actions>.btn{
        width:100%!important;
        min-height:50px!important;
        border-radius:12px!important;
        font-size:12px!important;
      }
      .production-schedule-modal .production-calendar-modal-actions>.btn.primary{
        background:#ececec!important;
        border-color:#ececec!important;
        color:#090909!important;
      }
    }

    @media(max-width:760px) and (max-height:650px){
      .production-schedule-modal .modal-head{margin-bottom:10px!important;padding-bottom:9px!important}
      .production-schedule-modal .modal-head b{font-size:16px!important}
      .production-schedule-modal .modal-head .muted{font-size:10px!important}
      .production-schedule-modal .production-calendar-day{min-height:68px!important}
      .production-schedule-modal .field>textarea{min-height:70px!important}
    }
  `;
  document.head.appendChild(style);

  const host=document.getElementById('modalHost');
  const syncMobileModal=()=>{
    if(!host||!document.body)return;
    host.querySelectorAll('.production-schedule-mobile-shell').forEach(el=>el.classList.remove('production-schedule-mobile-shell'));
    const box=host.querySelector('.production-schedule-modal');
    const modal=box?.closest('.modal');
    if(modal)modal.classList.add('production-schedule-mobile-shell');
    document.body.classList.toggle('production-schedule-open',Boolean(box));
  };

  if(host){
    syncMobileModal();
    if(typeof MutationObserver==='function'){
      new MutationObserver(syncMobileModal).observe(host,{childList:true,subtree:true});
    }
  }
})();