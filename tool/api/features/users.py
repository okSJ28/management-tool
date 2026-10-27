"""Login user management (administrators only)."""

from __future__ import annotations

from core import auth
from core.storage import STORE

from ..http import Request, Response, error, json_response
from ..router import ADMIN, Router

router = Router()


@router.get("/api/users", auth=ADMIN)
def list_users(_req: Request) -> Response:
    return json_response({"users": auth.list_users()})


@router.post("/api/users", auth=ADMIN)
def create_user(req: Request) -> Response:
    try:
        user = auth.create_user(req.json())
    except auth.AccountError as exc:
        return error(exc.code, exc.status)
    return json_response({"user": user, "masters": STORE.load()["masters"]})


@router.put("/api/users/{user_id}", auth=ADMIN)
def update_user(req: Request) -> Response:
    try:
        user = auth.update_user(req.params["user_id"], req.json())
    except auth.AccountError as exc:
        return error(exc.code, exc.status)
    return json_response({"user": user, "masters": STORE.load()["masters"]})


@router.delete("/api/users/{user_id}", auth=ADMIN)
def delete_user(req: Request) -> Response:
    try:
        auth.delete_user(req.params["user_id"], req.account["id"])
    except auth.AccountError as exc:
        return error(exc.code, exc.status)
    return json_response({"ok": True})
