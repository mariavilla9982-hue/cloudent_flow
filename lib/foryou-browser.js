import { Sandbox } from '@vercel/sandbox';

export const SANDBOX_NAME = 'cloudent-foryou-jujuh';
const BROWSER_PORT = 6080;

async function commandOutput(command) {
  if (!command) return '';
  if (typeof command.stdout === 'function') return String(await command.stdout());
  return String(command.stdout || '');
}

export async function ensureForYouBrowser() {
  const box = await Sandbox.get({ name: SANDBOX_NAME, resume: true });

  const command = await box.runCommand('bash', ['-lc', `
set -e
if ! wget -qO- http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  /vercel/foryou-worker/start-browser.sh >/vercel/logs/start-browser.log 2>&1
fi
if ! pgrep -f '^node /vercel/foryou-worker/collector.js$' >/dev/null 2>&1; then
  nohup node /vercel/foryou-worker/collector.js >/vercel/logs/collector.log 2>&1 &
fi
cat /vercel/foryou-worker/setup-token
`]);

  const setupToken = (await commandOutput(command)).trim().split(/\s+/).pop();
  if (!/^[a-f0-9]{24,80}$/i.test(setupToken || '')) throw new Error('browser_setup_token_missing');

  const route = (box.routes || []).find((item) => Number(item.port) === BROWSER_PORT && item.url);
  if (!route?.url) throw new Error('browser_route_missing');

  const base = String(route.url).replace(/\/$/, '');
  return {
    box,
    url: `${base}/setup/${encodeURIComponent(setupToken)}/vnc.html?autoconnect=1&resize=scale&reconnect=1`,
    route: base,
  };
}
