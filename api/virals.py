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
IG_ASBD_ID = "129477"
CLIPS_DOC_ID = "27234427476213202"
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
    if raw.startswith("@"):
        raw = raw[1:]
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


def _headers(username=""):
    return {
        "User-Agent": UA,
        "X-IG-App-ID": IG_APP_ID,
        "X-ASBD-ID": IG_ASBD_ID,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": f"https://www.instagram.com/{username}/" if username else "https://www.instagram.com/",
        "Origin": "https://www.instagram.com",
        "Accept": "*/*",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.7,en;q=0.6",
    }


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
    value = node.get("caption")
    if isinstance(value, dict):
        return str(value.get("text") or "").strip()
    return str(value or node.get("title") or node.get("description") or "").strip()


def _cover(node):
    direct = node.get("display_url") or node.get("thumbnail_src") or node.get("thumbnail_url") or node.get("thumbnail")
    if direct:
        return str(direct)
    candidates = ((node.get("image_versions2") or {}).get("candidates") or [])
    if candidates:
        return str((candidates[0] or {}).get("url") or "")
    return ""


def _media_from_node(node, forced_type=None):
    if not isinstance(node, dict):
        return None
    code = str(node.get("shortcode") or node.get("code") or node.get("display_id") or "").strip()
    if not code:
        return None
    product_type = str(node.get("product_type") or "").lower()
    typename = str(node.get("__typename") or "").lower()
    is_video = bool(node.get("is_video") or product_type in {"clips", "igtv"} or "video" in typename or node.get("video_versions"))
    is_reel = forced_type == "reels" or product_type == "clips" or bool(node.get("clips_music_attribution_info"))
    kind = forced_type or ("reels" if is_reel else "posts")
    return {
        "id": str(node.get("id") or node.get("pk") or code),
        "shortcode": code,
        "type": kind,
        "is_video": is_video or kind == "reels",
        "permalink": f"https://www.instagram.com/reel/{code}/" if kind == "reels" else f"https://www.instagram.com/p/{code}/",
        "cover_url": _cover(node),
        "caption": _caption(node),
        "views": _count(node, "play_count", "video_play_count", "video_view_count", "view_count"),
        "likes": _count(node, "like_count", "edge_liked_by.count", "edge_media_preview_like.count"),
        "comments": _count(node, "comment_count", "edge_media_to_comment.count"),
        "timestamp": _count(node, "taken_at", "taken_at_timestamp"),
    }


