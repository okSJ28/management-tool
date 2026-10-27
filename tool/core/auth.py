"""Login accounts and sessions.

Accounts live in their own SQLite table (see core.db) and are seeded from
users.json the first time the database has none.  Passwords are stored as
PBKDF2 hashes.  A session is an HMAC-signed cookie value, so it survives a
server restart and stops working as soon as the user's password changes or
the account is deleted.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import CONFIG
from .storage import DB, STORE

COOKIE = "dpm_session"
# owner = 特権管理者: 管理者と同じ権限を持ち、担当者（日次入力などの入力対象）には含めない
ROLES = ("owner", "admin", "user")
ADMIN_ROLES = ("owner", "admin")
MIN_PASSWORD = 4

_SEED_PATH = Path(__file__).with_name("users.json")
_SEED_EXAMPLE = Path(__file__).with_name("users.example.json")
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
_ITERATIONS = 120_000
_SECRET_KEY = "authSecret"
_LOCK = threading.RLock()
_seeded_for: Path | None = None


class AccountError(Exception):
    """A rejected account operation; `code` is sent to the client."""

    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# ------------------------------------------------------------- passwords
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                 bytes.fromhex(salt), _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt}${digest.hex()}"


def _check_password(password: str, stored: str) -> bool:
    try:
        _algo, iterations, salt, expected = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                                     bytes.fromhex(salt), int(iterations))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), expected)


# ------------------------------------------------------------------ seed
def ensure_ready() -> None:
    """Create the initial accounts when the database has none."""
    global _seeded_for
    with _LOCK:
        if _seeded_for == DB.path:
            return
        if not DB.read_users():
            path = _SEED_PATH if _SEED_PATH.exists() else _SEED_EXAMPLE
            seed = json.loads(path.read_text(encoding="utf-8"))
            now = _now()
            for raw in seed.get("users", []):
                DB.save_user({
                    "id": raw["id"], "name": raw.get("name") or raw["id"],
                    "member": raw.get("member") or "", "role": raw.get("role") or "user",
                    "password": hash_password(raw["id"]),
                    "created_at": now, "updated_at": now,
                })
            for raw in seed.get("users", []):
                _sync_member(raw.get("role") or "user", raw.get("member"))
        _seeded_for = DB.path


def _public(row: dict[str, Any]) -> dict[str, Any]:
    return {"id": row["id"], "name": row.get("name") or row["id"],
            "member": row.get("member") or "", "role": row.get("role") or "user",
            "createdAt": row.get("created_at"), "updatedAt": row.get("updated_at")}


def is_admin(account: dict[str, Any] | None) -> bool:
    return bool(account) and account.get("role") in ADMIN_ROLES


def _admin_count(exclude: str | None = None) -> int:
    return sum(1 for u in DB.read_users() if u["role"] in ADMIN_ROLES and u["id"] != exclude)


def _sync_member(role: str, member: str | None) -> None:
    """特権管理者は担当者一覧から外し、それ以外は担当者として登録する。"""
    if role == "owner":
        STORE.exclude_members([member])
    else:
        STORE.ensure_members([member])


# -------------------------------------------------------------- sessions
def _secret() -> bytes:
    with _LOCK:
        value = DB.get_meta(_SECRET_KEY)
        if not value:
            value = secrets.token_hex(32)
            DB.set_meta(_SECRET_KEY, value)
        return value.encode("ascii")


def _sign(user_id: str, expires: int, password_hash: str) -> str:
    message = f"{user_id}.{expires}.{password_hash}".encode("utf-8")
    return hmac.new(_secret(), message, hashlib.sha256).hexdigest()


def session_seconds() -> int:
    return max(1, CONFIG.session_hours) * 3600


def issue_token(user_id: str) -> str:
    ensure_ready()
    row = DB.read_user(user_id)
    if row is None:
        raise AccountError("not-found", 404)
    expires = int(time.time()) + session_seconds()
    return f"{user_id}.{expires}.{_sign(user_id, expires, row['password'])}"


def verify_token(token: str) -> dict[str, Any] | None:
    """Return the signed-in user for a session cookie value, or None."""
    parts = (token or "").split(".")
    if len(parts) != 3 or not _ID_RE.match(parts[0]) or not parts[1].isdigit():
        return None
    user_id, expires = parts[0], int(parts[1])
    if expires < time.time():
        return None
    ensure_ready()
    row = DB.read_user(user_id)
    if row is None or not hmac.compare_digest(parts[2], _sign(user_id, expires, row["password"])):
        return None
    return _public(row)


def authenticate(user_id: str, password: str) -> dict[str, Any] | None:
    ensure_ready()
    row = DB.read_user(user_id.strip()) if _ID_RE.match(user_id.strip()) else None
    if row is None or not _check_password(password, row["password"]):
        return None
    return _public(row)


# ---------------------------------------------------------- management
def list_users() -> list[dict[str, Any]]:
    ensure_ready()
    return [_public(u) for u in DB.read_users()]


def _clean(payload: dict, current: dict | None = None) -> dict[str, Any]:
    base = current or {}
    name = str(payload.get("name", base.get("name")) or "").strip()
    member = str(payload.get("member", base.get("member")) or "").strip()
    role = payload.get("role", base.get("role")) or "user"
    if not name:
        raise AccountError("name-required")
    if role not in ROLES:
        raise AccountError("invalid-role")
    return {"name": name[:40], "member": member[:40] or name.split()[0][:40], "role": role}


def create_user(payload: dict) -> dict[str, Any]:
    ensure_ready()
    user_id = str(payload.get("id") or "").strip()
    if not _ID_RE.match(user_id):
        raise AccountError("invalid-user-id")
    with _LOCK:
        if DB.read_user(user_id):
            raise AccountError("user-exists", 409)
        fields = _clean(payload)
        now = _now()
        DB.save_user({"id": user_id, **fields, "password": hash_password(user_id),
                      "created_at": now, "updated_at": now})
    _sync_member(fields["role"], fields["member"])
    return _public(DB.read_user(user_id))


def update_user(user_id: str, payload: dict) -> dict[str, Any]:
    ensure_ready()
    with _LOCK:
        row = DB.read_user(user_id)
        if row is None:
            raise AccountError("not-found", 404)
        fields = _clean(payload, row)
        if row["role"] in ADMIN_ROLES and fields["role"] not in ADMIN_ROLES and not _admin_count(user_id):
            raise AccountError("last-admin")
        updated = {**row, **fields, "updated_at": _now()}
        if payload.get("resetPassword"):
            updated["password"] = hash_password(user_id)
        DB.save_user(updated)
    _sync_member(fields["role"], fields["member"])
    return _public(DB.read_user(user_id))


def delete_user(user_id: str, acting_id: str) -> None:
    ensure_ready()
    with _LOCK:
        row = DB.read_user(user_id)
        if row is None:
            raise AccountError("not-found", 404)
        if user_id == acting_id:
            raise AccountError("cannot-delete-self")
        if row["role"] in ADMIN_ROLES and not _admin_count(user_id):
            raise AccountError("last-admin")
        DB.delete_user(user_id)


def change_password(user_id: str, current: str, new: str) -> None:
    ensure_ready()
    with _LOCK:
        row = DB.read_user(user_id)
        if row is None:
            raise AccountError("not-found", 404)
        if not _check_password(current, row["password"]):
            raise AccountError("wrong-password")
        if len(new) < MIN_PASSWORD:
            raise AccountError("weak-password")
        DB.save_user({**row, "password": hash_password(new), "updated_at": _now()})
