"""Domain model: schema loading, derived metric calculation, validation.

All Japanese labels/enum values live in the JSON files next to this module so
that the Python sources stay ASCII-only (safe against encoding issues).
"""

from __future__ import annotations

import datetime as _dt
import json
import math
import re
import unicodedata
from pathlib import Path
from typing import Any

CORE_DIR = Path(__file__).resolve().parent
ROOT_DIR = CORE_DIR.parent
BASE_DIR = ROOT_DIR.parent


def _load(name: str) -> Any:
    with open(CORE_DIR / name, "rb") as fh:
        return json.loads(fh.read().decode("utf-8"))


SCHEMA = _load("fields.json")
DEFAULT_MASTERS = _load("masters.json")
ENUMS = _load("enums.json")

ST = ENUMS["status"]
KB = ENUMS["kubun"]
FIELDS = {f["key"]: f for f in SCHEMA["fields"]}
CALC_KEYS = {f["key"] for f in SCHEMA["fields"] if f["type"] == "calc"}
NUM_KEYS = {f["key"] for f in SCHEMA["fields"] if f["type"] in ("number", "calc")}
DATE_KEYS = {f["key"] for f in SCHEMA["fields"] if f["type"] == "date"}
TYPE_KEYS = [t["key"] for t in SCHEMA["types"]]


# --------------------------------------------------------------------------
# normalisation helpers
# --------------------------------------------------------------------------
_SPACE_RE = re.compile(r"[\s\u3000]+")


def norm_header(value: Any) -> str:
    """Normalise an Excel header cell for tolerant matching."""
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    return _SPACE_RE.sub("", text).lower()


def norm_member(value: Any) -> str:
    if value is None:
        return ""
    text = _SPACE_RE.sub("", unicodedata.normalize("NFKC", str(value)))
    return ENUMS["memberAlias"].get(text, text)


