"""Tiny OpenAI/Volcengine-compatible media endpoint used for local end-to-end tests.

Serves, on 127.0.0.1:8899:

* POST /v1/images/generations and POST /v1/images/edits - solid-colour PNG whose
  canvas matches the requested size.
* POST /v1/images/variations - same, for the variations probe.
* POST /api/v3/contents/generations/tasks - fake Volcengine video task creation.
* GET  /api/v3/contents/generations/tasks/<id> - immediately "succeeded".
* GET  /mock.mp4 - a small fake MP4 payload.

No third-party dependencies beyond Pillow.
"""
import base64
import io
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer

from PIL import Image

PORT = 8899
DEFAULT_SIZE = "1024x1024"
MP4_BYTES = (
    b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"
    b"\x00\x00\x00\x08free" + b"\x00" * 2048
)


def canvas_from(text: str) -> tuple[int, int]:
    match = re.search(r'size[\"\']?\s*[=:]\s*[\"\']?(\d{2,5})[xX*](\d{2,5})', text)
    if match:
        return int(match.group(1)), int(match.group(2))
    return 1024, 1024


def multipart_images(raw: bytes, content_type: str) -> list[bytes]:
    """Pull the uploaded image payloads out of a multipart/form-data body."""
    marker = content_type.split("boundary=")[-1].strip().strip('"')
    if not marker:
        return []
    found = []
    for part in raw.split(("--" + marker).encode()):
        if b"\r\n\r\n" not in part:
            continue
        head, body = part.split(b"\r\n\r\n", 1)
        if b"filename=" in head or b'name="image' in head:
            payload = body.rstrip(b"\r\n")
            if payload:
                found.append(payload)
    return found


class Handler(BaseHTTPRequestHandler):
    def _reply_json(self, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _reply_bytes(self, body: bytes, content_type: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        path = self.path.split("?")[0]
        if path == "/mock.mp4":
            self._reply_bytes(MP4_BYTES, "video/mp4")
            return
        if path.startswith("/api/v3/contents/generations/tasks/"):
            self._reply_json({
                "id": path.rsplit("/", 1)[-1],
                "status": "succeeded",
                "content": {"video_url": f"http://127.0.0.1:{PORT}/mock.mp4"},
            })
            return
        self._reply_json({"error": {"message": "unknown GET " + path}})

    def do_POST(self) -> None:  # noqa: N802 - stdlib naming
        path = self.path.split("?")[0]
        try:
            length = int(self.headers.get("Content-Length") or "0")
            raw = self.rfile.read(length) if length else b""
            text = raw.decode("utf-8", "replace")

            if path.startswith("/api/v3/contents/generations/tasks"):
                self._reply_json({"id": "cgt-mock-0001", "status": "queued"})
                return

            width, height = 1024, 1024
            if "json" in (self.headers.get("Content-Type") or ""):
                try:
                    request = json.loads(text or "{}")
                    size = str(request.get("size") or DEFAULT_SIZE)
                    parts = re.split(r"[xX*]", size)
                    width = int(parts[0]) if parts and parts[0].isdigit() else 1024
                    height = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else width
                except Exception:
                    pass
            else:
                # An edits request must answer with the same canvas as its input,
                # otherwise GenBox's strict size policy rejects the result.
                width, height = canvas_from(text)
                uploads = multipart_images(raw, self.headers.get("Content-Type") or "")
                for payload in uploads[:1]:
                    try:
                        with Image.open(io.BytesIO(payload)) as source:
                            width, height = source.size
                    except Exception:
                        pass

            image = Image.new("RGB", (width, height), (24, 118, 210))
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
            self._reply_json({"created": 0, "data": [{"b64_json": encoded}], "images": [{"b64_json": encoded}]})
        except Exception as exc:  # pragma: no cover - diagnostic path
            self._reply_json({"error": {"message": str(exc)}})

    def log_message(self, *args) -> None:  # silence request logging
        return


if __name__ == "__main__":
    print(f"mock-openai listening on http://127.0.0.1:{PORT}", flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
