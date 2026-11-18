"""One explicitly authorized Reel test; never runs the calendar automatically."""
import base64
import contextlib
import io
import json
import logging
import hmac
import os
import re
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

import requests
from Cryptodome.Cipher import AES

USERNAME = 'sahryjapah'
ORIGIN = 'https://cloudent-flow.vercel.app'


class PilotError(Exception):
    def __init__(self, code, status=400):
        self.code, self.status = code, status


def config():
    ref = os.environ.get('SUPABASE_PROJECT_REF', '')
    url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_PUBLISHABLE_KEY', '')
    if url != f'https://{ref}.supabase.co' or not key.startswith('sb_publishable_'):
        raise PilotError('configuration_unavailable', 503)
    return url, key


def backend(token, path, body=None):
    url, key = config()
    response = requests.request('GET' if body is None else 'POST', url + path,
        headers={'Authorization': 'Bearer ' + token, 'apikey': key}, json=body, timeout=20)
    if not response.ok:
        # Do not echo provider bodies, signed URLs, credentials, or database errors.
        raise PilotError('backend_rejected' if response.status_code != 401 else 'login_cloudent_required', response.status_code if response.status_code in (401,403,409) else 409)
    return response.json()


def control(token, action, payload=None):
    return backend(token, '/rest/v1/rpc/instagram_private_pilot_control', {'p_action': action, 'p_payload': payload or {}})


def cipher_key():
    try:
        key = base64.urlsafe_b64decode(os.environ.get('INSTAGRAM_PILOT_KEY', ''))
        if len(key) != 32:
            raise ValueError()
        return key
    except Exception:
        raise PilotError('configuration_unavailable', 503)


def seal(settings, user_id):
    cipher = AES.new(cipher_key(), AES.MODE_GCM)
    cipher.update(('cloudent-pilot:' + user_id).encode())
    data, tag = cipher.encrypt_and_digest(json.dumps(settings).encode())
    return base64.urlsafe_b64encode(cipher.nonce + tag + data).decode()


def unseal(value, user_id):
    if not value:
        return {}
    raw = base64.urlsafe_b64decode(value)
    cipher = AES.new(cipher_key(), AES.MODE_GCM, nonce=raw[:16])
    cipher.update(('cloudent-pilot:' + user_id).encode())
    return json.loads(cipher.decrypt_and_verify(raw[32:], raw[16:32]))


def instagram(settings=None):
    from instagrapi import Client
    client = Client()
    client.logger = logging.getLogger('cloudent.pilot.silent')
    client.logger.disabled = True
    client.private_request_logger = client.logger
    client.request_timeout = 20
    if settings:
        settings = dict(settings)
        client.cloudent_pending = settings.pop('_cloudent_pending', None)
        client.set_settings(settings)
    return client


def challenge_state(client):
    """Keep the actual response encrypted, rather than losing the checkpoint."""
    settings = client.get_settings()
    raw = getattr(client, 'last_json', None)
    if isinstance(raw, dict) and len(json.dumps(raw).encode()) <= 40000:
        settings['_cloudent_pending'] = {'created_at':time.time(), 'last_json':raw}
    return settings


def challenge_hint(raw):
    """Only a labelled value from Instagram may be shown. Never guess from choices."""
    numbers = set()
    def walk(value, depth=0):
        if depth > 10:
            return
        if isinstance(value, dict):
            for key, item in value.items():
                if key in ('matching_number','number_matching_code','challenge_number') and re.fullmatch(r'\d{1,2}',str(item)):
                    numbers.add(str(item))
                elif key in ('title','text','description') and isinstance(item,str):
                    # Accept an explicit human-readable instruction, not arbitrary digits.
                    match = re.search(r'\b(?:tap|select|choose|toque|selecione|escolha)\s+(?:the\s+)?(?:number|número)\s*[:#]?\s*(\d{1,2})\b',item,re.I)
                    if match:
                        numbers.add(match.group(1))
                elif isinstance(item,(dict,list)):
                    walk(item,depth+1)
        elif isinstance(value,list):
            for item in value[:100]:
                walk(item,depth+1)
    walk(raw)
    # Supported upstream continuation; do not invent a native approval endpoint.
    resumable = isinstance(raw,dict) and raw.get('bloks_action') == 'com.bloks.www.ig.challenge.redirect.async' and bool(raw.get('challenge_context'))
    return {'matching_number':next(iter(numbers)) if len(numbers)==1 else None, 'can_resume':bool(resumable)}


