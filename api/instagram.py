import json
import os
import re
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

import yt_dlp


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


def _first_media(info):
    if not info:
        return None
    if info.get("_type") in {"playlist", "multi_video"} or info.get("entries"):
        for entry in info.get("entries") or []:
            media = _first_media(entry)
            if media:
                return media
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
        "noplaylist": False,
        "format": "best[ext=mp4]/best",
        "socket_timeout": 25,
        "retries": 2,
        "http_headers": {
            "User-Agent": UA,
            "Referer": "https://www.instagram.com/",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.7,en;q=0.6",
        },
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    media = _first_media(info)
    if not media or not media.get("url"):
        raise RuntimeError("video_not_found")
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
            })
        except yt_dlp.utils.DownloadError as exc:
            message = str(exc)
            lower = message.lower()
            if "login" in lower or "cookies" in lower or "private" in lower:
                return _json(self, {"ok": False, "error": "instagram_login_required", "message": "Esse Reel exige login ou não é público."}, 422)
            return _json(self, {"ok": False, "error": "instagram_public_extract_failed", "message": "Não consegui resolver esse Reel público agora."}, 422)
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
