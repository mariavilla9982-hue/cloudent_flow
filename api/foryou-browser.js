import { ensureForYouBrowser } from '../lib/foryou-browser.js';

import { supabaseConfig } from "../lib/supabase-config.js";
const {url:SUPABASE_URL,key:SUPABASE_KEY}=supabaseConfig();

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function validCloudentUser(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7).trim();
  if (!token) return false;
  const response = await fetch(`${SUPABASE_URL}/functions/v1/cloudent-api?resource=session`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
    cache: 'no-store',
  });
  if(!response.ok)return false;
  const session=await response.json();return session.role==='admin';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });

  try {
    if (!(await validCloudentUser(req))) return send(res, 401, { ok: false, error: 'unauthorized' });
    const browser = await ensureForYouBrowser();
    return send(res, 200, { ok: true, url: browser.url, status: 'browser_ready' });
  } catch (error) {
    console.error('foryou-browser', error);
    return send(res, 500, {
      ok: false,
      error: 'browser_worker_unavailable',
      message: String(error?.message || error).slice(0, 300),
    });
  }
}
