import assert from "node:assert/strict";
import test from "node:test";
import { parseColdChainConfig, summarizeColdChain } from "../db/cold-chain";

test("parses cold-chain configuration without inventing temperature limits", () => {
  const config = parseColdChainConfig({
    coldChain: {
      minimumC: 2,
      maximumC: 8,
      targetC: 5,
      staleAfterSeconds: 120,
      disagreementThresholdC: 1.5,
      excursionDelaySeconds: 300,
      batteryLowVoltage: 3.1,
      temperatureHysteresisC: 0.5,
    },
  });
  assert.deepEqual(config, {
    minimumC: 2,
    maximumC: 8,
    targetC: 5,
    staleAfterSeconds: 120,
    disagreementThresholdC: 1.5,
    excursionDelaySeconds: 300,
    batteryLowVoltage: 3.1,
    temperatureHysteresisC: 0.5,
  });

  const unconfigured = parseColdChainConfig({});
  assert.equal(unconfigured.minimumC, null);
  assert.equal(unconfigured.maximumC, null);
  assert.equal(unconfigured.batteryLowVoltage, null);
  assert.equal(unconfigured.temperatureHysteresisC, 0);
});

test("summarizes multiple sensors in one refrigeration chamber", () => {
  const now = new Date("2026-10-02T18:00:00.000Z");
  const config = parseColdChainConfig({
    coldChain: { minimumC: 2, maximumC: 8, staleAfterSeconds: 180, disagreementThresholdC: 1.5 },
  });

  const summary = summarizeColdChain([
    {
      id: "s1",
      code: "TEMP-01",
      name: "Sensor frontal",
      deviceState: "active",
      lastReadAt: new Date("2026-10-02T17:59:55.000Z"),
      temperatureC: 4.2,
      temperatureRecordedAt: new Date("2026-10-02T17:59:55.000Z"),
      temperatureQuality: "good",
      batteryVoltage: 3.5,
      rssi: -65,
    },
    {
      id: "s2",
      code: "TEMP-02",
      name: "Sensor posterior",
      deviceState: "active",
      lastReadAt: new Date("2026-10-02T17:59:50.000Z"),
      temperatureC: 5.1,
      temperatureRecordedAt: new Date("2026-10-02T17:59:50.000Z"),
      temperatureQuality: "good",
      batteryVoltage: 3.4,
      rssi: -70,
    },
  ], config, now);

  assert.equal(summary.status, "normal");
  assert.equal(summary.sensorsTotal, 2);
  assert.equal(summary.sensorsOnline, 2);
  assert.equal(summary.minimumObservedC, 4.2);
  assert.equal(summary.maximumObservedC, 5.1);
  assert.ok(Math.abs((summary.averageC ?? 0) - 4.65) < 0.0001);
});

test("marks a chamber warning when redundant sensors disagree", () => {
  const now = new Date("2026-10-02T18:00:00.000Z");
  const config = parseColdChainConfig({
    coldChain: { minimumC: 2, maximumC: 8, disagreementThresholdC: 1 },
  });

  const summary = summarizeColdChain([
    {
      id: "s1", code: "TEMP-01", name: "Sensor 1", deviceState: "active",
      lastReadAt: now, temperatureC: 3, temperatureRecordedAt: now, temperatureQuality: "good",
      batteryVoltage: null, rssi: null,
    },
    {
      id: "s2", code: "TEMP-02", name: "Sensor 2", deviceState: "active",
      lastReadAt: now, temperatureC: 5, temperatureRecordedAt: now, temperatureQuality: "good",
      batteryVoltage: null, rssi: null,
    },
  ], config, now);

  assert.equal(summary.disagreement, true);
  assert.equal(summary.status, "warning");
});

test("marks an out-of-range sensor critical", () => {
  const now = new Date("2026-10-02T18:00:00.000Z");
  const config = parseColdChainConfig({ coldChain: { minimumC: 2, maximumC: 8 } });
  const summary = summarizeColdChain([
    {
      id: "s1", code: "TEMP-01", name: "Sensor 1", deviceState: "active",
      lastReadAt: now, temperatureC: 9.4, temperatureRecordedAt: now, temperatureQuality: "good",
      batteryVoltage: null, rssi: null,
    },
  ], config, now);
  assert.equal(summary.status, "critical");
});
