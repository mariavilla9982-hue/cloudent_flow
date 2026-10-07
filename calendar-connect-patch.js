(()=>{
  if(window.__cfCalendarConnectPatchV3)return;
  window.__cfCalendarConnectPatchV3=true;

  const OAUTH_URL=SUPABASE_URL+"/functions/v1/instagram-oauth";
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
    .calendar-connect-body p{margin:0;color:#9b9b9b;font-size:12px;line-height:1.55}
    .calendar-oauth-box{display:flex;align-items:center;gap:12px;margin:16px 0 12px;padding:13px;border:1px solid #282828;border-radius:14px;background:#101010}
    .calendar-oauth-logo{width:38px;height:38px;border:1px solid #333;border-radius:12px;display:grid;place-items:center;font-weight:950;font-size:17px;background:#080808;color:#fff;flex:0 0 auto}
    .calendar-oauth-box b{display:block;font-size:12px;color:#f5f5f5;margin-bottom:3px}.calendar-oauth-box small{display:block;color:#777;font-size:10px;line-height:1.4}
    .calendar-connect-actions{display:flex;gap:9px;justify-content:flex-end;margin-top:14px}
    .calendar-connect-actions button{min-height:42px;padding:0 14px;border-radius:10px;border:1px solid #303030;background:#151515;color:#fff;font-weight:850;cursor:pointer}
    .calendar-connect-actions .primary{background:#f2f2f2;color:#080808;border-color:#f2f2f2;flex:1}
    .calendar-connect-actions button:disabled{opacity:.55;cursor:wait}
    .calendar-connect-meta{display:flex;justify-content:space-between;gap:10px;margin-top:12px;color:#666;font-size:10px}.calendar-connect-meta b{color:#bdbdbd}
    .calendar-connect-safe{display:flex;gap:7px;align-items:center;margin-top:10px;color:#777;font-size:10px}.calendar-connect-safe i{width:6px;height:6px;border-radius:50%;background:#bdbdbd;display:block}
    @media(max-width:760px){.calendar-connect-chip{min-height:42px;padding:0 13px}.calendar-connect-modal{align-items:end;padding:10px}.calendar-connect-card{border-radius:22px 22px 14px 14px}.calendar-connect-head{padding:18px 17px 13px}.calendar-connect-body{padding:16px 17px 18px}.calendar-connect-actions{flex-direction:column-reverse}.calendar-connect-actions button{width:100%}}
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
            <p>Você vai entrar pelo login oficial do Instagram e autorizar o CloudentFlow. Não precisa copiar token e sua senha não passa pelo CloudentFlow.</p>
            <div class="calendar-oauth-box"><div class="calendar-oauth-logo">◎</div><div><b>Instagram oficial</b><small>Login e autorização feitos diretamente no Instagram/Meta.</small></div></div>
            <div class="calendar-connect-actions">
              <button onclick="closeModal()">Cancelar</button>
              <button class="primary" id="calendarConnectInstagramBtn" onclick="startCalendarInstagramOAuth()">Continuar com Instagram</button>
            </div>
            <div class="calendar-connect-safe"><i></i><span>O CloudentFlow recebe somente a autorização da conta profissional.</span></div>
            <div class="calendar-connect-meta"><span>Calendário separado por conta</span><b>Máx. 3 contas</b></div>
          </div>
        </div>
      </div>`;
    }catch(err){
      console.error(err);
      toast("Não consegui abrir a conexão agora.","err");
    }
  };

  async function oauthStartRequest(retry=true){
    if(!cloudSession)throw new Error("Entre no CloudentFlow primeiro.");
    const res=await fetch(OAUTH_URL,{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+cloudSession.access_token,apikey:SUPABASE_KEY},
      body:JSON.stringify({action:"start"})
    });
    if(res.status===401&&retry&&typeof refreshCloudSession==="function"&&await refreshCloudSession())return oauthStartRequest(false);
    let data=null;try{data=await res.json()}catch{}
    if(!res.ok)throw new Error(data?.user_message||data?.message||data?.error||("Erro "+res.status));
    return data;
  }

  window.startCalendarInstagramOAuth=async function(){
    if(!cloudSession){focusCloudLogin();return}
    const btn=document.getElementById("calendarConnectInstagramBtn");
    if(btn){btn.disabled=true;btn.textContent="Abrindo Instagram..."}
    try{
      const r=await oauthStartRequest();
      if(!r?.url)throw new Error("O Instagram não retornou a tela de login.");
      sessionStorage.setItem("cf_instagram_oauth_pending","1");
      window.location.assign(r.url);
    }catch(err){
      const msg=err?.message||"Não consegui abrir o login do Instagram.";
      toast(msg,"err");
      if(btn){btn.disabled=false;btn.textContent="Continuar com Instagram"}
    }
  };

  async function handleOAuthReturn(){
    let u;try{u=new URL(window.location.href)}catch{return}
    const status=u.searchParams.get("instagram_oauth");
    if(!status)return;
    const username=u.searchParams.get("username")||"";
    u.searchParams.delete("instagram_oauth");u.searchParams.delete("username");u.searchParams.delete("account_id");u.searchParams.delete("reason");
    try{history.replaceState({},"",u.pathname+(u.search?u.search:"")+(u.hash||""))}catch{}
    sessionStorage.removeItem("cf_instagram_oauth_pending");
    if(status==="cancelled"){toast("Conexão com o Instagram cancelada.","warn");return}
    if(status!=="success"){toast("Não consegui concluir a conexão com o Instagram.","err");return}
    for(let i=0;i<24&&!cloudSession;i++)await new Promise(r=>setTimeout(r,250));
    try{
      if(cloudSession){
        await loadPlatformAccounts();
        const found=calendarInstagramAccounts().find(a=>String(a.account_label||"").replace(/^@/,"")===String(username).replace(/^@/,""));
        const id=calendarAccountId(found);
        if(id){calendarActiveAccountId=id;localStorage.setItem(CALENDAR_ACCOUNT_KEY,id)}
        await syncFromBackend();
      }
      if(typeof showPage==="function")showPage("calendar");
      if(typeof calendarPage==="function")calendarPage();
      toast((username?"@"+String(username).replace(/^@/,"")+" ":"")+"conectada ao calendário.","ok");
    }catch(err){
      console.error(err);toast("Conta conectada, mas não consegui atualizar o calendário agora.","warn");
    }
  }

  setTimeout(()=>{
    try{if(currentPage==="calendar")calendarPage()}catch{}
    handleOAuthReturn().catch(err=>console.error("Instagram OAuth return",err));
  },0);
})();