import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../app/api/v1/_lib/auth";
import { parseGenericIngestPayload } from "../app/api/v1/gateway/_lib/ingest-v2";

const now = new Date("2026-10-02T16:30:10.000Z");

function validPayload() {
  return {
    schemaVersion: "2.0",
    batchKey: "GW-DSE-01:boot-1:18452",
    sentAt: "2026-10-02T16:30:05.000Z",
    sampledAt: "2026-10-02T16:30:04.900Z",
    timeQuality: "synced",
    gateway: {
      code: "gw-dse-01",
      bootId: "550e8400-e29b-41d4-a716-446655440000",
      sequence: 18452,
    },
    device: {
      code: "dse-01",
      driver: "dse8660",
    },
    metrics: {
      "electrical.voltage.l1_n": 231.4,
      "electrical.current.l1": 85.3,
      "electrical.frequency": 50.02,
      "ats.mains.available": true,
    },
  };
}

test("parses normalized schema v2 telemetry", () => {
  const parsed = parseGenericIngestPayload(validPayload(), now);
  assert.equal(parsed.schemaVersion, "2.0");
  assert.equal(parsed.gateway.code, "GW-DSE-01");
  assert.equal(parsed.device.code, "DSE-01");
  assert.equal(parsed.quality, "good");
  assert.equal(parsed.timeQuality, "synced");
  assert.equal(parsed.metrics["electrical.voltage.l1_n"], 231.4);
  assert.equal(parsed.metrics["ats.mains.available"], true);
});

test("rejects an invalid schema version", () => {
  const payload = validPayload();
  payload.schemaVersion = "1.0";
  assert.throws(
    () => parseGenericIngestPayload(payload, now),
    (error: unknown) => error instanceof ApiError && error.status === 400 && /schemaVersion/.test(error.message),
  );
});

test("rejects non scalar metric values", () => {
  const payload = validPayload() as Record<string, unknown>;
  payload.metrics = { "environment.temperature": { value: -18.3 } };
  assert.throws(
    () => parseGenericIngestPayload(payload, now),
    (error: unknown) => error instanceof ApiError && error.status === 400 && /number, boolean o string/.test(error.message),
  );
});

test("rejects stale backfill beyond seven days", () => {
  const payload = validPayload();
  payload.sampledAt = "2026-09-20T16:30:04.900Z";
  assert.throws(
    () => parseGenericIngestPayload(payload, now),
    (error: unknown) => error instanceof ApiError && error.status === 400 && /7 días/.test(error.message),
  );
});
