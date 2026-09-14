"""API layer: transport-agnostic request/response objects plus the router.

`build_router()` discovers every module under `api.features` and merges the
router it exposes, so a feature can be added or removed by dropping a single
file into that package.
"""

from __future__ import annotations

from . import features
from .http import ApiError, Request, Response, attachment, error, json_response
from .router import Router

__all__ = ["ApiError", "Request", "Response", "Router", "attachment", "error",
           "json_response", "build_router", "feature_names"]

_ROUTER: Router | None = None


def build_router(refresh: bool = False) -> Router:
    global _ROUTER
    if _ROUTER is not None and not refresh:
        return _ROUTER
    root = Router()
    for module in features.discover():
        sub = getattr(module, "router", None)
        if isinstance(sub, Router):
            root.include(sub)
    _ROUTER = root
    return root


def feature_names() -> list[str]:
    return [m.__name__.rsplit(".", 1)[-1] for m in features.discover()]
