#!/bin/bash
set -eu
export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64
cd /vercel/runninghub-ui
mkdir -p profile/Default
chmod 700 profile
if [ ! -f profile/Default/Preferences ]; then
  printf '%s' '{"credentials_enable_service":false,"profile":{"password_manager_enabled":false}}' > profile/Default/Preferences
fi
if ! pgrep -f '^Xvfb :88 ' >/dev/null; then
  nohup Xvfb :88 -screen 0 1360x900x24 -nolisten tcp >xvfb.log 2>&1 &
fi
if ! curl -fsS http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  rm -f profile/SingletonLock profile/SingletonSocket profile/SingletonCookie
  browser_bin=$(node --input-type=module -e "import {chromium} from 'playwright-core'; process.stdout.write(chromium.executablePath())")
  DISPLAY=:88 nohup "$browser_bin" --disable-dev-shm-usage --no-first-run --no-default-browser-check --password-store=basic --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir=/vercel/runninghub-ui/profile --window-size=1360,900 'https://www.runninghub.ai/pt-br/call-api/bill-task?tab=detail' >chrome.log 2>&1 &
fi
if ! pgrep -f '^x11vnc -display :88 ' >/dev/null; then
  nohup x11vnc -display :88 -localhost -nopw -forever -shared -rfbport 5900 >vnc.log 2>&1 &
fi
if ! pgrep -f 'websockify.*6081' >/dev/null; then
  nohup websockify --web=/usr/share/novnc 127.0.0.1:6081 127.0.0.1:5900 >websockify.log 2>&1 &
fi
if ! curl -fsS http://127.0.0.1:6080/ >/dev/null 2>&1 && ! pgrep -f '^node /vercel/runninghub-ui/gateway.mjs$' >/dev/null; then
  nohup node /vercel/runninghub-ui/gateway.mjs >gateway.log 2>&1 &
fi
for n in $(seq 1 50); do
  if [ -f setup-token ] && curl -fsS http://127.0.0.1:9222/json/version >/dev/null 2>&1; then exit 0; fi
  sleep 0.2
done
exit 1
