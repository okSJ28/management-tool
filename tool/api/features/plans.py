"""Work plan (business schedule) CRUD.

一般ユーザーは、ログインアカウントに紐づく担当者の記録だけを登録・変更・削除できる。
管理者（owner / admin）は全担当者の記録を扱える。
"""

from __future__ import annotations

from typing import Iterable

from core import auth
from core.storage import STORE

from ..http import Request, Response, error, json_response
from ..router import Router

router = Router()

_FORBIDDEN = "forbidden-member"


def _may_write(req: Request, new_records: Iterable[dict] = (), ids: Iterable[str] = ()) -> bool:
    """新しい内容（new_records）と既存の記録（ids）がすべて自分の担当者の分か。"""
    if auth.is_admin(req.account):
        return True
    own = (req.account or {}).get("member") or ""
    if not own:
        return False
    existing = {p.get("id"): p.get("member") for p in STORE.plans() if p.get("id")}
    for r in new_records:
        # 担当者を省略した場合は、既存の記録の担当者のまま更新される
        member = r["member"] if "member" in r else existing.get(r.get("id"))
        if member != own:
            return False
    return all(existing[i] == own for i in ids if i in existing)


@router.get("/api/plans")
def list_plans(_req: Request) -> Response:
    return json_response({"plans": STORE.plans()})


@router.post("/api/plans")
def create_plan(req: Request) -> Response:
    payload = req.json()
    if not _may_write(req, [{"member": payload.get("member")}], [payload.get("id")]):
        return error(_FORBIDDEN, 403)
    dates = payload.get("dates")
    if dates:
        created = STORE.add_plan_range(payload, dates, req.user)
        return json_response({"plans": created, "added": len(created)})
    return json_response({"plan": STORE.add_plan(payload, req.user)})


@router.post("/api/plans/batch")
def batch(req: Request) -> Response:
    """日次入力シートなど複数件を1トランザクションで保存する。"""
    payload = req.json()
    save = payload.get("save") or []
    delete = payload.get("delete") or []
    if not _may_write(req, save, [r.get("id") for r in save] + list(delete)):
        return error(_FORBIDDEN, 403)
    result = STORE.save_plans(save, delete, req.user)
    return json_response(result)


@router.post("/api/plans/bulk")
def bulk(req: Request) -> Response:
    payload = req.json()
    action = payload.get("action")
    ids = payload.get("ids") or []
    patch = payload.get("patch") or {}
    if not _may_write(req, [{**patch, "id": i} for i in ids] if action == "patch" else [], ids):
        return error(_FORBIDDEN, 403)
    if action == "delete":
        return json_response({"removed": STORE.delete_plans(ids)})
    if action == "patch":
        updated = [STORE.update_plan(i, patch, req.user) for i in ids]
        return json_response({"updated": len([u for u in updated if u])})
    return error("unknown-action", 400)


@router.put("/api/plans/{plan_id}")
def update_plan(req: Request) -> Response:
    patch = req.json()
    if not _may_write(req, [{**patch, "id": req.params["plan_id"]}], [req.params["plan_id"]]):
        return error(_FORBIDDEN, 403)
    plan = STORE.update_plan(req.params["plan_id"], patch, req.user)
    return json_response({"plan": plan}) if plan else error("not-found", 404)


@router.delete("/api/plans/{plan_id}")
def delete_plan(req: Request) -> Response:
    if not _may_write(req, ids=[req.params["plan_id"]]):
        return error(_FORBIDDEN, 403)
    return json_response({"removed": STORE.delete_plans([req.params["plan_id"]])})
