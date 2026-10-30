"""本地预览用的假后端：模仿 Supabase 的 PostgREST 接口，够跑通这个页面。

用法（在 lab-checkin 目录下）：
    py dev/mock.py
然后浏览器打开 http://127.0.0.1:8788

数据只存在内存里，关掉就没了，不会碰到真正的 Supabase。
"""

import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = {}
PORT = 8788


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, *args):
        pass

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/rest/v1/"):
            rows = list(DB.values())
            since = parse_qs(parsed.query).get("at", [None])[0]
            if since and since.startswith("gte."):
                rows = [r for r in rows if r["at"] >= since[4:]]
            rows.sort(key=lambda r: r["at"], reverse="desc" in parsed.query)
            return self._json(rows)
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/rest/v1/"):
            length = int(self.headers.get("Content-Length") or 0)
            rows = json.loads(self.rfile.read(length) or b"[]")
            for row in rows:
                DB.setdefault(row["id"], row)
            self.send_response(201)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_error(404)


if __name__ == "__main__":
    print(f"预览地址 http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
