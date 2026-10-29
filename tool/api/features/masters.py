"""Master data (members, projects, settings) - administrators only."""

from __future__ import annotations

from core.storage import STORE

from ..http import Request, Response, error, json_response
from ..router import ADMIN, Router

router = Router()


def _update(req: Request) -> Response:
    try:
        return json_response({"masters": STORE.update_masters(req.json())})
    except ValueError:
        return error("invalid-settings", 400)


router.put("/api/masters", auth=ADMIN)(_update)
router.post("/api/masters", auth=ADMIN)(_update)
