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

  function draw(jobs) {
    const list = panel.querySelector("[data-jobs]");
    const signature = JSON.stringify(jobs);
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    list.replaceChildren();
    for (const job of jobs) {
      const card = document.createElement("article");
      card.className = "gv3-job";
      const header = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = labels[job.status] || job.status;
      const date = document.createElement("time");
      date.dateTime = job.created_at;
      date.textContent = new Date(job.created_at).toLocaleString("pt-BR");
      header.append(title, date);
      card.append(header);
      if (job.error) {
        const details = document.createElement("p");
        details.className = "gv3-note";
        details.textContent = job.error;
        card.append(details);
      }
      const outputs = document.createElement("div");
      outputs.className = "gv3-outputs";
      for (const [node, fps] of variants) {
        const output = job.outputs?.[node];
        if (!output) continue;
        const label = output.fps ?? fps;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn";
        button.textContent = output.fps === null ? "Baixar saída #" + node : "Baixar " + label + " fps";
        button.onclick = async () => {
          button.disabled = true;
          try {
            const { url } = await call("download", { id: job.id, node });
            const response = await fetch(url);
            if (!response.ok) throw new Error("Não foi possível baixar o vídeo.");
            const object = URL.createObjectURL(await response.blob());
            const link = document.createElement("a");
            link.href = object;
            link.download = "genjutsu-v3-" + (output.fps === null ? "node-" + node : label + "fps") + ".mp4";
            link.click();
            setTimeout(() => URL.revokeObjectURL(object), 30000);
          } catch (e) { notify(e.message); }
          finally { button.disabled = false; }
        };
        outputs.append(button);
      }
      if (outputs.childElementCount) card.append(outputs);
      list.append(card);
    }
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
    busy = true;
    button.disabled = true;
    button.textContent = "Enviando…";
    try {
      if (pending?.video !== video || pending?.image !== image ||
          ((!pending.uploaded.video || !pending.uploaded.image) && Date.now() - pending.created > 240000)) {
        pending = { video, image, created: Date.now(), uploaded: {} };
        pending.ticket = await call("ticket", {}, {
          video_bytes: video.size, image_bytes: image.size,
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
        <div class="gv3-actions"><button class="btn primary" type="submit">Gerar vídeos</button><p class="gv3-status" data-status role="status"></p></div>
      </form>
      <section class="gv3-panel" aria-label="Resultados">
        <header class="gv3-heading"><div><h3>Resultados</h3><p class="gv3-note">Versões de 24 e 30 fps com downloads separados.</p></div></header>
        <div class="gv3-jobs" data-jobs><div class="gv3-empty">Carregando resultados…</div></div>
      </section>`;
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
