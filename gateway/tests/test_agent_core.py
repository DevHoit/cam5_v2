from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from urllib.request import Request

from gateway.hoit_agent.cloud import CloudClient, CloudResponse
from gateway.hoit_agent.models import GatewayConfig, Sample
from gateway.hoit_agent.runtime import GatewayRuntime, RuntimeSettings
from gateway.hoit_agent.store import LocalStore


CONFIG = {
    "schema_version": "1.0",
    "config_version": 42,
    "gateway_id": "GW-TEST",
    "upload": {"interval_seconds": 5, "max_batch_samples": 100},
    "devices": [
        {
            "device_id": "PM-01",
            "driver": "pm5560",
            "enabled": True,
            "poll_profile": "pm5560_default",
            "transport": {
                "type": "modbus_rtu",
                "port": "/dev/ttyS1",
                "baud": 19200,
                "parity": "E",
                "stop_bits": 1,
                "slave_id": 1,
            },
        }
    ],
}


class FakeTransport:
    def __init__(self):
        self.ingest_statuses = [202]
        self.requests: list[tuple[str, str, dict | None]] = []

    def __call__(self, request: Request, timeout: int) -> CloudResponse:
        payload = json.loads(request.data.decode("utf-8")) if request.data else None
        self.requests.append((request.full_url, request.method, payload))
        if request.full_url.endswith("/gateway/config"):
            return CloudResponse(200, CONFIG, json.dumps(CONFIG))
        if request.full_url.endswith("/gateway/heartbeat"):
            return CloudResponse(202, {"accepted": True}, '{"accepted":true}')
        if request.full_url.endswith("/gateway/ingest"):
            status = self.ingest_statuses.pop(0)
            body = {"accepted": True, "message_id": payload["message_id"]} if status < 300 else {"error": "temporary"}
            return CloudResponse(status, body, json.dumps(body))
        raise AssertionError(request.full_url)


