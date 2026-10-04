from __future__ import annotations

import os
import shutil
import time
import uuid
from dataclasses import dataclass
from typing import Any

from .clock import time_quality, utc_now
from .cloud import CloudClient, CloudResponse
from .health import cpu_percent, memory_percent, network_status
from .models import GatewayConfig, Sample
from .store import LocalStore


RETRY_SECONDS = (2, 5, 15, 30, 60, 120, 300)


@dataclass(frozen=True)
class RuntimeSettings:
    api_base: str
    token: str
    gateway_id: str
    state_db: str
    software_version: str = "0.1.0"
    buffer_max_bytes: int = 256 * 1024 * 1024
    config_refresh_seconds: int = 900
    heartbeat_seconds: int = 30
    sync_seconds: int = 2

    @classmethod
    def from_environment(cls) -> "RuntimeSettings":
        api_base = os.environ.get("HOIT_API_BASE", "").rstrip("/")
        token = os.environ.get("HOIT_GATEWAY_TOKEN", "")
        gateway_id = os.environ.get("HOIT_GATEWAY_ID", "").strip().upper()
        state_db = os.environ.get("HOIT_STATE_DB", "/var/lib/hoit-agent/agent.db")
        if not api_base or not token or not gateway_id:
            raise RuntimeError("HOIT_API_BASE, HOIT_GATEWAY_TOKEN y HOIT_GATEWAY_ID son obligatorios.")
        buffer_max_bytes = max(1_048_576, int(os.environ.get("HOIT_BUFFER_MAX_BYTES", str(256 * 1024 * 1024))))
        return cls(
            api_base=api_base,
            token=token,
            gateway_id=gateway_id,
            state_db=state_db,
            buffer_max_bytes=buffer_max_bytes,
            config_refresh_seconds=max(60, int(os.environ.get("HOIT_CONFIG_REFRESH_SECONDS", "900"))),
            heartbeat_seconds=max(5, int(os.environ.get("HOIT_HEARTBEAT_SECONDS", "30"))),
            sync_seconds=max(1, int(os.environ.get("HOIT_SYNC_SECONDS", "2"))),
        )


