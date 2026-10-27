"""SQLite persistence engine.

The domain model is schema-driven (fields.json), so each record keeps its
full JSON payload while the columns used for lookup/reporting are mirrored
into real SQL columns.  That keeps the model flexible and still allows the
database to be queried with plain SQL.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 2

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS masters (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id         TEXT PRIMARY KEY,
    seq        INTEGER NOT NULL,
    type       TEXT,
    program_id TEXT,
    project    TEXT,
    assignee1  TEXT,
    assignee2  TEXT,
    start_date TEXT,
    end_date   TEXT,
    created_at TEXT,
    updated_at TEXT,
    payload    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_seq     ON tasks (seq);
CREATE INDEX IF NOT EXISTS idx_tasks_type    ON tasks (type);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks (project);
CREATE TABLE IF NOT EXISTS plans (
    id         TEXT PRIMARY KEY,
    seq        INTEGER NOT NULL,
    kind       TEXT,
    member     TEXT,
    project    TEXT,
    date       TEXT,
    end_date   TEXT,
    created_at TEXT,
    updated_at TEXT,
    payload    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_seq    ON plans (seq);
CREATE INDEX IF NOT EXISTS idx_plans_date   ON plans (date);
CREATE INDEX IF NOT EXISTS idx_plans_member ON plans (member);
CREATE TABLE IF NOT EXISTS entries (
    member TEXT NOT NULL,
    month  TEXT NOT NULL,
    value  TEXT,
    PRIMARY KEY (member, month)
);
CREATE TABLE IF NOT EXISTS saved_views (
    seq   INTEGER PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    seq        INTEGER NOT NULL,
    name       TEXT,
    member     TEXT,
    role       TEXT NOT NULL,
    password   TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
);
"""

_TASK_COLUMNS = ("id", "seq", "type", "program_id", "project", "assignee1",
                 "assignee2", "start_date", "end_date", "created_at",
                 "updated_at", "payload")
_PLAN_COLUMNS = ("id", "seq", "kind", "member", "project", "date", "end_date",
                 "created_at", "updated_at", "payload")
_USER_COLUMNS = ("id", "seq", "name", "member", "role", "password",
                 "created_at", "updated_at")

# Columns added after the first release: (table, column, type).
_ADDED_COLUMNS = (("plans", "kind", "TEXT"),)

# SQLite の変数上限(999)に収まるバッチサイズ
_CHUNK = 400


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


