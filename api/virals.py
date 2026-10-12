import json
import math
import re
import statistics
import urllib.parse
from http.server import BaseHTTPRequestHandler

import yt_dlp
from curl_cffi import requests as curl_requests


UA = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151 Mobile Safari/537.36"
IG_APP_ID = "936619743392459"
MAX_ITEMS = 60


def _json(handler, data, status=200):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _username(value):
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw.startswith("@"): raw = raw[1:]
    if "://" in raw:
        try:
            parsed = urllib.parse.urlparse(raw)
            host = (parsed.hostname or "").lower().removeprefix("www.")
            if host not in {"instagram.com", "instagr.am"}:
                return ""
            parts = [p for p in (parsed.path or "").split("/") if p]
            if not parts:
                return ""
            raw = parts[0]
        except Exception:
            return ""
    raw = raw.split("?")[0].split("#")[0].strip("/ ")
    if not re.fullmatch(r"[A-Za-z0-9._]{1,30}", raw):
        return ""
    blocked = {"reel", "reels", "p", "stories", "explore", "accounts", "direct"}
    return "" if raw.lower() in blocked else raw


def _count(obj, *paths):
    for path in paths:
        cur = obj
        ok = True
        for key in path.split("."):
            if not isinstance(cur, dict) or key not in cur:
                ok = False
                break
            cur = cur[key]
        if ok:
            try:
                return int(cur or 0)
            except Exception:
                pass
    return 0


def _caption(node):
    edges = ((node.get("edge_media_to_caption") or {}).get("edges") or [])
    if edges:
        return str((edges[0].get("node") or {}).get("text") or "").strip()
    return str(node.get("caption") or node.get("title") or node.get("description") or "").strip()


def _media_from_node(node, forced_type=None):
    if not isinstance(node, dict):
        return None
    code = str(node.get("shortcode") or node.get("code") or node.get("display_id") or "").strip()
    if not code:
        return None
    product_type = str(node.get("product_type") or "").lower()
    typename = str(node.get("__typename") or "").lower()
    is_video = bool(node.get("is_video") or product_type in {"clips", "igtv"} or "video" in typename)
    is_reel = forced_type == "reels" or product_type == "clips" or bool(node.get("clips_music_attribution_info"))
    kind = forced_type or ("reels" if is_reel else "posts")
    permalink = f"https://www.instagram.com/reel/{code}/" if kind == "reels" else f"https://www.instagram.com/p/{code}/"
    views = _count(node, "video_view_count", "video_play_count", "play_count", "view_count")
    likes = _count(node, "edge_liked_by.count", "edge_media_preview_like.count", "like_count")
    comments = _count(node, "edge_media_to_comment.count", "comment_count")
    timestamp = _count(node, "taken_at_timestamp", "taken_at")
    cover = str(node.get("display_url") or node.get("thumbnail_src") or node.get("thumbnail") or "").strip()
    return {
        "id": str(node.get("id") or node.get("pk") or code),
        "shortcode": code,
        "type": kind,
        "is_video": is_video,
        "permalink": permalink,
        "cover_url": cover,
        "caption": _caption(node),
        "views": views,
        "likes": likes,
        "comments": comments,
        "timestamp": timestamp,
    }


def _profile_from_web(username):
    url = "https://www.instagram.com/api/v1/users/web_profile_info/?username=" + urllib.parse.quote(username)
    headers = {
        "User-Agent": UA,
        "X-IG-App-ID": IG_APP_ID,
        "Referer": f"https://www.instagram.com/{username}/",
        "Accept": "*/*",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.7,en;q=0.6",
    }
    res = curl_requests.get(url, headers=headers, impersonate="chrome", timeout=18, allow_redirects=True)
    if res.status_code != 200:
        raise RuntimeError(f"profile_http_{res.status_code}")
    payload = res.json()
    user = ((payload or {}).get("data") or {}).get("user") or {}
    if not user:
        raise RuntimeError("profile_not_found")

    items = []
    seen = set()
    timeline = ((user.get("edge_owner_to_timeline_media") or {}).get("edges") or [])
    reels = ((user.get("edge_felix_video_timeline") or {}).get("edges") or [])
    for edge in timeline:
        item = _media_from_node((edge or {}).get("node") or {})
        if item and item["shortcode"] not in seen:
            seen.add(item["shortcode"]); items.append(item)
    for edge in reels:
        item = _media_from_node((edge or {}).get("node") or {}, "reels")
        if item and item["shortcode"] not in seen:
            seen.add(item["shortcode"]); items.append(item)

    return {
        "profile": {
            "username": str(user.get("username") or username),
            "full_name": str(user.get("full_name") or ""),
            "profile_pic_url": str(user.get("profile_pic_url_hd") or user.get("profile_pic_url") or ""),
            "followers": _count(user, "edge_followed_by.count", "follower_count"),
            "is_private": bool(user.get("is_private")),
            "is_verified": bool(user.get("is_verified")),
        },
        "items": items[:MAX_ITEMS],
        "source": "instagram_web_profile",
    }


