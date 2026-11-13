"""Persistence layer.

Records are stored in SQLite (see core.db).  Rolling JSON snapshots are kept
in data/backup so the store can always be inspected or restored by hand.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import model
from .config import CONFIG
from .db import Database

DB = Database(CONFIG.db_path)

_LOCK = threading.RLock()
# meta key recording that plan-only projects were removed from the 案件名 master
_PLAN_PROJECTS_MIGRATION = "planProjectsRemovedAt"
# meta key recording that 0h results / 0h plans were converted to 未実施 / 予定外
_PLAN_NOT_DONE_MIGRATION = "planNotDoneMigratedAt"
# meta key recording that result statuses (実施中・完了など) were converted to 予定通り
# meta key recording that assignment statuses were brought in line with their results
_ASSIGNMENT_STATUS_MIGRATION = "assignmentStatusMigratedAt"
_RESULT_STATUS_MIGRATION = "resultStatusMigratedAt"


class ConflictError(Exception):
    """The record was changed by someone else since the client loaded it."""


def configure(data_dir: Path) -> None:
    """Move the data directory (e.g. onto a shared network folder)."""
    CONFIG.data_dir = Path(data_dir)
    DB.relocate(CONFIG.db_path)
    STORE.path = CONFIG.db_path
    STORE._data = None


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _empty_pending() -> dict[str, Any]:
    return {"full": False, "tasks": {}, "taskDel": set(),
            "plans": {}, "planDel": set(),
            "masters": False, "entries": False, "views": False}


def _import_legacy_json() -> None:
    """One-off migration of the pre-SQLite data/store.json file."""
    legacy = CONFIG.legacy_json_path
    if not legacy.exists():
        return
    try:
        payload = json.loads(legacy.read_bytes().decode("utf-8"))
    except (OSError, ValueError):
        return
    if not isinstance(payload, dict):
        return
    payload.setdefault("updatedAt", _now())
    DB.write_all(payload)
    try:
        legacy.rename(legacy.with_name(legacy.name + ".migrated"))
    except OSError:
        pass


def _empty() -> dict[str, Any]:
    return {
        "version": 2,
        "tasks": [],
        "plans": [],
        "masters": json.loads(json.dumps(model.DEFAULT_MASTERS)),
        "entries": {},
        "savedViews": [],
        "updatedAt": _now(),
    }


class Store:
    def __init__(self, path: Path | None = None):
        self.path = Path(path) if path else CONFIG.db_path
        self._data: dict[str, Any] | None = None
        self._pending: dict[str, Any] = _empty_pending()
        self._last_snapshot = 0.0

    # ------------------------------------------------- change tracking
    def _mark_full(self) -> None:
        self._pending = _empty_pending()
        self._pending["full"] = True

    def _mark_task(self, task: dict) -> None:
        if task.get("id"):
            self._pending["tasks"][task["id"]] = task

    def _mark_task_deleted(self, ids) -> None:
        for task_id in ids:
            self._pending["tasks"].pop(task_id, None)
            self._pending["taskDel"].add(task_id)

    def _mark_plan(self, plan: dict) -> None:
        if plan.get("id"):
            self._pending["plans"][plan["id"]] = plan

    def _mark_plan_deleted(self, ids) -> None:
        for plan_id in ids:
            self._pending["plans"].pop(plan_id, None)
            self._pending["planDel"].add(plan_id)

    # ---------------------------------------------------------------- io
    def load(self) -> dict[str, Any]:
        with _LOCK:
            if self._data is not None:
                return self._data
            DB.initialize()
            if DB.is_empty():
                _import_legacy_json()
            data = DB.read_all()
            base = _empty()
            base.update(data)
            base["masters"] = {**_empty()["masters"], **(data.get("masters") or {})}
            base["masters"]["settings"] = {
                **model.DEFAULT_MASTERS["settings"],
                **((data.get("masters") or {}).get("settings") or {}),
            }
            self._data = base
            self._pending = _empty_pending()
            self._migrate_plan_projects()
            self._migrate_not_done()
            self._migrate_result_status()
            self._migrate_assignment_status()
            return base

    def _migrate_plan_projects(self) -> None:
        """One-off: drop project names that only appear in 業務予定 from the 案件名 master.

        以前は業務予定の保存でも案件名マスタに追加していたため、開発管理の案件の選択肢に
        業務予定だけの案件（健康診断・課会など）が混ざっていた。タスクにある案件と、
        どこにも使われていない手入力の案件は残す。
        """
        if DB.get_meta(_PLAN_PROJECTS_MIGRATION):
            return
        data = self._data
        task_projects = {t.get("project") for t in data["tasks"] if t.get("project")}
        plan_projects = {p.get("project") for p in data.get("plans", []) if p.get("project")}
        projects = data["masters"].get("projects") or []
        kept = [p for p in projects if p in task_projects or p not in plan_projects]
        if kept != projects:
            data["masters"]["projects"] = kept
            self._pending["masters"] = True
            self.save()
        DB.set_meta(_PLAN_PROJECTS_MIGRATION, _now())

    def _migrate_not_done(self) -> None:
        """One-off: 予定でやらなかった作業・突発作業の記録を、日次入力の現在の保存形式にそろえる。

        - 予定に対応する実績で、実績 0h（または実績h 空欄で進捗 0%）のもの → 実績を消し、予定の状況を「中止」（＝未実施）にする。進捗率は予定に移す
        - 予定(h) が空欄・0 の予定（休暇を除く）に実績 0h 超が対応しているもの → 予定を消し、実績を予定外にする
        """
        if DB.get_meta(_PLAN_NOT_DONE_MIGRATION):
            return
        plans = self._data.get("plans", [])
        by_id = {p.get("id"): p for p in plans}
        drop: set = set()
        for r in plans:
            src = by_id.get(r.get("sourceId"))
            if r.get("kind") != "result" or not src or src.get("kind") not in (None, "", "plan"):
                continue
            hours, progress = r.get("actualHours"), r.get("progress")
            if hours == 0 or (hours is None and progress == 0):
                drop.add(r["id"])
                src["status"] = "中止"
                src["progress"] = progress  # 進捗率（作業全体の進み具合）は予定に残す
                self._mark_plan(src)
            elif not src.get("hours") and src.get("category") != "休暇" and (hours or 0) > 0:
                drop.add(src["id"])
                r["sourceId"] = None
                self._mark_plan(r)
        if drop:
            self._data["plans"] = [p for p in plans if p.get("id") not in drop]
            self._mark_plan_deleted(drop)
            self.save()
        DB.set_meta(_PLAN_NOT_DONE_MIGRATION, _now())

    def _migrate_result_status(self) -> None:
        """実績の状況を「予定通り」「遅延」の 2 つにそろえる（読み込みのたびに確認する）。

        以前は業務予定のステータス（実施中・完了・中止など）を実績にも使っていた。
        遅延の記録は無かったので、遅延以外はすべて「予定通り」にする。
        更新前の画面を開いたままの利用者が保存した値も、次の読み込みでそろえる。
        meta には最初に移行した日時を残す。
        """
        changed = False
        for r in self._data.get("plans", []):
            if r.get("kind") == "result" and r.get("status") not in model.RESULT_STATUSES:
                r["status"] = "予定通り"
                self._mark_plan(r)
                changed = True
        if changed:
            self.save()
        if not DB.get_meta(_RESULT_STATUS_MIGRATION):
            DB.set_meta(_RESULT_STATUS_MIGRATION, _now())

    def _migrate_assignment_status(self) -> None:
        """One-off: 実績が入っているのに「予定」のまま、最新の進捗が 100 なのに「完了」でない取組み予定を直す。

        以前はステータスを実績から自動で切り替えていなかった。手で選んだ値を戻さないよう、
        予定 → 実施中 → 完了 の向きにだけ進める（中止・実績のない実施中などはそのまま）。
        """
        if DB.get_meta(_ASSIGNMENT_STATUS_MIGRATION):
            return
        rank = {status: i for i, status in enumerate(model.ASSIGNMENT_AUTO_STATUSES)}
        changed = False
        for a in self._data.get("plans", []):
            if a.get("kind") != "assignment" or a.get("status") not in rank:
                continue
            status = self._assignment_status(a.get("id"))
            if rank[status] > rank[a["status"]]:
                a["status"] = status
                self._mark_plan(a)
                changed = True
        if changed:
            self.save()
        DB.set_meta(_ASSIGNMENT_STATUS_MIGRATION, _now())

    # ------------------------------------- 取組み予定のステータス（実績から自動）
    def _assignment_status(self, assignment_id: str | None) -> str:
        """紐づく実績から取組み予定のステータスを決める。

        実績なし = 予定 / 最新の進捗（日付順、同じ日は更新の新しい方）が 100 = 完了 / それ以外 = 実施中。
        画面の「進捗」（State.assignmentRollup）と同じ判定。
        """
        results = sorted(
            (p for p in self._data.get("plans", [])
             if p.get("kind") == "result" and assignment_id and p.get("assignmentId") == assignment_id),
            key=lambda p: (p.get("date") or "", p.get("updatedAt") or ""))
        pending, doing, done = model.ASSIGNMENT_AUTO_STATUSES
        if not results:
            return pending
        latest = next((p.get("progress") for p in reversed(results) if p.get("progress") is not None), None)
        return done if latest == 100 else doing

    def _sync_assignment_status(self, ids) -> None:
        """実績の保存・削除で紐づく実績が変わった取組み予定のステータスを、実績に合わせて切り替える。

        手で選んだステータスも、次に実績を保存したときに上書きする。中止は手で選んだまま変えない。
        """
        ids = {i for i in ids if i}
        if not ids:
            return
        for a in self._data.get("plans", []):
            if a.get("kind") != "assignment" or a.get("id") not in ids or a.get("status") == "中止":
                continue
            status = self._assignment_status(a["id"])
            if a.get("status") != status:
                a["status"] = status
                a["updatedAt"] = _now()
                self._mark_plan(a)

    def save(self) -> None:
        with _LOCK:
            if self._data is None:
                return
            self._data["updatedAt"] = _now()
            pending = self._pending
            full = pending.get("full")
            if full:
                DB.write_all(self._data)
            else:
                DB.write_partial(self._data, pending)
            self._pending = _empty_pending()
            self._snapshot(force=bool(full))

    def _snapshot(self, force: bool = False) -> None:
        keep = CONFIG.backup_keep
        if keep <= 0:
            return
        # 全件ダンプは重いので、取込・復元などの一括更新以外は間隔を空ける
        now = time.time()
        if not force and now - self._last_snapshot < CONFIG.backup_interval:
            return
        backup_dir = CONFIG.backup_dir
        try:
            backup_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            payload = json.dumps(self._data, ensure_ascii=False, indent=1).encode("utf-8")
            (backup_dir / f"store_{stamp}.json").write_bytes(payload)
            for old in sorted(backup_dir.glob("store_*.json"))[:-keep]:
                old.unlink()
            self._last_snapshot = now
        except OSError:
            pass

    # ------------------------------------------------------------- access
    @property
    def settings(self) -> dict[str, Any]:
        return self.load()["masters"]["settings"]

    def tasks(self) -> list[dict[str, Any]]:
        return self.load()["tasks"]

    def plans(self) -> list[dict[str, Any]]:
        return self.load().setdefault("plans", [])

    def recompute_all(self) -> None:
        data = self.load()
        settings = data["masters"]["settings"]
        data["tasks"] = [model.compute(t, settings) for t in data["tasks"]]

    def sync_masters(self) -> None:
        """Keep member/project master lists in sync with the actual data."""
        data = self.load()
        masters = data["masters"]
        members = list(masters.get("members") or [])
        projects = list(masters.get("projects") or [])
        excluded = set(masters.get("excludedMembers") or [])
        for task in data["tasks"]:
            for key in ("assignee1", "assignee2"):
                name = task.get(key)
                if name and name not in members and name not in excluded:
                    members.append(name)
            project = task.get("project")
            if project and project not in projects:
                projects.append(project)
        if members != masters.get("members") or sorted(projects) != masters.get("projects"):
            self._pending["masters"] = True
        masters["members"] = members
        masters["projects"] = sorted(projects)

    # ------------------------------------------------------------- tasks
    def add_task(self, raw: dict) -> dict:
        with _LOCK:
            data = self.load()
            task = model.normalize_task(raw, self.settings)
            task["id"] = raw.get("id") or uuid.uuid4().hex[:12]
            task["createdAt"] = _now()
            task["updatedAt"] = task["createdAt"]
            data["tasks"].append(task)
            self._mark_task(task)
            self.sync_masters()
            self.save()
            return task

    def update_task(self, task_id: str, patch: dict,
                    expected_updated_at: str | None = None) -> dict | None:
        with _LOCK:
            data = self.load()
            for index, task in enumerate(data["tasks"]):
                if task.get("id") == task_id:
                    if expected_updated_at and task.get("updatedAt") != expected_updated_at:
                        raise ConflictError(task)
                    merged = {**task, **patch, "id": task_id}
                    updated = model.normalize_task(merged, self.settings)
                    updated["id"] = task_id
                    updated["createdAt"] = task.get("createdAt")
                    updated["updatedAt"] = _now()
                    data["tasks"][index] = updated
                    self._mark_task(updated)
                    self.sync_masters()
                    self.save()
                    return updated
            return None

    def delete_tasks(self, ids: list[str]) -> int:
        with _LOCK:
            data = self.load()
            target = set(ids)
            before = len(data["tasks"])
            data["tasks"] = [t for t in data["tasks"] if t.get("id") not in target]
            removed = before - len(data["tasks"])
            if removed:
                self._mark_task_deleted(target)
                self.save()
            return removed

    def replace_tasks(self, tasks: list[dict]) -> int:
        with _LOCK:
            data = self.load()
            normalized = []
            for raw in tasks:
                task = model.normalize_task(raw, self.settings)
                task["id"] = raw.get("id") or uuid.uuid4().hex[:12]
                task["createdAt"] = raw.get("createdAt") or _now()
                task["updatedAt"] = _now()
                normalized.append(task)
            data["tasks"] = normalized
            self._mark_full()
            self.sync_masters()
            self.save()
            return len(normalized)

    def merge_tasks(self, tasks: list[dict], mode: str = "upsert") -> dict:
        """Import tasks. mode: 'upsert' (match by type+programId+project+start) or 'append'."""
        with _LOCK:
            data = self.load()
            if mode == "replace":
                count = self.replace_tasks(tasks)
                return {"added": count, "updated": 0, "skipped": 0}

            index: dict[tuple, int] = {}
            if mode == "upsert":
                for pos, task in enumerate(data["tasks"]):
                    index[_dedupe_key(task)] = pos

            added = updated = 0
            for raw in tasks:
                task = model.normalize_task(raw, self.settings)
                key = _dedupe_key(task)
                if mode == "upsert" and key in index:
                    pos = index[key]
                    old = data["tasks"][pos]
                    task["id"] = old.get("id")
                    task["createdAt"] = old.get("createdAt")
                    task["updatedAt"] = _now()
                    data["tasks"][pos] = task
                    updated += 1
                else:
                    task["id"] = uuid.uuid4().hex[:12]
                    task["createdAt"] = _now()
                    task["updatedAt"] = task["createdAt"]
                    data["tasks"].append(task)
                    index[key] = len(data["tasks"]) - 1
                    added += 1
            self._mark_full()
            self.sync_masters()
            self.save()
            return {"added": added, "updated": updated, "skipped": 0}

    # ----------------------------------------------------------- masters
    def update_masters(self, patch: dict) -> dict:
        with _LOCK:
            data = self.load()
            if "settings" in patch:
                # 不正な値で再計算が失敗し、設定が中途半端に残らないよう先に検証する
                patch = {**patch, "settings": model.validate_settings(patch["settings"] or {})}
            for key, value in patch.items():
                if key == "settings":
                    data["masters"]["settings"].update(value)
                else:
                    if key == "members":
                        self._track_excluded(data["masters"], value or [])
                    data["masters"][key] = value
            self.recompute_all()
            # 計算パラメータ変更で全タスクの指標が変わるため全件書き込み
            self._mark_full()
            self.save()
            return data["masters"]

    @staticmethod
    def _track_excluded(masters: dict, new_members: list) -> None:
        """担当者マスタから外した名前を記録し、過去データから自動で復活しないようにする。"""
        removed = [m for m in masters.get("members") or [] if m not in new_members]
        excluded = [m for m in masters.get("excludedMembers") or [] if m not in new_members]
        masters["excludedMembers"] = excluded + [m for m in removed if m not in excluded]

    def ensure_members(self, names) -> None:
        """Add people to the member master (e.g. a newly created login user)."""
        with _LOCK:
            masters = self.load()["masters"]
            members = masters.setdefault("members", [])
            excluded = masters.get("excludedMembers") or []
            added = [name for name in names if name and name not in members]
            restored = [name for name in names if name in excluded]
            if added or restored:
                members.extend(added)
                masters["excludedMembers"] = [m for m in excluded if m not in names]
                self._pending["masters"] = True
                self.save()

    def exclude_members(self, names) -> None:
        """Remove people from the member master and keep them out (e.g. 特権管理者)."""
        with _LOCK:
            masters = self.load()["masters"]
            names = [name for name in names if name]
            members = masters.get("members") or []
            excluded = masters.get("excludedMembers") or []
            if any(n in members for n in names) or any(n not in excluded for n in names):
                masters["members"] = [m for m in members if m not in names]
                masters["excludedMembers"] = excluded + [n for n in names if n not in excluded]
                self._pending["masters"] = True
                self.save()

    # ----------------------------------------------------------- entries
    def set_entry(self, member: str, month: str, value: str | None) -> dict:
        with _LOCK:
            data = self.load()
            entries = data.setdefault("entries", {})
            row = entries.setdefault(member, {})
            if value:
                row[month] = value
            else:
                row.pop(month, None)
                # 空になった担当者は削除する（DB側は空行を保持しないため）
                if not row:
                    entries.pop(member, None)
            self._pending["entries"] = True
            self.save()
            return entries

    # ------------------------------------------------------------- plans
    def add_plan(self, raw: dict, user: str | None = None) -> dict:
        with _LOCK:
            data = self.load()
            plan = model.normalize_plan(raw)
            plan["id"] = raw.get("id") or uuid.uuid4().hex[:12]
            plan["createdAt"] = _now()
            plan["updatedAt"] = plan["createdAt"]
            plan["updatedBy"] = user or plan.get("updatedBy")
            data.setdefault("plans", []).append(plan)
            self._mark_plan(plan)
            self._sync_assignment_status([plan.get("assignmentId")])
            self._sync_plan_masters()
            self.save()
            return plan

    def update_plan(self, plan_id: str, patch: dict, user: str | None = None) -> dict | None:
        with _LOCK:
            plans = self.plans()
            for index, plan in enumerate(plans):
                if plan.get("id") == plan_id:
                    merged = {**plan, **patch, "id": plan_id}
                    updated = model.normalize_plan(merged)
                    updated["id"] = plan_id
                    updated["createdAt"] = plan.get("createdAt")
                    updated["updatedAt"] = _now()
                    updated["updatedBy"] = user or plan.get("updatedBy")
                    plans[index] = updated
                    self._mark_plan(updated)
                    self._sync_assignment_status([plan.get("assignmentId"), updated.get("assignmentId")])
                    self._sync_plan_masters()
                    self.save()
                    return updated
            return None

    def delete_plans(self, ids: list[str]) -> int:
        with _LOCK:
            data = self.load()
            target = set(ids)
            plans = data.setdefault("plans", [])
            before = len(plans)
            linked = [p.get("assignmentId") for p in plans if p.get("id") in target]
            data["plans"] = [p for p in plans if p.get("id") not in target]
            removed = before - len(data["plans"])
            if removed:
                self._mark_plan_deleted(target)
                self._sync_assignment_status(linked)
                self.save()
            return removed

    def add_plan_range(self, raw: dict, dates: list[str], user: str | None = None) -> list[dict]:
        with _LOCK:
            created = []
            data = self.load()
            for date in dates:
                plan = model.normalize_plan({**raw, "date": date, "endDate": date})
                plan["id"] = uuid.uuid4().hex[:12]
                plan["createdAt"] = _now()
                plan["updatedAt"] = plan["createdAt"]
                plan["updatedBy"] = user
                data.setdefault("plans", []).append(plan)
                self._mark_plan(plan)
                created.append(plan)
            self._sync_assignment_status([raw.get("assignmentId")])
            self._sync_plan_masters()
            self.save()
            return created

    def _sync_plan_masters(self) -> None:
        data = self.load()
        masters = data["masters"]
        members = list(masters.get("members") or [])
        excluded = set(masters.get("excludedMembers") or [])
        # 案件名マスタは開発管理（タスク）の案件だけにするため、業務予定の案件は追加しない
        for plan in data.get("plans", []):
            if plan.get("member") and plan["member"] not in members and plan["member"] not in excluded:
                members.append(plan["member"])
        if members != masters.get("members"):
            self._pending["masters"] = True
        masters["members"] = members

    # ------------------------------------------------- plans (bulk save)
    def save_plans(self, upserts: list[dict], delete_ids: list[str],
                   user: str | None = None) -> dict:
        """1日分の入力シートなど、複数件をまとめて1トランザクションで保存する。"""
        with _LOCK:
            data = self.load()
            plans = data.setdefault("plans", [])
            by_id = {p.get("id"): i for i, p in enumerate(plans) if p.get("id")}

            removed = 0
            target = {i for i in (delete_ids or []) if i}
            # 紐づく実績が変わる取組み予定（削除する記録・保存前後の記録の紐づけ先）
            linked = [p.get("assignmentId") for p in plans if p.get("id") in target]
            if target:
                before = len(plans)
                plans = [p for p in plans if p.get("id") not in target]
                data["plans"] = plans
                removed = before - len(plans)
                self._mark_plan_deleted(target)
                by_id = {p.get("id"): i for i, p in enumerate(plans) if p.get("id")}

            saved: list[dict] = []
            added = updated = 0
            for raw in (upserts or []):
                plan_id = raw.get("id")
                if plan_id and plan_id in by_id:
                    old = plans[by_id[plan_id]]
                    linked.append(old.get("assignmentId"))
                    plan = model.normalize_plan({**old, **raw, "id": plan_id})
                    plan["id"] = plan_id
                    plan["createdAt"] = old.get("createdAt")
                    plan["updatedAt"] = _now()
                    plan["updatedBy"] = user or old.get("updatedBy")
                    plans[by_id[plan_id]] = plan
                    updated += 1
                else:
                    plan = model.normalize_plan(raw)
                    plan["id"] = plan_id or uuid.uuid4().hex[:12]
                    plan["createdAt"] = _now()
                    plan["updatedAt"] = plan["createdAt"]
                    plan["updatedBy"] = user or plan.get("updatedBy")
                    plans.append(plan)
                    by_id[plan["id"]] = len(plans) - 1
                    added += 1
                self._mark_plan(plan)
                saved.append(plan)
                linked.append(plan.get("assignmentId"))

            if added or updated or removed:
                self._sync_assignment_status(linked)
                self._sync_plan_masters()
                self.save()
            return {"plans": saved, "added": added, "updated": updated, "removed": removed}


def _dedupe_key(task: dict) -> tuple:
    return (
        task.get("type"),
        (task.get("programId") or "").strip(),
        (task.get("project") or "").strip(),
        task.get("startDate") or "",
    )


STORE = Store()