class GatewayRuntime:
    def __init__(self, settings: RuntimeSettings, cloud: CloudClient | None = None, store: LocalStore | None = None):
        self.settings = settings
        self.cloud = cloud or CloudClient(settings.api_base, settings.token)
        self.store = store or LocalStore(settings.state_db)
        self.boot_id = str(uuid.uuid4())
        self.started_monotonic = time.monotonic()
        self.sequence = 0
        self.config: GatewayConfig | None = None

    def close(self) -> None:
        self.store.close()

    def load_configuration(self) -> GatewayConfig:
        response = self.cloud.config()
        if response.status == 200 and isinstance(response.body, dict):
            candidate = GatewayConfig.from_dict(response.body)
            if candidate.gateway_id.upper() != self.settings.gateway_id:
                raise RuntimeError("gateway_id de configuración no coincide con la identidad local.")
            self.store.save_config(response.body)
            self.config = candidate
            return candidate

        cached = self.store.load_config()
        if cached is None:
            raise RuntimeError(f"No fue posible obtener configuración y no existe cache local (HTTP {response.status}).")
        candidate = GatewayConfig.from_dict(cached)
        if candidate.gateway_id.upper() != self.settings.gateway_id:
            raise RuntimeError("La configuración cacheada pertenece a otro gateway.")
        self.config = candidate
        return candidate

    def enqueue_samples(self, samples: list[Sample]) -> dict[str, Any]:
        if not samples:
            raise ValueError("No se puede crear un mensaje de ingest sin muestras.")
        maximum = self.config.max_batch_samples if self.config else 100
        if len(samples) > maximum:
            raise ValueError(f"El lote excede max_batch_samples={maximum}.")
        self.sequence += 1
        payload = {
            "schema_version": "1.0",
            "gateway_id": self.settings.gateway_id,
            "boot_id": self.boot_id,
            "message_id": str(uuid.uuid4()),
            "sequence": self.sequence,
            "created_at": utc_now(),
            "time_quality": time_quality(),
            "samples": [sample.as_dict() for sample in samples],
        }
        encoded_bytes = len(str(payload).encode("utf-8"))
        pending_bytes = int(self.store.stats()["pending_bytes"])
        if pending_bytes + encoded_bytes > self.settings.buffer_max_bytes:
            raise RuntimeError(
                f"Store & Forward lleno: {pending_bytes + encoded_bytes} bytes exceden HOIT_BUFFER_MAX_BYTES={self.settings.buffer_max_bytes}."
            )
        self.store.queue(payload)
        return payload

    def _retry_delay(self, attempts: int) -> int:
        return RETRY_SECONDS[min(max(0, attempts), len(RETRY_SECONDS) - 1)]

    def sync_once(self, limit: int = 25) -> dict[str, int]:
        result = {"sent": 0, "retried": 0, "dead_letter": 0}
        for message in self.store.pending(limit=limit):
            response = self.cloud.ingest(message.payload)
            if 200 <= response.status < 300:
                echoed = response.body.get("message_id") if isinstance(response.body, dict) else None
                if echoed is not None and echoed != message.message_id:
                    self.store.schedule_retry(message.message_id, self._retry_delay(message.attempts), "message_id de ACK no coincide.")
                    result["retried"] += 1
                    continue
                self.store.mark_sent(message.message_id)
                result["sent"] += 1
                continue

            detail = response.text or f"HTTP {response.status}"
            if response.status == 0 or response.status == 429 or response.status >= 500:
                self.store.schedule_retry(message.message_id, self._retry_delay(message.attempts), detail)
                result["retried"] += 1
            else:
                self.store.mark_dead_letter(message.message_id, detail)
                result["dead_letter"] += 1
        return result

    def heartbeat_payload(self) -> dict[str, Any]:
        stats = self.store.stats()
        disk = shutil.disk_usage(os.path.dirname(self.settings.state_db) or ".")
        disk_percent = round((disk.used / disk.total) * 100, 2) if disk.total else 0.0
        buffer_percent = round(min(100.0, (int(stats["pending_bytes"]) / self.settings.buffer_max_bytes) * 100.0), 2)
        active_interface, ip_available = network_status()
        return {
            "schema_version": "1.0",
            "gateway_id": self.settings.gateway_id,
            "boot_id": self.boot_id,
            "software_version": self.settings.software_version,
            "uptime_seconds": max(0, int(time.monotonic() - self.started_monotonic)),
            "buffer": {
                "pending_messages": stats["pending_messages"],
                "bytes": stats["pending_bytes"],
                "usage_percent": buffer_percent,
            },
            "network": {
                "active_interface": active_interface,
                "rssi_dbm": None,
                "ip_available": ip_available,
            },
            "system": {
                "cpu_percent": cpu_percent(),
                "memory_percent": memory_percent(),
                "disk_percent": disk_percent,
            },
            "interfaces": {},
            "devices": [],
        }

    def heartbeat_once(self) -> CloudResponse:
        return self.cloud.heartbeat(self.heartbeat_payload())

    def run_control_plane_once(self) -> dict[str, Any]:
        config = self.load_configuration()
        sync = self.sync_once()
        heartbeat = self.heartbeat_once()
        return {
            "config_version": config.config_version,
            "devices": len(config.devices),
            "sync": sync,
            "heartbeat_status": heartbeat.status,
        }

    def run_forever(self, stop_requested=lambda: False) -> None:
        self.load_configuration()
        now = time.monotonic()
        next_config = now + self.settings.config_refresh_seconds
        next_sync = now
        next_heartbeat = now

        while not stop_requested():
            now = time.monotonic()

            if now >= next_config:
                try:
                    self.load_configuration()
                except RuntimeError:
                    # Keep the last validated configuration; retry on the next refresh window.
                    pass
                next_config = now + self.settings.config_refresh_seconds

            if now >= next_sync:
                self.sync_once()
                next_sync = now + self.settings.sync_seconds

            if now >= next_heartbeat:
                response = self.heartbeat_once()
                interval = self.settings.heartbeat_seconds
                if isinstance(response.body, dict):
                    candidate = response.body.get("next_heartbeat_seconds")
                    if isinstance(candidate, int) and candidate >= 5:
                        interval = candidate
                next_heartbeat = now + interval

            time.sleep(0.2)
