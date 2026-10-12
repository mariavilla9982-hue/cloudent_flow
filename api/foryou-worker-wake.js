const { ensureForYouBrowser } = require('../lib/foryou-browser');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  const secret = String(process.env.CRON_SECRET || '');
  const auth = String(req.headers.authorization || '');
  if (!secret || auth !== `Bearer ${secret}`) return send(res, 401, { ok: false, error: 'unauthorized' });

  try {
    await ensureForYouBrowser();
    return send(res, 200, { ok: true, status: 'browser_awake' });
  } catch (error) {
    console.error('foryou-worker-wake', error);
    return send(res, 500, { ok: false, error: 'wake_failed', message: String(error?.message || error).slice(0, 300) });
  }
};
