"""Static file serving for the bundled web client."""

from __future__ import annotations

import mimetypes
import posixpath
import urllib.parse
from pathlib import Path

from .http import Response, error

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

_TEXT_TYPES = ("text/", "application/javascript", "application/json")


def serve(web_dir: Path, route: str) -> Response:
    if route in ("/", ""):
        route = "/index.html"
    rel = posixpath.normpath(urllib.parse.unquote(route)).lstrip("/")
    root = Path(web_dir).resolve()
    target = (root / rel).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return error("forbidden", 403)
    if not target.is_file():
        return error("not-found", 404)
    ctype, _ = mimetypes.guess_type(str(target))
    if ctype and ctype.startswith(_TEXT_TYPES):
        ctype = f"{ctype}; charset=utf-8"
    return Response(200, target.read_bytes(), ctype or "application/octet-stream")
