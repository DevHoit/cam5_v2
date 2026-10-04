from __future__ import annotations

from typing import Protocol

from ..models import DeviceConfig, Sample


class DeviceDriver(Protocol):
    def poll(self, config: DeviceConfig) -> Sample:
        """Acquire and normalize one sample from a physical device."""
        ...