def error_code(error):
    name = type(error).__name__
    if name == 'TwoFactorRequired':
        return 'two_factor_required'
    if name in ('ChallengeRequired','ChallengeUnknownStep','ChallengeRedirection','ChallengeSelfieCaptcha','RecaptchaChallengeForm'):
        return 'instagram_verification_required'
    if name in ('BadPassword','InvalidCredentials'):
        return 'bad_credentials'
    if name in ('PleaseWaitFewMinutes','ClientThrottledError','RateLimitError','FeedbackRequired'):
        return 'instagram_rate_limited'
    if name in ('LoginRequired','ClientLoginRequired'):
        return 'instagram_login_required'
    return 'instagram_request_failed'


def login(token, user_id, body):
    password = body.get('password')
    code = str(body.get('verification_code') or '').strip()
    resume = body.get('action') == 'resume'
    if (not resume and (not isinstance(password, str) or not 1 <= len(password) <= 512)) or len(code) > 16:
        raise PilotError('credentials_required')
    cipher_key()  # Fail before contacting Instagram if persistence is unavailable.
    claim = control(token, 'login_claim')
    client = None
    try:
        client = instagram(unseal(claim.get('settings_cipher'), user_id))
        # Library logs can contain private response data; never forward them.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            if resume:
                pending = getattr(client,'cloudent_pending',None) or {}
                raw = pending.get('last_json')
                if time.time()-pending.get('created_at',0)>600 or not challenge_hint(raw)['can_resume']:
                    raise PilotError('challenge_not_resumable')
                client.username = USERNAME
                client.last_json = raw
                client.challenge_bloks_redirect_dismiss()
            else:
                client.login(USERNAME, password, verification_code=code)
            profile = client.account_info()
        if str(profile.username).lower() != USERNAME:
            raise PilotError('instagram_account_mismatch', 409)
        control(token, 'login_finish', {'lease':claim['lease'], 'phase':'connected', 'settings_cipher':seal(client.get_settings(), user_id)})
        return {'ok':True, 'phase':'connected', 'username':USERNAME}
    except Exception as error:
        err = error.code if isinstance(error, PilotError) else error_code(error)
        phase = 'two_factor' if err == 'two_factor_required' else 'blocked'
        hint = challenge_hint(getattr(client,'last_json',None)) if client else {}
        control(token, 'login_finish', {'lease':claim['lease'], 'phase':phase, 'error_code':err,
            'settings_cipher':seal(challenge_state(client), user_id) if client else None})
        return {'ok':False, 'phase':phase, 'error_code':err, 'challenge':hint}


def download_video(url, target):
    host = urlparse(url).hostname or ''
    if urlparse(url).scheme != 'https' or not host.endswith('.r2.cloudflarestorage.com'):
        raise PilotError('media_source_unavailable')
    with requests.get(url, stream=True, timeout=30, allow_redirects=False) as response:
        if response.status_code != 200:
            raise PilotError('media_source_unavailable')
        total = 0
        with target.open('wb') as output:
            for chunk in response.iter_content(262144):
                total += len(chunk)
                if total > 50_000_000:
                    raise PilotError('media_too_large')
                output.write(chunk)
    with target.open('rb') as source:
        header = source.read(32)
    if b'ftyp' not in header:
        raise PilotError('invalid_video')


