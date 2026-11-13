import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { motionObjectConfig, motionObjectURL, motionCheckObject, putMotionPrimary, requireMotionStorage, storageRPC, MotionStorageSafetyError } from "../cloudent-motion-control-worker/motion-storage-protection.ts";

const WORKFLOW = "2120974306862780417";
const NODES = ["148", "170"] as const;
const MIB = 1024 * 1024;
const table = "genjutsu_v3_jobs";
const headers = {
  "Content-Type": "application/json", "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const env = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(env, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fromB64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const root = (job: any) => `${job.user_id}/genjutsu-v3/${job.id}`;
const directInputPath = (job: any, kind: string) => kind === "video"
  ? `${root(job)}/video.${job.video_type === "video/quicktime" ? "mov" : job.video_type === "video/webm" ? "webm" : "mp4"}`
  : `${root(job)}/photo.${job.image_type === "image/png" ? "png" : job.image_type === "image/webp" ? "webp" : "jpg"}`;
function inputPath(job: any, kind: string) {
  const savedPath = kind === "video" ? job.input_video_path : job.input_image_path;
  if (!savedPath) return directInputPath(job, kind);
  if (!savedPath.startsWith(job.user_id + "/")) throw new Error("Entrada pertence a outra conta.");
  return savedPath;
}
const outputPath = (job: any, node: string) => `${root(job)}/output-${node}.mp4`;
const settings = async (key: string) => {
  const { data, error } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value;
};
async function userId(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  let claims;
  try { claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); }
  catch { return null; }
  if (claims.iss !== env + "/auth/v1" || !uuid.test(claims.session_id || "")) return null;
  const [session, member] = await Promise.all([
    admin.rpc("cloudent_auth_session_active", { p_session_id: claims.session_id, p_user_id: data.user.id }),
    admin.from("app_members").select("enabled,role").eq("user_id", data.user.id).maybeSingle(),
  ]);
  return session.data === true && member.data?.enabled && member.data?.role === "admin" ? data.user.id : null;
}
async function storage() {
  const cfg = await motionObjectConfig(admin);
  if (!cfg) throw new MotionStorageSafetyError("Armazenamento principal indisponível.");
  return cfg;
}
async function runningHub(master: string) {
  const { data, error } = await admin.from("integrations").select("enabled,config").eq("provider", "runninghub").maybeSingle();
  if (error || !data?.enabled) throw new Error("RunningHub está indisponível.");
  const cfg = data.config;
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(master)), "AES-GCM", false, ["decrypt"]);
  const apiKey = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(cfg.apiKeyIv) }, key, fromB64(cfg.apiKeyCipher)));
  const base = new URL(cfg.baseUrl || "https://www.runninghub.ai");
  if (base.protocol !== "https:" || !/(^|\.)runninghub\.(ai|cn)$/.test(base.hostname) || base.username || base.password || base.port)
    throw new Error("Endereço RunningHub inválido.");
  const origin = base.origin;
  const request = async (path: string, body?: Record<string, unknown>) => {
    const response = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify({ ...body, apiKey }) : undefined,
      redirect: "error", signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`RunningHub retornou HTTP ${response.status}.`);
    return await response.json();
  };
  return { request };
}
function parse(value: any) { return typeof value === "string" ? JSON.parse(value) : value; }
async function validateGraph(request: any) {
  const result = await request("/api/openapi/getJsonApiFormat", { workflowId: WORKFLOW });
  const data = parse(result.data);
  const graph = parse(data?.prompt ?? data?.data?.prompt ?? data);
  const has = (id: string, kind: string, field: string) => graph?.[id]?.class_type === kind && Object.hasOwn(graph[id].inputs || {}, field);
  if (Number(result.code) !== 0 || !has("1", "VHS_LoadVideo", "video") || !has("2", "LoadImage", "image")
      || !has("148", "SaveVideo", "video") || !has("170", "SaveVideo", "video")
      || !has("169", "RH_DLSS5FrameInterpolation", "output_fps")
      || !has("159", "ComfySwitchNode", "switch") || !has("115", "PrimitiveStringMultiline", "value")
      || !has("147", "CreateVideo", "fps") || Number(graph["147"].inputs.fps) !== 24
      || String(graph["148"].inputs.video?.[0]) !== "147"
      || String(graph["170"].inputs.video?.[0]) !== "169")
    throw new Error("RunningHub não confirmou os nós do GENJUTSU V3.");
  return { workflow: WORKFLOW, originalOutputFps: graph["169"].inputs.output_fps };
}
async function patch(job: any, values: Record<string, unknown>) {
  const { data, error } = await admin.from(table).update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", job.id).eq("lease_id", job.lease_id).select("id").maybeSingle();
  if (error || !data) throw new Error("A reserva do job mudou.");
}
const release = { lease_id: null, lease_until: null };
function providerOutput(items: unknown, node: string) {
  if (!Array.isArray(items)) return null;
  const item = items.find(x => String(x?.nodeId ?? x?.node_id) === node && typeof x?.fileUrl === "string");
  if (!item) return null;
  const url = new URL(item.fileUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !/(^|\.)(runninghub\.(ai|cn)|xiaoyaoyou\.com)$/.test(url.hostname))
    throw new Error("Endereço de saída RunningHub inválido.");
  return url.href;
}
async function downloadMp4(url: string) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(25000) });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 40 * MIB)
    throw new Error("Saída de vídeo indisponível ou acima de 40 MiB.");
  const reader = response.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 40 * MIB) throw new Error("Saída acima de 40 MiB.");
      parts.push(Uint8Array.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  const blob = new Blob(parts, { type: "video/mp4" });
  const signature = new TextDecoder().decode(await blob.slice(4, 8).arrayBuffer());
  if (signature !== "ftyp") throw new Error("RunningHub não retornou um MP4 válido.");
  return blob;
}
async function videoFps(blob: Blob) {
  function boxes(view: DataView, start: number, end: number) {
    const result = [];
    for (let offset = start; offset + 8 <= end;) {
      const length = view.getUint32(offset);
      const size = length === 1 && offset + 16 <= end ? Number(view.getBigUint64(offset + 8)) : length || end - offset;
      const header = length === 1 ? 16 : 8;
      if (size < header || size > end - offset) break;
      result.push({ type: view.getUint32(offset + 4), start: offset + header, end: offset + size });
      offset += size;
    }
    return result;
  }
  for (let offset = 0; offset + 8 <= blob.size;) {
    const header = new DataView(await blob.slice(offset, offset + 16).arrayBuffer());
    const length = header.getUint32(0);
    const size = length === 1 && header.byteLength >= 16 ? Number(header.getBigUint64(8)) : length || blob.size - offset;
    const headerSize = length === 1 ? 16 : 8;
    if (size < headerSize || size > blob.size - offset) return null;
    if (header.getUint32(4) !== 0x6d6f6f76) { offset += size; continue; } // moov
    if (size > 4 * MIB) return null;
    const view = new DataView(await blob.slice(offset + headerSize, offset + size).arrayBuffer());
    const child = (box: { start: number; end: number } | undefined, type: number) =>
      box && boxes(view, box.start, box.end).find(item => item.type === type);
    for (const trak of boxes(view, 0, view.byteLength).filter(item => item.type === 0x7472616b)) {
      const mdia = child(trak, 0x6d646961), handler = child(mdia, 0x68646c72);
      if (!handler || handler.start + 12 > handler.end || view.getUint32(handler.start + 8) !== 0x76696465) continue;
      const mdhd = child(mdia, 0x6d646864), stts = child(child(child(mdia, 0x6d696e66), 0x7374626c), 0x73747473);
      if (!mdhd || mdhd.start >= mdhd.end || !stts || stts.start + 8 > stts.end) continue;
      const timescaleAt = mdhd.start + (view.getUint8(mdhd.start) === 1 ? 20 : 12);
      const entries = view.getUint32(stts.start + 4);
      if (timescaleAt + 4 > mdhd.end || entries > (stts.end - stts.start - 8) / 8) continue;
      let frames = 0, ticks = 0;
      for (let index = 0; index < entries; index++) {
        const pos = stts.start + 8 + index * 8, count = view.getUint32(pos);
        frames += count;
        ticks += count * view.getUint32(pos + 4);
      }
      const fps = frames * view.getUint32(timescaleAt) / ticks;
      if (Number.isFinite(fps) && fps > 0) return Math.round(fps * 100) / 100;
    }
    return null;
  }
  return null;
}
function generationMode(job: any) {
  return job.input_video_path ? "automatic" : "manual";
}
function promptInputs(job: any) {
  const manual = generationMode(job) === "manual";
  return [
    { nodeId: "159", fieldName: "switch", fieldValue: manual },
    ...(manual && job.manual_prompt ? [{ nodeId: "115", fieldName: "value", fieldValue: job.manual_prompt }] : []),
  ];
}
async function worker(master: string) {
  const job = await storageRPC(admin, "claim_genjutsu_v3_job", { p_lease: crypto.randomUUID() });
  if (!job) return { ok: true, idle: true };
  let dispatchSent = false;
  try {
    const { request } = await runningHub(master);
    if (!job.task_id) {
      const queue = await settings("production_queue");
      if (queue?.enabled === false) { await patch(job, { status: "queued", ...release }); return { ok: true, paused: true }; }
      const capacity = await request("/openapi/v2/queue/status");
      const limit = Number(capacity.data?.concurrentLimit), active = Number(capacity.data?.totalCurrentTasks);
      if (Number(capacity.code) !== 0 || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(active) || active < 0 || active >= limit) {
        await patch(job, { status: "queued", ...release });
        return { ok: true, waiting: true };
      }
      await validateGraph(request);
      await requireMotionStorage(admin);
      const cfg = await storage();
      if (!await storageRPC(admin, "motion_storage_record_read", { p_count: 2 })) throw new MotionStorageSafetyError("Orçamento de leituras atingido.");
      const [video, image] = await Promise.all([motionObjectURL(cfg, "GET", inputPath(job, "video"), 3600), motionObjectURL(cfg, "GET", inputPath(job, "image"), 3600)]);
      dispatchSent = true;
      const created = await request("/task/openapi/create", { workflowId: WORKFLOW, addMetadata: true, nodeInfoList: [
        { nodeId: "1", fieldName: "video", fieldValue: video },
        { nodeId: "2", fieldName: "image", fieldValue: image },
        { nodeId: "169", fieldName: "output_fps", fieldValue: "30" },
        ...promptInputs(job),
      ] });
      const taskId = String(created.data?.taskId || "");
      if (Number(created.code) !== 0) {
        await patch(job, { status: "failed", error: `RunningHub recusou a geração (código ${Number(created.code) || "desconhecido"}).`, ...release });
        return { ok: false };
      }
      if (!/^\d+$/.test(taskId)) throw new Error("RunningHub não confirmou a tarefa.");
      console.info(JSON.stringify({ event: "genjutsu_v3_created", job: job.id, task: taskId }));
      await patch(job, { status: "running", task_id: taskId, started_at: new Date().toISOString(), error: null, ...release });
      return { ok: true };
    }
    const result = await request("/task/openapi/outputs", { taskId: job.task_id });
    const outputs = { ...job.outputs };
    for (const node of NODES) {
      if (outputs[node] || Number(result.code) !== 0) continue;
      const url = providerOutput(result.data, node);
      if (!url) continue;
      await requireMotionStorage(admin);
      const cfg = await storage();
      const blob = await downloadMp4(url);
      await putMotionPrimary(admin, cfg, outputPath(job, node), blob, "video/mp4");
      outputs[node] = { size: blob.size, fps: await videoFps(blob) };
      await patch(job, { outputs });
    }
    if (NODES.every(node => outputs[node])) {
      const mismatch = NODES.find(node => typeof outputs[node].fps === "number" && Math.abs(outputs[node].fps - (node === "148" ? 24 : 30)) > 0.15);
      await patch(job, { status: "ready", error: mismatch ? `A saída #${mismatch} veio com ${outputs[mismatch].fps} fps.` : null, ...release });
      return { ok: true, ready: true };
    }
    const statusResult = await request("/task/openapi/status", { taskId: job.task_id });
    const state = String(statusResult.data?.taskStatus ?? statusResult.data?.status ?? statusResult.data ?? "").toUpperCase();
    if (["FAILED", "CANCELED", "CANCELLED"].includes(state) ||
        (job.provider_finished_at && Date.now() - Date.parse(job.provider_finished_at) > 4 * 60 * 1000) ||
        Date.now() - Date.parse(job.started_at) > 4 * 60 * 60 * 1000) {
      const missing = NODES.filter(node => !outputs[node]).map(node => `#${node}`).join(" e ");
      await patch(job, { status: "failed", error: `Saída indisponível no RunningHub: ${missing}.`, ...release });
    } else await patch(job, { error: null, provider_finished_at: job.provider_finished_at || (state === "SUCCESS" ? new Date().toISOString() : null), ...release });
    return { ok: true };
  } catch (e) {
    console.error("GENJUTSU V3", job.id, e instanceof Error ? e.name : "unknown");
    const storagePaused = e instanceof MotionStorageSafetyError;
    const timedOut = Date.now() - Date.parse(job.started_at) > 4 * 60 * 60 * 1000;
    await patch(job, {
      status: job.task_id ? (timedOut ? "failed" : "running") : dispatchSent ? "review" : storagePaused ? "queued" : "failed",
      error: dispatchSent ? "O RunningHub não confirmou o envio. Confira a tarefa antes de repetir."
        : storagePaused ? "Aguardando o armazenamento principal."
        : job.task_id ? "Não foi possível recuperar a saída. O Cloudent verifica novamente enquanto a tarefa estiver disponível."
        : "Não foi possível iniciar a geração. Confira a configuração do RunningHub.",
      ...release,
    });
    return { ok: false };
  }
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const url = new URL(req.url), action = url.searchParams.get("action");
  try {
    if (action === "worker" || action === "verify-workflow") {
      const supplied = req.headers.get("x-cloudent-worker-secret");
      if (req.method !== "POST" || !supplied || supplied !== await storageRPC(admin, "get_cloudent_worker_secret")) return reply({ error: "unauthorized" }, 401);
      if (action === "worker") return reply(await worker(supplied));
      return reply(await validateGraph((await runningHub(supplied)).request));
    }
    const owner = await userId(req);
    if (!owner) return reply({ error: "Acesso restrito." }, 403);
    if (action === "list" && req.method === "GET") {
      const { data, error } = await admin.from(table).select("id,status,outputs,error,created_at,updated_at,started_at,input_video_path")
        .eq("user_id", owner).neq("status", "draft").order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return reply({ jobs: (data || []).map(({ input_video_path, ...job }) => ({ ...job, mode: generationMode({ input_video_path }) })) });
    }
    if (action === "ticket" && req.method === "POST") {
      const { video_bytes, image_bytes, video_type, image_type, manual_prompt } = await req.json();
      const prompt = typeof manual_prompt === "string" ? manual_prompt.trim() : "";
      if (!prompt || Array.from(prompt).length > 8000) return reply({ error: "Digite o prompt manual com até 8.000 caracteres." }, 400);
      if (!Number.isSafeInteger(video_bytes) || video_bytes < 1 || video_bytes > 30 * MIB ||
          !Number.isSafeInteger(image_bytes) || image_bytes < 1 || image_bytes > 10 * MIB ||
          !["video/mp4", "video/webm", "video/quicktime"].includes(video_type) ||
          !["image/jpeg", "image/png", "image/webp"].includes(image_type))
        return reply({ error: "Selecione um vídeo de até 30 MiB e uma foto de até 10 MiB." }, 400);
      await requireMotionStorage(admin);
      const cfg = await storage();
      const { data: job, error } = await admin.from(table).insert({ user_id: owner, video_bytes, image_bytes, video_type, image_type, manual_prompt: prompt }).select("*").single();
      if (error) throw error;
      const [video, image] = await Promise.all([motionObjectURL(cfg, "PUT", inputPath(job, "video")), motionObjectURL(cfg, "PUT", inputPath(job, "image"))]);
      return reply({ id: job.id, video, image });
    }
    const id = url.searchParams.get("id") || "";
    if (!uuid.test(id)) return reply({ error: "Job inválido." }, 400);
    const { data: job, error } = await admin.from(table).select("*").eq("id", id).eq("user_id", owner).maybeSingle();
    if (error) throw error;
    if (!job) return reply({ error: "Job não encontrado." }, 404);
    if (action === "submit" && req.method === "POST") {
      if (job.status !== "draft") return reply({ id: job.id, status: job.status });
      const cfg = await storage();
      if (!await motionCheckObject(admin, cfg, inputPath(job, "video"), job.video_bytes) ||
          !await motionCheckObject(admin, cfg, inputPath(job, "image"), job.image_bytes))
        return reply({ error: "O upload ainda não foi confirmado. Tente novamente." }, 409);
      const { error: writeError } = await admin.from(table).update({ status: "queued", updated_at: new Date().toISOString() })
        .eq("id", id).eq("user_id", owner).eq("status", "draft");
      if (writeError) throw writeError;
      return reply({ id, status: "queued" });
    }
    if (action === "input" && req.method === "GET") {
      const kind = url.searchParams.get("kind");
      if (job.status === "draft" || (kind !== "video" && kind !== "image")) return reply({ error: "Arquivo indisponível." }, 404);
      if (!await storageRPC(admin, "motion_storage_record_read", { p_count: 1 })) return reply({ error: "Limite de leitura do armazenamento atingido." }, 503);
      return reply({ url: await motionObjectURL(await storage(), "GET", inputPath(job, kind)), type: kind === "video" ? job.video_type : job.image_type });
    }
    if (["retry", "stop", "delete"].includes(action) && req.method === "POST") {
      const terminal = job.status === "ready" || job.status === "failed";
      const match = (query: any) => query.eq("id", id).eq("user_id", owner).eq("status", job.status).eq("updated_at", job.updated_at);
      const changed = (data: any) => data ? reply({ ok: true }) : reply({ error: "A tarefa mudou. Atualize e tente novamente." }, 409);
      if (action === "delete" && terminal) {
        const { data, error } = await match(admin.from(table).delete()).select("id").maybeSingle();
        if (error) throw error;
        return changed(data);
      }
      if (action === "retry" && terminal) {
        const { data, error } = await match(admin.from(table).update({
          status: "queued", task_id: null, started_at: null, provider_finished_at: null,
          outputs: {}, error: null, ...release, updated_at: new Date().toISOString(),
        })).select("id").maybeSingle();
        if (error) throw error;
        return changed(data);
      }
      if (action === "stop" && job.status === "queued") {
        const { data, error } = await match(admin.from(table).update({
          status: "failed", error: "Produção parada.", updated_at: new Date().toISOString(), ...release,
        })).select("id").maybeSingle();
        if (error) throw error;
        return changed(data);
      }
      if (action === "stop" && job.status === "running") {
        const now = new Date();
        const lease = crypto.randomUUID();
        const { data: locked, error } = await match(admin.from(table).update({
          lease_id: lease, lease_until: new Date(now.getTime() + 60000).toISOString(),
        })).or("lease_id.is.null,lease_until.lt." + now.toISOString()).select("*").maybeSingle();
        if (error) throw error;
        if (!locked) return changed(null);
        try {
          if (locked.task_id) {
            const { request } = await runningHub(await storageRPC(admin, "get_cloudent_worker_secret"));
            const result = await request("/task/openapi/cancel", { taskId: locked.task_id });
            if (Number(result.code) !== 0) return reply({ error: "O RunningHub ainda não confirmou a parada." }, 409);
          }
          await patch(locked, { status: "failed", error: "Produção parada.", ...release });
          return reply({ ok: true });
        } finally {
          const { error: unlockError } = await admin.from(table).update(release).eq("id", id).eq("lease_id", lease);
          if (unlockError) throw unlockError;
        }
      }
      return reply({ error: "Esta ação não está disponível para o estado atual." }, 409);
    }
    if (action === "download" && req.method === "GET") {
      const node = url.searchParams.get("node") || "";
      if (!NODES.some(n => n === node) || !job.outputs?.[node]) return reply({ error: "Vídeo ainda indisponível." }, 404);
      if (!await storageRPC(admin, "motion_storage_record_read", { p_count: 1 })) return reply({ error: "Limite de leitura do armazenamento atingido." }, 503);
      return reply({ url: await motionObjectURL(await storage(), "GET", outputPath(job, node)) });
    }
    return reply({ error: "Operação inválida." }, 404);
  } catch (e) {
    console.error("GENJUTSU V3 request", e instanceof Error ? e.name : "unknown");
    return reply({ error: e instanceof MotionStorageSafetyError ? e.message : "GENJUTSU V3 temporariamente indisponível." }, 503);
  }
});
