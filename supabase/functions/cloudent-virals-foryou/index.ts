import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

function saoPauloDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function cleanItem(row: any) {
  const shortcode = String(row?.shortcode || row?.code || "").trim();
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(shortcode)) return null;
  const views = Math.max(0, Number(row?.views || row?.play_count || 0) || 0);
  return {
    shortcode,
    permalink: String(row?.permalink || `https://www.instagram.com/reel/${shortcode}/`).slice(0, 1000),
    cover_url: String(row?.cover_url || row?.thumbnail || "").slice(0, 3000) || null,
    caption: String(row?.caption || "").slice(0, 5000) || null,
    views: Math.trunc(views),
    likes: Math.max(0, Math.trunc(Number(row?.likes || 0) || 0)),
    comments: Math.max(0, Math.trunc(Number(row?.comments || 0) || 0)),
    published_at: row?.published_at || null,
    raw: typeof row === "object" && row ? row : {},
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const authHeader = req.headers.get("Authorization") || "";
    if (!url || !anon || !service) return json({ ok: false, error: "server_not_configured" }, 500);
    if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);

    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData?.user) return json({ ok: false, error: "unauthorized" }, 401);

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const {data:accessMember,error:accessError}=await admin.from("app_members").select("role,enabled").eq("user_id",userData.user.id).maybeSingle();
    if(accessError||!accessMember?.enabled||accessMember.role!=="admin")return json({error:"forbidden"},403);
    const { data: account, error: accountError } = await admin
      .from("platform_accounts")
      .select("id, account_label, config, enabled")
      .eq("platform", "instagram")
      .ilike("account_label", "jujuhmartinss")
      .eq("enabled", true)
      .maybeSingle();

    if (accountError) throw accountError;
    if (!account) return json({ ok: false, error: "jujuh_account_not_found", message: "A conta Jujuh não está conectada no CloudentFlow." }, 404);

    let { data: settings, error: settingsError } = await admin
      .from("viral_foryou_settings")
      .select("*")
      .eq("source_account_id", account.id)
      .maybeSingle();
    if (settingsError) throw settingsError;

    if (!settings) {
      const created = await admin.from("viral_foryou_settings").insert({
        source_account_id: account.id,
        daily_target: 5,
        min_views: 400000,
        enabled: false,
        collector_status: "needs_browser_session",
      }).select("*").single();
      if (created.error) throw created.error;
      settings = created.data;
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const action = String(body?.action || "settings");

      if (action === "settings") {
        const dailyTarget = Number(body?.daily_target) === 10 ? 10 : 5;
        const enabled = body?.enabled === true;
        const updated = await admin.from("viral_foryou_settings").update({
          daily_target: dailyTarget,
          min_views: 400000,
          enabled,
          updated_at: new Date().toISOString(),
        }).eq("source_account_id", account.id).select("*").single();
        if (updated.error) throw updated.error;
        settings = updated.data;
      } else if (action === "collector_status") {
        const allowed = new Set(["needs_browser_session", "ready", "running", "error", "paused"]);
        const collectorStatus = allowed.has(String(body?.status)) ? String(body.status) : "error";
        const updated = await admin.from("viral_foryou_settings").update({
          collector_status: collectorStatus,
          last_error: body?.error ? String(body.error).slice(0, 1000) : null,
          last_collected_at: collectorStatus === "ready" ? new Date().toISOString() : settings.last_collected_at,
          updated_at: new Date().toISOString(),
        }).eq("source_account_id", account.id).select("*").single();
        if (updated.error) throw updated.error;
        settings = updated.data;
      } else if (action === "ingest") {
        const input = Array.isArray(body?.items) ? body.items : [];
        const minViews = Math.max(400000, Number(settings.min_views || 400000));
        const dailyTarget = Number(settings.daily_target || 5) === 10 ? 10 : 5;
        const cleaned = input.map(cleanItem).filter(Boolean).filter((x: any) => x.views >= minViews)
          .sort((a: any, b: any) => b.views - a.views);
        const unique: any[] = [];
        const seen = new Set<string>();
        for (const item of cleaned) {
          if (seen.has(item.shortcode)) continue;
          seen.add(item.shortcode);
          unique.push(item);
          if (unique.length >= dailyTarget) break;
        }
        const day = saoPauloDay();
        if (unique.length) {
          const payload = unique.map((item: any) => ({
            ...item,
            source_account_id: account.id,
            collected_day: day,
            collected_at: new Date().toISOString(),
            source: "instagram_foryou",
          }));
          const upsert = await admin.from("viral_foryou_items").upsert(payload, { onConflict: "source_account_id,shortcode" });
          if (upsert.error) throw upsert.error;
        }
        const updated = await admin.from("viral_foryou_settings").update({
          collector_status: "ready",
          last_collected_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq("source_account_id", account.id).select("*").single();
        if (updated.error) throw updated.error;
        settings = updated.data;
      } else {
        return json({ ok: false, error: "unknown_action" }, 400);
      }
    }

    const day = saoPauloDay();
    const { data: items, error: itemsError } = await admin
      .from("viral_foryou_items")
      .select("id, shortcode, permalink, cover_url, caption, views, likes, comments, published_at, collected_at, collected_day")
      .eq("source_account_id", account.id)
      .eq("collected_day", day)
      .gte("views", Number(settings.min_views || 400000))
      .order("views", { ascending: false })
      .limit(Number(settings.daily_target || 5) === 10 ? 10 : 5);
    if (itemsError) throw itemsError;

    return json({
      ok: true,
      source: {
        platform_account_id: account.id,
        username: account.account_label,
        profile_picture_url: account?.config?.profile_picture_url || "",
      },
      settings: {
        daily_target: Number(settings.daily_target || 5) === 10 ? 10 : 5,
        min_views: 400000,
        enabled: Boolean(settings.enabled),
        collector_status: settings.collector_status || "needs_browser_session",
        last_collected_at: settings.last_collected_at || null,
        last_error: settings.last_error || null,
      },
      today: day,
      items: items || [],
      count: (items || []).length,
      remaining: Math.max(0, (Number(settings.daily_target || 5) === 10 ? 10 : 5) - (items || []).length),
      collector_requires_browser_session: true,
    });
  } catch (error) {
    console.error("cloudent-virals-foryou", error);
    return json({ ok: false, error: "foryou_failed", message: String(error?.message || error).slice(0, 500) }, 500);
  }
});
