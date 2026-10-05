import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROMPT_PATH = Path(__file__).with_name("TRUE_TONE_AGENT_SYSTEM.md")
HOST = "0.0.0.0"
PORT = int(os.getenv("PORT", "9000"))
CORS_ORIGIN = os.getenv("CORS_ORIGIN", "*")


def load_prompt() -> str:
    try:
        return PROMPT_PATH.read_text(encoding="utf-8")
    except Exception:
        return (
            "You are TrueTone, a beauty-content trust and purchase-decision assistant. "
            "Use only the supplied evidence. Never equate positive reviews with truth. "
            "Distinguish normal variation from suspicious distortion. Return JSON only."
        )


def model_call(payload: dict) -> dict:
    api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("DASHSCOPE_API_KEY is not configured")

    base_url = os.getenv("MODEL_STUDIO_BASE_URL", "").strip().rstrip("/")
    if not base_url:
        raise RuntimeError("MODEL_STUDIO_BASE_URL is not configured")

    model = os.getenv("QWEN_MODEL", "qwen-plus").strip() or "qwen-plus"

    user_prompt = (
        "Use the following structured TrueTone evidence. "
        "Do not invent source material. "
        "Do not recalculate deterministic trust or match scores; explain what those scores mean. "
        "Return one JSON object only.\n\n"
        + json.dumps(payload, ensure_ascii=False)
    )
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": load_prompt()},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.2,
        "reasoning_effort": "none",
        "max_tokens": 1200,
        "response_format": {"type": "json_object"},
    }

    req = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Model Studio HTTP {exc.code}: {detail[:1200]}") from exc

    data = json.loads(raw)
    content = data["choices"][0]["message"]["content"]
    return content if isinstance(content, dict) else json.loads(content)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_json(self, status: int, body: dict):
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Connection", "keep-alive")
        self.send_header("x-fc-status", "200" if status < 400 else "404")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/?"):
            return self._send_json(200, {
                "service": "TrueTone Agent API",
                "ok": True,
                "routes": ["/health", "/api/analyze"],
            })
        if self.path.startswith("/health"):
            return self._send_json(200, {
                "ok": True,
                "service": "truetone-agent-api",
                "model_configured": bool(
                    os.getenv("DASHSCOPE_API_KEY") and os.getenv("MODEL_STUDIO_BASE_URL")
                ),
                "model": os.getenv("QWEN_MODEL", "qwen-plus"),
            })
        self._send_json(404, {"error": "not_found"})

    def do_POST(self):
        if not self.path.startswith("/api/analyze"):
            return self._send_json(404, {"error": "not_found"})

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            return self._send_json(400, {"error": "invalid_json"})

        if not payload.get("product_key"):
            return self._send_json(400, {"error": "product_key is required"})

        try:
            result = model_call(payload)
            result["runtime"] = "aliyun-model-studio"
            return self._send_json(200, result)
        except Exception as exc:
            return self._send_json(503, {
                "error": "cloud_agent_unavailable",
                "detail": str(exc),
                "runtime": "deterministic-frontend-fallback",
            })

    def log_message(self, fmt, *args):
        print("%s - - [%s] %s" % (self.address_string(), self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    print(f"TrueTone Agent API listening on {HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
