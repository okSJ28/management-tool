"""User defined saved views."""

from __future__ import annotations

from core.storage import STORE

from ..http import Request, Response, json_response
from ..router import Router

router = Router()


def _save_views(req: Request) -> Response:
    data = STORE.load()
    data["savedViews"] = req.json().get("savedViews") or []
    STORE._pending["views"] = True
    STORE.save()
    return json_response({"savedViews": data["savedViews"]})


router.put("/api/views")(_save_views)
router.post("/api/views")(_save_views)
