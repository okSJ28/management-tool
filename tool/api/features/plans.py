"""Work plan (business schedule) CRUD."""

from __future__ import annotations

from core.storage import STORE

from ..http import Request, Response, error, json_response
from ..router import Router

router = Router()


@router.get("/api/plans")
def list_plans(_req: Request) -> Response:
    return json_response({"plans": STORE.plans()})


@router.post("/api/plans")
def create_plan(req: Request) -> Response:
    payload = req.json()
    dates = payload.get("dates")
    if dates:
        created = STORE.add_plan_range(payload, dates, req.user)
        return json_response({"plans": created, "added": len(created)})
    return json_response({"plan": STORE.add_plan(payload, req.user)})


@router.post("/api/plans/batch")
def batch(req: Request) -> Response:
    """日次入力シートなど複数件を1トランザクションで保存する。"""
    payload = req.json()
    result = STORE.save_plans(payload.get("save") or [],
                              payload.get("delete") or [],
                              req.user)
    return json_response(result)


@router.post("/api/plans/bulk")
def bulk(req: Request) -> Response:
    payload = req.json()
    action = payload.get("action")
    ids = payload.get("ids") or []
    if action == "delete":
        return json_response({"removed": STORE.delete_plans(ids)})
    if action == "patch":
        patch = payload.get("patch") or {}
        updated = [STORE.update_plan(i, patch, req.user) for i in ids]
        return json_response({"updated": len([u for u in updated if u])})
    return error("unknown-action", 400)


@router.put("/api/plans/{plan_id}")
def update_plan(req: Request) -> Response:
    plan = STORE.update_plan(req.params["plan_id"], req.json(), req.user)
    return json_response({"plan": plan}) if plan else error("not-found", 404)


@router.delete("/api/plans/{plan_id}")
def delete_plan(req: Request) -> Response:
    return json_response({"removed": STORE.delete_plans([req.params["plan_id"]])})
