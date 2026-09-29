"""WSGI application for the invitation: static site + JSON API for RSVP answers and wishes.

Works on any WSGI host (PythonAnywhere, gunicorn, ...) and locally via server.py.
Answers and wishes are stored in SQLite: data/invite.db (tables rsvp, wishes).
Old data/rsvp.json and data/wishes.json are imported once on first start.
Page content (texts, date, images, music) is stored in the `page` table, seeded from
data.js, served to the site as /page-data.js and editable from /admin.
Guest responses are viewable at /admin (login: any username, password: ADMIN_PASSWORD).
"""

import base64
import json
import mimetypes
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from urllib.parse import parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
DB_PATH = os.path.join(DATA_DIR, "invite.db")
UPLOAD_DIR = os.path.join(ROOT, "uploads")
UPLOAD_TYPES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp3", ".m4a", ".ogg", ".wav"}
MAX_UPLOAD = 25 * 1024 * 1024
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "0601")

# files of the site itself that may be served; everything else except uploads/ is private
PUBLIC_FILES = {"index.html", "app.js", "style.css"}

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


# ---------------- database ----------------

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


# ---------------- request / response helpers ----------------

class Request:
    def __init__(self, environ):
        self.environ = environ
        self.method = environ["REQUEST_METHOD"]
        self.path = environ.get("PATH_INFO", "/") or "/"
        self.query = parse_qs(environ.get("QUERY_STRING", ""))

    def header(self, name, default=""):
        return self.environ.get("HTTP_" + name.upper().replace("-", "_"), default)

    @property
    def length(self):
        try:
            return int(self.environ.get("CONTENT_LENGTH") or 0)
        except ValueError:
            return 0

    def read(self, limit):
        return self.environ["wsgi.input"].read(min(self.length, limit))

    def json(self, limit):
        return json.loads(self.read(limit) or b"{}")


def response(status, body=b"", content_type="text/plain; charset=utf-8", headers=()):
    if isinstance(body, str):
        body = body.encode()
    hdrs = [("Content-Type", content_type), ("Content-Length", str(len(body)))] + list(headers)
    return status, hdrs, body


def json_response(obj, status="200 OK"):
    return response(status, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")


NOT_FOUND = ("404 Not Found", [("Content-Type", "text/plain"), ("Content-Length", "9")], b"Not found")


def is_admin(req):
    if not ADMIN_PASSWORD:
        return True
    auth = req.header("Authorization")
    if auth.startswith("Basic "):
        try:
            _, _, pwd = base64.b64decode(auth[6:]).decode().partition(":")
            if pwd == ADMIN_PASSWORD:
                return True
        except ValueError:
            pass
    return False


UNAUTHORIZED = ("401 Unauthorized",
                [("WWW-Authenticate", 'Basic realm="admin"'), ("Content-Type", "text/plain"), ("Content-Length", "12")],
                b"Unauthorized")


def serve_file(path, cache="no-cache"):
    if not os.path.isfile(path):
        return NOT_FOUND
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/javascript", "text/javascript"):
        ctype += "; charset=utf-8"
    with open(path, "rb") as f:
        return response("200 OK", f.read(), ctype, [("Cache-Control", cache)])


# ---------------- routes ----------------

def handle(req):
    path, method = req.path, req.method

    if method == "GET":
        if path in ("/", "/index.html"):
            return serve_file(os.path.join(ROOT, "index.html"))
        if path.lstrip("/") in PUBLIC_FILES:
            return serve_file(os.path.join(ROOT, path.lstrip("/")))
        if path.startswith("/uploads/"):
            name = os.path.basename(path)  # no subdirectories, no traversal
            return serve_file(os.path.join(UPLOAD_DIR, name), "public, max-age=31536000")
        if path == "/page-data.js":
            body = "window.PAGE_DATA = " + json.dumps(get_page(), ensure_ascii=False) + ";\n"
            return response("200 OK", body, "application/javascript; charset=utf-8", [("Cache-Control", "no-cache")])
        if path == "/api/page":
            return json_response(get_page())
        if path == "/api/wishes":
            return json_response(query("SELECT * FROM wishes ORDER BY id DESC"))
        if path in ("/admin", "/admin/", "/admin.html"):
            return serve_file(os.path.join(ROOT, "admin.html")) if is_admin(req) else UNAUTHORIZED
        if path == "/api/rsvp":
            return json_response(query("SELECT * FROM rsvp ORDER BY id")) if is_admin(req) else UNAUTHORIZED
        return NOT_FOUND

    if method == "POST":
        if path == "/api/upload":
            return upload(req)
        if path not in ("/api/rsvp", "/api/wishes"):
            return NOT_FOUND
        try:
            payload = req.json(20_000)
        except ValueError:
            return json_response({"error": "bad json"}, "400 Bad Request")
        name = str(payload.get("name", "")).strip()[:80]
        if path == "/api/rsvp":
            if not name:
                return json_response({"error": "name required"}, "400 Bad Request")
            execute("INSERT INTO rsvp (name, answer, answer_text, created_at) VALUES (?, ?, ?, ?)",
                    (name, str(payload.get("answer", ""))[:20], str(payload.get("answer_text", ""))[:80], now_iso()))
            return json_response({"ok": True})
        text = str(payload.get("text", "")).strip()[:1000]
        if not name or not text:
            return json_response({"error": "name and text required"}, "400 Bad Request")
        execute("INSERT INTO wishes (name, text, created_at) VALUES (?, ?, ?)", (name, text, now_iso()))
        return json_response({"ok": True})

    if method == "PUT" and path == "/api/page":
        if not is_admin(req):
            return UNAUTHORIZED
        try:
            data = req.json(2_000_000)
            if not isinstance(data, dict) or not isinstance(data.get("blocks"), list):
                raise ValueError
        except ValueError:
            return json_response({"error": "bad page data"}, "400 Bad Request")
        execute("UPDATE page SET data = ?, updated_at = ? WHERE id = 1",
                (json.dumps(data, ensure_ascii=False), now_iso()))
        return json_response({"ok": True})

    if method == "DELETE":
        # /api/rsvp?id=<id> or /api/wishes?id=<id>
        tables = {"/api/rsvp": "rsvp", "/api/wishes": "wishes"}
        if path not in tables:
            return NOT_FOUND
        if not is_admin(req):
            return UNAUTHORIZED
        try:
            item_id = int(req.query.get("id", [""])[0])
        except ValueError:
            return json_response({"error": "bad id"}, "400 Bad Request")
        deleted = execute(f"DELETE FROM {tables[path]} WHERE id = ?", (item_id,))
        return json_response({"ok": True, "deleted": deleted})

    return ("405 Method Not Allowed", [("Content-Type", "text/plain"), ("Content-Length", "18")],
            b"Method Not Allowed")


def upload(req):
    if not is_admin(req):
        return UNAUTHORIZED
    ext = os.path.splitext(req.header("X-Filename"))[1].lower()
    if ext not in UPLOAD_TYPES:
        return json_response({"error": "unsupported file type"}, "400 Bad Request")
    if not 0 < req.length <= MAX_UPLOAD:
        return json_response({"error": "file too large"}, "400 Bad Request")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    name = uuid.uuid4().hex + ext
    with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
        f.write(req.read(MAX_UPLOAD))
    return json_response({"ok": True, "url": "/uploads/" + name})


# ---------------- WSGI entry point ----------------

init_db()


def application(environ, start_response):
    status, headers, body = handle(Request(environ))
    start_response(status, headers)
    return [body] if environ["REQUEST_METHOD"] != "HEAD" else [b""]
