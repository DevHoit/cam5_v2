import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCommissioning, type CommissioningValidationInput } from "../db/commissioning-engine";

const completeInput: CommissioningValidationInput = {
  deviceCode: "DEVICE-001",
  gatewayOnline: true,
  configuredMetricCount: 8,
  recentMetricCount: 8,
  goodMetricCount: 8,
  latestMetricAt: new Date("2026-10-04T18:00:00.000Z"),
  capabilityCount: 2,
};

test("approves generic commissioning when normalized evidence is complete", () => {
  const results = evaluateCommissioning(completeInput, new Date("2026-10-04T18:05:00.000Z"));
  assert.equal(results.length, 4);
  assert.ok(results.every((result) => result.status === "passed"));
  assert.equal(results.find((result) => result.itemKey === "metrics")?.evidence.configuredMetricCount, 8);
});

test("blocks commissioning when gateway, metrics or quality are incomplete", () => {
  const results = evaluateCommissioning({ ...completeInput, gatewayOnline: false, recentMetricCount: 0, goodMetricCount: 0, latestMetricAt: null });
  assert.equal(results.find((result) => result.itemKey === "gateway")?.status, "failed");
  assert.equal(results.find((result) => result.itemKey === "metrics")?.status, "failed");
  assert.equal(results.find((result) => result.itemKey === "quality")?.status, "failed");
});
