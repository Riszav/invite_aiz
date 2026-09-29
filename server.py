#!/usr/bin/env python3
"""Static server for the invitation + tiny JSON API for RSVP answers and wishes.

Usage: python3 server.py [port]   (default 8080)
Answers and wishes are stored in SQLite: data/invite.db (tables rsvp, wishes).
Old data/rsvp.json and data/wishes.json are imported once on first start.
Page content (texts, date, images, music) is stored in the `page` table, seeded from
data.js, served to the site as /page-data.js and editable from /admin.
Guest responses are viewable at /admin (login: any username, password: ADMIN_PASSWORD).
"""

import base64
import json
import os
import sqlite3
import re
import sys
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
DB_PATH = os.path.join(DATA_DIR, "invite.db")
UPLOAD_DIR = os.path.join(ROOT, "uploads")
UPLOAD_TYPES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp3", ".m4a", ".ogg", ".wav"}
MAX_UPLOAD = 25 * 1024 * 1024
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "0601")

SCHEMA = """
CREATE TABLE IF NOT EXISTS rsvp (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    answer      TEXT NOT NULL,
    answer_text TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wishes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    text        TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS page (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    data        TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
"""


def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def query(sql, args=()):
    conn = db()
    try:
        return [dict(r) for r in conn.execute(sql, args)]
    finally:
        conn.close()


def execute(sql, args=()):
    conn = db()
    try:
        with conn:
            return conn.execute(sql, args).rowcount
    finally:
        conn.close()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def get_page():
    return json.loads(query("SELECT data FROM page WHERE id = 1")[0]["data"])


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = db()
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        # one-time import of the old JSON storage
        for table, cols in (("rsvp", ("name", "answer", "answer_text", "created_at")),
                            ("wishes", ("name", "text", "created_at"))):
            path = os.path.join(DATA_DIR, table + ".json")
            if not os.path.exists(path):
                continue
            with open(path, encoding="utf-8") as f:
                items = json.load(f)
            with conn:
                conn.executemany(
                    f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                    [tuple(i.get(c, "") for c in cols) for i in items],
                )
            os.rename(path, path + ".imported")
            print(f"Imported {len(items)} rows from {table}.json")
        # seed page content from data.js
        if not conn.execute("SELECT 1 FROM page WHERE id = 1").fetchone():
            with open(os.path.join(ROOT, "data.js"), encoding="utf-8") as f:
                raw = re.sub(r"^\s*window\.PAGE_DATA\s*=\s*", "", f.read()).strip().rstrip(";")
            with conn:
                conn.execute("INSERT INTO page (id, data, updated_at) VALUES (1, ?, ?)",
                             (json.dumps(json.loads(raw), ensure_ascii=False), now_iso()))
            print("Seeded page content from data.js")
    finally:
        conn.close()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def is_admin(self):
        if not ADMIN_PASSWORD:
            return True
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Basic "):
            try:
                _, _, pwd = base64.b64decode(auth[6:]).decode().partition(":")
                if pwd == ADMIN_PASSWORD:
                    return True
            except ValueError:
                pass
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="admin"')
        self.end_headers()
        return False

    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/data/") or path.endswith(".py"):
            return self.send_error(404)
        if path == "/api/wishes":
            return self.send_json(query("SELECT * FROM wishes ORDER BY id DESC"))
        if path == "/page-data.js":
            body = ("window.PAGE_DATA = " + json.dumps(get_page(), ensure_ascii=False) + ";\n").encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if path == "/api/page":
            return self.send_json(get_page())
        if path in ("/admin", "/admin/", "/admin.html", "/api/rsvp"):
            if not self.is_admin():
                return
            if path == "/api/rsvp":
                return self.send_json(query("SELECT * FROM rsvp ORDER BY id"))
            self.path = "/admin.html"
        return super().do_GET()

    def do_DELETE(self):
        # /api/rsvp?id=<id> or /api/wishes?id=<id>
        path, _, qs = self.path.partition("?")
        tables = {"/api/rsvp": "rsvp", "/api/wishes": "wishes"}
        if path not in tables:
            return self.send_json({"error": "not found"}, 404)
        if not self.is_admin():
            return
        try:
            item_id = int(parse_qs(qs).get("id", [""])[0])
        except ValueError:
            return self.send_json({"error": "bad id"}, 400)
        deleted = execute(f"DELETE FROM {tables[path]} WHERE id = ?", (item_id,))
        return self.send_json({"ok": True, "deleted": deleted})

    def do_PUT(self):
        if self.path != "/api/page":
            return self.send_json({"error": "not found"}, 404)
        if not self.is_admin():
            return
        try:
            length = min(int(self.headers.get("Content-Length", 0)), 2_000_000)
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict) or not isinstance(data.get("blocks"), list):
                raise ValueError
        except ValueError:
            return self.send_json({"error": "bad page data"}, 400)
        execute("UPDATE page SET data = ?, updated_at = ? WHERE id = 1",
                (json.dumps(data, ensure_ascii=False), now_iso()))
        return self.send_json({"ok": True})

    def handle_upload(self):
        if not self.is_admin():
            return
        ext = os.path.splitext(self.headers.get("X-Filename", ""))[1].lower()
        if ext not in UPLOAD_TYPES:
            return self.send_json({"error": "unsupported file type"}, 400)
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= MAX_UPLOAD:
            return self.send_json({"error": "file too large"}, 400)
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        name = uuid.uuid4().hex + ext
        with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
            f.write(self.rfile.read(length))
        return self.send_json({"ok": True, "url": "/uploads/" + name})

    def do_POST(self):
        if self.path == "/api/upload":
            return self.handle_upload()
        try:
            length = min(int(self.headers.get("Content-Length", 0)), 20_000)
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self.send_json({"error": "bad json"}, 400)
        now = now_iso()

        if self.path == "/api/rsvp":
            name = str(payload.get("name", "")).strip()[:80]
            if not name:
                return self.send_json({"error": "name required"}, 400)
            execute(
                "INSERT INTO rsvp (name, answer, answer_text, created_at) VALUES (?, ?, ?, ?)",
                (name, str(payload.get("answer", ""))[:20], str(payload.get("answer_text", ""))[:80], now),
            )
            return self.send_json({"ok": True})

        if self.path == "/api/wishes":
            name = str(payload.get("name", "")).strip()[:80]
            text = str(payload.get("text", "")).strip()[:1000]
            if not name or not text:
                return self.send_json({"error": "name and text required"}, 400)
            execute("INSERT INTO wishes (name, text, created_at) VALUES (?, ?, ?)", (name, text, now))
            return self.send_json({"ok": True})

        return self.send_json({"error": "not found"}, 404)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    init_db()
    print(f"Serving on http://localhost:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
