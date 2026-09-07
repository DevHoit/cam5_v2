import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCommissioning, type CommissioningValidationInput } from "../db/commissioning-engine";

const completeInput: CommissioningValidationInput = {
  serialNumber: "CAM5-001",
  firmwareVersion: "1.6",
  dataVersion: 1,
  registerCount: 105,
  minimumRegister: 418,
  maximumRegister: 522,
  lastReadAt: new Date("2026-08-11T12:00:00.000Z"),
  enabledChannelCount: 8,
  configuredRuleCount: 8,
  relayCount: 6,
  snapshotCount: 1,
  readingCount: 10_000,
  validReadingCount: 9_950,
  firstReadingAt: new Date("2026-08-10T11:00:00.000Z"),
  lastReadingAt: new Date("2026-08-11T12:00:00.000Z"),
};

test("approves every automatic commissioning control when the evidence is complete", () => {
  const results = evaluateCommissioning(completeInput, new Date("2026-08-11T12:05:00.000Z"));
  assert.equal(results.length, 6);
  assert.ok(results.every((result) => result.status === "passed"));
  assert.equal(results.find((result) => result.itemKey === "registers")?.evidence.registerCount, 105);
  assert.equal(results.find((result) => result.itemKey === "stability")?.evidence.qualityPercent, 99.5);
});

test("blocks commissioning when identity, register coverage or stability is incomplete", () => {
  const results = evaluateCommissioning({
    ...completeInput,
    serialNumber: null,
    registerCount: 104,
    maximumRegister: 521,
    validReadingCount: 9_850,
    firstReadingAt: new Date("2026-08-11T00:00:00.000Z"),
  });
  assert.equal(results.find((result) => result.itemKey === "identity")?.status, "failed");
  assert.equal(results.find((result) => result.itemKey === "registers")?.status, "failed");
  assert.equal(results.find((result) => result.itemKey === "stability")?.status, "failed");
  assert.match(results.find((result) => result.itemKey === "stability")?.message ?? "", /24 horas/);
});
