export async function publishDueFeedPosts(admin: any, deps: any) {
  const {route, graph, r2Url} = deps;
  const now = new Date().toISOString();
  const posts = () => admin.from("instagram_feed_posts");
  const {data,error} = await posts().select("*").in("status",["scheduled","processing","publishing"])
    .lte("scheduled_at",now).lte("next_attempt_at",now)
    .or("locked_until.is.null,locked_until.lt."+now).order("next_attempt_at").limit(2);
  if (error) throw error;

  await Promise.all((data || []).map(async (post: any) => {
    const lease = crypto.randomUUID();
    const {data:claimed,error:claimError} = await posts().update({
      lock_id:lease,locked_until:new Date(Date.now()+120000).toISOString()
    }).eq("id",post.id).eq("status",post.status).or("locked_until.is.null,locked_until.lt."+now)
      .select("id").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return;

    const save = async (patch: Record<string,unknown>) => {
      const {error} = await posts().update(patch).eq("id",post.id).eq("lock_id",lease).select("id").single();
      if (error) throw error;
    };
    const later = () => new Date(Date.now()+60000).toISOString();
    let publishing = post.status === "publishing";
    try {
      const r = await route(admin,post.platform_account_id);
      const readStatus = (id: string) => graph(r.base,id,r.token,"GET",{fields:"status_code"});
      const create = async (params: Record<string,string>) => {
        const result = await graph(r.base,r.igId+"/media",r.token,"POST",params);
        if (!result.id) throw new Error("O Instagram não confirmou a criação do post.");
        return String(result.id);
      };
      let container = post.container_id;
      if (publishing) {
        const result = await readStatus(container);
        if (result.status_code === "PUBLISHED") await save({status:"published",last_error:null});
        else if (["ERROR","EXPIRED"].includes(result.status_code)) await save({status:"failed",last_error:"O Instagram encerrou o envio sem confirmar a publicação."});
        else await save({next_attempt_at:later(),last_error:"Aguardando confirmação da publicação pelo Instagram."});
        return;
      }
      if (!container) {
        const paths: string[] = post.photo_paths;
        const carousel = paths.length > 1;
        if (carousel && !post.child_ids.length) {
          const ids = await Promise.all(paths.map(async path => create({
            image_url:await r2Url(admin,path,7200),is_carousel_item:"true"
          })));
          await save({status:"processing",child_ids:ids,next_attempt_at:later(),last_error:null});
          return;
        }
        if (carousel) {
          const statuses = await Promise.all(post.child_ids.map(readStatus));
          if (statuses.some(s => ["ERROR","EXPIRED"].includes(s.status_code))) throw new Error("O Instagram recusou uma foto do carrossel.");
          if (statuses.some(s => s.status_code !== "FINISHED")) {
            await save({next_attempt_at:later()});
            return;
          }
        }
        container = await create(carousel
          ? {media_type:"CAROUSEL",children:post.child_ids.join(","),caption:r.captionsPaused?"":post.caption}
          : {image_url:await r2Url(admin,paths[0],7200),caption:r.captionsPaused?"":post.caption});
        await save({status:"processing",container_id:container,caption_suppressed:r.captionsPaused,next_attempt_at:later(),last_error:null});
        return;
      }
      const result = await readStatus(container);
      if (r.captionsPaused && !post.caption_suppressed && ["FINISHED","IN_PROGRESS","ERROR","EXPIRED"].includes(result.status_code)) {
        await save({status:"scheduled",container_id:null,next_attempt_at:later(),last_error:null});
        return;
      }
      if (["ERROR","EXPIRED"].includes(result.status_code)) throw new Error("O Instagram recusou a mídia deste post.");
      if (result.status_code !== "FINISHED") {
        await save({next_attempt_at:later()});
        return;
      }
      await save({status:"publishing",next_attempt_at:later()});
      publishing = true;
      const receipt = await graph(r.base,r.igId+"/media_publish",r.token,"POST",{creation_id:container});
      if (!receipt.id) throw new Error("Recibo de publicação indisponível.");
      await save({status:"published",instagram_media_id:String(receipt.id),last_error:null});
    } catch (e: any) {
      const explicitRejection = e?.payload?.code && e.payload.is_transient !== true;
      await save({
        status:publishing && !explicitRejection ? "publishing" : "failed",
        next_attempt_at:later(),
        last_error:publishing && !explicitRejection
          ? "Aguardando confirmação da publicação pelo Instagram."
          : String(e?.message || "Falha no agendamento.").replace(/https?:\/\/\S+/g,"[URL]").slice(0,400)
      });
    } finally {
      await save({lock_id:null,locked_until:null});
    }
  }));
}
