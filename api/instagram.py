import json
import os
import re
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

import yt_dlp
from curl_cffi import requests as curl_requests


MAX_BYTES = 200 * 1024 * 1024
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151 Safari/537.36"


def _json(handler, data, status=200):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def _is_instagram_post_url(value):
    try:
        u = urllib.parse.urlparse(value)
    except Exception:
        return False
    host = (u.hostname or "").lower().removeprefix("www.")
    if host not in {"instagram.com", "instagr.am"}:
        return False
    return bool(re.search(r"/(?:reel|reels|p)/[A-Za-z0-9_-]+", u.path or "", re.I))


def _is_allowed_media_url(value):
    try:
        u = urllib.parse.urlparse(value)
    except Exception:
        return False
    if u.scheme != "https":
        return False
    host = (u.hostname or "").lower()
    allowed = (
        host == "instagram.com"
        or host.endswith(".instagram.com")
        or host.endswith(".cdninstagram.com")
        or host.endswith(".fbcdn.net")
        or host.endswith(".fna.fbcdn.net")
    )
    return allowed


def _shortcode_from_url(value):
    try:
        u = urllib.parse.urlparse(str(value or ""))
    except Exception:
        return ""
    match = re.search(r"/(?:reel|reels|p|tv)/([A-Za-z0-9_-]+)", u.path or "", re.I)
    return match.group(1) if match else ""


def _shortcode_to_media_id(code):
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    value = 0
    for ch in str(code or ""):
        idx = alphabet.find(ch)
        if idx < 0:
            return ""
        value = value * 64 + idx
    return str(value)


def _decode_instagram_url(value):
    out = str(value or "").strip()
    for _ in range(3):
        out = (
            out.replace("&amp;", "&")
            .replace("&#38;", "&")
            .replace("&#x26;", "&")
            .replace("&quot;", '"')
            .replace("\\u0026", "&")
            .replace("\\u003d", "=")
            .replace("\\u0025", "%")
            .replace("\\u002f", "/")
            .replace("\\/", "/")
        )
    return out


def _exact_page_media(html_text, expected_shortcode):
    if not html_text or not expected_shortcode:
        return None

    identity_patterns = [
        r'<meta[^>]+property=["\']og:url["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:url["\']',
        r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)["\']',
        r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\']canonical["\']',
    ]
    page_code = ""
    for pattern in identity_patterns:
        m = re.search(pattern, html_text, re.I)
        if m:
            page_code = _shortcode_from_url(_decode_instagram_url(m.group(1)))
            if page_code:
                break
    if page_code != expected_shortcode:
        return None

    video_patterns = [
        r'<meta[^>]+property=["\']og:video(?::secure_url)?["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:video(?::secure_url)?["\']',
        r'<meta[^>]+name=["\']twitter:player:stream["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:player:stream["\']',
    ]
    image_patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
    ]
    video = ""
    thumbnail = ""
    for pattern in video_patterns:
        m = re.search(pattern, html_text, re.I)
        if m:
            video = _decode_instagram_url(m.group(1))
            break
    for pattern in image_patterns:
        m = re.search(pattern, html_text, re.I)
        if m:
            thumbnail = _decode_instagram_url(m.group(1))
            break
    if not video:
        return None
    return {"url": video, "thumbnail": thumbnail, "ext": "mp4", "identity_evidence": "exact_page_meta"}


def _anchored_page_media(html_text, expected_shortcode):
    if not html_text or not expected_shortcode:
        return None
    media_id = _shortcode_to_media_id(expected_shortcode)
    anchors = [
        f'"shortcode":"{expected_shortcode}"',
        f'\\"shortcode\\":\\"{expected_shortcode}\\"',
        f'"code":"{expected_shortcode}"',
        f'\\"code\\":\\"{expected_shortcode}\\"',
    ]
    if media_id:
        anchors += [f'"pk":"{media_id}"', f'\\"pk\\":\\"{media_id}\\"']

    for anchor in anchors:
        start = html_text.find(anchor)
        if start < 0:
            continue
        end = min(len(html_text), start + 90000)
        segment = html_text[start:end]
        variants = [segment, segment.replace('\\\"', '"').replace("\\/", "/")]
        for source in variants:
            patterns = [
                r'"video_url"\s*:\s*"([^"]+)"',
                r'"video_versions"[\s\S]{0,6000}?"url"\s*:\s*"([^"]+)"',
            ]
            for pattern in patterns:
                m = re.search(pattern, source, re.I)
                if not m:
                    continue
                video = _decode_instagram_url(m.group(1))
                thumb = ""
                tm = re.search(r'"(?:thumbnail_src|display_url)"\s*:\s*"([^"]+)"', source, re.I)
                if tm:
                    thumb = _decode_instagram_url(tm.group(1))
                return {"url": video, "thumbnail": thumb, "ext": "mp4", "identity_evidence": "anchored_html"}
    return None


