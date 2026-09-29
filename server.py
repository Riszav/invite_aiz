#!/usr/bin/env python3
"""Local / Docker runner for the invitation WSGI app (see app.py).

Usage: python3 server.py [port]   (default 8080)
On PythonAnywhere this file is not used: the WSGI config imports `application` from app.py.
"""

import sys
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

from app import application


class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"Serving on http://localhost:{port}")
    make_server("0.0.0.0", port, application, ThreadingWSGIServer, WSGIRequestHandler).serve_forever()
