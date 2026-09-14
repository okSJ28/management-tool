"""CSV / Excel / JSON export."""

from __future__ import annotations

import json

from core import excel_io, model
from core.storage import STORE

from ..http import Request, Response, attachment, error
from ..router import Router

router = Router()

_LIST_SUFFIX = "_\u4e00\u89a7.csv"                              # _一覧.csv
_WORKBOOK_NAME = "\u958b\u767a\u30d7\u30ed\u30b0\u30e9\u30e0\u7ba1\u7406.xlsx"  # 開発プログラム管理.xlsx
_JSON_NAME = "\u7ba1\u7406\u30c4\u30fc\u30eb\u30c7\u30fc\u30bf.json"            # 管理ツールデータ.json


@router.get("/api/export/csv")
def export_csv(req: Request) -> Response:
    type_key = req.q("type", "mfg")
    ids = set(req.q_list("ids"))
    tasks = [t for t in STORE.tasks() if t.get("type") == type_key]
    if ids:
        tasks = [t for t in tasks if t.get("id") in ids]
    body = excel_io.write_csv(tasks, type_key)
    label = next((t["label"] for t in model.SCHEMA["types"] if t["key"] == type_key), type_key)
    return attachment(body, "text/csv; charset=utf-8", f"{label}{_LIST_SUFFIX}")


@router.get("/api/export/excel")
def export_excel(_req: Request) -> Response:
    if not excel_io.HAS_OPENPYXL:
        return error("openpyxl-missing", 500)
    data = STORE.load()
    body = excel_io.write_workbook(data["tasks"], data.get("entries", {}), data["masters"])
    return attachment(
        body,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _WORKBOOK_NAME)


@router.get("/api/export/json")
def export_json(_req: Request) -> Response:
    body = json.dumps(STORE.load(), ensure_ascii=False, indent=1).encode("utf-8")
    return attachment(body, "application/json; charset=utf-8", _JSON_NAME)
