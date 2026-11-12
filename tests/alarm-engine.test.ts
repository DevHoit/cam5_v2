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

test("keeps the title consistent with the severity after a critical alarm drops back to warning", async () => {
  const { createMigratedTestDatabase } = await import("./helpers/database");
  const { evaluateAlarmReadings } = await import("../db/alarm-engine");
  const { seedCam5Database } = await import("../db/seed");
  const schema = await import("../db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const [device] = await db.select().from(schema.devices).limit(1);
    const [channel] = await db.select().from(schema.channels).where(and(eq(schema.channels.assetId, device.assetId), eq(schema.channels.enabled, true))).limit(1);
    await db.update(schema.alarmRules).set({ enabled: true, warningThreshold: "60", criticalThreshold: "75", hysteresis: "0", activationSamples: 1, recoverySamples: 3 }).where(eq(schema.alarmRules.channelId, channel.id));
    const reading = (value: number) => [{ channelId: channel.id, value, quality: "good" as const, qualityFlags: [] }];
    const start = new Date("2026-11-11T12:00:00Z");

    await evaluateAlarmReadings(db, device.assetId, reading(80), start);
    await evaluateAlarmReadings(db, device.assetId, reading(65), new Date(start.getTime() + 60_000));

    const [alarm] = await db.select().from(schema.alarms).where(eq(schema.alarms.channelId, channel.id));
    assert.equal(alarm.severity, "critical");
    assert.match(alarm.title, /Umbral crítico superado/);
  } finally {
    await client.close();
  }
});

test("describes communication outages with a readable duration", async () => {
  const { formatAge } = await import("../db/alarm-engine");
  assert.equal(formatAge(45), "45 s");
  assert.equal(formatAge(12 * 60), "12 min");
  assert.equal(formatAge(3 * 3600 + 3599), "4 h");
  assert.equal(formatAge(14665), "4 h 4 min");
  assert.equal(formatAge(3 * 86400), "3 d");
});
