import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { accountAmounts, taskAmounts } from '../_shared/runninghub-points.ts';

const env = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(env, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
const check = (result: any) => { if (result.error) throw new Error('database_unavailable'); return result.data; };
async function authorized(req: Request) {
  const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return false;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return false;
  let claims;
  try { claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return false; }
  if (claims.iss !== env + '/auth/v1' || !/^[a-f0-9-]{36}$/i.test(claims.session_id || '')) return false;
  const [session, member] = await Promise.all([
    admin.rpc('cloudent_auth_session_active', { p_session_id: claims.session_id, p_user_id: data.user.id }),
    admin.from('app_members').select('enabled,role').eq('user_id', data.user.id).maybeSingle(),
  ]);
  return !session.error && !member.error && session.data === true && member.data?.enabled && member.data?.role === 'admin';
}
async function provider() {
  const integration = check(await admin.from('integrations').select('enabled,config').eq('provider', 'runninghub').maybeSingle());
  const cfg = integration?.config;
  if (!integration?.enabled || !cfg?.apiKeyCipher || !cfg?.apiKeyIv) throw new Error('runninghub_unavailable');
  const master = check(await admin.rpc('get_cloudent_worker_secret'));
  const bytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(master)), 'AES-GCM', false, ['decrypt']);
  const apiKey = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(cfg.apiKeyIv) }, key, bytes(cfg.apiKeyCipher)));
  const base = new URL(cfg.baseUrl || 'https://www.runninghub.ai');
  if (base.protocol !== 'https:' || !/(^|\.)runninghub\.(ai|cn)$/.test(base.hostname) || base.username || base.password || base.port) throw new Error('invalid_provider');
  return async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(base.origin + path, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, apikey: apiKey, apiKey }), signal: AbortSignal.timeout(6000), redirect: 'error' });
    if (!response.ok) throw new Error('provider_unavailable');
    return response.json();
  };
}
async function syncBalance(request: any) {
  // CAS lease also throttles refreshes from several tabs/admin sessions.
  const claimed = check(await admin.rpc('claim_runninghub_balance'));
  if (!claimed) return;
  try {
    const result = await request('/uc/openapi/accountStatus', {});
    if (Number(result?.code) !== 0 || !result?.data) throw new Error('provider_unavailable');
    check(await admin.from('runninghub_balance').update({ ...accountAmounts(result.data), fetched_at: new Date().toISOString(), error: null }).eq('id', true));
  } catch {
    check(await admin.from('runninghub_balance').update({ error: 'Saldo não pôde ser atualizado. Última leitura preservada.' }).eq('id', true));
  }
}
async function syncCharges(request: any) {
  // Bounded batch, one provider read per task; no media download or generation.
  const rows = check(await admin.rpc('claim_runninghub_charges')) || [];
  await Promise.allSettled(rows.map(async (row: any) => {
    try {
      const result = taskAmounts(await request('/openapi/v2/query', { taskId: row.task_id }), row.task_id);
      const checked = new Date().toISOString();
      const delay = result?.settled ? 86400000 : row.attempts >= 12 ? 86400000 : 300000;
      check(await admin.from('runninghub_charges').update({ ...(result || {}), checked_at: checked,
        next_check_at: new Date(Date.now() + delay).toISOString() }).eq('task_id', row.task_id).eq('attempts', row.attempts));
    } catch { /* Lease expires. Keep unknown charges unknown and retry later. */ }
  }));
}
async function sync() {
  const request = await provider();
  await Promise.allSettled([syncBalance(request), syncCharges(request)]);
}
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  try {
    const action = new URL(req.url).searchParams.get('action');
    if (action === 'worker') {
      const supplied = req.headers.get('x-cloudent-worker-secret');
      if (req.method !== 'POST' || !supplied || supplied !== check(await admin.rpc('get_cloudent_worker_secret'))) return reply({ error: 'unauthorized' }, 401);
      await sync();
      return reply({ ok: true });
    }
    if (!await authorized(req)) return reply({ error: 'Acesso restrito.' }, 403);
    if (req.method !== 'GET' && !(req.method === 'POST' && action === 'refresh')) return reply({ error: 'invalid_method' }, 405);
    if (req.method === 'POST') {
      const request = await provider();
      await syncBalance(request);
      EdgeRuntime.waitUntil(syncCharges(request));
    }
    const data = check(await admin.rpc('runninghub_points_summary'));
    return reply(data);
  } catch { return reply({ error: 'Não foi possível consultar os pontos. Tente novamente.' }, 503); }
});
