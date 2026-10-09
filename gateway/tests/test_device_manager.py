from __future__ import annotations

import unittest

from gateway.hoit_agent.device_manager import DeviceManager
from gateway.hoit_agent.models import GatewayConfig, Sample


CONFIG = GatewayConfig.from_dict({
    "schema_version": "1.0",
    "config_version": 1,
    "gateway_id": "GW-TEST",
    "upload": {"interval_seconds": 5, "max_batch_samples": 100},
    "devices": [{
        "device_id": "PM-01",
        "driver": "fake",
        "enabled": True,
        "transport": {"type": "modbus_rtu", "port": "/dev/ttyS1", "baud": 19200, "parity": "E", "stop_bits": 1, "slave_id": 1},
    }],
})


class GoodDriver:
    def poll(self, config):
        return Sample(config.device_id, "2026-10-04T01:00:00.000Z", "GOOD", {"electrical.frequency": 50.0})


class FlakyDriver:
    def __init__(self):
        self.fail = False

    def poll(self, config):
        if self.fail:
            raise RuntimeError("timeout")
        return Sample(config.device_id, "2026-10-04T01:00:00.000Z", "GOOD", {"x": 1})


class DeviceManagerTests(unittest.TestCase):
    def test_registered_driver_produces_normalized_sample_and_online_health(self):
        manager = DeviceManager({"fake": lambda _config: GoodDriver()})
        manager.configure(CONFIG)
        samples = manager.poll_all()
        self.assertEqual(len(samples), 1)
        self.assertEqual(samples[0].device_id, "PM-01")
        [health] = manager.heartbeat_devices()
        self.assertEqual(health["status"], "ONLINE")
        self.assertEqual(health["consecutive_errors"], 0)
        self.assertIsNotNone(health["last_success_at"])

    def test_unregistered_driver_is_unknown_not_falsely_offline(self):
        manager = DeviceManager()
        manager.configure(CONFIG)
        self.assertEqual(manager.poll_all(), [])
        [health] = manager.heartbeat_devices()
        self.assertEqual(health["status"], "UNKNOWN")
        self.assertEqual(health["consecutive_errors"], 0)

    def test_failures_degrade_then_offline_after_three_consecutive_errors(self):
        driver = FlakyDriver()
        manager = DeviceManager({"fake": lambda _config: driver})
        manager.configure(CONFIG)
        manager.poll_all()
        driver.fail = True

        manager.poll_all()
        self.assertEqual(manager.heartbeat_devices()[0]["status"], "DEGRADED")
        manager.poll_all()
        self.assertEqual(manager.heartbeat_devices()[0]["status"], "DEGRADED")
        manager.poll_all()
        health = manager.heartbeat_devices()[0]
        self.assertEqual(health["status"], "OFFLINE")
        self.assertEqual(health["consecutive_errors"], 3)

    def test_driver_cannot_emit_sample_for_another_device(self):
        class WrongDriver:
            def poll(self, _config):
                return Sample("OTHER", "2026-10-04T01:00:00.000Z", "GOOD", {"x": 1})

        manager = DeviceManager({"fake": lambda _config: WrongDriver()})
        manager.configure(CONFIG)
        self.assertEqual(manager.poll_all(), [])
        health = manager.heartbeat_devices()[0]
        self.assertEqual(health["status"], "UNKNOWN")
        self.assertEqual(health["consecutive_errors"], 1)


if __name__ == "__main__":
    unittest.main()
