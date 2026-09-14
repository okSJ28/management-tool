"""Excel / CSV / JSON import."""

from __future__ import annotations

from pathlib import Path

from core import excel_io
from core.config import CONFIG
from core.storage import STORE

from ..http import Request, Response, error, json_response
from ..router import Router

router = Router()


def _safe_child(folder: Path, name: str) -> Path | None:
    """Resolve `name` inside `folder`, rejecting traversal attempts."""
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return None
    candidate = (folder / name).resolve()
    try:
        candidate.relative_to(folder.resolve())
    except ValueError:
        return None
    return candidate


@router.post("/api/import/excel")
def import_excel(req: Request) -> Response:
    payload = req.json()
    path = _safe_child(CONFIG.files_dir, payload.get("file") or "")
    if path is None or not path.exists():
        return error("file-not-found", 404)
    result = excel_io.import_workbook(path)
    summary = STORE.merge_tasks(result["tasks"], payload.get("mode", "upsert"))
    if result["entries"] and payload.get("withEntries", True):
        data = STORE.load()
        entries = data.setdefault("entries", {})
        for member, months in result["entries"].items():
            entries.setdefault(member, {}).update(months)
        members = data["masters"].setdefault("members", [])
        for member in result["entries"]:
            if member not in members:
                members.append(member)
        STORE._pending["entries"] = True
        STORE._pending["masters"] = True
        STORE.save()
    return json_response({**summary,
                          "detail": result["detail"],
                          "sheets": result["sheets"]})


@router.post("/api/import/csv")
def import_csv(req: Request) -> Response:
    payload = req.json()
    raw = (payload.get("text") or "").encode("utf-8")
    rows = excel_io.read_csv(raw, payload.get("type", "mfg"))
    return json_response(STORE.merge_tasks(rows, payload.get("mode", "upsert")))


@router.post("/api/import/json")
def import_json(req: Request) -> Response:
    payload = req.json()
    incoming = payload.get("data") or {}
    data = STORE.load()
    if "tasks" in incoming:
        STORE.replace_tasks(incoming["tasks"])
    if "masters" in incoming:
        STORE.update_masters(incoming["masters"])
    if "entries" in incoming:
        data["entries"] = incoming["entries"]
        STORE._mark_full()
        STORE.save()
    return json_response({"ok": True})
