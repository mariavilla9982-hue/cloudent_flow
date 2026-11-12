(() => {
  const endpoint = (window.CloudentConfig?.supabaseUrl || "") + "/functions/v1/cloudent-genjutsu-v3";
  const call = (action, params = {}, body) => edgeFetch(
    endpoint + "?" + new URLSearchParams({ action, ...params }),
    body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const labels = {
    queued: "Na fila", dispatching: "Enviando ao RunningHub", running: "Gerando",
    ready: "Dois vídeos prontos", failed: "Saída incompleta", review: "Envio a confirmar",
  };
  const variants = [["148", 24], ["170", 30]];
  let panel = null, owner = null, busy = false, pending = null, loading = false;
  const active = () => panel?.isConnected && currentPage === "production" &&
    window.CloudentMotionControl?.mode === "genjutsu" && owner === cloudSession?.user?.id;

  function notify(message) {
    if (active()) panel.querySelector("[data-status]").textContent = message;
  }
  function mediaField({ name, title, kind, accept, formats, icon }) {
    return `<label class="gv3-field">
      <b>${title}</b>
      <span class="gv3-media">
        <span class="gv3-media-copy">
          <span class="gv3-media-icon" aria-hidden="true">${icon}</span>
          <b>Selecionar ${kind}</b><small>${formats}</small>
        </span>
        ${name === "video" ? '<video hidden muted playsinline preload="metadata"></video>' : '<img hidden alt="Prévia da foto do personagem">'}
        <input required type="file" name="${name}" accept="${accept}" aria-label="${title}">
      </span>
      <small class="gv3-filename" aria-live="polite"></small>
    </label>`;
  }

  function showSelectedFile(input) {
    const field = input.closest(".gv3-field");
    const preview = field.querySelector("video,img");
    const copy = field.querySelector(".gv3-media-copy");
    const filename = field.querySelector(".gv3-filename");
    const file = input.files[0];
    if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
    preview.removeAttribute("src");
    delete preview.dataset.objectUrl;
    preview.hidden = !file;
    copy.hidden = Boolean(file);
    filename.textContent = file ? file.name : "";
    if (file) {
      preview.dataset.objectUrl = URL.createObjectURL(file);
      preview.src = preview.dataset.objectUrl;
    }
  }

  function saveFile(blob, name) {
    const object = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = object;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(object), 30000);
  }

  function resultVariant(job, node, fps, output) {
    const measured = output.fps;
    const displayFps = typeof measured === "number" && Math.abs(measured - fps) > 0.15 ? measured : fps;
    const label = measured === null ? "Saída #" + node : displayFps + " fps";
    const suffix = measured === null ? "node-" + node : displayFps + "fps";
    const tile = document.createElement("section");
    tile.className = "gv3-variant";
    const heading = document.createElement("header");
    heading.className = "gv3-variant-heading";
    const title = document.createElement("h4");
    title.textContent = label;
    if (typeof measured === "number") title.title = "FPS medido: " + measured.toLocaleString("pt-BR");
    const download = document.createElement("button");
    download.type = "button";
    download.className = "btn";
    download.textContent = "↓ Baixar";
    download.setAttribute("aria-label", "Baixar vídeo " + label);
    heading.append(title, download);

    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.setAttribute("aria-label", "Prévia do vídeo " + label);
    const status = document.createElement("p");
    status.className = "gv3-note gv3-preview-status";
    status.setAttribute("role", "status");
    const cover = document.createElement("button");
    cover.type = "button";
    cover.className = "btn gv3-cover";
    cover.textContent = "↓ Baixar capa";
    cover.setAttribute("aria-label", "Baixar capa de " + label);
    cover.hidden = true;
    let link, expires = 0, pendingLink, coverImage, fallbackUsed = false;
    const getLink = async () => {
      if (link && Date.now() < expires) return link;
      pendingLink ||= call("download", { id: job.id, node }).then(({ url }) => {
        link = url;
        expires = Date.now() + 240000;
        return url;
      }).finally(() => { pendingLink = null; });
      return await pendingLink;
    };
    download.onclick = async () => {
      download.disabled = true;
      status.textContent = "";
      try {
        const response = await fetch(await getLink());
        if (!response.ok) throw new Error("Não foi possível baixar o vídeo.");
        saveFile(await response.blob(), "genjutsu-v3-" + suffix + ".mp4");
      } catch (e) { status.textContent = e.message; }
      finally { download.disabled = false; }
    };

    video.addEventListener("loadeddata", () => {
      status.textContent = "";
      if (coverImage || fallbackUsed || !video.videoWidth) return;
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      try {
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        video.poster = canvas.toDataURL("image/jpeg", 0.9);
        canvas.toBlob(blob => {
          if (blob) { coverImage = blob; cover.hidden = false; }
        }, "image/jpeg", 0.9);
      } catch { /* The player still displays its first frame when canvas reads are unavailable. */ }
    });
    cover.onclick = () => {
      if (coverImage) saveFile(coverImage, "genjutsu-v3-capa-" + suffix + ".jpg");
    };
    video.addEventListener("error", () => {
      if (!fallbackUsed && link) {
        fallbackUsed = true;
        video.removeAttribute("crossorigin");
        video.src = link + "#t=0.1";
        return;
      }
      status.textContent = "Prévia indisponível. Você ainda pode baixar o vídeo.";
    });
    async function open() {
      if (video.getAttribute("src")) return;
      status.textContent = "Carregando prévia…";
      try { video.src = (await getLink()) + "#t=0.1"; }
      catch (e) { status.textContent = e.message; }
    }
    tile.append(heading, video, cover, status);
    return { tile, video, open };
  }

  function jobButton(label, handler, message) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = label;
    button.onclick = async () => {
      button.disabled = true;
      try { await handler(); }
      catch (error) { message(error.message); }
      finally { button.disabled = false; }
    };
    return button;
  }
  async function retryJob(job) {
    await call("retry", { id: job.id }, {});
  }
  function addJobActions(card, job, result) {
    const actions = document.createElement("div");
    actions.className = "gv3-actions";
    const status = document.createElement("p");
    status.className = "gv3-note";
    status.setAttribute("role", "status");
    const message = value => { status.textContent = value; };
    const add = (label, handler) => actions.append(jobButton(label, handler, message));
    if (result) add("Ver resultado", () => { result.open = true; result.scrollIntoView({ block: "nearest" }); });
    const preview = document.createElement("div");
    preview.className = "gv3-outputs";
    const input = kind => call("input", { id: job.id, kind });
    const inputFile = async kind => {
      const { url, type } = await input(kind);
      const response = await fetch(url);
      if (!response.ok) throw new Error("Arquivo indisponível.");
      const extension = { "video/quicktime": "mov", "video/webm": "webm", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type] || "mp4";
      return new File([await response.blob()], (kind === "video" ? "video-original." : "frame.") + extension, { type });
    };
    for (const [kind, show, download, reuse] of [
      ["video", "Vídeo original", "Baixar vídeo original", "Usar vídeo"],
      ["image", "Ver frame", "Baixar frame", "Usar frame"],
    ]) {
      add(show, async () => {
        const existing = preview.querySelector('[data-kind="' + kind + '"]');
        if (existing) { existing.remove(); return; }
        const { url } = await input(kind);
        if (!card.isConnected) return;
        const media = document.createElement(kind === "video" ? "video" : "img");
        media.dataset.kind = kind;
        media.style.maxWidth = "100%";
        media.style.maxHeight = "320px";
        if (kind === "video") { media.controls = true; media.playsInline = true; }
        else media.alt = "Frame do personagem";
        media.onerror = () => message("Prévia indisponível.");
        media.src = url;
        preview.append(media);
      });
      add(download, async () => {
        const file = await inputFile(kind);
        if (active()) saveFile(file, file.name);
      });
      if (job.status === "failed") add(reuse, async () => {
        const form = panel.querySelector("form");
        const file = await inputFile(kind);
        if (!active() || !form.isConnected || busy) return;
        const field = form.elements[kind];
        if (field.files.length && !confirm("Substituir o arquivo selecionado?")) return;
        const transfer = new DataTransfer();
        transfer.items.add(file);
        field.files = transfer.files;
        showSelectedFile(field);
        form.scrollIntoView({ block: "nearest" });
      });
    }
    if (["queued", "running"].includes(job.status)) add("Parar", async () => {
      if (!confirm("Parar esta produção do GENJUTSU V3?")) return;
      await call("stop", { id: job.id }, {});
      await refresh();
    });
    if (["ready", "failed"].includes(job.status)) {
      add("Tentar novamente", async () => {
        if (job.status === "ready" && !confirm("Gerar este vídeo novamente?")) return;
        await retryJob(job);
        await refresh();
      });
      add("Excluir", async () => {
        if (!confirm("Remover este vídeo da fila?")) return;
        await call("delete", { id: job.id }, {});
        await refresh();
      });
    }
    card.append(actions, status, preview);
  }
  function draw(jobs) {
    const list = panel.querySelector("[data-jobs]");
    const signature = JSON.stringify(jobs);
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    const retryAll = panel.querySelector("[data-retry-all]");
    const failed = jobs.filter(job => job.status === "failed");
    retryAll.hidden = !failed.length;
    retryAll.onclick = async () => {
      retryAll.disabled = true;
      try {
        let confirmed = 0;
        for (const job of failed) {
          try { await retryJob(job); confirmed++; }
          catch { /* Report the total confirmed by the server. */ }
        }
        notify(confirmed + " de " + failed.length + " vídeos voltaram à fila.");
        await refresh();
      } finally { retryAll.disabled = false; }
    };
    const cards = new Map([...list.children].filter(item => item.dataset.jobId).map(item => [item.dataset.jobId, item]));
    const nextCards = new Set();
    for (const job of jobs) {
      const existing = cards.get(job.id);
      const signature = JSON.stringify(job);
      if (existing?.dataset.signature === signature) {
        nextCards.add(existing);
        continue;
      }
      const card = document.createElement("article");
      card.dataset.jobId = job.id;
      card.dataset.signature = signature;
      card.className = "gv3-job";
      const header = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = labels[job.status] || job.status;
      const date = document.createElement("time");
      date.dateTime = job.created_at;
      date.textContent = new Date(job.created_at).toLocaleString("pt-BR");
      const identity = document.createElement("div");
      identity.className = "gv3-job-identity";
      identity.append(title);
      if (job.mode === "manual" || job.mode === "automatic") {
        const tag = document.createElement("span");
        tag.className = "gv3-mode-tag";
        tag.textContent = job.mode === "manual" ? "Manual" : "Automático";
        identity.append(tag);
      }
      header.append(identity, date);
      card.append(header);
      if (job.error) {
        const details = document.createElement("p");
        details.className = "gv3-note";
        details.textContent = job.error;
        card.append(details);
      }
      const results = variants.filter(([node]) => job.outputs?.[node]);
      if (results.length) {
        const details = document.createElement("details");
        details.className = "gv3-compare";
        const summary = document.createElement("summary");
        summary.textContent = results.length === 2 ? "Abrir prévias de 24 e 30 fps" : "Abrir prévia do vídeo disponível";
        const outputs = document.createElement("div");
        outputs.className = "gv3-outputs";
        const players = results.map(([node, fps]) => resultVariant(job, node, fps, job.outputs[node]));
        outputs.append(...players.map(player => player.tile));
        details.append(summary, outputs);
        details.addEventListener("toggle", () => {
          for (const player of players) {
            if (details.open) void player.open();
            else player.video.pause();
          }
        });
        card.append(details);
        if (existing?.querySelector("details")?.open) details.open = true;
      }
      addJobActions(card, job, card.querySelector("details"));
      if (existing) existing.replaceWith(card);
      else list.append(card);
      nextCards.add(card);
    }
    for (const item of [...list.children]) if (!nextCards.has(item)) item.remove();
    if (!jobs.length) list.innerHTML = '<div class="gv3-empty">Nenhuma geração enviada.</div>';
  }
  async function refresh() {
    if (!active() || loading) return;
    const target = panel;
    loading = true;
    try {
      const { jobs } = await call("list");
      if (active() && panel === target) draw(jobs || []);
    } catch (e) {
      if (active() && panel === target) notify(e.message);
    } finally { loading = false; }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || !active()) return;
    const form = event.currentTarget, button = form.querySelector("button[type=submit]");
    const video = form.elements.video.files[0], image = form.elements.image.files[0];
    if (!video || !image) return;
    const prompt = form.elements.manual_prompt.value.trim();
    if (!prompt) { notify("Digite o prompt manual."); return; }
    busy = true;
    button.disabled = true;
    button.textContent = "Enviando…";
    try {
      if (pending?.video !== video || pending?.image !== image || pending?.prompt !== prompt ||
          ((!pending.uploaded.video || !pending.uploaded.image) && Date.now() - pending.created > 240000)) {
        pending = { video, image, prompt, created: Date.now(), uploaded: {} };
        pending.ticket = await call("ticket", {}, {
          video_bytes: video.size, image_bytes: image.size, manual_prompt: prompt,
          video_type: video.type || "video/mp4", image_type: image.type || "image/jpeg",
        });
      }
      notify("Enviando vídeo e foto…");
      const uploads = await Promise.allSettled([["video", video], ["image", image]].map(async ([kind, file]) => {
        if (pending.uploaded[kind]) return;
        const result = await fetch(pending.ticket[kind], { method: "PUT", body: file });
        if (!result.ok) throw new Error("Falha no envio de " + (kind === "video" ? "vídeo" : "foto") + ".");
        pending.uploaded[kind] = true;
      }));
      const failed = uploads.find(upload => upload.status === "rejected");
      if (failed) throw failed.reason;
      await call("submit", { id: pending.ticket.id }, {});
      pending = null;
      form.reset();
      form.querySelectorAll("input[type=file]").forEach(showSelectedFile);
      notify("Geração adicionada à fila.");
      await refresh();
    } catch (e) {
      if (!pending?.ticket) pending = null;
      notify(e.message);
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = "Gerar vídeos";
    }
  }
  function render(root) {
    const user = cloudSession?.user?.id;
    if (active() && root.contains(panel)) return;
    panel?.querySelectorAll("[data-object-url]").forEach(preview => URL.revokeObjectURL(preview.dataset.objectUrl));
    root.querySelector("[data-genjutsu-v3]")?.remove();
    if (!user) return;
    if (owner !== user) { owner = user; pending = null; }
    panel = document.createElement("section");
    panel.dataset.genjutsuV3 = "";
    panel.innerHTML = `
      <form class="gv3-panel">
        <header class="gv3-heading"><div><h3>Nova geração</h3><p class="gv3-note">Use um vídeo de até 15 segundos.</p></div></header>
        <div class="gv3-inputs">
          ${mediaField({ name: "video", title: "Vídeo de referência", kind: "vídeo", accept: "video/mp4,video/webm,video/quicktime", formats: "MP4, MOV ou WebM · até 30 MiB", icon: "▷" })}
          ${mediaField({ name: "image", title: "Foto do personagem", kind: "foto", accept: "image/jpeg,image/png,image/webp", formats: "JPG, PNG ou WebP · até 10 MiB", icon: "▧" })}
        </div>
        <label class="gv3-prompt"><b>Prompt manual</b><textarea name="manual_prompt" rows="4" required maxlength="8000" placeholder="Descreva o personagem em inglês…"></textarea></label>
        <div class="gv3-actions"><button class="btn primary" type="submit">Gerar vídeos</button><p class="gv3-status" data-status role="status"></p></div>
      </form>
      <section class="gv3-panel" aria-label="Resultados">
        <header class="gv3-heading"><div><h3>Resultados</h3><p class="gv3-note">Compare as versões e baixe a que preferir.</p></div><div class="gv3-actions"><button class="btn" type="button" data-refresh>Atualizar</button><button class="btn" type="button" data-retry-all hidden>Tentar todos novamente</button></div></header>
        <div class="gv3-jobs" data-jobs><div class="gv3-empty">Carregando resultados…</div></div>
      </section>`;
    panel.querySelector("[data-refresh]").onclick = refresh;
    const form = panel.querySelector("form");
    form.addEventListener("submit", submit);
    form.addEventListener("change", event => {
      if (event.target.matches("input[type=file]")) showSelectedFile(event.target);
    });
    root.append(panel);
    void refresh();
  }
  window.CloudentGenjutsuV3 = { render, refresh, get busy() { return busy; } };
  setInterval(refresh, 12000);
})();
