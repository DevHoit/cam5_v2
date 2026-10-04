from __future__ import annotations

import os
import shutil
import time
import uuid
from dataclasses import dataclass
from typing import Any

from .clock import time_quality, utc_now
from .cloud import CloudClient, CloudResponse
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

    @classmethod
    def from_environment(cls) -> "RuntimeSettings":
        api_base = os.environ.get("HOIT_API_BASE", "").rstrip("/")
        token = os.environ.get("HOIT_GATEWAY_TOKEN", "")
        gateway_id = os.environ.get("HOIT_GATEWAY_ID", "").strip().upper()
        state_db = os.environ.get("HOIT_STATE_DB", "/var/lib/hoit-agent/agent.db")
        if not api_base or not token or not gateway_id:
            raise RuntimeError("HOIT_API_BASE, HOIT_GATEWAY_TOKEN y HOIT_GATEWAY_ID son obligatorios.")
        return cls(api_base=api_base, token=token, gateway_id=gateway_id, state_db=state_db)


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
        usage_percent = round((disk.used / disk.total) * 100, 2) if disk.total else 0.0
        return {
            "schema_version": "1.0",
            "gateway_id": self.settings.gateway_id,
            "boot_id": self.boot_id,
            "software_version": self.settings.software_version,
            "uptime_seconds": max(0, int(time.monotonic() - self.started_monotonic)),
            "buffer": {
                "pending_messages": stats["pending_messages"],
                "bytes": stats["pending_bytes"],
                "usage_percent": usage_percent,
            },
            "network": {
                "active_interface": "unknown",
                "rssi_dbm": None,
                "ip_available": True,
            },
            "system": {
                "cpu_percent": None,
                "memory_percent": None,
                "disk_percent": usage_percent,
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
