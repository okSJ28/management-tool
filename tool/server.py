"""HTTP transport for the development program management tool.

This module only speaks HTTP: every endpoint lives in an independent module
under `api/features/`, and persistence lives in `core/`.

Usage:  python server.py [--port 8765] [--host 0.0.0.0] [--no-browser]
        python server.py --routes        # list the registered endpoints
Configuration can also be supplied through DPM_* environment variables.
"""

from __future__ import annotations

import argparse
import gzip
import json
import socket
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from api import build_router, static_files
from api.http import ApiError, Request, Response, error
from core import storage
from core.config import CONFIG
from core.storage import STORE

ROUTER = build_router()
SAFE_METHODS = {"GET", "HEAD"}
_LOG_LOCK = threading.Lock()
_COMPRESSIBLE = ("application/json", "text/", "application/javascript",
                 "image/svg+xml", "text/csv")


def _compressible(content_type: str) -> bool:
    ctype = (content_type or "").lower()
    return any(ctype.startswith(prefix) for prefix in _COMPRESSIBLE)


def log(line: str) -> None:
    text = f"[{time.strftime('%H:%M:%S')}] {line}"
    print(text, flush=True)
    with _LOG_LOCK:
        try:
            CONFIG.log_path.parent.mkdir(parents=True, exist_ok=True)
            with open(CONFIG.log_path, "ab") as fh:
                fh.write((text + "\n").encode("utf-8"))
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    server_version = "DevMgmt/2.0"
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------ output
    def _write(self, response: Response) -> None:
        body = response.body
        encoding = None
        if (self.command != "HEAD" and len(body) >= CONFIG.gzip_min
                and "gzip" in (self.headers.get("Accept-Encoding") or "").lower()
                and _compressible(response.content_type)):
            body = gzip.compress(body, 5)
            encoding = "gzip"

        self.send_response(response.status)
        self.send_header("Content-Type", response.content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if encoding:
            self.send_header("Content-Encoding", encoding)
            self.send_header("Vary", "Accept-Encoding")
        for key, value in response.headers.items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
            self.wfile.flush()
        elapsed = (time.time() - getattr(self, "_t0", time.time())) * 1000
        size = f"{len(body)}B" if encoding is None else f"{len(body)}B(gz/{len(response.body)})"
        log(f"{self.command} {self.path} -> {response.status} {size} {elapsed:.0f}ms")

    # ------------------------------------------------------------- input
    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return b""
        if length > CONFIG.max_body:
            self.close_connection = True
            raise ApiError("payload-too-large", 413)
        return self.rfile.read(length)

    def _host_ok(self) -> bool:
        """Reject Host headers we do not listen on (DNS rebinding guard)."""
        allowed = CONFIG.allowed_hosts
        if not allowed:
            return True
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        return host in allowed

    def log_message(self, fmt, *args):  # replaced by the explicit request log
        pass

    def handle_one_request(self):
        self._t0 = time.time()
        super().handle_one_request()

    # ---------------------------------------------------------- dispatch
    def do_GET(self):
        self._dispatch(self.command)

    do_HEAD = do_GET
    do_POST = do_GET
    do_PUT = do_GET
    do_DELETE = do_GET

    def _dispatch(self, method: str) -> None:
        parsed = urllib.parse.urlparse(self.path)
        route = parsed.path
        if not self._host_ok():
            return self._write(error("host-not-allowed", 403))
        if not route.startswith("/api/"):
            if method in SAFE_METHODS:
                return self._write(static_files.serve(CONFIG.web_dir, route))
            return self._write(error("not-found", 404))
        if CONFIG.read_only and method not in SAFE_METHODS:
            return self._write(error("read-only-mode", 403))

        match = ROUTER.resolve("GET" if method == "HEAD" else method, route)
        if match is None:
            if ROUTER.path_exists(route):
                return self._write(error("method-not-allowed", 405))
            return self._write(error("not-found", 404))

        handler, params = match
        try:
            request = Request(method=method, path=route,
                              query=urllib.parse.parse_qs(parsed.query),
                              params=params, headers=dict(self.headers),
                              body=self._read_body())
            return self._write(handler(request))
        except ApiError as exc:
            return self._write(error(exc.message, exc.status))
        except json.JSONDecodeError:
            return self._write(error("invalid-json", 400))
        except Exception as exc:  # noqa: BLE001
            log(f"ERROR {method} {route}: {type(exc).__name__}: {exc}")
            return self._write(error("internal-error", 500))


class _V6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def _start(server_cls, host: str, port: int) -> ThreadingHTTPServer | None:
    try:
        httpd = server_cls((host, port), Handler)
    except OSError:
        return None
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def _local_ips() -> list[str]:
    ips: list[str] = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except OSError:
        pass
    return ips


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--host", default=None)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--share", action="store_true",
                        help="listen on the LAN so co-workers can use the tool")
    parser.add_argument("--read-only", action="store_true")
    parser.add_argument("--data", default=None,
                        help="data folder (e.g. a shared network path)")
    parser.add_argument("--routes", action="store_true",
                        help="print the registered API routes and exit")
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    if args.routes:
        print("\n".join(ROUTER.describe()))
        return

    if args.data:
        storage.configure(Path(args.data))
    if args.port:
        CONFIG.port = args.port
    if args.read_only:
        CONFIG.read_only = True
    if args.share:
        CONFIG.host = "0.0.0.0"
    if args.host:
        CONFIG.host = args.host
    if args.no_browser:
        CONFIG.open_browser = False

    primary = None
    port = CONFIG.port
    for candidate in range(CONFIG.port, CONFIG.port + max(1, CONFIG.port_scan)):
        primary = _start(ThreadingHTTPServer, CONFIG.host, candidate)
        if primary is not None:
            port = candidate
            break
    if primary is None:
        raise SystemExit("no free port")
    CONFIG.port = port

    ips = _local_ips()
    if CONFIG.shared:
        if not CONFIG.allowed_hosts_raw:
            CONFIG.set_allowed_hosts({"localhost", "127.0.0.1", "::1",
                                      socket.gethostname().lower(), *ips})
    else:
        # localhost may resolve to ::1 first; listen there too.
        _start(_V6Server, "::1", port)

    try:
        CONFIG.log_path.parent.mkdir(parents=True, exist_ok=True)
        CONFIG.log_path.write_bytes(b"")
    except OSError:
        pass

    url = f"http://localhost:{port}/"
    print("=" * 62)
    print("  Development Program Management Tool")
    print(f"  URL      : {url}")
    if CONFIG.shared:
        print("  Share    : give the following URL to your team")
        for ip in ips:
            print(f"             http://{ip}:{port}/")
    else:
        print(f"             http://127.0.0.1:{port}/")
        print("  Share    : off (run with --share to allow LAN access)")
    if CONFIG.read_only:
        print("  Mode     : READ ONLY")
    print(f"  Folder   : {CONFIG.files_dir}")
    print(f"  Database : {STORE.path}")
    print(f"  Log      : {CONFIG.log_path}")
    print(f"  Endpoints: {len(ROUTER.describe())}")
    print("  Press Ctrl+C to stop.")
    print("=" * 62)

    if CONFIG.open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        primary.shutdown()
        primary.server_close()


if __name__ == "__main__":
    main()