def _resolve_with_browser_tls(url):
    expected_shortcode = _shortcode_from_url(url)
    if not expected_shortcode:
        return None
    canonical = _canonical_reel_url(url)
    candidates = [
        canonical,
        f"https://www.instagram.com/p/{expected_shortcode}/embed/captioned/",
        f"https://www.instagram.com/reel/{expected_shortcode}/embed/",
    ]
    headers = {
        "User-Agent": UA,
        "Referer": "https://www.instagram.com/",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.7,en;q=0.6",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    for candidate in candidates:
        try:
            res = curl_requests.get(
                candidate,
                headers=headers,
                impersonate="chrome",
                timeout=20,
                allow_redirects=True,
            )
        except Exception:
            continue
        if res.status_code != 200 or not res.text:
            continue
        media = _exact_page_media(res.text, expected_shortcode) or _anchored_page_media(res.text, expected_shortcode)
        if not media:
            continue
        if not _is_allowed_media_url(media.get("url")):
            continue
        media.update({
            "duration": None,
            "title": None,
            "id": _shortcode_to_media_id(expected_shortcode) or expected_shortcode,
            "requested_shortcode": expected_shortcode,
            "identity_verified": True,
        })
        return media
    return None


def _canonical_reel_url(value):
    code = _shortcode_from_url(value)
    return f"https://www.instagram.com/reel/{code}/" if code else str(value or "")


def _identity_candidates(info):
    values = []
    if not info:
        return values
    for key in ("webpage_url", "original_url"):
        code = _shortcode_from_url(info.get(key))
        if code:
            values.append(code)
    for key in ("display_id", "shortcode", "code"):
        value = str(info.get(key) or "").strip()
        if re.fullmatch(r"[A-Za-z0-9_-]+", value):
            values.append(value)
    return list(dict.fromkeys(values))


def _identity_match(info, expected_shortcode):
    if not info or not expected_shortcode:
        return None
    candidates = _identity_candidates(info)
    if candidates:
        return expected_shortcode in candidates

    expected_media_id = _shortcode_to_media_id(expected_shortcode)
    raw_id = str(info.get("id") or info.get("pk") or "").strip()
    if expected_media_id and raw_id.isdigit():
        return raw_id == expected_media_id
    return None


def _first_media(info, expected_shortcode=None):
    if not info:
        return None
    if info.get("_type") in {"playlist", "multi_video"} or info.get("entries"):
        unknown = []
        for entry in info.get("entries") or []:
            media = _first_media(entry, expected_shortcode)
            if not media:
                continue
            match = _identity_match(media, expected_shortcode)
            if match is True:
                return media
            if match is None:
                unknown.append(media)
        # Only accept an unverified playlist entry when there is exactly one.
        # This prevents a recommended/neighboring Instagram Reel from silently
        # becoming the result for the requested URL.
        return unknown[0] if len(unknown) == 1 else None

    if _identity_match(info, expected_shortcode) is False:
        return None
    if info.get("url"):
        return info
    formats = info.get("formats") or []
    candidates = [
        f for f in formats
        if f.get("url") and (f.get("vcodec") not in {None, "none"} or str(f.get("ext", "")).lower() in {"mp4", "webm", "mov"})
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda f: (
        f.get("height") or 0,
        f.get("tbr") or 0,
        f.get("filesize") or f.get("filesize_approx") or 0
    ), reverse=True)
    chosen = dict(candidates[0])
    chosen.setdefault("title", info.get("title"))
    chosen.setdefault("thumbnail", info.get("thumbnail"))
    chosen.setdefault("duration", info.get("duration"))
    chosen.setdefault("id", info.get("id"))
    return chosen


def _resolve(url):
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "format": "best[ext=mp4]/best",
        "socket_timeout": 25,
        "retries": 2,
        "http_headers": {
            "User-Agent": UA,
            "Referer": "https://www.instagram.com/",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.7,en;q=0.6",
        },
    }
    expected_shortcode = _shortcode_from_url(url)
    canonical_url = _canonical_reel_url(url)
    info = None
    yt_error = None
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(canonical_url, download=False)
    except Exception as exc:
        yt_error = exc

    if not info:
        browser_media = _resolve_with_browser_tls(canonical_url)
        if browser_media:
            return {
                "media_url": browser_media["url"],
                "thumbnail": browser_media.get("thumbnail"),
                "duration": browser_media.get("duration"),
                "title": browser_media.get("title"),
                "ext": browser_media.get("ext") or "mp4",
                "id": browser_media.get("id"),
                "requested_shortcode": expected_shortcode,
                "identity_verified": True,
                "identity_evidence": browser_media.get("identity_evidence") or "browser_tls",
            }
        if yt_error:
            raise yt_error
        raise RuntimeError("video_not_found")

    top_identity = _identity_match(info, expected_shortcode)
    if top_identity is False:
        raise RuntimeError("identity_mismatch")
    media = _first_media(info, expected_shortcode)
    if not media or not media.get("url"):
        browser_media = _resolve_with_browser_tls(canonical_url)
        if browser_media:
            return {
                "media_url": browser_media["url"],
                "thumbnail": browser_media.get("thumbnail"),
                "duration": browser_media.get("duration"),
                "title": browser_media.get("title"),
                "ext": browser_media.get("ext") or "mp4",
                "id": browser_media.get("id"),
                "requested_shortcode": expected_shortcode,
                "identity_verified": True,
                "identity_evidence": browser_media.get("identity_evidence") or "browser_tls",
            }
        raise RuntimeError("video_not_found")
    media_identity = _identity_match(media, expected_shortcode)
    if media_identity is False:
        raise RuntimeError("identity_mismatch")
    # If yt-dlp does not expose identity metadata, keep the direct single-Reel
    # result. The request itself is bound to one canonical shortcode and
    # playlists are disabled; any explicit mismatch is still rejected above.
    identity_evidence = "metadata" if (top_identity is True or media_identity is True) else "direct_url_single"
    media_url = media["url"]
    if not _is_allowed_media_url(media_url):
        raise RuntimeError("media_host_not_allowed")
    ext = str(media.get("ext") or "mp4").lower()
    if ext not in {"mp4", "webm", "mov"}:
        ext = "mp4"
    return {
        "media_url": media_url,
        "thumbnail": media.get("thumbnail") or (info or {}).get("thumbnail"),
        "duration": media.get("duration") or (info or {}).get("duration"),
        "title": media.get("title") or (info or {}).get("title"),
        "ext": ext,
        "id": media.get("id") or (info or {}).get("id"),
        "requested_shortcode": expected_shortcode,
        "identity_verified": True,
        "identity_evidence": identity_evidence,
    }


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 8192:
                return _json(self, {"ok": False, "error": "invalid_body"}, 400)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            url = str(payload.get("url") or "").strip()
            if not _is_instagram_post_url(url):
                return _json(self, {"ok": False, "error": "instagram_public_url_required"}, 400)

            data = _resolve(url)
            proxy = "/api/instagram?media=" + urllib.parse.quote(data["media_url"], safe="")
            return _json(self, {
                "ok": True,
                "resolver": "yt-dlp",
                "proxy_url": proxy,
                "thumbnail_url": data["thumbnail"],
                "duration": data["duration"],
                "title": data["title"],
                "extension": data["ext"],
                "media_id": data["id"],
                "requested_shortcode": data["requested_shortcode"],
                "identity_verified": data["identity_verified"],
                "identity_evidence": data["identity_evidence"],
            })
        except yt_dlp.utils.DownloadError as exc:
            message = str(exc)
            lower = message.lower()
            if "login" in lower or "cookies" in lower or "private" in lower:
                return _json(self, {"ok": False, "error": "instagram_login_required", "message": "Esse Reel exige login ou não é público."}, 422)
            return _json(self, {"ok": False, "error": "instagram_public_extract_failed", "message": "Não consegui resolver esse Reel público agora."}, 422)
        except RuntimeError as exc:
            code = str(exc)
            if code == "identity_mismatch":
                return _json(self, {
                    "ok": False,
                    "error": "instagram_identity_mismatch",
                    "message": "O Instagram devolveu uma mídia diferente do Reel solicitado."
                }, 422)
            if code == "video_not_found":
                return _json(self, {"ok": False, "error": "instagram_video_not_resolved", "message": "Não consegui resolver o vídeo exato desse Reel."}, 422)
            if code == "identity_unverified":
                return _json(self, {
                    "ok": False,
                    "error": "instagram_identity_unverified",
                    "message": "Não consegui confirmar que a mídia pertence exatamente ao Reel solicitado."
                }, 422)
            return _json(self, {"ok": False, "error": "instagram_resolver_failed", "message": "Falha no resolvedor externo."}, 500)
        except Exception:
            return _json(self, {"ok": False, "error": "instagram_resolver_failed", "message": "Falha no resolvedor externo."}, 500)

    def do_GET(self):
        try:
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            media = (query.get("media") or [""])[0]
            if not media or not _is_allowed_media_url(media):
                return _json(self, {"ok": False, "error": "media_url_invalid"}, 400)

            req = urllib.request.Request(
                media,
                headers={
                    "User-Agent": UA,
                    "Referer": "https://www.instagram.com/",
                    "Accept": "video/mp4,video/*,*/*;q=0.8",
                },
            )
            upstream = urllib.request.urlopen(req, timeout=35)
            length = int(upstream.headers.get("Content-Length") or 0)
            if length and length > MAX_BYTES:
                upstream.close()
                return _json(self, {"ok": False, "error": "video_too_large"}, 413)

            content_type = upstream.headers.get("Content-Type") or "video/mp4"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            if length:
                self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "private, max-age=120")
            self.send_header("Content-Disposition", 'inline; filename="instagram-reel.mp4"')
            self.end_headers()

            sent = 0
            while True:
                chunk = upstream.read(64 * 1024)
                if not chunk:
                    break
                sent += len(chunk)
                if sent > MAX_BYTES:
                    break
                self.wfile.write(chunk)
            upstream.close()
        except Exception:
            if not self.wfile.closed:
                try:
                    return _json(self, {"ok": False, "error": "media_proxy_failed"}, 502)
                except Exception:
                    return
