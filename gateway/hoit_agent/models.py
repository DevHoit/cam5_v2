from __future__ import annotations

from dataclasses import dataclass
from typing import Any


VALID_TIME_QUALITY = {"SYNCED", "ESTIMATED", "UNSYNCED"}
VALID_SAMPLE_QUALITY = {"GOOD", "STALE", "INVALID", "UNKNOWN"}


@dataclass(frozen=True)
class DeviceConfig:
    device_id: str
    driver: str
    enabled: bool
    transport: dict[str, Any]
    poll_profile: str | None

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "DeviceConfig":
        device_id = str(value.get("device_id") or "").strip()
        driver = str(value.get("driver") or "").strip()
        transport = value.get("transport")
        if not device_id or not driver or not isinstance(transport, dict):
            raise ValueError("Device config inválida.")
        return cls(
            device_id=device_id,
            driver=driver,
            enabled=bool(value.get("enabled", True)),
            transport=transport,
            poll_profile=str(value["poll_profile"]).strip() if value.get("poll_profile") else None,
        )


@dataclass(frozen=True)
class GatewayConfig:
    schema_version: str
    config_version: int
    gateway_id: str
    upload_interval_seconds: int
    max_batch_samples: int
    devices: tuple[DeviceConfig, ...]

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "GatewayConfig":
        if value.get("schema_version") != "1.0":
            raise ValueError("schema_version de configuración no soportado.")
        upload = value.get("upload")
        if not isinstance(upload, dict):
            raise ValueError("upload es obligatorio.")
        devices = value.get("devices")
        if not isinstance(devices, list):
            raise ValueError("devices debe ser un arreglo.")
        config_version = value.get("config_version")
        if not isinstance(config_version, int) or config_version < 0:
            raise ValueError("config_version inválido.")
        gateway_id = str(value.get("gateway_id") or "").strip()
        if not gateway_id:
            raise ValueError("gateway_id es obligatorio.")
        interval = int(upload.get("interval_seconds", 5))
        maximum = int(upload.get("max_batch_samples", 100))
        if interval < 1 or maximum < 1 or maximum > 100:
            raise ValueError("Política de upload inválida.")
        return cls(
            schema_version="1.0",
            config_version=config_version,
            gateway_id=gateway_id,
            upload_interval_seconds=interval,
            max_batch_samples=maximum,
            devices=tuple(DeviceConfig.from_dict(item) for item in devices),
        )


@dataclass(frozen=True)
class Sample:
    device_id: str
    sampled_at: str
    quality: str
    metrics: dict[str, int | float | bool | str]

    def as_dict(self) -> dict[str, Any]:
        quality = self.quality.upper()
        if quality not in VALID_SAMPLE_QUALITY:
            raise ValueError(f"quality no soportada: {quality}")
        if not self.device_id or not self.metrics:
            raise ValueError("Una muestra requiere device_id y metrics.")
        return {
            "device_id": self.device_id,
            "sampled_at": self.sampled_at,
            "quality": quality,
            "metrics": self.metrics,
        }