class Database:
    """One SQLite file holding the whole store."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()
        self._local = threading.local()
        self._ready = False

    # ------------------------------------------------------- connection
    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=15.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @property
    def conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None or getattr(self._local, "path", None) != self.path:
            if conn is not None:
                conn.close()
            conn = self._connect()
            self._local.conn = conn
            self._local.path = self.path
        return conn

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None

    def initialize(self) -> None:
        with self._lock:
            if self._ready:
                return
            with self.conn as conn:
                conn.executescript(_SCHEMA_SQL)
                for table, column, ctype in _ADDED_COLUMNS:
                    existing = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
                    if column not in existing:
                        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ctype}")
            self._ready = True

    def relocate(self, path: Path) -> None:
        with self._lock:
            self.close()
            self.path = Path(path)
            self._ready = False

    # ------------------------------------------------------------- read
    def is_empty(self) -> bool:
        self.initialize()
        row = self.conn.execute(
            "SELECT COUNT(*) FROM meta WHERE key = 'updatedAt'").fetchone()
        return not row or not row[0]

    def read_all(self) -> dict[str, Any]:
        self.initialize()
        conn = self.conn
        masters = {key: json.loads(value)
                   for key, value in conn.execute("SELECT key, value FROM masters")}
        entries: dict[str, dict[str, str]] = {}
        for member, month, value in conn.execute(
                "SELECT member, month, value FROM entries ORDER BY member, month"):
            entries.setdefault(member, {})[month] = value
        meta = dict(conn.execute("SELECT key, value FROM meta"))
        return {
            "version": int(meta.get("version") or SCHEMA_VERSION),
            "tasks": [json.loads(r[0]) for r in
                      conn.execute("SELECT payload FROM tasks ORDER BY seq")],
            "plans": [json.loads(r[0]) for r in
                      conn.execute("SELECT payload FROM plans ORDER BY seq")],
            "masters": masters,
            "entries": entries,
            "savedViews": [json.loads(r[0]) for r in
                           conn.execute("SELECT value FROM saved_views ORDER BY seq")],
            "updatedAt": meta.get("updatedAt") or None,
        }

    # ------------------------------------------------------------ write
    def write_all(self, data: dict[str, Any]) -> None:
        """Replace the whole store inside a single transaction."""
        self.initialize()
        task_rows = [self._task_row(i, t) for i, t in enumerate(data.get("tasks") or [])]
        plan_rows = [self._plan_row(i, p) for i, p in enumerate(data.get("plans") or [])]
        entry_rows = [(member, month, value)
                      for member, months in (data.get("entries") or {}).items()
                      for month, value in (months or {}).items()]
        view_rows = [(i, _dumps(v)) for i, v in enumerate(data.get("savedViews") or [])]
        master_rows = [(k, _dumps(v)) for k, v in (data.get("masters") or {}).items()]
        meta_rows = [("version", str(data.get("version") or SCHEMA_VERSION)),
                     ("updatedAt", str(data.get("updatedAt") or ""))]

        with self._lock, self.conn as conn:
            for table in ("tasks", "plans", "entries", "saved_views", "masters"):
                conn.execute(f"DELETE FROM {table}")
            conn.executemany(
                f"INSERT OR REPLACE INTO tasks ({', '.join(_TASK_COLUMNS)}) "
                f"VALUES ({', '.join('?' * len(_TASK_COLUMNS))})", task_rows)
            conn.executemany(
                f"INSERT OR REPLACE INTO plans ({', '.join(_PLAN_COLUMNS)}) "
                f"VALUES ({', '.join('?' * len(_PLAN_COLUMNS))})", plan_rows)
            conn.executemany(
                "INSERT OR REPLACE INTO entries (member, month, value) VALUES (?, ?, ?)",
                entry_rows)
            conn.executemany(
                "INSERT INTO saved_views (seq, value) VALUES (?, ?)", view_rows)
            conn.executemany(
                "INSERT OR REPLACE INTO masters (key, value) VALUES (?, ?)", master_rows)
            conn.executemany(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", meta_rows)
        # Fold the WAL back in so a plain copy of the .sqlite3 file is complete.
        self.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    def write_partial(self, data: dict[str, Any], changes: dict[str, Any]) -> None:
        """Write only the records listed in `changes`.

        changes = {"tasks": {id: obj}, "taskDel": {id},
                   "plans": {id: obj}, "planDel": {id},
                   "masters": bool, "entries": bool, "views": bool}
        """
        self.initialize()
        meta_rows = [("version", str(data.get("version") or SCHEMA_VERSION)),
                     ("updatedAt", str(data.get("updatedAt") or ""))]

        with self._lock, self.conn as conn:
            self._delete_ids(conn, "tasks", changes.get("taskDel"))
            self._delete_ids(conn, "plans", changes.get("planDel"))
            self._upsert(conn, "tasks", _TASK_COLUMNS, self._task_row,
                         list((changes.get("tasks") or {}).values()))
            self._upsert(conn, "plans", _PLAN_COLUMNS, self._plan_row,
                         list((changes.get("plans") or {}).values()))

            if changes.get("masters"):
                conn.execute("DELETE FROM masters")
                conn.executemany(
                    "INSERT OR REPLACE INTO masters (key, value) VALUES (?, ?)",
                    [(k, _dumps(v)) for k, v in (data.get("masters") or {}).items()])
            if changes.get("entries"):
                conn.execute("DELETE FROM entries")
                conn.executemany(
                    "INSERT OR REPLACE INTO entries (member, month, value) VALUES (?, ?, ?)",
                    [(m, month, value)
                     for m, months in (data.get("entries") or {}).items()
                     for month, value in (months or {}).items()])
            if changes.get("views"):
                conn.execute("DELETE FROM saved_views")
                conn.executemany(
                    "INSERT INTO saved_views (seq, value) VALUES (?, ?)",
                    [(i, _dumps(v)) for i, v in enumerate(data.get("savedViews") or [])])
            conn.executemany(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", meta_rows)
        self.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    # ------------------------------------------------------------ users
    # Login accounts are kept apart from the store payload so they never end
    # up in JSON exports / backups and are not wiped by a full import.
    def read_users(self) -> list[dict[str, Any]]:
        self.initialize()
        rows = self.conn.execute(
            f"SELECT {', '.join(_USER_COLUMNS)} FROM users ORDER BY seq")
        return [dict(zip(_USER_COLUMNS, row)) for row in rows]

    def read_user(self, user_id: str) -> dict[str, Any] | None:
        self.initialize()
        row = self.conn.execute(
            f"SELECT {', '.join(_USER_COLUMNS)} FROM users WHERE id = ?",
            (user_id,)).fetchone()
        return dict(zip(_USER_COLUMNS, row)) if row else None

    def save_user(self, user: dict[str, Any]) -> None:
        self.initialize()
        with self._lock, self.conn as conn:
            row = conn.execute("SELECT seq FROM users WHERE id = ?", (user["id"],)).fetchone()
            if row is None:
                row = conn.execute("SELECT COALESCE(MAX(seq), -1) + 1 FROM users").fetchone()
            values = {**user, "seq": row[0]}
            conn.execute(
                f"INSERT OR REPLACE INTO users ({', '.join(_USER_COLUMNS)}) "
                f"VALUES ({', '.join('?' * len(_USER_COLUMNS))})",
                [values.get(c) for c in _USER_COLUMNS])

    def delete_user(self, user_id: str) -> None:
        self.initialize()
        with self._lock, self.conn as conn:
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))

    def get_meta(self, key: str) -> str | None:
        self.initialize()
        row = self.conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    def set_meta(self, key: str, value: str) -> None:
        self.initialize()
        with self._lock, self.conn as conn:
            conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, value))

    @staticmethod
    def _delete_ids(conn: sqlite3.Connection, table: str, ids) -> None:
        ids = [i for i in (ids or []) if i]
        for start in range(0, len(ids), _CHUNK):
            part = ids[start:start + _CHUNK]
            conn.execute(f"DELETE FROM {table} WHERE id IN ({', '.join('?' * len(part))})",
                         part)

    @staticmethod
    def _upsert(conn: sqlite3.Connection, table: str, columns, row_fn, objects) -> None:
        if not objects:
            return
        ids = [o.get("id") for o in objects if o.get("id")]
        known: dict[str, int] = {}
        for start in range(0, len(ids), _CHUNK):
            part = ids[start:start + _CHUNK]
            known.update(dict(conn.execute(
                f"SELECT id, seq FROM {table} WHERE id IN ({', '.join('?' * len(part))})",
                part)))
        row = conn.execute(f"SELECT COALESCE(MAX(seq), -1) FROM {table}").fetchone()
        next_seq = (row[0] if row else -1) + 1
        rows = []
        for obj in objects:
            seq = known.get(obj.get("id"))
            if seq is None:
                seq = next_seq
                next_seq += 1
            rows.append(row_fn(seq, obj))
        conn.executemany(
            f"INSERT OR REPLACE INTO {table} ({', '.join(columns)}) "
            f"VALUES ({', '.join('?' * len(columns))})", rows)

    @staticmethod
    def _task_row(seq: int, task: dict) -> tuple:
        return (task.get("id") or f"seq-{seq}", seq, task.get("type"),
                task.get("programId"), task.get("project"), task.get("assignee1"),
                task.get("assignee2"), task.get("startDate"), task.get("endDate"),
                task.get("createdAt"), task.get("updatedAt"), _dumps(task))

    @staticmethod
    def _plan_row(seq: int, plan: dict) -> tuple:
        return (plan.get("id") or f"seq-{seq}", seq, plan.get("kind") or "plan",
                plan.get("member"), plan.get("project"), plan.get("date"),
                plan.get("endDate"), plan.get("createdAt"), plan.get("updatedAt"),
                _dumps(plan))
