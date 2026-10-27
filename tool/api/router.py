"""Tiny path router.

Patterns use `{name}` placeholders, e.g. `/api/tasks/{task_id}`.
Literal segments always win over placeholders, so `/api/tasks/bulk` is
matched before `/api/tasks/{task_id}`.

Every route has an access level: PUBLIC (no login), USER (any signed-in
user, the default) or ADMIN.  The server enforces it before calling the
handler.
"""

from __future__ import annotations

from typing import Callable

from .http import Request, Response

Handler = Callable[[Request], Response]

PUBLIC = "public"
USER = "user"
ADMIN = "admin"


class Route:
    __slots__ = ("method", "path", "segments", "handler", "wildcards", "auth")

    def __init__(self, method: str, path: str, handler: Handler, auth: str = USER) -> None:
        self.method = method.upper()
        self.path = path
        self.segments = [s for s in path.strip("/").split("/")]
        self.handler = handler
        self.wildcards = sum(1 for s in self.segments if s.startswith("{"))
        self.auth = auth

    def match(self, segments: list[str]) -> dict[str, str] | None:
        if len(segments) != len(self.segments):
            return None
        params: dict[str, str] = {}
        for pattern, value in zip(self.segments, segments):
            if pattern.startswith("{") and pattern.endswith("}"):
                if not value:
                    return None
                params[pattern[1:-1]] = value
            elif pattern != value:
                return None
        return params


class Router:
    def __init__(self) -> None:
        self._routes: list[Route] = []

    # ------------------------------------------------------ registration
    def add(self, method: str, path: str, handler: Handler, auth: str = USER) -> None:
        self._routes.append(Route(method, path, handler, auth))
        self._routes.sort(key=lambda r: r.wildcards)

    def include(self, other: "Router") -> None:
        for route in other._routes:
            self.add(route.method, route.path, route.handler, route.auth)

    def _decorator(self, method: str, path: str, auth: str):
        def wrap(fn: Handler) -> Handler:
            self.add(method, path, fn, auth)
            return fn
        return wrap

    def get(self, path: str, auth: str = USER):
        return self._decorator("GET", path, auth)

    def post(self, path: str, auth: str = USER):
        return self._decorator("POST", path, auth)

    def put(self, path: str, auth: str = USER):
        return self._decorator("PUT", path, auth)

    def delete(self, path: str, auth: str = USER):
        return self._decorator("DELETE", path, auth)

    # ---------------------------------------------------------- dispatch
    def resolve(self, method: str, path: str) -> tuple[Route, dict[str, str]] | None:
        segments = [s for s in path.strip("/").split("/")]
        for route in self._routes:
            if route.method != method.upper():
                continue
            params = route.match(segments)
            if params is not None:
                return route, params
        return None

    def path_exists(self, path: str) -> bool:
        segments = [s for s in path.strip("/").split("/")]
        return any(route.match(segments) is not None for route in self._routes)

    def describe(self) -> list[str]:
        return sorted(f"{r.method} {r.path}" + (f"  [{r.auth}]" if r.auth != USER else "")
                      for r in self._routes)