def to_num(value: Any) -> float | None:
    """Parse a number. NaN / Infinity are rejected (None) because they break JSON output."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        if isinstance(value, (int, float)):
            number = float(value)
        else:
            text = unicodedata.normalize("NFKC", str(value)).replace(",", "").replace("%", "").strip()
            if not text:
                return None
            number = float(text)
    except (ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


# 計算パラメータの許容範囲（下限, 上限）。None は制限なし
_SETTING_RANGES = {
    "baseCoef": (0, None), "newCoef": (0, None), "modCoef": (0, None),
    "monthHours": (1, None), "workHoursPerDay": (1, 24), "fiscalStartMonth": (1, 12),
    "targetProdMonth": (0, None), "targetQuality": (0, None),
}


def validate_settings(settings: dict) -> dict:
    """計算パラメータを数値に揃える。数値でない・範囲外の値があれば ValueError。"""
    out = dict(settings)
    for key, (low, high) in _SETTING_RANGES.items():
        if key not in out:
            continue
        value = to_num(out[key])
        if value is None or value < low or (high is not None and value > high):
            raise ValueError(key)
        if key == "fiscalStartMonth":
            if value != int(value):
                raise ValueError(key)
            value = int(value)
        out[key] = value
    return out


def to_date(value: Any) -> str | None:
    """Return an ISO yyyy-mm-dd string, or None."""
    if value is None or value == "":
        return None
    if isinstance(value, _dt.datetime):
        return value.date().isoformat()
    if isinstance(value, _dt.date):
        return value.isoformat()
    text = unicodedata.normalize("NFKC", str(value)).strip()
    if not text:
        return None
    text = text.replace("/", "-").replace(".", "-")
    match = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", text)
    if match:
        try:
            year, month, day = (int(g) for g in match.groups())
            return _dt.date(year, month, day).isoformat()
        except ValueError:
            return None
    return None


def parse_date(value: Any) -> _dt.date | None:
    iso = to_date(value)
    if not iso:
        return None
    return _dt.date.fromisoformat(iso)


def is_sample_row(value: Any) -> bool:
    if value is None:
        return False
    text = _SPACE_RE.sub("", str(value))
    return any(text.startswith(s) for s in ENUMS["sample"])


# --------------------------------------------------------------------------
# derived metrics
# --------------------------------------------------------------------------
def _round(value: float | None, digits: int) -> float | None:
    if value is None:
        return None
    if value != value or value in (float("inf"), float("-inf")):
        return None
    return round(value, digits)


def _div(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or not denominator:
        return None
    return numerator / denominator


def compute(task: dict, settings: dict | None = None) -> dict:
    """Fill in every calculated field of a task (in place) and return it."""
    cfg = dict(DEFAULT_MASTERS["settings"])
    if settings:
        cfg.update({k: v for k, v in settings.items() if v is not None})

    n = lambda key: to_num(task.get(key)) or 0.0  # noqa: E731
    has = lambda key: to_num(task.get(key)) is not None  # noqa: E731

    if task.get("type") == "dd":
        hours = n("hourDesign")
        pages = n("pages")
        issues = n("issues")
        task["totalHour"] = _round(hours, 2) if hours else (0.0 if has("hourDesign") else None)
        task["issueTotal"] = _round(issues, 0) if has("issues") else None
        task["pagePerHour"] = _round(_div(pages, hours), 2)
        task["issuePerPage"] = _round(_div(issues, pages), 2)
        for key in ("convStep", "testRatio", "prodNew", "prodMod", "prodMonth",
                    "quality", "defectRate"):
            task[key] = None
    else:
        base, new, mod = n("baseStep"), n("newStep"), n("modStep")
        # Same as the Excel sheet: kubun selects the formula (anything but "new" counts as "mod").
        is_new = (task.get("kubun") or "").strip() == KB["new"]
        if is_new:
            conv = new * cfg["newCoef"]
        else:
            conv = base * cfg["baseCoef"] + mod * cfg["modCoef"]
        task["convStep"] = _round(conv, 2) if (base or new or mod) else None

        make, check, verify = n("hourMake"), n("hourCheck"), n("hourVerify")
        total = make + check + verify
        any_hour = has("hourMake") or has("hourCheck") or has("hourVerify")
        task["totalHour"] = _round(total, 2) if any_hour else None
        task["testRatio"] = _round(_div((check + verify) * 100.0, total), 1)
        task["prodNew"] = _round(_div(new, make), 2) if new else None
        task["prodMod"] = _round(_div(mod, make), 2) if mod else None
        task["prodMonth"] = _round(_div((new if is_new else mod) * cfg["monthHours"], total), 1)

        issue_total = n("issueCode") + n("issueCheck") + n("issueVerify")
        any_issue = has("issueCode") or has("issueCheck") or has("issueVerify")
        task["issueTotal"] = _round(issue_total, 0) if any_issue else None
        task["quality"] = _round(_div(issue_total * 1000.0, conv), 2)
        task["defectRate"] = _round(_div(n("defect") * 1000.0, conv), 2)
        for key in ("pagePerHour", "issuePerPage"):
            task[key] = None

    start, end = parse_date(task.get("startDate")), parse_date(task.get("endDate"))
    task["durationDays"] = (end - start).days + 1 if start and end and end >= start else None
    task["effectiveStatus"] = effective_status(task)
    task["isLate"] = is_late(task)
    return task


def effective_status(task: dict) -> str:
    explicit = (task.get("status") or "").strip()
    if explicit:
        return explicit
    today = _dt.date.today()
    start, end = parse_date(task.get("startDate")), parse_date(task.get("endDate"))
    if end and end < today:
        return ST["done"]
    if start and start <= today and (end is None or end >= today):
        return ST["doing"]
    if start and start > today:
        return ST["todo"]
    return ST["todo"] if not end else ST["doing"]


def is_late(task: dict) -> bool:
    status = task.get("effectiveStatus") or effective_status(task)
    if status in (ST["done"], ST["na"]):
        return False
    end = parse_date(task.get("endDate"))
    return bool(end and end < _dt.date.today())


# --------------------------------------------------------------------------
# task normalisation
# --------------------------------------------------------------------------
def normalize_task(raw: dict, settings: dict | None = None) -> dict:
    task: dict[str, Any] = {}
    task["type"] = raw.get("type") if raw.get("type") in TYPE_KEYS else TYPE_KEYS[0]
    for key, field in FIELDS.items():
        if key in ("type",) or field["type"] == "calc":
            continue
        if task["type"] not in field["types"]:
            continue
        value = raw.get(key)
        if field["type"] == "number":
            task[key] = to_num(value)
        elif field["type"] == "date":
            task[key] = to_date(value)
        else:
            task[key] = None if value is None else str(value).strip() or None
    for key in ("assignee1", "assignee2"):
        if task.get(key):
            task[key] = norm_member(task[key])
    task["id"] = raw.get("id")
    task["createdAt"] = raw.get("createdAt")
    task["updatedAt"] = raw.get("updatedAt")
    return compute(task, settings)


def fiscal_year(date: _dt.date, start_month: int = 4) -> int:
    return date.year if date.month >= start_month else date.year - 1


def month_key(value: Any) -> str | None:
    date = parse_date(value)
    return f"{date.year:04d}-{date.month:02d}" if date else None


# --------------------------------------------------------------------------
# work plans (business schedule)
# --------------------------------------------------------------------------
PLAN_TEXT_KEYS = ("member", "category", "project", "programId", "taskId",
                  "title", "status", "note", "updatedBy", "kind", "sourceId",
                  "assignmentId", "projectCode", "workCode")
PLAN_NUM_KEYS = ("hours", "actualHours", "progress")

# "plan"   = 始業前に登録するその日の予定
# "result" = 終業前に登録するその日の実績
# "assignment" = 一定期間取り組む予定（日次の plan / result が assignmentId で紐づく）
PLAN_KINDS = ("plan", "result", "assignment")


def normalize_plan(raw: dict) -> dict:
    plan: dict[str, Any] = {}
    for key in PLAN_TEXT_KEYS:
        value = raw.get(key)
        plan[key] = None if value is None else str(value).strip() or None
    if plan.get("member"):
        plan["member"] = norm_member(plan["member"])
    plan["kind"] = plan["kind"] if plan["kind"] in PLAN_KINDS else PLAN_KINDS[0]
    for key in PLAN_NUM_KEYS:
        plan[key] = to_num(raw.get(key))
    if plan["progress"] is not None:
        plan["progress"] = max(0.0, min(100.0, plan["progress"]))
    plan["date"] = to_date(raw.get("date")) or to_date(raw.get("startDate"))
    plan["endDate"] = to_date(raw.get("endDate")) or plan["date"]
    plan["allDay"] = bool(raw.get("allDay", True))
    plan["id"] = raw.get("id")
    plan["createdAt"] = raw.get("createdAt")
    plan["updatedAt"] = raw.get("updatedAt")
    return plan


def expand_plan_dates(plan: dict) -> list[str]:
    """Every calendar day covered by a plan."""
    start, end = parse_date(plan.get("date")), parse_date(plan.get("endDate"))
    if not start:
        return []
    if not end or end < start:
        end = start
    days, cursor = [], start
    while cursor <= end and len(days) < 400:
        days.append(cursor.isoformat())
        cursor += _dt.timedelta(days=1)
    return days
