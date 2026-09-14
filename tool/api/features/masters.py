"""Master data (members, projects, settings)."""

from __future__ import annotations

from core.storage import STORE

from ..http import Request, Response, json_response
from ..router import Router

router = Router()


def _update(req: Request) -> Response:
    return json_response({"masters": STORE.update_masters(req.json())})


router.put("/api/masters")(_update)
router.post("/api/masters")(_update)
