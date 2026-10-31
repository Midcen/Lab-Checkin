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
PORT = 8788

# 表名 -> {主键: 行}
DB = {"visits": {}, "people": {}}


def pick(row):
    """people 表的主键是 name，visits 表是 id"""
    return row.get("id") or row.get("name")


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
            table = parsed.path.rsplit("/", 1)[-1]
            rows = list(DB.get(table, {}).values())
            since = parse_qs(parsed.query).get("at", [None])[0]
            if since and since.startswith("gte."):
                rows = [r for r in rows if r.get("at", "") >= since[4:]]
            key = "at" if table == "visits" else "created_at"
            rows.sort(key=lambda r: r.get(key, ""), reverse="desc" in parsed.query)
            return self._json(rows)
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/rest/v1/"):
            table = parsed.path.rsplit("/", 1)[-1]
            length = int(self.headers.get("Content-Length") or 0)
            rows = json.loads(self.rfile.read(length) or b"[]")
            store = DB.setdefault(table, {})
            for row in rows:
                store.setdefault(pick(row), row)
            self.send_response(201)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_error(404)


if __name__ == "__main__":
    print(f"预览地址 http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