def publish(token, user_id, body):
    if body.get('confirm_username') != USERNAME:
        raise PilotError('confirmation_required')
    claim = control(token, 'publish_claim')  # Atomic, durable, never auto-released.
    try:
        client = instagram(unseal(claim['settings_cipher'], user_id))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            profile = client.account_info()
        if str(profile.username).lower() != USERNAME:
            raise PilotError('instagram_account_mismatch')
        signed = backend(token, '/functions/v1/cloudent-api?resource=media-url&entity=video&id=' + claim['video_id'])
        with tempfile.TemporaryDirectory(prefix='cloudent-pilot-') as folder:
            path = Path(folder) / 'reel.mp4'
            cover = Path(folder) / 'cover.jpg'
            download_video(signed['url'], path)
            import imageio_ffmpeg
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin','-v','error','-ss','0','-i',str(path),'-frames:v','1','-vf','scale=540:-2',str(cover)],
                check=True, capture_output=True, timeout=30)
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                media = client.clip_upload(path, caption='', thumbnail=cover)
                receipt = client.media_info(media.pk)
            if str(receipt.user.username).lower() != USERNAME or str(receipt.pk) != str(media.pk) or not receipt.code:
                raise PilotError('receipt_uncertain')
            result = {'lease':claim['lease'], 'media_id':str(receipt.pk), 'code':receipt.code}
            control(token, 'publish_finish', result)
            return {'ok':True, 'phase':'published', 'permalink':'https://www.instagram.com/reel/' + receipt.code + '/'}
    except Exception as error:
        # An upload may have succeeded before a timeout. Never retry automatically.
        err = error.code if isinstance(error, PilotError) else error_code(error)
        control(token, 'publish_finish', {'lease':claim['lease'], 'error_code':err})
        return {'ok':False, 'phase':'uncertain', 'error_code':err}


def dispatch(headers, body):
    if body.get('action') == 'inspect_saved':
        # Temporary, expiring diagnostic. It cannot log in, approve, or publish.
        expected, _, until = os.environ.get('INSTAGRAM_PILOT_INSPECT', '').partition(':')
        supplied = headers.get('Authorization', '').removeprefix('Bearer ')
        if not expected or not until.isdigit() or time.time()>int(until) or not hmac.compare_digest(expected,supplied):
            raise PilotError('diagnostic_disabled',410)
        owner = '8ab89cf8-699e-4ae8-833f-1f215f1d4d69'
        saved = unseal(str(body.get('settings_cipher','')),owner)
        pending = saved.get('_cloudent_pending') or {}
        raw = pending.get('last_json') or {}
        client = None
        if body.get('read_checkpoint') is True:
            challenge = raw.get('challenge') or {}
            path = challenge.get('api_path','')
            if not re.fullmatch(r'/challenge/[0-9]+/[A-Za-z0-9_-]+/?',path):
                raise PilotError('unsupported_checkpoint_read')
            client = instagram(saved)
            with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
                try:
                    client._send_private_request(path.lstrip('/'),params={'guid':client.uuid,'device_id':client.android_device_id})
                except Exception:
                    pass
            raw = getattr(client,'last_json',{})
        def shape(value,depth=0):
            if depth>5:return type(value).__name__
            if isinstance(value,dict):return {str(k)[:80]:shape(v,depth+1) for k,v in list(value.items())[:70]}
            if isinstance(value,list):return [shape(v,depth+1) for v in value[:3]]
            return type(value).__name__
        safe = {k:raw[k] for k in ('step_name','bloks_action','challenge_type_enum_str','action','type','status')
            if isinstance(raw.get(k),str) and re.fullmatch(r'[A-Za-z0-9_. -]{1,120}',raw[k])}
        return {'has_pending':bool(pending),'age_seconds':int(time.time()-pending.get('created_at',0)),
            'shape':shape(raw),'safe':safe,'hint':challenge_hint(raw)}
    if headers.get('Origin') not in (None, ORIGIN):
        raise PilotError('origin_rejected', 403)
    token = headers.get('Authorization', '')
    if not token.startswith('Bearer '):
        raise PilotError('login_cloudent_required', 401)
    token = token[7:]
    session = backend(token, '/functions/v1/cloudent-api?resource=session')
    if session.get('role') != 'admin' or not session.get('user_id'):
        raise PilotError('admin_required', 403)
    action = body.get('action')
    if action == 'status':
        return control(token, 'status')
    if action in ('login','resume'):
        return login(token, session['user_id'], body)
    if action == 'publish':
        return publish(token, session['user_id'], body)
    raise PilotError('invalid_action')


class handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 4096 or not self.headers.get('Content-Type','').startswith('application/json'):
                raise PilotError('invalid_request')
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise PilotError('invalid_request')
            data, status = dispatch(self.headers, body), 200
        except PilotError as error:
            data, status = {'ok':False,'error_code':error.code}, error.status
        except Exception:
            data, status = {'ok':False,'error_code':'request_unavailable'}, 503
        output = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(len(output)))
        self.end_headers()
        self.wfile.write(output)