def _profile_from_web(username):
    url = "https://www.instagram.com/api/v1/users/web_profile_info/?username=" + urllib.parse.quote(username)
    res = curl_requests.get(url, headers=_headers(username), impersonate="chrome", timeout=18, allow_redirects=True)
    if res.status_code != 200:
        raise RuntimeError(f"profile_http_{res.status_code}")
    payload = res.json()
    user = ((payload or {}).get("data") or {}).get("user") or {}
    if not user:
        raise RuntimeError("profile_not_found")

    items = []
    seen = set()
    timeline = ((user.get("edge_owner_to_timeline_media") or {}).get("edges") or [])
    legacy_reels = ((user.get("edge_felix_video_timeline") or {}).get("edges") or [])
    for edge in timeline:
        item = _media_from_node((edge or {}).get("node") or {})
        if item and item["shortcode"] not in seen:
            seen.add(item["shortcode"])
            items.append(item)
    for edge in legacy_reels:
        item = _media_from_node((edge or {}).get("node") or {}, "reels")
        if item and item["shortcode"] not in seen:
            seen.add(item["shortcode"])
            items.append(item)

    return {
        "user_id": str(user.get("id") or ""),
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


def _parse_clips_graphql(payload):
    connection = ((payload or {}).get("data") or {}).get("xdt_api__v1__clips__user__connection_v2") or {}
    rows = []
    seen = set()
    for edge in connection.get("edges") or []:
        media = ((edge or {}).get("node") or {}).get("media") or {}
        item = _media_from_node(media, "reels")
        if item and item["shortcode"] not in seen:
            seen.add(item["shortcode"])
            rows.append(item)
    return rows[:MAX_ITEMS]


def _reels_from_clips(username, user_id):
    if not user_id:
        return []

    errors = []
    session = curl_requests.Session(impersonate="chrome")
    csrf = ""
    try:
        warm_headers = {
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.7,en;q=0.6",
        }
        session.get("https://www.instagram.com/", headers=warm_headers, timeout=15, allow_redirects=True)
        csrf = str(session.cookies.get("csrftoken") or "")
    except Exception as exc:
        errors.append("warm:" + str(exc))

    headers = _headers(username)
    if csrf:
        headers["X-CSRFToken"] = csrf

    variables = {
        "data": {
            "include_feed_video": True,
            "page_size": 36,
            "target_user_id": str(user_id),
        }
    }
    form = {
        "doc_id": CLIPS_DOC_ID,
        "variables": json.dumps(variables, separators=(",", ":")),
    }
    try:
        res = session.post(
            "https://www.instagram.com/graphql/query",
            headers=headers,
            data=form,
            timeout=20,
            allow_redirects=True,
        )
        if res.status_code == 200:
            rows = _parse_clips_graphql(res.json())
            if rows:
                return rows
            errors.append("graphql_empty")
        else:
            errors.append(f"graphql_http_{res.status_code}")
    except Exception as exc:
        errors.append("graphql:" + str(exc))

    legacy_form = {"target_user_id": str(user_id), "page_size": "36", "max_id": ""}
    for url in ("https://www.instagram.com/api/v1/clips/user/", "https://i.instagram.com/api/v1/clips/user/"):
        try:
            res = session.post(url, headers=headers, data=legacy_form, timeout=18, allow_redirects=True)
            if res.status_code != 200:
                errors.append(f"legacy_http_{res.status_code}")
                continue
            payload = res.json()
            source_rows = payload.get("items") or payload.get("clips") or []
            out = []
            seen = set()
            for row in source_rows:
                media = (row or {}).get("media") or (row or {}).get("clip") or row or {}
                item = _media_from_node(media, "reels")
                if item and item["shortcode"] not in seen:
                    seen.add(item["shortcode"])
                    out.append(item)
            if out:
                return out[:MAX_ITEMS]
        except Exception as exc:
            errors.append("legacy:" + str(exc))
    raise RuntimeError(";".join(errors[-4:]) or "clips_unavailable")


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
            "Accept-Language": "pt-BR,pt;q=0.9",
        },
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(profile_url, download=False)
    items = []
    seen = set()
    for entry in list((info or {}).get("entries") or [])[:MAX_ITEMS]:
        if not entry:
            continue
        page = str(entry.get("webpage_url") or entry.get("original_url") or entry.get("url") or "")
        m = re.search(r"/(reel|reels|p)/([A-Za-z0-9_-]+)", page)
        code = (m.group(2) if m else str(entry.get("display_id") or entry.get("id") or "")).strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]+", code) or code in seen:
            continue
        seen.add(code)
        kind = "reels" if (m and m.group(1) in {"reel", "reels"}) else "posts"
        items.append({
            "id": str(entry.get("id") or code),
            "shortcode": code,
            "type": kind,
            "is_video": str(entry.get("vcodec") or "none") != "none" or kind == "reels",
            "permalink": f"https://www.instagram.com/reel/{code}/" if kind == "reels" else f"https://www.instagram.com/p/{code}/",
            "cover_url": str(entry.get("thumbnail") or ""),
            "caption": str(entry.get("description") or entry.get("title") or "").strip(),
            "views": int(entry.get("view_count") or entry.get("play_count") or 0),
            "likes": int(entry.get("like_count") or 0),
            "comments": int(entry.get("comment_count") or 0),
            "timestamp": int(entry.get("timestamp") or 0),
        })
    return {
        "profile": {"username": username, "full_name": "", "profile_pic_url": "", "followers": 0, "is_private": False, "is_verified": False},
        "items": items,
        "source": "yt_dlp_profile",
    }


