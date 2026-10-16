import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function adminFetch(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(500, { error: "server_not_configured" });

  let payload: { email?: string; password?: string; invite_token?: string };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const inviteToken = String(payload.invite_token || "").trim();

  if (!/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: "invalid_email" });
  if (password.length < 8) return json(400, { error: "password_too_short" });
  if (!inviteToken || inviteToken.length < 20) return json(403, { error: "invalid_invite" });

  const tokenHash = await sha256(inviteToken);
  const nowIso = new Date().toISOString();
  const inviteQuery = new URLSearchParams({
    email: `eq.${email}`,
    enabled: "eq.true",
    claimed_by: "is.null",
    signup_token_hash: `eq.${tokenHash}`,
    signup_token_expires_at: `gte.${nowIso}`,
    select: "email,role,workspace_id,signup_token_hash,signup_token_expires_at",
    limit: "1",
  });

  const inviteRes = await adminFetch(`/rest/v1/member_invites?${inviteQuery.toString()}`);
  if (!inviteRes.ok) return json(500, { error: "invite_lookup_failed" });
  const invites = await inviteRes.json();
  const invite = Array.isArray(invites) ? invites[0] : null;
  if (!invite) return json(403, { error: "invite_not_valid" });

  // Public first-access can only create regular members, never administrators.
  if (invite.role !== "x_user") return json(403, { error: "invite_role_not_allowed" });

  const createRes = await adminFetch("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      app_metadata: { cloudent_role: "x_user" },
      user_metadata: { cloudent_role: "x_user" },
    }),
  });

  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !created?.id) {
    const msg = String(created?.msg || created?.message || created?.error || "");
    if (/already|registered|exists/i.test(msg)) return json(409, { error: "account_already_exists" });
    return json(createRes.status >= 400 && createRes.status < 500 ? createRes.status : 500, { error: "account_creation_failed" });
  }

  const userId = String(created.id);
  const memberRes = await adminFetch("/rest/v1/app_members?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ user_id: userId, role: "x_user", workspace_id: invite.workspace_id, enabled: true, updated_at: new Date().toISOString() }),
  });

  if (!memberRes.ok) {
    await adminFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" }).catch(() => {});
    return json(500, { error: "member_assignment_failed" });
  }

  const claimParams = new URLSearchParams({
    email: `eq.${email}`,
    claimed_by: "is.null",
    signup_token_hash: `eq.${tokenHash}`,
  });
  const claimRes = await adminFetch(`/rest/v1/member_invites?${claimParams.toString()}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      claimed_by: userId,
      claimed_at: new Date().toISOString(),
      signup_token_hash: null,
      signup_token_expires_at: null,
      updated_at: new Date().toISOString(),
    }),
  });
  const claimedRows = await claimRes.json().catch(() => []);

  if (!claimRes.ok || !Array.isArray(claimedRows) || claimedRows.length !== 1) {
    await adminFetch(`/rest/v1/app_members?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" }).catch(() => {});
    await adminFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" }).catch(() => {});
    return json(409, { error: "invite_already_used" });
  }

  return json(201, { ok: true, role: "x_user", workspace_id: invite.workspace_id });
});
