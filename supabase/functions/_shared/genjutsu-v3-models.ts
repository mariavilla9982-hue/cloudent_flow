export const GENJUTSU_MODELS = [
  { key: "jujuh", name: "Jujuh", tag: "JUJUH" },
  { key: "sahry_japah", name: "Sahry Japah", tag: "SAHRY JAPAH" },
] as const;
const MIB = 1024 * 1024;
const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const videoTypes = ["video/mp4", "video/webm", "video/quicktime"];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const check = (result: any) => { if (result.error) throw result.error; return result.data; };
export async function genjutsuModelsApi(deps: any) {
  const { admin, owner, action, req, reply, storage, sign, verify, guard } = deps;
  if (!["models", "model-ticket", "model-save", "direct-ticket", "model-import"].includes(action)) return null;
  if (action === "models" && req.method === "GET") {
    const rows = check(await admin.from("genjutsu_v3_models").select("*").eq("user_id", owner)) || [];
    const cfg = await storage();
    const models = await Promise.all(GENJUTSU_MODELS.map(async model => {
      const row = rows.find((r: any) => r.model_key === model.key);
      const photo = row?.photo_id ? check(await admin.from("genjutsu_v3_model_photos").select("*")
        .eq("id", row.photo_id).eq("user_id", owner).single()) : null;
      return { ...model, photo_id: photo?.id || null, platform_account_id: row?.platform_account_id || null,
        photo_url: photo ? await sign(cfg, "GET", photo.storage_path) : null };
    }));
    return reply({ models, can_edit: true });
  }
  if (req.method !== "POST") return reply({ error: "Método inválido." }, 405);
  const body = await req.json();
  const model = GENJUTSU_MODELS.find(m => m.key === body.model_key);
  if (!model) return reply({ error: "Modelo inválida." }, 400);
  const current = check(await admin.from("genjutsu_v3_models").select("*").eq("user_id", owner).eq("model_key", model.key).maybeSingle());
  if (action === "model-ticket" || action === "model-import") {
    const size = body.size_bytes, mime = body.mime_type;
    if (!Number.isSafeInteger(size) || size < 1 || size > 10 * MIB || !imageTypes.includes(mime))
      return reply({ error: "Selecione JPG, PNG ou WebP de até 10 MiB." }, 400);
    if (!uuid.test(body.id || "")) return reply({ error: "Identificador de foto inválido." }, 400);
    await guard();
    const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const path = `${owner}/genjutsu-v3/models/${model.key}/${body.id}.${extension}`;
    const photo = { id: body.id, user_id: owner, model_key: model.key, storage_path: path, mime_type: mime, size_bytes: size };
    check(await admin.from("genjutsu_v3_model_photos").upsert(photo, { onConflict: "id", ignoreDuplicates: true }));
    const saved = check(await admin.from("genjutsu_v3_model_photos").select("*").eq("id", body.id).eq("user_id", owner).single());
    if (saved.storage_path !== path || saved.mime_type !== mime || saved.size_bytes !== size)
      return reply({ error: "Este envio já está associado a outra foto." }, 409);
    // Once active or pinned to a job, an immutable photo never receives another write URL.
    const pinned = check(await admin.from("genjutsu_v3_jobs").select("id").eq("model_photo_id", body.id).limit(1));
    if (pinned?.length || current?.photo_id === body.id) return reply({ error: "Foto já cadastrada. Use um novo envio para substituí-la." }, 409);
    const cfg = await storage();
    if (action === "model-import") {
      if (typeof body.image_base64 !== "string" || body.image_base64.length > 14 * MIB)
        return reply({ error: "Imagem inválida." }, 400);
      const bytes = Uint8Array.from(atob(body.image_base64), c => c.charCodeAt(0));
      if (bytes.length !== size) return reply({ error: "Tamanho da imagem inválido." }, 400);
      await deps.put(cfg, path, new Blob([bytes], { type: mime }), mime);
      const activated = check(await admin.rpc("activate_genjutsu_v3_photo", {
        p_owner: owner, p_model: model.key, p_photo: body.id, p_previous: body.previous_photo_id || null,
      }));
      return reply({ ok: activated, photo_id: body.id }, activated ? 200 : 409);
    }
    return reply({ id: body.id, upload: await sign(cfg, "PUT", path), previous_photo_id: current?.photo_id || null });
  }
  if (action === "model-save") {
    if (!uuid.test(body.id || "")) return reply({ error: "Foto inválida." }, 400);
    const photo = check(await admin.from("genjutsu_v3_model_photos").select("*").eq("id", body.id).eq("user_id", owner).eq("model_key", model.key).maybeSingle());
    if (!photo) return reply({ error: "Foto não encontrada." }, 404);
    if (!await verify(await storage(), photo.storage_path, photo.size_bytes)) return reply({ error: "Envio da foto ainda não confirmado." }, 409);
    const ok = check(await admin.rpc("activate_genjutsu_v3_photo", {
      p_owner: owner, p_model: model.key, p_photo: photo.id, p_previous: body.previous_photo_id || null,
    }));
    return reply(ok ? { ok: true } : { error: "A foto foi alterada em outra sessão. Atualize antes de substituir." }, ok ? 200 : 409);
  }
  const { id, video_bytes, video_type } = body;
  if (!uuid.test(id || "") || !Number.isSafeInteger(video_bytes) || video_bytes < 1 || video_bytes > 30 * MIB || !videoTypes.includes(video_type))
    return reply({ error: "Selecione MP4, MOV ou WebM de até 30 MiB." }, 400);
  let job = check(await admin.from("genjutsu_v3_jobs").select("*").eq("id", id).eq("user_id", owner).maybeSingle());
  if (!job) {
    if (!current?.photo_id) return reply({ error: "Cadastre a foto fixa desta modelo antes de enviar." }, 409);
    if (body.photo_id !== current.photo_id) return reply({ error: "A foto da modelo mudou. Atualize a confirmação do envio." }, 409);
    const photo = check(await admin.from("genjutsu_v3_model_photos").select("*").eq("id", current.photo_id).eq("user_id", owner).single());
    await guard();
    check(await admin.from("genjutsu_v3_jobs").upsert({ id, user_id: owner, video_bytes, video_type,
      image_bytes: photo.size_bytes, image_type: photo.mime_type, input_image_path: photo.storage_path,
      model_key: model.key, model_photo_id: photo.id, model_tag: model.tag,
      source_file_name: String(body.file_name || "Vídeo").slice(0, 255),
    }, { onConflict: "id", ignoreDuplicates: true }));
    job = check(await admin.from("genjutsu_v3_jobs").select("*").eq("id", id).eq("user_id", owner).single());
  }
  if (job.model_key !== model.key || job.video_bytes !== video_bytes || job.video_type !== video_type || job.model_photo_id !== body.photo_id)
    return reply({ error: "Este envio já possui outros arquivos ou modelo. Inicie um novo envio." }, 409);
  if (job.status !== "draft") return reply({ id, status: job.status });
  const cfg = await storage();
  const uploaded = await verify(cfg, deps.inputPath(job, "video"), job.video_bytes);
  return reply({ id, status: "draft", video_uploaded: uploaded,
    video: uploaded ? null : await sign(cfg, "PUT", deps.inputPath(job, "video")), photo_id: job.model_photo_id, tag: job.model_tag });
}
