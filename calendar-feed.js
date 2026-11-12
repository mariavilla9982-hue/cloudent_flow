(() => {
  let draft = null;
  let busy = false;
  let reading = false;
  let accountData = null;
  let feedUser = null;
  const resource = "?resource=instagram-feed";
  const statuses = {scheduled:"Agendado",processing:"Preparando",publishing:"Confirmando",published:"Publicado",failed:"Falhou"};
  const formatDate = new Intl.DateTimeFormat("pt-BR",{
    timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"
  });
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const postRequest = body => cloudFetch(resource,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  });

  function resetDraft() {
    draft?.photos.forEach(photo => URL.revokeObjectURL(photo.url));
    draft = null;
  }

  function tabs(feed) {
    return '<nav class="feed-tabs" aria-label="Agenda"><button type="button" data-feed-tab="calendar" aria-pressed="'+!feed+
      '">Calendário</button><button type="button" data-feed-tab="feed" aria-pressed="'+feed+'">Feed</button></nav>';
  }

  function attachTabs(root) {
    root.querySelector('[data-feed-tab="feed"]').onclick = open;
    root.querySelector('[data-feed-tab="calendar"]').onclick = () => { if (!busy && !reading) { feedUser = null; resetDraft(); calendarPage(); } };
  }

  async function list(root, account) {
    const host = root.querySelector("[data-feed-list]");
    if (!host || !account || !cloudSession) return;
    const user = cloudSession.user?.id;
    const key = user+":"+account;
    try {
      if (accountData?.key !== key || Date.now() - accountData.at > 30000) {
        if (accountData?.key !== key) accountData = {key,at:0,promise:null};
        const entry = accountData;
        entry.promise ||= cloudFetch(resource+"&account="+encodeURIComponent(account)).then(result => {
          entry.posts = result.posts || [];
          entry.at = Date.now();
        }).finally(() => { entry.promise = null; });
        await entry.promise;
      }
      if (!host.isConnected || accountData?.key !== key || cloudSession?.user?.id !== user) return;
      const rows = accountData.posts || [];
      host.innerHTML = rows.length ? rows.map(post =>
        '<div class="feed-list-row"><div><b>'+esc(formatDate.format(new Date(post.scheduled_at)))+'</b><p>'+esc(post.caption || "Post de fotos")+
        '</p></div><span>'+esc(statuses[post.status])+'</span>'+
        (post.last_error ? '<small>'+esc(post.last_error)+'</small>' : '')+
        (post.status === "scheduled" ? '<button class="btn" type="button" data-cancel-post="'+esc(post.id)+'">Cancelar</button>' : '')+'</div>'
      ).join("") : '<p class="muted">Nenhum post de fotos agendado para esta conta.</p>';
      host.querySelectorAll("[data-cancel-post]").forEach(button => {
        button.onclick = async () => {
          if (!window.confirm("Cancelar este post de fotos?")) return;
          button.disabled = true;
          try {
            await postRequest({operation:"cancel",id:button.dataset.cancelPost,platform_account_id:account});
            accountData = null;
            await list(root,account);
          } catch (error) {
            toast(error.message,"err");
            button.disabled = false;
          }
        };
      });
    } catch (error) {
      if (host.isConnected) host.textContent = error.message;
    }
  }

  function calendar(root, account) {
    const bar = root.querySelector("[data-feed-nav]");
    if (!bar) return;
    bar.innerHTML = tabs(false);
    attachTabs(bar);
    void list(root,account);
  }

  function open() {
    if (busy || reading) return;
    const root = document.querySelector("#calendar");
    const accounts = calendarInstagramAccounts();
    feedUser = cloudSession?.user?.id ?? null;
    resetDraft();
    draft = {photos:[],carousel:false,index:0};
    root.innerHTML = '<div class="ui3-page-head"><h2>Agenda</h2></div>'+tabs(true)+
      '<div class="feed-grid"><form class="feed-panel"><h3>Novo post</h3>'+
      '<label>Conta do Instagram<select name="account" required>'+accounts.map(a =>
        '<option value="'+esc(calendarAccountId(a))+'"'+(calendarAccountId(a) === calendarEnsureAccount() ? ' selected' : '')+'>'+esc(a.account_label || a.label || a.username)+'</option>'
      ).join("")+'</select></label><fieldset><legend>Formato</legend><div class="feed-formats">'+
      '<label><input type="radio" name="format" value="single" checked> Foto única</label>'+
      '<label><input type="radio" name="format" value="carousel"> Carrossel</label></div></fieldset>'+
      '<label>Fotos<input type="file" name="photos" accept="image/jpeg,image/png,image/webp"></label>'+
      '<div class="feed-photos"></div><label>Legenda<textarea name="caption" rows="4" maxlength="2200"></textarea></label>'+
      '<div class="feed-dates"><label>Data<input type="date" name="date" required></label>'+
      '<label>Horário de Brasília<input type="time" name="time" required></label></div>'+
      '<p data-feed-message role="status"></p><button type="submit" class="btn primary">Agendar post</button></form>'+
      '<section class="feed-panel"><h3>Prévia do Instagram</h3><div class="feed-preview"></div></section></div>'+
      '<section class="feed-panel feed-list"><h3>Posts do Feed</h3><div data-feed-list></div></section>';
    attachTabs(root);
    const form = root.querySelector("form");
    const fields = form.elements;
    const msg = root.querySelector("[data-feed-message]");
    fields.date.min = new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format(new Date());
    fields.date.value = fields.date.min;
    if (!accounts.length) msg.textContent = "Conecte uma conta do Instagram para agendar.";
    const preview = () => {
      const photo = draft.photos[draft.index];
      root.querySelector(".feed-preview").innerHTML = '<b>'+esc(fields.account.selectedOptions[0]?.text)+'</b>'+
        (photo ? '<img src="'+photo.url+'" alt="Foto '+(draft.index+1)+' da publicação">' : '<div class="feed-placeholder">Adicione uma foto para ver a prévia</div>')+
        '<p>'+esc(fields.caption.value)+'</p>';
    };
    function photos() {
      const host = root.querySelector(".feed-photos");
      host.innerHTML = draft.photos.map((photo,i) => '<div class="feed-photo"><button type="button" data-preview-index="'+i+
        '" aria-label="Ver foto '+(i+1)+'" aria-pressed="'+(i===draft.index)+'"><img src="'+photo.url+'" alt="Foto '+(i+1)+'"></button>'+
        '<div><button type="button" data-move="-1" data-index="'+i+'" aria-label="Mover foto para trás" '+(i===0?'disabled':'')+'>←</button>'+
        '<button type="button" data-move="1" data-index="'+i+'" aria-label="Mover foto para frente" '+(i===draft.photos.length-1?'disabled':'')+'>→</button>'+
        '<button type="button" data-remove-index="'+i+'" aria-label="Remover foto '+(i+1)+'">×</button></div></div>').join("");
      preview();
    }
    form.oninput = preview;
    form.onchange = async event => {
      if (reading) return;
      if (event.target.name === "account") void list(root,fields.account.value);
      if (event.target.name === "format") {
        draft.carousel = form.querySelector('[name="format"]:checked').value === "carousel";
        fields.photos.multiple = draft.carousel;
        if (!draft.carousel) {
          draft.photos.splice(1).forEach(photo => URL.revokeObjectURL(photo.url));
          draft.index = 0;
        }
        photos();
      }
      if (event.target !== fields.photos || reading) return;
      const files = Array.from(fields.photos.files);
      fields.photos.value = "";
      if (!files.length) return;
      if (draft.carousel && draft.photos.length + files.length > 10) {
        msg.textContent = "O carrossel aceita até 10 fotos.";
        return;
      }
      reading = true;
      const formatControls = [...form.querySelectorAll('[name="format"]')];
      formatControls.forEach(input => { input.disabled = true; });
      fields.photos.disabled = true;
      msg.textContent = "Preparando fotos…";
      try {
        const converted = [];
        for (const file of files) converted.push(await toJpeg(file));
        if (!draft.carousel) draft.photos.splice(0).forEach(photo => URL.revokeObjectURL(photo.url));
        draft.photos.push(...converted.map(blob => ({blob,url:URL.createObjectURL(blob)})));
        draft.index = 0;
        photos();
        msg.textContent = "";
      } catch (error) {
        msg.textContent = error.message;
      } finally {
        fields.photos.disabled = false;
        formatControls.forEach(input => { input.disabled = false; });
        reading = false;
      }
    };
    root.querySelector(".feed-photos").onclick = event => {
      const button = event.target.closest("button");
      if (!button || busy || reading) return;
      if (button.dataset.previewIndex != null) draft.index = Number(button.dataset.previewIndex);
      if (button.dataset.removeIndex != null) {
        const [removed] = draft.photos.splice(Number(button.dataset.removeIndex),1);
        URL.revokeObjectURL(removed.url);
        draft.index = Math.min(draft.index,Math.max(0,draft.photos.length-1));
      }
      if (button.dataset.move != null) {
        const i = Number(button.dataset.index);
        const to = i + Number(button.dataset.move);
        [draft.photos[i],draft.photos[to]] = [draft.photos[to],draft.photos[i]];
        draft.index = to;
      }
      photos();
    };

    form.onsubmit = async event => {
      event.preventDefault();
      if (busy || reading) return;
      if (!fields.account.value || draft.photos.length < (draft.carousel ? 2 : 1)) {
        msg.textContent = draft.carousel ? "Selecione uma conta e adicione pelo menos duas fotos." : "Selecione uma conta e adicione uma foto.";
        return;
      }
      const at = new Date(fields.date.value+"T"+fields.time.value+":00-03:00");
      if (!(at.getTime() > Date.now())) { msg.textContent = "Escolha uma data e hora futuras."; return; }
      const body = {
        id:draft.id ||= crypto.randomUUID(),platform_account_id:fields.account.value,
        scheduled_at:at.toISOString(),caption:fields.caption.value,photo_sizes:draft.photos.map(photo => photo.blob.size)
      };
      const blobs = draft.photos.map(photo => photo.blob);
      const author = feedUser;
      const controls = [...form.querySelectorAll("input,select,textarea,button")].filter(el => !el.disabled);
      busy = true;
      controls.forEach(el => { el.disabled = true; });
      try {
        msg.textContent = "Enviando fotos…";
        let result = await postRequest({...body,operation:"ticket"});
        if (!result.post) {
          for (const [i,upload] of result.uploads.entries()) {
            const response = await fetch(upload,{method:"PUT",headers:{"Content-Type":"image/jpeg"},body:blobs[i]});
            if (!response.ok) throw new Error("O envio da foto "+(i+1)+" falhou. Tente novamente.");
          }
          if (cloudSession?.user?.id !== author) throw new Error("A sessão mudou durante o envio.");
          result = await postRequest({...body,operation:"schedule"});
        }
        if (!result.post) throw new Error("O agendamento ainda não foi confirmado.");
        accountData = null;
        toast("Post agendado.","ok");
        busy = false;
        if (root.contains(form) && cloudSession?.user?.id === author) open();
      } catch (error) {
        msg.textContent = error.message;
      } finally {
        busy = false;
        controls.forEach(el => { el.disabled = false; });
      }
    };
    preview();
    void list(root,fields.account.value);
  }

  async function toJpeg(file) {
    if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 20*1024*1024) {
      throw new Error("Escolha JPG, PNG ou WebP de até 20 MB.");
    }
    let bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { throw new Error("Não foi possível abrir uma das fotos."); }
    try {
      const aspect = bitmap.width/bitmap.height;
      if (aspect < 0.8 || aspect > 1.91) throw new Error("Use uma proporção de 4:5 a 1,91:1 nas fotos.");
      const width = Math.min(bitmap.width,1440);
      if (width < 320) throw new Error("A foto deve ter pelo menos 320 pixels de largura.");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round(width/aspect);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const jpeg = await new Promise(resolve => canvas.toBlob(resolve,"image/jpeg",0.9));
      if (!jpeg) throw new Error("Não foi possível preparar a foto.");
      return jpeg;
    } finally { bitmap.close(); }
  }

  window.CloudentFeed = {calendar, isOpen: root => Boolean(feedUser && feedUser === cloudSession?.user?.id && root.querySelector("form.feed-panel"))};
})();
