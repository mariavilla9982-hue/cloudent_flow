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
  function draw(jobs) {
    const list = panel.querySelector("[data-jobs]");
    list.replaceChildren();
    for (const job of jobs) {
      const card = document.createElement("div");
      card.className = "card";
      const title = document.createElement("strong");
      title.textContent = labels[job.status] || job.status;
      card.append(title);
      const details = document.createElement("p");
      details.className = "muted";
      details.textContent = [new Date(job.created_at).toLocaleString("pt-BR"), job.error].filter(Boolean).join(" · ");
      card.append(details);
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
        card.append(button);
      }
      list.append(card);
    }
    if (!jobs.length) list.textContent = "Nenhuma geração enviada.";
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
    const form = event.currentTarget, button = form.querySelector("button");
    const video = form.elements.video.files[0], image = form.elements.image.files[0];
    if (!video || !image) return;
    busy = true;
    button.disabled = true;
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
      notify("Geração adicionada à fila.");
      await refresh();
    } catch (e) {
      if (!pending?.ticket) pending = null;
      notify(e.message);
    } finally { busy = false; button.disabled = false; }
  }
  function render(root) {
    const user = cloudSession?.user?.id;
    if (active() && root.contains(panel)) return;
    root.querySelector("[data-genjutsu-v3]")?.remove();
    if (!user) return;
    if (owner !== user) { owner = user; pending = null; }
    panel = document.createElement("section");
    panel.dataset.genjutsuV3 = "";
    panel.innerHTML = '<form class="card" style="display:grid;gap:12px"><label>Vídeo de referência<input required type="file" name="video" accept="video/mp4,video/webm,video/quicktime"></label><label>Foto do personagem<input required type="file" name="image" accept="image/jpeg,image/png,image/webp"></label><small class="muted">O workflow foi preparado para vídeos de até 15 segundos.</small><button class="btn primary" type="submit">Gerar vídeos</button><p data-status role="status"></p></form><h3>Resultados</h3><div data-jobs></div>';
    panel.querySelector("form").addEventListener("submit", submit);
    root.append(panel);
    void refresh();
  }
  window.CloudentGenjutsuV3 = { render, refresh, get busy() { return busy; } };
  setInterval(refresh, 12000);
})();
