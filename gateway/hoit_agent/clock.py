from __future__ import annotations

import subprocess
from datetime import datetime, timezone


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def time_quality() -> str:
    """Return SYNCED only when systemd-timesyncd explicitly confirms synchronization."""
    try:
        result = subprocess.run(
            ["timedatectl", "show", "-p", "NTPSynchronized", "--value"],
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
        )
        if result.returncode == 0 and result.stdout.strip().lower() == "yes":
            return "SYNCED"
        if result.returncode == 0:
            return "ESTIMATED"
    except (FileNotFoundError, subprocess.SubprocessError, OSError):
        pass
    return "UNSYNCED"
