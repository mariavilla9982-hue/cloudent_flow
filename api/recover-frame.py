# Incident-scoped repair: private worker header is verified by the Edge helper.
import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler
import imageio_ffmpeg
import requests
EDGE = 'https://iubzjfidmxfjvvonusos.supabase.co/functions/v1/cloudent-recover-upload-20261118'
class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        secret = self.headers.get('x-cloudent-worker-secret', '')
        if not secret:
            self.send_response(401); self.end_headers(); return
        headers = {'x-cloudent-worker-secret': secret}
        try:
            ticket = requests.post(EDGE, headers=headers, json={'op': 'frame-ticket'}, timeout=15)
            if ticket.status_code != 200:
                self.send_response(403); self.end_headers(); return
            urls = ticket.json()
            with tempfile.TemporaryDirectory() as tmp:
                video, frame = os.path.join(tmp, 'original.mp4'), os.path.join(tmp, 'first.jpg')
                source = requests.get(urls['source'], stream=True, timeout=15)
                source.raise_for_status()
                total = 0
                with open(video, 'wb') as output:
                    for chunk in source.iter_content(65536):
                        total += len(chunk)
                        if total > 5 * 1024 * 1024:
                            raise ValueError('size_limit')
                        output.write(chunk)
                subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-i', video, '-frames:v', '1', '-q:v', '2', frame], check=True, timeout=20, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                with open(frame, 'rb') as image:
                    put = requests.put(urls['target'], data=image, headers={'Content-Type': 'image/jpeg'}, timeout=15)
                put.raise_for_status()
                result = requests.post(EDGE, headers=headers, json={'op': 'frame-complete', 'size': os.path.getsize(frame)}, timeout=15)
                result.raise_for_status()
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b'{"ok":true,"frame_recovered":true}')
        except Exception:
            self.send_response(503); self.end_headers(); self.wfile.write(b'{"error":"frame_recovery_incomplete"}')
    def log_message(self, *_args):
        pass
