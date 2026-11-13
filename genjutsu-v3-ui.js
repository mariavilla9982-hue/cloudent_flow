(() => {
  const endpoint = (window.CloudentConfig?.supabaseUrl || "") + "/functions/v1/cloudent-genjutsu-v3";
  const call = (action, params = {}, body) => edgeFetch(
    endpoint + "?" + new URLSearchParams({ action, ...params }),
    body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const labels = {
    queued: "Na fila", dispatching: "Enviando ao RunningHub", running: "Gerando",
    ready: "Pronto", failed: "Falha", review: "Revisão",
  };
  const variants = [["148", 24], ["170", 30]];
  let panel = null, owner = null, busy = false, pending = null, loading = false;
  const selectedByJob = new Map();
  let resultFilter = "all";
  const active = () => panel?.isConnected && currentPage === "production" &&
    window.CloudentMotionControl?.mode === "genjutsu" && owner === cloudSession?.user?.id;

  function formatElapsed(started) {
    const ms = Date.parse(started || "");
    if (!Number.isFinite(ms)) return "Aguardando início";
    const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    return "Gerando há " + [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(v => String(v).padStart(2, "0")).join(":");
  }
  function tickTimers() {
    if (!active()) return;
    for (const timer of panel.querySelectorAll("[data-gv3-started]"))
      timer.textContent = formatElapsed(timer.dataset.gv3Started);
  }

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
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(object), 60000);
  }

  // Signed storage URLs can play in <video> but refuse cross-origin fetch.
  // Always provide a browser-native fallback rather than silently doing nothing.
  async function downloadVideo(url, name, status) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Download HTTP " + response.status);
      const blob = await response.blob();
      if (!blob.size) throw new Error("Arquivo de vídeo vazio.");
      saveFile(blob, name);
      return;
    } catch (error) {
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.append(link);
      link.click();
      link.remove();
      if (status) status.textContent = "Download direto aberto. Caso o navegador exiba o vídeo, use Salvar/Baixar.";
      if (typeof toast === "function") toast("Download direto aberto no navegador.", "info");
    }
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
        status.textContent = "Preparando download…";
        await downloadVideo(await getLink(), "genjutsu-v3-" + suffix + ".mp4", status);
        if (status.textContent === "Preparando download…") status.textContent = "Download iniciado.";
      } catch (e) {
        status.textContent = e.message || "Falha no download.";
        if (typeof toast === "function") toast(status.textContent, "err");
      }
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
    return { tile, video, open, getLink };
  }

  function jobButton(label, handler, message) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = label;
    button.onclick = async () => {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try { await handler(); }
      catch (error) {
        message(error?.message || "Falha ao executar ação.");
        if (typeof toast === "function") toast(error?.message || "Falha ao executar ação.", "err");
      }
      finally { button.disabled = false; button.removeAttribute("aria-busy"); }
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
  function element(tag, className = "", label = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label) node.textContent = label;
    return node;
  }

  function applyFilters(jobs) {
    if (!panel?.isConnected) return;
    const counts = { all: jobs.length, running: jobs.filter(j => ["queued", "dispatching", "running"].includes(j.status)).length, ready: jobs.filter(j => j.status === "ready").length };
    const names = { all: "Todos", running: "Em andamento", ready: "Prontos" };
    for (const button of panel.querySelectorAll("[data-gv3-filter]")) {
      const filter = button.dataset.gv3Filter;
      button.textContent = names[filter] + " (" + counts[filter] + ")";
      button.classList.toggle("active", filter === resultFilter);
      button.setAttribute("aria-pressed", String(filter === resultFilter));
    }
    const queue = panel.querySelector("[data-gv3-queue]");
    if (queue) {
      const running = jobs.filter(j => ["running", "dispatching"].includes(j.status)).length;
      const waiting = jobs.filter(j => j.status === "queued").length;
      queue.textContent = running + "/1 gerando · " + waiting + " na fila";
    }
    const list = panel.querySelector("[data-jobs]");
    for (const card of list.querySelectorAll("[data-job-id]")) {
      const status = card.dataset.jobStatus;
      card.hidden = resultFilter === "running" ? !["queued", "dispatching", "running"].includes(status) :
        resultFilter === "ready" ? status !== "ready" : false;
    }
    const emptyFilter = panel.querySelector("[data-gv3-filter-empty]");
    if (emptyFilter) emptyFilter.hidden = !jobs.length || (resultFilter === "all" || counts[resultFilter] > 0);
  }

  function createShowcase(job, results, players) {
    const showcase = element("div", "gv3-showcase");
    const frame = element("div", "gv3-feature");
    const controls = element("div", "gv3-showcase-controls");
    const name = element("p", "gv3-feature-title", "PRÉVIA VERTICAL · 9:16");
    const status = element("p", "gv3-note gv3-feedback");
    status.setAttribute("role", "status");
    let selectedNode = selectedByJob.get(job.id);
    if (!results.some(([node]) => node === selectedNode)) selectedNode = results.at(-1)?.[0] || null;
    if (selectedNode) selectedByJob.set(job.id, selectedNode);
    const playerFor = () => players.find(p => p.node === selectedNode);
    const available = results.length > 0;
    const video = available ? document.createElement("video") : null;
    let previewVersion = 0;
    if (video) {
      video.className = "gv3-featured-video";
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.setAttribute("aria-label", "Prévia vertical do vídeo gerado");
      video.addEventListener("error", () => { status.textContent = "A prévia falhou. Tente baixar o arquivo."; });
      video.addEventListener("loadeddata", () => {
        if (video.readyState >= 2) status.textContent = "";
      });
      frame.append(video);
    } else {
      const placeholder = element("div", "gv3-feature-placeholder");
      const spinner = element("span", "gv3-feature-spinner", job.status === "failed" ? "!" : "◌");
      spinner.setAttribute("aria-hidden", "true");
      placeholder.append(spinner, element("small", "", job.status === "failed" ? "Produção não concluída" : "Prévia disponível quando finalizar"));
      frame.append(placeholder);
    }
    frame.append(element("span", "gv3-ratio", "9:16"));
    const versionLabel = element("b", "gv3-option-heading", "Versão para agenda");
    const versionOptions = element("div", "gv3-version-options");
    const versionNote = element("div", "gv3-selected-note");
    const variantButtons = [];
    const selectedFps = () => variants.find(([node]) => node === selectedNode)?.[1] || 24;
    const renderChoice = () => {
      for (const { button, node } of variantButtons) {
        const selected = node === selectedNode;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      }
      versionNote.textContent = available ? "✓ Versão selecionada: " + selectedFps() + " fps" : "Aguardando vídeos de saída";
    };
    async function loadPreview(play = false) {
      if (!video || !selectedNode) return;
      const node = selectedNode, version = ++previewVersion;
      const selected = playerFor();
      if (!selected) return;
      if (video.dataset.node !== node) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        delete video.dataset.node;
      } else if (video.getAttribute("src")) {
        if (play) await video.play().catch(() => {});
        return;
      }
      status.textContent = "Carregando prévia " + selectedFps() + " fps…";
      try {
        const url = await selected.getLink();
        if (version !== previewVersion || !showcase.isConnected) return;
        video.dataset.node = node;
        video.src = url + "#t=0.1";
        if (play) await video.play().catch(() => {});
      } catch (error) {
        if (version === previewVersion) status.textContent = error.message || "Prévia indisponível.";
      }
    }
    for (const [node, fps] of variants) {
      const button = element("button", "gv3-option", fps + " fps");
      button.type = "button";
      button.disabled = !results.some(([resultNode]) => resultNode === node);
      button.setAttribute("aria-label", "Selecionar versão de " + fps + " fps");
      button.onclick = () => {
        if (selectedNode === node) return;
        selectedNode = node;
        selectedByJob.set(job.id, node);
        renderChoice();
        void loadPreview();
      };
      variantButtons.push({ button, node });
      versionOptions.append(button);
    }
    renderChoice();
    if (!available) status.textContent = ["queued", "dispatching", "running"].includes(job.status)
      ? "Aguardando a saída do vídeo. Preview, agenda e download serão liberados quando ficar pronto."
      : "Nenhuma saída disponível. Use os controles de recuperação abaixo.";
    function action(label, className, handler, disabled = false) {
      const button = element("button", "btn " + className, label);
      button.type = "button";
      button.disabled = disabled;
      button.onclick = async () => {
        if (button.disabled) return;
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        const previous = button.textContent;
        status.textContent = label.includes("agenda") ? "Abrindo a agenda…" : label.includes("Baixar") ? "Preparando download…" : "Carregando prévia…";
        try { await handler(button); }
        catch (error) {
          status.textContent = error?.message || "Não foi possível concluir esta ação.";
          if (typeof toast === "function") toast(status.textContent, "err");
        }
        finally {
          if (button.isConnected) {
            button.textContent = previous;
            button.disabled = disabled;
            button.removeAttribute("aria-busy");
          }
        }
      };
      return button;
    }
    const preview = action("▷ Preview", "gv3-preview-button", async () => {
      await loadPreview(true);
      video?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, !available);
    const agenda = action("▦ Adicionar à agenda", "primary gv3-agenda-button", () => {
      if (typeof openScheduleModal !== "function") throw new Error("Agenda não disponível nesta tela.");
      const selected = playerFor();
      if (!selected) throw new Error("Selecione uma versão disponível.");
      const fps = selectedFps();
      openScheduleModal();
      const fileInput = document.getElementById("modalFile");
      if (!fileInput) throw new Error("O agendador não abriu corretamente.");
      // The server performs an S3 CopyObject when the user saves the date.
      const marker = document.createElement("input");
      marker.type = "hidden";
      marker.id = "modalGenjutsuV3";
      marker.dataset.jobId = job.id;
      marker.dataset.node = selectedNode;
      fileInput.insertAdjacentElement("afterend", marker);
      const field = fileInput.closest(".field");
      field.hidden = true;
      field.style.display = "none";
      const hint = document.createElement("p");
      hint.className = "note";
      hint.setAttribute("role", "status");
      hint.textContent = "✓ GENJUTSU V3 · " + fps + " fps selecionado. O vídeo será copiado direto do Backblaze ao salvar, sem novo upload.";
      field.insertAdjacentElement("afterend", hint);
      status.textContent = "Agenda aberta para a versão " + fps + " fps.";
    }, !available);
    const download = action("↓ Baixar", "gv3-download-button", async button => {
      const selected = playerFor();
      if (!selected) throw new Error("Vídeo ainda indisponível.");
      button.textContent = "Baixando…";
      await downloadVideo(await selected.getLink(), "genjutsu-v3-" + selectedFps() + "fps.mp4", status);
      if (status.textContent === "Preparando download…") status.textContent = "Download iniciado.";
    }, !available);
    const buttonGroup = element("div", "gv3-primary-actions");
    buttonGroup.append(preview, agenda, download);
    controls.append(name, versionLabel, versionOptions, versionNote, buttonGroup, status);
    showcase.append(frame, controls);
    if (video) {
      if (typeof IntersectionObserver === "function") {
        const observer = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) {
            observer.disconnect();
            void loadPreview();
          }
        }, { rootMargin: "160px" });
        observer.observe(showcase);
      } else {
        Promise.resolve().then(() => { if (showcase.isConnected) void loadPreview(); });
      }
    } else if (["dispatching", "running"].includes(job.status)) {
      const progress = element("div", "gv3-progress");
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-label", "Geração em andamento");
      progress.removeAttribute("aria-valuenow");
      progress.append(element("span", "gv3-progress-runner"));
      controls.insertBefore(progress, buttonGroup);
    }
    return showcase;
  }

  function draw(jobs) {
    const list = panel.querySelector("[data-jobs]");
    const signature = JSON.stringify(jobs);
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    const retryAll = panel.querySelector("[data-retry-all]");
    const waitingJobs = jobs.filter(job => job.status === "queued")
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || String(a.id).localeCompare(String(b.id)));
    const queuePositions = new Map(waitingJobs.map((job, i) => [job.id, i + 1]));
    const failed = jobs.filter(job => job.status === "failed");
    retryAll.hidden = !failed.length;
    retryAll.onclick = async () => {
      retryAll.disabled = true;
      try {
        let confirmed = 0;
        for (const job of failed) {
          try { await retryJob(job); confirmed++; }
          catch { /* Report only confirmed retries. */ }
        }
        notify(confirmed + " de " + failed.length + " vídeos voltaram à fila.");
        await refresh();
      } finally { retryAll.disabled = false; }
    };
    const cards = new Map([...list.children].filter(item => item.dataset.jobId).map(item => [item.dataset.jobId, item]));
    const nextCards = new Set();
    for (const [index, job] of jobs.entries()) {
      const existing = cards.get(job.id);
      // Do not destroy interactive cards on worker heartbeat timestamp updates.
      const jobSignature = JSON.stringify(job.status === "ready" ? job : { ...job, updated_at: null });
      if (existing?.dataset.signature === jobSignature) {
        nextCards.add(existing);
        continue;
      }
      const card = element("article", "gv3-job");
      card.dataset.jobId = job.id;
      card.dataset.jobStatus = job.status;
      card.dataset.signature = jobSignature;
      const header = element("header", "gv3-job-header");
      const identity = element("div", "gv3-job-identity");
      identity.append(element("strong", "gv3-job-title", "Vídeo " + (index + 1)));
      const statusTag = element("span", "gv3-state gv3-state-" + job.status, labels[job.status] || job.status);
      identity.append(statusTag);
      if (job.status === "queued")
        identity.append(element("span", "gv3-queue-position", "Fila · posição " + (queuePositions.get(job.id) || 1)));
      if (job.status === "running" && job.started_at) {
        const timer = element("span", "gv3-elapsed", formatElapsed(job.started_at));
        timer.dataset.gv3Started = job.started_at;
        timer.setAttribute("role", "timer");
        identity.append(timer);
      }
      if (job.mode === "manual" || job.mode === "automatic") {
        identity.append(element("span", "gv3-mode-tag", job.mode === "manual" ? "Manual" : "Automático"));
      }
      const complete = job.status === "ready" && job.updated_at;
      const timestamp = complete ? job.updated_at : job.created_at;
      const date = element("time", "gv3-job-time");
      date.dateTime = timestamp;
      const at = new Date(timestamp);
      date.textContent = (complete ? "Gerado" : "Enviado") + " em " +
        at.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " às " +
        at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      header.append(identity, date);
      card.append(header);
      if (job.error) card.append(element("p", "gv3-note", job.error));
      const results = variants.filter(([node]) => job.outputs?.[node]);
      const players = results.map(([node, fps]) => ({ ...resultVariant(job, node, fps, job.outputs[node]), node, fps }));
      const showcase = createShowcase(job, results, players);
      card.append(showcase);
      let comparison = null;
      if (players.length) {
        comparison = element("details", "gv3-compare");
        comparison.append(element("summary", "", players.length === 2 ? "Comparar prévias de 24 e 30 fps" : "Ver prévia detalhada"));
        const outputs = element("div", "gv3-outputs");
        outputs.append(...players.map(player => player.tile));
        comparison.append(outputs);
        comparison.addEventListener("toggle", () => {
          for (const player of players) {
            if (comparison.open) void player.open();
            else player.video.pause();
          }
        });
        if (existing?.querySelector(".gv3-compare")?.open) comparison.open = true;
        card.append(comparison);
      }
      addJobActions(card, job, comparison);
      const actions = card.querySelector(":scope > .gv3-actions");
      const lastStatus = actions?.nextElementSibling;
      const originalPreviews = lastStatus?.nextElementSibling;
      const heroActions = showcase.querySelector(".gv3-primary-actions");
      for (const label of ["Parar", "Tentar novamente"]) {
        const button = [...(actions?.querySelectorAll("button") || [])].find(item => item.textContent === label);
        if (button) { button.classList.add("gv3-recovery-button"); heroActions.append(button); }
      }
      const tools = element("details", "gv3-tools");
      tools.append(element("summary", "", "Vídeo original, frame e outras ações"));
      if (actions) tools.append(actions);
      if (lastStatus) tools.append(lastStatus);
      if (originalPreviews) tools.append(originalPreviews);
      if (existing?.querySelector(".gv3-tools")?.open) tools.open = true;
      card.append(tools);
      if (existing) existing.replaceWith(card);
      else list.append(card);
      nextCards.add(card);
    }
    for (const item of [...list.children]) if (!nextCards.has(item)) item.remove();
    if (!jobs.length) list.innerHTML = '<div class="gv3-empty">Nenhuma geração enviada.</div>';
    applyFilters(jobs);
    tickTimers();
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
        <header class="gv3-heading"><div><h3>Produção</h3><p class="gv3-note">Vídeos gerados com IA · Prévia vertical 9:16</p></div><div class="gv3-heading-actions"><span class="gv3-queue-count" data-gv3-queue></span><button class="btn" type="button" data-refresh>Atualizar</button><button class="btn" type="button" data-retry-all hidden>Tentar todos novamente</button></div></header>
        <nav class="gv3-filters" aria-label="Filtrar vídeos"><button type="button" data-gv3-filter="all" class="active">Todos</button><button type="button" data-gv3-filter="running">Em andamento</button><button type="button" data-gv3-filter="ready">Prontos</button></nav>
        <div class="gv3-empty gv3-filter-empty" data-gv3-filter-empty hidden>Nenhum vídeo nesta categoria.</div>
        <div class="gv3-jobs" data-jobs><div class="gv3-empty">Carregando resultados…</div></div>
      </section>`;
    panel.querySelector("[data-refresh]").onclick = refresh;
    panel.querySelectorAll("[data-gv3-filter]").forEach(button => { button.onclick = () => { resultFilter = button.dataset.gv3Filter; const jobs = [...panel.querySelectorAll("[data-job-id]")].map(card => ({ status: card.dataset.jobStatus })); applyFilters(jobs); }; });
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
  setInterval(tickTimers, 1000);
})();
