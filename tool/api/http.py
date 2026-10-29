"""Request / response value objects shared by every feature module."""

from __future__ import annotations

import json
import math
import urllib.parse
from dataclasses import dataclass, field
from http.cookies import CookieError, SimpleCookie
from typing import Any


class ApiError(Exception):
    """Raised by a feature to return a controlled HTTP error."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class Request:
    method: str
    path: str
    query: dict[str, list[str]] = field(default_factory=dict)
    params: dict[str, str] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b""
    # The signed-in user (set by the server from the session cookie).
    account: dict[str, Any] | None = None

    @property
    def user(self) -> str:
        """Name recorded as the editor: the signed-in user's member name."""
        account = self.account or {}
        return (account.get("member") or account.get("name") or "unknown")[:40]

    def cookie(self, name: str) -> str:
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie") or "")
        except CookieError:
            return ""
        morsel = jar.get(name)
        return morsel.value if morsel else ""

    def json(self) -> dict:
        if not self.body:
            return {}
        payload = json.loads(self.body.decode("utf-8"))
        return payload if isinstance(payload, dict) else {}

    def q(self, name: str, default: str = "") -> str:
        values = self.query.get(name) or []
        return values[0] if values else default

    def q_list(self, name: str) -> list[str]:
        return [v for v in self.q(name).split(",") if v]


@dataclass
class Response:
    status: int = 200
    body: bytes = b""
    content_type: str = "application/json; charset=utf-8"
    headers: dict[str, str] = field(default_factory=dict)


def _finite(value: Any) -> Any:
    """Replace NaN / Infinity (invalid in JSON) with None, recursively."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _finite(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_finite(v) for v in value]
    return value


def json_response(payload: Any, status: int = 200) -> Response:
    try:
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False)
    except ValueError:
        # 古いデータに NaN などが残っていても、ブラウザが解析できる JSON を返す
        body = json.dumps(_finite(payload), ensure_ascii=False)
    return Response(status, body.encode("utf-8"))


def error(message: str, status: int = 400) -> Response:
    return json_response({"error": message}, status)


def attachment(body: bytes, content_type: str, filename: str) -> Response:
    quoted = urllib.parse.quote(filename)
    return Response(200, body, content_type,
                    {"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"})
