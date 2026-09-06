import assert from "node:assert/strict";
import test from "node:test";
import { classifyAlarmCondition, remainsInsideAlarmHysteresis } from "../db/alarm-engine";

test("classifies thresholds and invalid telemetry without treating errors as measurements", () => {
  assert.deepEqual(classifyAlarmCondition(54, "good", [], "60", "75"), { severity: "normal", kind: "threshold", threshold: 60 });
  assert.deepEqual(classifyAlarmCondition(64, "good", [], "60", "75"), { severity: "warning", kind: "threshold", threshold: 60 });
  assert.deepEqual(classifyAlarmCondition(78, "good", [], "60", "75"), { severity: "critical", kind: "threshold", threshold: 75 });
  assert.deepEqual(classifyAlarmCondition(null, "bad", ["over_range"], "60", "75"), { severity: "critical", kind: "data_quality", threshold: null });
  assert.deepEqual(classifyAlarmCondition(null, "bad", ["communication_lost"], "60", "75"), { severity: "critical", kind: "communication", threshold: null });
});

test("holds an active threshold alarm until the value clears its hysteresis", () => {
  assert.equal(remainsInsideAlarmHysteresis(58.5, "good", "warning", "threshold", "60", "75", "2"), true);
  assert.equal(remainsInsideAlarmHysteresis(57.9, "good", "warning", "threshold", "60", "75", "2"), false);
  assert.equal(remainsInsideAlarmHysteresis(72.5, "good", "critical", "threshold", "60", "75", "3"), true);
  assert.equal(remainsInsideAlarmHysteresis(70, "stale", "critical", "threshold", "60", "75", "3"), false);
});
