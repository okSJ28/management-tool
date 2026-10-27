"""Bootstrap, version, health and data-folder listing."""

from __future__ import annotations

from core import excel_io, model
from core.config import CONFIG
from core.storage import STORE

from ..http import Request, Response, json_response
from ..router import PUBLIC, Router

router = Router()


@router.get("/api/health", auth=PUBLIC)
def health(_req: Request) -> Response:
    return json_response({"status": "ok"})


@router.get("/api/bootstrap")
def bootstrap(req: Request) -> Response:
    data = STORE.load()
    STORE.recompute_all()
    return json_response({
        "account": req.account,
        "schema": model.SCHEMA,
        "enums": model.ENUMS,
        "masters": data["masters"],
        "tasks": data["tasks"],
        "plans": data.get("plans", []),
        "entries": data.get("entries", {}),
        "savedViews": data.get("savedViews", []),
        "folder": str(CONFIG.files_dir),
        "dataDir": str(CONFIG.data_dir),
        "database": str(CONFIG.db_path),
        "backupKeep": CONFIG.backup_keep,
        "hasExcel": excel_io.HAS_OPENPYXL,
        "readOnly": CONFIG.read_only,
        "shared": CONFIG.shared,
        "updatedAt": data.get("updatedAt"),
    })


@router.get("/api/version")
def version(_req: Request) -> Response:
    return json_response({"updatedAt": STORE.load().get("updatedAt")})


@router.get("/api/files")
def files(_req: Request) -> Response:
    folder = CONFIG.files_dir
    if not folder.is_dir():
        return json_response({"files": []})
    return json_response({"files": excel_io.list_excel_files(folder)})
