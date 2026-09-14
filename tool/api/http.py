"""Request / response value objects shared by every feature module."""

from __future__ import annotations

import json
import urllib.parse
from dataclasses import dataclass, field
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

    @property
    def user(self) -> str:
        raw = self.headers.get("X-User") or ""
        try:
            name = urllib.parse.unquote(raw)
        except Exception:  # noqa: BLE001
            name = ""
        return name.strip()[:40] or "unknown"

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


def json_response(payload: Any, status: int = 200) -> Response:
    return Response(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def error(message: str, status: int = 400) -> Response:
    return json_response({"error": message}, status)


def attachment(body: bytes, content_type: str, filename: str) -> Response:
    quoted = urllib.parse.quote(filename)
    return Response(200, body, content_type,
                    {"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"})
