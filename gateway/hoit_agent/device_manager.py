from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

from .clock import utc_now
from .drivers.base import DeviceDriver
from .models import DeviceConfig, GatewayConfig, Sample


DriverFactory = Callable[[DeviceConfig], DeviceDriver]


@dataclass
class DeviceHealth:
    device_id: str
    status: str = "UNKNOWN"
    latency_ms: float | None = None
    last_success_at: str | None = None
    consecutive_errors: int = 0
    last_error: str | None = None

    def heartbeat(self) -> dict:
        return {
            "device_id": self.device_id,
            "status": self.status,
            "latency_ms": self.latency_ms,
            "last_success_at": self.last_success_at,
            "consecutive_errors": self.consecutive_errors,
        }


class DeviceManager:
    def __init__(self, registry: dict[str, DriverFactory] | None = None):
        self.registry = registry or {}
        self.config: GatewayConfig | None = None
        self.drivers: dict[str, DeviceDriver] = {}
        self.health: dict[str, DeviceHealth] = {}

    def register(self, driver_name: str, factory: DriverFactory) -> None:
        self.registry[driver_name] = factory

    def configure(self, config: GatewayConfig) -> None:
        self.config = config
        active_ids = {device.device_id for device in config.devices if device.enabled}
        self.drivers = {key: driver for key, driver in self.drivers.items() if key in active_ids}
        self.health = {key: value for key, value in self.health.items() if key in active_ids}

        for device in config.devices:
            if not device.enabled:
                continue
            self.health.setdefault(device.device_id, DeviceHealth(device_id=device.device_id))
            if device.device_id in self.drivers:
                continue
            factory = self.registry.get(device.driver)
            if factory is not None:
                self.drivers[device.device_id] = factory(device)

    def poll_all(self) -> list[Sample]:
        if self.config is None:
            return []
        samples: list[Sample] = []
        for device in self.config.devices:
            if not device.enabled:
                continue
            health = self.health.setdefault(device.device_id, DeviceHealth(device_id=device.device_id))
            driver = self.drivers.get(device.device_id)
            if driver is None:
                health.status = "UNKNOWN"
                health.latency_ms = None
                health.last_error = f"Driver no registrado: {device.driver}"
                continue

            started = time.monotonic()
            try:
                sample = driver.poll(device)
                latency_ms = (time.monotonic() - started) * 1000.0
                if sample.device_id != device.device_id:
                    raise RuntimeError("El driver devolvió una muestra para otro device_id.")
                health.status = "ONLINE"
                health.latency_ms = round(latency_ms, 2)
                health.last_success_at = sample.sampled_at or utc_now()
                health.consecutive_errors = 0
                health.last_error = None
                samples.append(sample)
            except Exception as error:
                latency_ms = (time.monotonic() - started) * 1000.0
                health.latency_ms = round(latency_ms, 2)
                health.consecutive_errors += 1
                health.last_error = str(error)[:500]
                if health.last_success_at is None:
                    health.status = "UNKNOWN"
                elif health.consecutive_errors >= 3:
                    health.status = "OFFLINE"
                else:
                    health.status = "DEGRADED"
        return samples

    def heartbeat_devices(self) -> list[dict]:
        return [self.health[key].heartbeat() for key in sorted(self.health)]
