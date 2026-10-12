const { ensureForYouBrowser } = require('../lib/foryou-browser');

const SUPABASE_URL = 'https://dxrhvudvutmgrmfkmzxo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eu6EGnAw7H-Y5q6w6pmSKQ_88GUR9HI';

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
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
    cache: 'no-store',
  });
  return response.ok;
}

module.exports = async function handler(req, res) {
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
};