def _merge_items(primary, extra):
    by_code = {str(x.get("shortcode")): dict(x) for x in (primary or []) if x.get("shortcode")}
    order = [str(x.get("shortcode")) for x in (primary or []) if x.get("shortcode")]
    for incoming in extra or []:
        code = str(incoming.get("shortcode") or "")
        if not code:
            continue
        if code not in by_code:
            by_code[code] = dict(incoming)
            order.append(code)
            continue
        current = by_code[code]
        if incoming.get("type") == "reels":
            current["type"] = "reels"
            current["is_video"] = True
            current["permalink"] = incoming.get("permalink") or current.get("permalink")
        for key in ("caption", "cover_url"):
            if not current.get(key) and incoming.get(key):
                current[key] = incoming[key]
        for key in ("views", "likes", "comments", "timestamp"):
            if int(incoming.get(key) or 0) > int(current.get(key) or 0):
                current[key] = incoming[key]
        current["is_video"] = bool(current.get("is_video") or incoming.get("is_video"))
    return [by_code[c] for c in order if c in by_code][:MAX_ITEMS]


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
    keep = min(10, max(3, math.ceil(len(ranked) * 0.30)))
    selected = [x for i, x in enumerate(ranked) if i < keep and (x["viral_score"] >= 1.35 or i < 3)]
    if not selected:
        selected = ranked[:min(3, len(ranked))]
    for index, item in enumerate(selected, 1):
        item["rank"] = index
    return selected


def _analyze(username):
    errors = []
    web = None
    ytdlp = None
    reel_items = []
    try:
        web = _profile_from_web(username)
    except Exception as exc:
        errors.append("web:" + str(exc))

    if web:
        try:
            reel_items = _reels_from_clips(username, web.get("user_id"))
        except Exception as exc:
            errors.append("clips:" + str(exc))

    web_items = (web or {}).get("items") or []
    items = _merge_items(web_items, reel_items)
    if not items or not any(x.get("type") == "reels" for x in items):
        try:
            ytdlp = _profile_from_ytdlp(username)
            items = _merge_items(items, (ytdlp or {}).get("items") or [])
        except Exception as exc:
            errors.append("yt:" + str(exc))

    if not web and not ytdlp and not items:
        raise RuntimeError(errors[-1] if errors else "profile_unavailable")

    profile = (web or ytdlp or {}).get("profile") or {"username": username}
    reels = _viral_only([x for x in items if x.get("type") == "reels"])
    posts = _viral_only([x for x in items if x.get("type") == "posts"])
    sources = []
    if web:
        sources.append("instagram_web_profile")
    if reel_items:
        sources.append("instagram_graphql_clips")
    if ytdlp:
        sources.append("yt_dlp_profile")
    return {
        "ok": True,
        "profile": profile,
        "source": "+".join(sources),
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
        "errors": errors[-3:],
    }


def _serve_profile(handler, value):
    username = _username(value)
    if not username:
        return _json(handler, {"ok": False, "error": "instagram_profile_required", "message": "Cole o link do perfil ou @usuário do Instagram."}, 400)
    try:
        return _json(handler, _analyze(username))
    except Exception as exc:
        message = str(exc)
        if "private" in message.lower() or "login" in message.lower():
            return _json(handler, {"ok": False, "error": "profile_private_or_login_required", "message": "Esse perfil não pode ser analisado publicamente."}, 422)
        return _json(handler, {"ok": False, "error": "profile_analysis_failed", "message": "Não consegui analisar esse perfil agora.", "detail": message[:240]}, 422)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        try:
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            return _serve_profile(self, (query.get("profile") or query.get("username") or [""])[0])
        except Exception as exc:
            return _json(self, {"ok": False, "error": "virals_failed", "message": str(exc)[:240]}, 500)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 8192:
                return _json(self, {"ok": False, "error": "invalid_body"}, 400)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            return _serve_profile(self, payload.get("profile") or payload.get("url") or payload.get("username"))
        except Exception as exc:
            return _json(self, {"ok": False, "error": "virals_failed", "message": str(exc)[:240]}, 500)
