"""Feature package.

Every module here is an independent slice of the API.  It only has to expose
a module level `router` object; `api.build_router()` finds and merges it.
"""

from __future__ import annotations

import importlib
import pkgutil
from types import ModuleType

_CACHE: list[ModuleType] | None = None


def discover(refresh: bool = False) -> list[ModuleType]:
    global _CACHE
    if _CACHE is not None and not refresh:
        return _CACHE
    modules: list[ModuleType] = []
    for info in sorted(pkgutil.iter_modules(__path__), key=lambda i: i.name):
        if info.name.startswith("_"):
            continue
        modules.append(importlib.import_module(f"{__name__}.{info.name}"))
    _CACHE = modules
    return modules
