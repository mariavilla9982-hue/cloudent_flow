import hashlib
import json
import os
import re
import subprocess
import tempfile
import urllib.parse
from http.server import BaseHTTPRequestHandler

import imageio_ffmpeg
import requests


SUPABASE_URL = "https://dxrhvudvutmgrmfkmzxo.supabase.co"
MAX_HARD_BYTES = 300 * 1024 * 1024


def _json(handler, data, status=200):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def _valid_target(path):
    return bool(re.fullmatch(
        r"[0-9a-fA-F-]{36}/cleaned/(?:video|trial)/[0-9a-fA-F-]{36}\.mp4",
        path or "",
    ))


def _safe_int(value, fallback, low, high):
    try:
        n = int(value)
    except Exception:
        n = fallback
    return max(low, min(high, n))


def _sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _probe(ffmpeg, path):
    proc = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", path],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        timeout=30,
    )
    text = proc.stderr or ""
    result = {}

    duration = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if duration:
        h, m, s = duration.groups()
        result["duration_seconds"] = round(int(h) * 3600 + int(m) * 60 + float(s), 3)

    video = re.search(
        r"Stream #.*?Video:\s*([^,\s]+).*?(\d{2,5})x(\d{2,5}).*?(?:(\d+(?:\.\d+)?)\s*fps)?",
        text,
        re.S,
    )
    if video:
        result["video_codec"] = video.group(1)
        result["width"] = int(video.group(2))
        result["height"] = int(video.group(3))
        if video.group(4):
            result["fps"] = float(video.group(4))

    audio = re.search(r"Stream #.*?Audio:\s*([^,\s]+)", text, re.S)
    if audio:
        result["audio_codec"] = audio.group(1)
        result["has_audio"] = True
    else:
        result["has_audio"] = False

    return result


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        input_path = None
        output_path = None
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 65536:
                return _json(self, {"ok": False, "error": "invalid_body"}, 400)

            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            source_url = str(payload.get("source_url") or "")
            target_path = str(payload.get("target_path") or "")
            upload_token = str(payload.get("upload_token") or "")
            anon_key = str(payload.get("anon_key") or "")
            cfg = payload.get("config") or {}

            if not source_url.startswith(SUPABASE_URL + "/storage/v1/object/sign/videos/"):
                return _json(self, {"ok": False, "error": "source_not_allowed"}, 403)
            if not _valid_target(target_path):
                return _json(self, {"ok": False, "error": "target_invalid"}, 400)
            if len(upload_token) < 20:
                return _json(self, {"ok": False, "error": "upload_token_invalid"}, 400)
            if len(anon_key) < 20:
                return _json(self, {"ok": False, "error": "anon_key_invalid"}, 400)

            max_bytes = _safe_int(cfg.get("max_input_bytes"), 262144000, 1_000_000, MAX_HARD_BYTES)
            crf = _safe_int(cfg.get("crf"), 19, 16, 26)
            audio_bitrate = _safe_int(cfg.get("audio_bitrate_kbps"), 128, 64, 256)
            audio_rate = _safe_int(cfg.get("audio_sample_rate"), 48000, 32000, 48000)
            preset = str(cfg.get("preset") or "veryfast")
            if preset not in {"ultrafast", "superfast", "veryfast", "faster", "fast", "medium"}:
                preset = "veryfast"

            with tempfile.NamedTemporaryFile(prefix="cloudent-input-", suffix=".bin", delete=False) as f:
                input_path = f.name
                total = 0
                with requests.get(source_url, stream=True, timeout=(20, 90)) as response:
                    if response.status_code != 200:
                        raise RuntimeError("source_download_" + str(response.status_code))
                    declared = int(response.headers.get("content-length") or 0)
                    if declared and declared > max_bytes:
                        return _json(self, {"ok": False, "error": "video_too_large"}, 413)
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if not chunk:
                            continue
                        total += len(chunk)
                        if total > max_bytes:
                            return _json(self, {"ok": False, "error": "video_too_large"}, 413)
                        f.write(chunk)

            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
            before = _probe(ffmpeg, input_path)

            fd, output_path = tempfile.mkstemp(prefix="cloudent-clean-", suffix=".mp4")
            os.close(fd)

            command = [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                input_path,
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-map_metadata",
                "-1",
                "-map_chapters",
                "-1",
                "-vf",
                "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:v",
                "libx264",
                "-profile:v",
                "high",
                "-pix_fmt",
                "yuv420p",
                "-preset",
                preset,
                "-crf",
                str(crf),
                "-c:a",
                "aac",
                "-b:a",
                str(audio_bitrate) + "k",
                "-ar",
                str(audio_rate),
                "-movflags",
                "+faststart",
                output_path,
            ]
            result = subprocess.run(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                timeout=240,
            )
            if result.returncode != 0:
                message = (result.stderr or "ffmpeg_failed").strip()[-1200:]
                return _json(self, {"ok": False, "error": "ffmpeg_failed", "message": message}, 422)

            after = _probe(ffmpeg, output_path)
            input_bytes = os.path.getsize(input_path)
            output_bytes = os.path.getsize(output_path)
            input_hash = _sha256_file(input_path)
            output_hash = _sha256_file(output_path)

            encoded_path = urllib.parse.quote(target_path, safe="/")
            encoded_token = urllib.parse.quote(upload_token, safe="")
            upload_url = (
                SUPABASE_URL
                + "/storage/v1/object/upload/sign/videos/"
                + encoded_path
                + "?token="
                + encoded_token
            )
            headers = {
                "apikey": anon_key,
                "Authorization": "Bearer " + anon_key,
                "Content-Type": "video/mp4",
                "cache-control": "max-age=3600",
                "x-upsert": "true",
            }
            with open(output_path, "rb") as out:
                uploaded = requests.put(upload_url, data=out, headers=headers, timeout=(20, 120))
            if uploaded.status_code < 200 or uploaded.status_code >= 300:
                return _json(
                    self,
                    {
                        "ok": False,
                        "error": "signed_upload_failed",
                        "status": uploaded.status_code,
                        "message": uploaded.text[-800:],
                    },
                    502,
                )

            warnings = []
            video_codec = str(after.get("video_codec") or "").lower()
            audio_codec = str(after.get("audio_codec") or "").lower()
            width = after.get("width")
            height = after.get("height")
            has_audio = bool(after.get("has_audio"))

            if video_codec and "h264" not in video_codec:
                warnings.append("unexpected_video_codec")
            if has_audio and audio_codec and "aac" not in audio_codec:
                warnings.append("unexpected_audio_codec")
            if not width or not height:
                warnings.append("geometry_not_detected")
            elif min(int(width), int(height)) < 480:
                warnings.append("low_resolution")
            if not has_audio:
                warnings.append("no_audio_stream")

            validation_passed = (
                ("h264" in video_codec)
                and bool(width and height)
                and ((not has_audio) or ("aac" in audio_codec))
            )

            report = {
                "engine": "ffmpeg",
                "normalized": True,
                "metadata_stripped": True,
                "faststart": True,
                "target_container": "mp4",
                "target_video_codec": "h264",
                "target_audio_codec": "aac",
                "target_pixel_format": "yuv420p",
                "input_bytes": input_bytes,
                "output_bytes": output_bytes,
                "input_sha256": input_hash,
                "output_sha256": output_hash,
                "size_delta_bytes": output_bytes - input_bytes,
                "before": before,
                "after": after,
                "width": after.get("width"),
                "height": after.get("height"),
                "fps": after.get("fps"),
                "duration_seconds": after.get("duration_seconds"),
                "has_audio": after.get("has_audio"),
                "video_codec": after.get("video_codec"),
                "audio_codec": after.get("audio_codec"),
                "crf": crf,
                "preset": preset,
                "audio_bitrate_kbps": audio_bitrate,
                "audio_sample_rate": audio_rate,
                "technical_validation_passed": validation_passed,
                "technical_warnings": warnings,
                "visual_watermark_check": "not_available",
            }
            return _json(self, {"ok": True, "target_path": target_path, "report": report})
        except subprocess.TimeoutExpired:
            return _json(self, {"ok": False, "error": "media_clean_timeout"}, 504)
        except requests.RequestException as exc:
            return _json(self, {"ok": False, "error": "network_error", "message": str(exc)[:600]}, 502)
        except Exception as exc:
            return _json(self, {"ok": False, "error": "media_clean_failed", "message": str(exc)[:800]}, 500)
        finally:
            for path in (input_path, output_path):
                if path:
                    try:
                        os.remove(path)
                    except Exception:
                        pass
