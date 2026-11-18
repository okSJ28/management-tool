"""Task CRUD.

一般ユーザーは、担当者①・②のどちらかがログインアカウントの担当者であるタスクだけを
登録・変更・削除できる。管理者（owner / admin）はすべてのタスクを扱える。
"""

from __future__ import annotations

from typing import Iterable

from core import auth, model
from core.storage import STORE, ConflictError

from ..http import Request, Response, error, json_response
from ..router import Router

router = Router()

REQUIRED_KEYS = ("programId", "project")
_FORBIDDEN = "forbidden-task"


def _assigned(task: dict, member: str) -> bool:
    return member in (model.norm_member(task.get("assignee1")), model.norm_member(task.get("assignee2")))


def _may_write(req: Request, new_tasks: Iterable[dict] = (), ids: Iterable[str] = ()) -> bool:
    """既存のタスク（ids）と保存後の内容（new_tasks）が、すべて自分が担当者①か②のものか。

    担当者を自分以外に変えると以後は編集できなくなるため、保存後の内容も確認する。"""
    if auth.is_admin(req.account):
        return True
    own = model.norm_member((req.account or {}).get("member"))
    if not own:
        return False
    existing = {t.get("id"): t for t in STORE.tasks() if t.get("id")}
    if not all(_assigned(existing[i], own) for i in ids if i in existing):
        return False
    return all(_assigned(t, own) for t in new_tasks)


def _merged(ids: list[str], patch: dict) -> list[dict]:
    existing = {t.get("id"): t for t in STORE.tasks() if t.get("id")}
    return [{**existing[i], **patch} for i in ids if i in existing]


def _invalid(payload: dict, creating: bool) -> str | None:
    """プログラムID・案件名は両方必須（更新では送られてきたときだけ確認）。数値は 0 以上、進捗率は 0〜100。

    Excel / CSV / JSON の取込はこの API を通らないため対象外。"""
    for key in REQUIRED_KEYS:
        if (creating or key in payload) and not str(payload.get(key) or "").strip():
            return "task-required"
    for key, field in model.FIELDS.items():
        if field["type"] != "number" or payload.get(key) in (None, ""):
            continue
        value = model.to_num(payload.get(key))
        if value is not None and value < 0:
            return "invalid-number"
        if key == "progress" and value is not None and value > 100:
            return "invalid-progress"
    return None


@router.get("/api/tasks")
def list_tasks(_req: Request) -> Response:
    STORE.recompute_all()
    return json_response({"tasks": STORE.tasks()})


@router.post("/api/tasks")
def create_task(req: Request) -> Response:
    payload = req.json()
    bad = _invalid(payload, creating=True)
    if bad:
        return error(bad, 400)
    if not _may_write(req, [payload]):
        return error(_FORBIDDEN, 403)
    return json_response({"task": STORE.add_task(payload)})


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
        bad = _invalid(patch, creating=False)
        if bad:
            return error(bad, 400)
        if not _may_write(req, _merged(ids, patch), ids):
            return error(_FORBIDDEN, 403)
        updated = [STORE.update_task(i, patch) for i in ids]
        return json_response({"updated": len([u for u in updated if u])})
    return error("unknown-action", 400)


@router.put("/api/tasks/{task_id}")
def update_task(req: Request) -> Response:
    patch = req.json()
    base = patch.pop("_baseUpdatedAt", None)
    bad = _invalid(patch, creating=False)
    if bad:
        return error(bad, 400)
    task_id = req.params["task_id"]
    if not _may_write(req, _merged([task_id], patch), [task_id]):
        return error(_FORBIDDEN, 403)
    try:
        task = STORE.update_task(task_id, patch, base)
    except ConflictError:
        return error("conflict", 409)
    return json_response({"task": task}) if task else error("not-found", 404)


@router.delete("/api/tasks/{task_id}")
def delete_task(req: Request) -> Response:
    if not _may_write(req, ids=[req.params["task_id"]]):
        return error(_FORBIDDEN, 403)
    return json_response({"removed": STORE.delete_tasks([req.params["task_id"]])})
