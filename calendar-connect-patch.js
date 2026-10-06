(()=>{
  if(window.__cfCalendarConnectPatchV2)return;
  window.__cfCalendarConnectPatchV2=true;

  const style=document.createElement("style");
  style.textContent=`
    .calendar-connect-chip{flex:0 0 auto;min-height:44px;padding:0 15px;border:1px dashed #4a4a4a;border-radius:999px;background:#0d0d0d;color:#f5f5f5;font-size:12px;font-weight:900;letter-spacing:.01em;transition:.16s ease;cursor:pointer}
    .calendar-connect-chip:hover{border-style:solid;border-color:#f2f2f2;background:#f2f2f2;color:#090909;transform:translateY(-1px)}
    .calendar-connect-chip:disabled{opacity:.55;cursor:default;transform:none;background:#0d0d0d;color:#aaa;border-color:#333}
    .calendar-connect-modal{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.78);display:grid;place-items:center;padding:18px;backdrop-filter:blur(12px)}
    .calendar-connect-card{width:min(460px,100%);border:1px solid #292929;border-radius:22px;background:#0b0b0b;color:#fff;box-shadow:0 28px 80px rgba(0,0,0,.55);overflow:hidden}
    .calendar-connect-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 20px 14px;border-bottom:1px solid #1f1f1f}
    .calendar-connect-head span{display:block;color:#858585;font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px}
    .calendar-connect-head h3{margin:0;font-size:18px}
    .calendar-connect-close{width:34px;height:34px;border:1px solid #2b2b2b;border-radius:50%;background:#111;color:#fff;font-size:20px;line-height:1;cursor:pointer}
    .calendar-connect-body{padding:18px 20px 20px}
    .calendar-connect-body p{margin:0 0 14px;color:#9b9b9b;font-size:12px;line-height:1.55}
    .calendar-connect-body input{box-sizing:border-box;width:100%;height:46px;border:1px solid #303030;border-radius:12px;background:#111;color:#fff;padding:0 13px;outline:none}
    .calendar-connect-body input:focus{border-color:#f2f2f2}
    .calendar-connect-actions{display:flex;gap:9px;justify-content:flex-end;margin-top:14px}
    .calendar-connect-actions button{min-height:40px;padding:0 14px;border-radius:10px;border:1px solid #303030;background:#151515;color:#fff;font-weight:850;cursor:pointer}
    .calendar-connect-actions .primary{background:#f2f2f2;color:#080808;border-color:#f2f2f2}
    .calendar-connect-actions button:disabled{opacity:.55;cursor:wait}
    .calendar-connect-meta{display:flex;justify-content:space-between;gap:10px;margin-top:11px;color:#666;font-size:10px}
    .calendar-connect-meta b{color:#bdbdbd}
    @media(max-width:760px){.calendar-connect-chip{min-height:42px;padding:0 13px}.calendar-connect-modal{align-items:end;padding:10px}.calendar-connect-card{border-radius:22px 22px 14px 14px}.calendar-connect-head{padding:18px 17px 13px}.calendar-connect-body{padding:16px 17px 18px}}
  `;
  document.head.appendChild(style);

  const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));

  try{
    calendarAccountSwitcher=function(){
      const accounts=calendarInstagramAccounts();
      const active=calendarEnsureAccount();
      const chips=accounts.map(a=>{
        const id=calendarAccountId(a);
        const label=String(a.account_label||a.username||"Instagram");
        const photo=String(a?.config?.profile_picture_url||a?.profile_picture_url||"").trim();
        const avatar=photo
          ?'<img src="'+escapeHtml(photo)+'" alt="" referrerpolicy="no-referrer">'
          :'<span class="calendar-account-avatar">'+escapeHtml(label.slice(0,1).toUpperCase())+'</span>';
        return '<button class="calendar-account-chip '+(id===active?'active':'')+'" onclick="selectCalendarAccount(\''+escapeHtml(id)+'\')">'+avatar+'<div><b>@'+escapeHtml(label.replace(/^@/,''))+'</b><small>'+(a.enabled===false?'Pausada':'Calendário')+'</small></div></button>';
      }).join('');
      const add=accounts.length<3
        ?'<button class="calendar-connect-chip" onclick="openCalendarInstagramConnect()">＋ Conectar conta</button>'
        :'<button class="calendar-connect-chip" disabled title="Limite atual atingido">3 / 3 contas</button>';
      return '<div class="calendar-account-switcher"><span>Contas</span>'+chips+add+'</div>';
    };
  }catch(err){
    console.error("CloudentFlow calendar account switcher patch failed",err);
  }

  window.openCalendarInstagramConnect=function(){
    try{
      if(!cloudSession){focusCloudLogin();return}
      const accounts=calendarInstagramAccounts();
      if(accounts.length>=3){toast("O limite atual é de 3 contas do Instagram.","warn");return}
      const host=document.getElementById("modalHost");
      if(!host){toast("Não consegui abrir a conexão agora.","err");return}
      host.innerHTML=`<div class="modal calendar-connect-modal" onclick="if(event.target===this)closeModal()">
        <div class="calendar-connect-card">
          <div class="calendar-connect-head">
            <div><span>Instagram · ${accounts.length+1}/3</span><h3>Conectar outra conta</h3></div>
            <button class="calendar-connect-close" onclick="closeModal()" aria-label="Fechar">×</button>
          </div>
          <div class="calendar-connect-body">
            <p>Conecte uma conta profissional do Instagram usando o access token da Meta. Ela será adicionada sem substituir as contas já conectadas.</p>
            <input id="calendarInstagramToken" type="password" autocomplete="off" placeholder="Instagram / Meta Access Token" onkeydown="if(event.key==='Enter')connectCalendarInstagramAccount()">
            <div class="calendar-connect-actions">
              <button onclick="closeModal()">Cancelar</button>
              <button class="primary" id="calendarConnectInstagramBtn" onclick="connectCalendarInstagramAccount()">Conectar conta</button>
            </div>
            <div class="calendar-connect-meta"><span>Calendário separado por conta</span><b>Máx. 3 contas</b></div>
          </div>
        </div>
      </div>`;
      setTimeout(()=>document.getElementById("calendarInstagramToken")?.focus(),80);
    }catch(err){
      console.error(err);
      toast("Não consegui abrir a conexão agora.","err");
    }
  };

  window.connectCalendarInstagramAccount=async function(){
    if(!cloudSession){focusCloudLogin();return}
    const input=document.getElementById("calendarInstagramToken");
    const token=input?.value?.trim();
    if(!token){toast("Cole o access token da conta do Instagram.","warn");return}
    const btn=document.getElementById("calendarConnectInstagramBtn");
    if(btn){btn.disabled=true;btn.textContent="Conectando..."}
    try{
      const r=await edgeFetch(IG_CONNECT_URL,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({credential:token})
      });
      await loadPlatformAccounts();
      const connected=r?.platform_account||calendarInstagramAccounts().find(a=>String(a.external_account_id||"")===String(r?.profile?.id||""));
      const id=calendarAccountId(connected);
      if(id){
        calendarActiveAccountId=id;
        localStorage.setItem(CALENDAR_ACCOUNT_KEY,id);
      }
      if(r?.profile){
        instagramIntegration={
          provider:"instagram",
          enabled:true,
          account_label:r.profile?.username||r.profile?.name||"Instagram",
          external_account_id:r.profile?.id||"",
          config:{
            status:"connected",
            account_type:r.profile?.account_type||null,
            api_mode:r.mode||"instagram_login",
            profile_picture_url:r.profile?.profile_picture_url||null,
            platform_account_id:r?.platform_account?.id||null
          },
          last_verified_at:new Date().toISOString()
        };
      }
      closeModal();
      await syncFromBackend();
      if(currentPage==="calendar")calendarPage();
      toast("@"+String(r?.profile?.username||r?.profile?.name||"Instagram").replace(/^@/,"")+" conectada ao calendário.","ok");
    }catch(err){
      const msg=typeof friendlyCloudentError==="function"?friendlyCloudentError(err?.message||"Não consegui conectar essa conta."):(err?.message||"Não consegui conectar essa conta.");
      toast(msg,"err");
    }finally{
      const liveBtn=document.getElementById("calendarConnectInstagramBtn");
      if(liveBtn){liveBtn.disabled=false;liveBtn.textContent="Conectar conta"}
    }
  };

  setTimeout(()=>{
    try{if(currentPage==="calendar")calendarPage()}catch{}
  },0);
})();