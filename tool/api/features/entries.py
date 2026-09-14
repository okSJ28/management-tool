"""Monthly member entries."""

from __future__ import annotations

from core.storage import STORE

from ..http import Request, Response, json_response
from ..router import Router

router = Router()


def _set_entry(req: Request) -> Response:
    payload = req.json()
    entries = STORE.set_entry(payload.get("member", ""),
                              payload.get("month", ""),
                              payload.get("value"))
    return json_response({"entries": entries})


router.put("/api/entries")(_set_entry)
router.post("/api/entries")(_set_entry)
