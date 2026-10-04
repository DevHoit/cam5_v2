from __future__ import annotations

import os
import socket
from pathlib import Path


def cpu_percent() -> float:
    try:
        load1 = os.getloadavg()[0]
        cpus = max(1, os.cpu_count() or 1)
        return round(min(100.0, max(0.0, (load1 / cpus) * 100.0)), 2)
    except (AttributeError, OSError):
        return 0.0


def memory_percent() -> float:
    try:
        values: dict[str, int] = {}
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            key, raw = line.split(":", 1)
            values[key] = int(raw.strip().split()[0])
        total = values.get("MemTotal", 0)
        available = values.get("MemAvailable", values.get("MemFree", 0))
        if total <= 0:
            return 0.0
        return round(min(100.0, max(0.0, ((total - available) / total) * 100.0)), 2)
    except (OSError, ValueError):
        return 0.0


def network_status() -> tuple[str, bool]:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("1.1.1.1", 53))
            address = sock.getsockname()[0]
        return ("unknown", bool(address and address != "0.0.0.0"))
    except OSError:
        return ("unknown", False)
