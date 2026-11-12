const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jpegLimit = 8 * 1024 * 1024;

export async function instagramFeedApi(req: Request, url: URL, admin: any, userId: string, deps: any) {
  const {json, resolveAccount, storageConfig, sign} = deps;
  const rows = () => admin.from("instagram_feed_posts");
  const columns = "id,scheduled_at,caption,status,last_error,instagram_media_id,platform_account_id";
  if (req.method === "GET") {
    const accountId = await resolveAccount(admin, url.searchParams.get("account"), userId);
    const {data,error} = await rows().select(columns).eq("user_id",userId).eq("platform_account_id",accountId)
      .neq("status","cancelled").gte("scheduled_at",new Date(Date.now()-7*86400000).toISOString())
      .order("scheduled_at").limit(150);
    if (error) throw error;
    return json({posts:data});
  }
  if (req.method !== "POST") return json({error:"method_not_allowed"},405);

  const body = await req.json();
  const id = String(body.id || "");
  if (!uuid.test(id)) return json({error:"feed_post_id_invalid"},400);
  const accountId = await resolveAccount(admin,body.platform_account_id,userId);
  const scoped = (query: any) => query.eq("id",id).eq("user_id",userId).eq("platform_account_id",accountId);
  if (body.operation === "cancel") {
    const {data,error} = await scoped(rows().update({status:"cancelled"}))
      .eq("status","scheduled").is("lock_id",null).select("id").maybeSingle();
    if (error) throw error;
    return data ? json({ok:true}) : json({error:"O post já começou a ser processado ou está indisponível."},409);
  }
  if (!["ticket","schedule"].includes(body.operation)) return json({error:"feed_operation_invalid"},400);
  const at = Date.parse(String(body.scheduled_at || ""));
  const caption = String(body.caption ?? "");
  const sizes = body.photo_sizes;
  if (!Array.isArray(sizes) || sizes.length < 1 || sizes.length > 10 ||
      sizes.some(size => !Number.isSafeInteger(size) || size < 1 || size > jpegLimit) ||
      Array.from(caption).length > 2200) return json({error:"Use de 1 a 10 fotos JPEG de até 8 MB e legenda de até 2.200 caracteres."},400);
  const {data:existing,error:readError} = await scoped(rows().select(columns)).maybeSingle();
  if (readError) throw readError;
  if (existing) return json({post:existing});
  if (!Number.isFinite(at) || at <= Date.now()) return json({error:"Escolha uma data e hora futuras."},400);
  const cfg = await storageConfig(admin);
  if (!cfg) return json({error:"Armazenamento de fotos indisponível."},503);
  const paths = sizes.map((_: number, i: number) => userId+"/instagram-feed/"+id+"/"+(i+1)+".jpg");
  if (body.operation === "ticket") {
    const uploads = await Promise.all(paths.map((path: string) => sign(cfg,"PUT",path,900,"image/jpeg")));
    return json({uploads});
  }
  const verified = await Promise.all(paths.map(async (path: string, i: number) => {
    const response = await fetch(await sign(cfg,"HEAD",path,300),{method:"HEAD",signal:AbortSignal.timeout(10000)});
    return response.ok && Number(response.headers.get("content-length")) === sizes[i] &&
      response.headers.get("content-type")?.split(";")[0] === "image/jpeg";
  }));
  if (verified.some(value => !value)) return json({error:"O armazenamento não confirmou todas as fotos. Tente novamente."},409);
  const {error:saveError} = await rows().upsert({
    id,user_id:userId,platform_account_id:accountId,scheduled_at:new Date(at).toISOString(),
    caption,photo_paths:paths
  },{onConflict:"id",ignoreDuplicates:true});
  if (saveError) throw saveError;
  const {data:post,error} = await scoped(rows().select(columns)).maybeSingle();
  if (error) throw error;
  return post ? json({post},201) : json({error:"Não foi possível confirmar o agendamento."},409);
}
