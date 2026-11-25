import assert from "node:assert/strict";
import test from "node:test";
import { and, asc, eq } from "drizzle-orm";
import { cam5OperationalChannels } from "../app/cam5-model";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { parsePointConfig, PointConfigError } from "../db/point-types";
import { classifyTemperatureDelta, evaluateTemperatureDelta, temperatureDeltaThresholds } from "../db/temperature-delta-alarm";
import { createMigratedTestDatabase } from "./helpers/database";

test("classifies the spread between the hottest and coldest sensor (strictly greater than the limit)", () => {
  const sensor = (code: string, value: number) => ({ channelId: code, code, name: code, value });
  const limits = { warning: 35, critical: 60 };
  assert.equal(classifyTemperatureDelta([sensor("T01", 40)], limits), null);
  assert.equal(classifyTemperatureDelta([sensor("T01", 75), sensor("T02", 40)], limits)?.severity, "normal", "35 justo no supera");
  const warning = classifyTemperatureDelta([sensor("T01", 40), sensor("T02", 75.5), sensor("T03", 41)], limits);
  assert.equal(warning?.severity, "warning");
  assert.equal(warning?.hottest.code, "T02");
  assert.equal(warning?.coldest.code, "T01");
  assert.equal(classifyTemperatureDelta([sensor("T01", 101), sensor("T02", 40)], limits)?.severity, "critical");
  assert.deepEqual(temperatureDeltaThresholds({}), limits);
  assert.deepEqual(temperatureDeltaThresholds({ temperatureDeltaWarning: 20, temperatureDeltaCritical: null }), { warning: 20, critical: null });
});

test("point configuration validates the temperature-difference limits", () => {
  assert.deepEqual(parsePointConfig({ temperatureDeltaWarning: "30", temperatureDeltaCritical: 50 }), { temperatureDeltaWarning: 30, temperatureDeltaCritical: 50 });
  assert.throws(() => parsePointConfig({ temperatureDeltaWarning: 60, temperatureDeltaCritical: 35 }), PointConfigError);
  assert.throws(() => parsePointConfig({ temperatureDeltaWarning: -5 }), PointConfigError);
});

test("CAM5 humidity defaults follow the condensation guidance (65 / 80 %RH)", () => {
  const humidity = cam5OperationalChannels.filter((channel) => channel.metric === "humidity");
  assert.ok(humidity.length > 0);
  for (const channel of humidity) {
    assert.equal(channel.warningDefault, 65);
    assert.equal(channel.criticalDefault, 80);
  }
});

test("opens, escalates and resolves the temperature-difference alarm of a CAM5 point", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const [device] = await db.select().from(schema.devices).where(eq(schema.devices.code, "CAM5-CTRL-01")).limit(1);
    const sensors = await db.select().from(schema.channels)
      .where(and(eq(schema.channels.deviceId, device.id), eq(schema.channels.metric, "temperature"), eq(schema.channels.enabled, true)))
      .orderBy(asc(schema.channels.code));
    assert.ok(sensors.length >= 3);

    let clock = Date.now() - 60 * 60_000;
    const send = async (hottest: number, rest = 40) => {
      clock += 60_000;
      const at = new Date(clock);
      for (const [index, channel] of sensors.entries()) {
        const value = String(index === 0 ? hottest : rest + index * 0.1);
        const [reading] = await db.insert(schema.readings).values({ channelId: channel.id, recordedAt: at, receivedAt: at, value, quality: "good" }).returning({ id: schema.readings.id });
        const latest = { readingId: reading.id, recordedAt: at, receivedAt: at, value, quality: "good" as const };
        await db.insert(schema.latestReadings).values({ channelId: channel.id, ...latest }).onConflictDoUpdate({ target: schema.latestReadings.channelId, set: latest });
      }
      return evaluateTemperatureDelta(db, device.assetId, at);
    };
    const deltaAlarms = () => db.select().from(schema.alarms).where(eq(schema.alarms.assetId, device.assetId));

    await send(42);
    assert.equal((await deltaAlarms()).length, 0, "diferencia normal");

    await send(80);
    await send(80);
    assert.equal((await deltaAlarms()).length, 0, "dos lecturas no bastan");
    assert.equal((await send(80)).opened, 1, "la tercera lectura seguida abre la advertencia");
    let [alarm] = await deltaAlarms();
    assert.equal(alarm.severity, "warning");
    assert.match(alarm.title, /Diferencia de temperatura entre sensores/);
    assert.match(alarm.detail ?? "", /Barra fase L1 \(T01\) 80,0 °C y .* diferencia de 39,9 °C \(umbral 35,0 °C\)/);
    assert.equal(alarm.channelId, sensors[0].id);

    await send(105);
    await send(105);
    assert.equal((await send(105)).escalated, 1);
    [alarm] = await deltaAlarms();
    assert.equal(alarm.severity, "critical");

    // 59 °C de diferencia sigue dentro de la histéresis de la crítica (60 − 2).
    await send(99.2);
    [alarm] = await deltaAlarms();
    assert.equal(alarm.status, "open");
    assert.equal(alarm.severity, "critical");

    await send(50);
    await send(50);
    assert.equal((await send(50)).resolved, 1, "tres lecturas normales la resuelven");
    [alarm] = await deltaAlarms();
    assert.equal(alarm.status, "resolved");
    const events = await db.select().from(schema.alarmEvents).where(eq(schema.alarmEvents.alarmId, alarm.id));
    assert.deepEqual(events.map((event) => event.eventType).sort(), ["escalated", "opened", "resolved_automatically"]);

    // Un punto puede desactivar la regla.
    await db.update(schema.assets).set({ config: { temperatureDeltaWarning: null, temperatureDeltaCritical: null } }).where(eq(schema.assets.id, device.assetId));
    for (let index = 0; index < 4; index += 1) await send(120);
    assert.equal((await deltaAlarms()).length, 1);
  } finally {
    await client.close();
  }
});
