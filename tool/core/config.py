"""Runtime configuration.

Every setting can be supplied through an environment variable so that the
same image runs unchanged in a container, and overridden by CLI flags for
local use.
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent   # tool/
BASE_DIR = ROOT_DIR.parent                          # repository root

_TRUE = {"1", "true", "yes", "on"}


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or "").strip() or default


def _flag(name: str, default: bool = False) -> bool:
    raw = _env(name).lower()
    return raw in _TRUE if raw else default


def _int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


class Config:
    """Mutable process-wide configuration."""

    def __init__(self) -> None:
        self.data_dir = Path(_env("DPM_DATA_DIR", str(ROOT_DIR / "data")))
        self.files_dir = Path(_env("DPM_FILES_DIR", str(BASE_DIR)))
        self.web_dir = Path(_env("DPM_WEB_DIR", str(ROOT_DIR / "web")))
        self.host = _env("DPM_HOST", "127.0.0.1")
        self.port = _int("DPM_PORT", 8765)
        self.read_only = _flag("DPM_READ_ONLY")
        self.open_browser = _flag("DPM_OPEN_BROWSER", True)
        self.max_body = _int("DPM_MAX_BODY", 64 * 1024 * 1024)
        self.backup_keep = _int("DPM_BACKUP_KEEP", 30)
        # 全件JSONスナップショットの最小間隔（秒）。0 で毎回保存。
        self.backup_interval = _int("DPM_BACKUP_INTERVAL", 1800)
        self.gzip_min = _int("DPM_GZIP_MIN", 4096)
        self.port_scan = _int("DPM_PORT_SCAN", 20)
        self.allowed_hosts_raw = _env("DPM_ALLOWED_HOSTS")

    # ------------------------------------------------------------ paths
    @property
    def db_path(self) -> Path:
        return self.data_dir / "store.sqlite3"

    @property
    def legacy_json_path(self) -> Path:
        return self.data_dir / "store.json"

    @property
    def backup_dir(self) -> Path:
        return self.data_dir / "backup"

    @property
    def log_path(self) -> Path:
        return self.data_dir / "server.log"

    # ------------------------------------------------------------ hosts
    @property
    def allowed_hosts(self) -> set[str]:
        """Empty set means "accept any Host header" (proxy / container mode)."""
        raw = self.allowed_hosts_raw.strip()
        if not raw or raw == "*":
            return set()
        return {h.strip().lower() for h in raw.split(",") if h.strip()}

    def set_allowed_hosts(self, hosts) -> None:
        self.allowed_hosts_raw = ",".join(sorted({str(h).lower() for h in hosts if h}))

    @property
    def shared(self) -> bool:
        return self.host not in ("127.0.0.1", "localhost", "::1")


CONFIG = Config()