class GatewayAgentCoreTests(unittest.TestCase):
    def settings(self, db_path: Path) -> RuntimeSettings:
        return RuntimeSettings(
            api_base="https://core.example.test",
            token="cam5gw_test",
            gateway_id="GW-TEST",
            state_db=str(db_path),
            buffer_max_bytes=1024 * 1024,
        )

    def test_config_is_validated_and_cached_for_offline_start(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "agent.db"
            transport = FakeTransport()
            runtime = GatewayRuntime(
                self.settings(db_path),
                cloud=CloudClient("https://core.example.test", "cam5gw_test", transport=transport),
            )
            try:
                config = runtime.load_configuration()
                self.assertIsInstance(config, GatewayConfig)
                self.assertEqual(config.config_version, 42)
                self.assertEqual(config.devices[0].transport["port"], "/dev/ttyS1")
            finally:
                runtime.close()

            offline = CloudClient(
                "https://core.example.test",
                "cam5gw_test",
                transport=lambda _request, _timeout: CloudResponse(0, None, "offline"),
            )
            runtime = GatewayRuntime(self.settings(db_path), cloud=offline)
            try:
                cached = runtime.load_configuration()
                self.assertEqual(cached.config_version, 42)
                self.assertEqual(cached.gateway_id, "GW-TEST")
            finally:
                runtime.close()

    def test_store_and_forward_retries_the_exact_same_message(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "agent.db"
            transport = FakeTransport()
            transport.ingest_statuses = [503, 202]
            runtime = GatewayRuntime(
                self.settings(db_path),
                cloud=CloudClient("https://core.example.test", "cam5gw_test", transport=transport),
            )
            try:
                runtime.config = GatewayConfig.from_dict(CONFIG)
                payload = runtime.enqueue_samples([
                    Sample(
                        device_id="PM-01",
                        sampled_at="2026-10-04T01:00:00.000Z",
                        quality="GOOD",
                        metrics={"electrical.frequency": 50.0},
                    )
                ])
                first = runtime.sync_once()
                self.assertEqual(first, {"sent": 0, "retried": 1, "dead_letter": 0})

                row = runtime.store.db.execute(
                    "SELECT payload_json, attempts, state FROM outbound_messages WHERE message_id=?",
                    (payload["message_id"],),
                ).fetchone()
                self.assertEqual(row["attempts"], 1)
                self.assertEqual(row["state"], "pending")
                self.assertEqual(json.loads(row["payload_json"])["message_id"], payload["message_id"])

                runtime.store.db.execute(
                    "UPDATE outbound_messages SET next_attempt_at=0 WHERE message_id=?",
                    (payload["message_id"],),
                )
                runtime.store.db.commit()
                second = runtime.sync_once()
                self.assertEqual(second, {"sent": 1, "retried": 0, "dead_letter": 0})

                ingest_payloads = [item[2] for item in transport.requests if item[0].endswith("/gateway/ingest")]
                self.assertEqual(len(ingest_payloads), 2)
                self.assertEqual(ingest_payloads[0], ingest_payloads[1])
                self.assertEqual(ingest_payloads[0]["message_id"], payload["message_id"])
                self.assertEqual(ingest_payloads[0]["sequence"], payload["sequence"])
                self.assertEqual(ingest_payloads[0]["boot_id"], payload["boot_id"])
            finally:
                runtime.close()

    def test_permanent_contract_error_moves_message_to_dead_letter(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "agent.db"
            transport = FakeTransport()
            transport.ingest_statuses = [422]
            runtime = GatewayRuntime(
                self.settings(db_path),
                cloud=CloudClient("https://core.example.test", "cam5gw_test", transport=transport),
            )
            try:
                runtime.config = GatewayConfig.from_dict(CONFIG)
                payload = runtime.enqueue_samples([
                    Sample("PM-01", "2026-10-04T01:00:00.000Z", "GOOD", {"electrical.frequency": 50.0})
                ])
                result = runtime.sync_once()
                self.assertEqual(result, {"sent": 0, "retried": 0, "dead_letter": 1})
                row = runtime.store.db.execute(
                    "SELECT state FROM outbound_messages WHERE message_id=?",
                    (payload["message_id"],),
                ).fetchone()
                self.assertEqual(row["state"], "dead_letter")
            finally:
                runtime.close()

    def test_heartbeat_matches_v1_numeric_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = GatewayRuntime(self.settings(Path(directory) / "agent.db"))
            try:
                heartbeat = runtime.heartbeat_payload()
                self.assertEqual(heartbeat["schema_version"], "1.0")
                self.assertEqual(heartbeat["gateway_id"], "GW-TEST")
                self.assertIsInstance(heartbeat["buffer"]["usage_percent"], float)
                self.assertGreaterEqual(heartbeat["system"]["cpu_percent"], 0)
                self.assertLessEqual(heartbeat["system"]["cpu_percent"], 100)
                self.assertGreaterEqual(heartbeat["system"]["memory_percent"], 0)
                self.assertLessEqual(heartbeat["system"]["memory_percent"], 100)
                self.assertGreaterEqual(heartbeat["system"]["disk_percent"], 0)
                self.assertLessEqual(heartbeat["system"]["disk_percent"], 100)
            finally:
                runtime.close()

    def test_store_survives_process_restart_with_pending_payload_intact(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agent.db"
            store = LocalStore(path)
            payload = {
                "schema_version": "1.0",
                "gateway_id": "GW-TEST",
                "boot_id": "550e8400-e29b-41d4-a716-446655440000",
                "message_id": "d1025c19-cfa7-4b90-93d7-725ad310d431",
                "sequence": 17,
                "created_at": "2026-10-04T01:00:00.000Z",
                "time_quality": "ESTIMATED",
                "samples": [{"device_id": "PM-01", "sampled_at": "2026-10-04T01:00:00.000Z", "quality": "GOOD", "metrics": {"x": 1}}],
            }
            self.assertTrue(store.queue(payload))
            store.close()

            reopened = LocalStore(path)
            try:
                pending = reopened.pending()
                self.assertEqual(len(pending), 1)
                self.assertEqual(pending[0].payload, payload)
            finally:
                reopened.close()


if __name__ == "__main__":
    unittest.main()