def _profile_from_ytdlp(username):
    profile_url = f"https://www.instagram.com/{username}/"
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "playlistend": 36,
        "socket_timeout": 18,
        "retries": 1,
        "extract_flat": False,
        "http_headers": {
            "User-Agent": UA,
            "Referer": "https://www.instagram.com/",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.7,en;q=0.6",
        },
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(profile_url, download=False)
    entries = list((info or {}).get("entries") or [])[:MAX_ITEMS]
    items = []
    seen = set()
    for entry in entries:
        if not entry: continue
        page = str(entry.get("webpage_url") or entry.get("original_url") or entry.get("url") or "")
        m = re.search(r"/(reel|reels|p)/([A-Za-z0-9_-]+)", page)
        code = (m.group(2) if m else str(entry.get("display_id") or entry.get("id") or "")).strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]+", code) or code in seen: continue
        seen.add(code)
        kind = "reels" if (m and m.group(1) in {"reel", "reels"}) else "posts"
        views = int(entry.get("view_count") or entry.get("play_count") or 0)
        likes = int(entry.get("like_count") or 0)
        comments = int(entry.get("comment_count") or 0)
        items.append({
            "id": str(entry.get("id") or code),
            "shortcode": code,
            "type": kind,
            "is_video": str(entry.get("vcodec") or "none") != "none" or kind == "reels",
            "permalink": f"https://www.instagram.com/reel/{code}/" if kind == "reels" else f"https://www.instagram.com/p/{code}/",
            "cover_url": str(entry.get("thumbnail") or ""),
            "caption": str(entry.get("description") or entry.get("title") or "").strip(),
            "views": views,
            "likes": likes,
            "comments": comments,
            "timestamp": int(entry.get("timestamp") or 0),
        })
    return {
        "profile": {"username": username, "full_name": "", "profile_pic_url": "", "followers": 0, "is_private": False, "is_verified": False},
        "items": items,
        "source": "yt_dlp_profile",
    }


def _metric(item, has_views):
    if has_views:
        return max(0, int(item.get("views") or 0))
    return max(0, int(item.get("likes") or 0) * 10 + int(item.get("comments") or 0) * 35)


def _viral_only(items):
    if not items:
        return []
    has_views = any(int(x.get("views") or 0) > 0 for x in items)
    positives = [_metric(x, has_views) for x in items if _metric(x, has_views) > 0]
    baseline = statistics.median(positives) if positives else 0
    ranked = []
    for item in items:
        raw = _metric(item, has_views)
        ratio = (raw / baseline) if baseline else 0
        row = dict(item)
        row["viral_score"] = round(ratio, 2) if baseline else 0
        row["ranking_metric"] = "views" if has_views else "engagement"
        row["ranking_value"] = raw
        ranked.append(row)
    ranked.sort(key=lambda x: (x["ranking_value"], int(x.get("timestamp") or 0)), reverse=True)
    if not ranked:
        return []
    keep = min(10, max(3, math.ceil(len(ranked) * 0.30)))
    selected = [x for i, x in enumerate(ranked) if i < keep and (x["viral_score"] >= 1.35 or i < 3)]
    if not selected and ranked:
        selected = ranked[: min(3, len(ranked))]
    for index, item in enumerate(selected, 1):
        item["rank"] = index
    return selected


def _analyze(username):
    errors = []
    data = None
    try:
        data = _profile_from_web(username)
    except Exception as exc:
        errors.append(str(exc))
    if not data or not data.get("items"):
        try:
            data = _profile_from_ytdlp(username)
        except Exception as exc:
            errors.append(str(exc))
    if not data:
        raise RuntimeError(errors[-1] if errors else "profile_unavailable")

    items = data.get("items") or []
    reels = _viral_only([x for x in items if x.get("type") == "reels"])
    posts = _viral_only([x for x in items if x.get("type") == "posts"])
    return {
        "ok": True,
        "profile": data.get("profile") or {"username": username},
        "source": data.get("source"),
        "reels": reels,
        "posts": posts,
        "highlights": [],
        "availability": {
            "reels": True,
            "posts": True,
            "highlights": False,
            "highlights_reason": "O Instagram não expõe métricas públicas de visualização/curtidas dos Destaques de perfis externos; por isso o CloudentFlow não inventa um ranking viral.",
        },
        "scanned": len(items),
        "errors": errors[-2:],
    }


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 8192:
                return _json(self, {"ok": False, "error": "invalid_body"}, 400)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            username = _username(payload.get("profile") or payload.get("url") or payload.get("username"))
            if not username:
                return _json(self, {"ok": False, "error": "instagram_profile_required", "message": "Cole o link do perfil ou @usuário do Instagram."}, 400)
            try:
                data = _analyze(username)
                return _json(self, data)
            except Exception as exc:
                message = str(exc)
                if "private" in message.lower() or "login" in message.lower():
                    return _json(self, {"ok": False, "error": "profile_private_or_login_required", "message": "Esse perfil não pode ser analisado publicamente."}, 422)
                return _json(self, {"ok": False, "error": "profile_analysis_failed", "message": "Não consegui analisar esse perfil agora.", "detail": message[:240]}, 422)
        except Exception as exc:
            return _json(self, {"ok": False, "error": "virals_failed", "message": str(exc)[:240]}, 500)
