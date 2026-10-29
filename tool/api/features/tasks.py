"""Task CRUD."""

from __future__ import annotations

from core import auth
from core.storage import STORE, ConflictError

from ..http import Request, Response, error, json_response
from ..router import Router

router = Router()


@router.get("/api/tasks")
def list_tasks(_req: Request) -> Response:
    STORE.recompute_all()
    return json_response({"tasks": STORE.tasks()})


@router.post("/api/tasks")
def create_task(req: Request) -> Response:
    return json_response({"task": STORE.add_task(req.json())})


@router.post("/api/tasks/bulk")
def bulk(req: Request) -> Response:
    payload = req.json()
    action = payload.get("action")
    ids = payload.get("ids") or []
    if action == "delete":
        # 一括削除は誤操作時の影響が大きいため管理者のみ
        if not auth.is_admin(req.account):
            return error("forbidden", 403)
        return json_response({"removed": STORE.delete_tasks(ids)})
    if action == "patch":
        patch = payload.get("patch") or {}
        updated = [STORE.update_task(i, patch) for i in ids]
        return json_response({"updated": len([u for u in updated if u])})
    return error("unknown-action", 400)


@router.put("/api/tasks/{task_id}")
def update_task(req: Request) -> Response:
    patch = req.json()
    base = patch.pop("_baseUpdatedAt", None)
    try:
        task = STORE.update_task(req.params["task_id"], patch, base)
    except ConflictError:
        return error("conflict", 409)
    return json_response({"task": task}) if task else error("not-found", 404)


@router.delete("/api/tasks/{task_id}")
def delete_task(req: Request) -> Response:
    return json_response({"removed": STORE.delete_tasks([req.params["task_id"]])})
