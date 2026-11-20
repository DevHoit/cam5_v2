import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { gatewayTokenFrom } from "../app/api/v1/gateway/_lib/auth";
import { ingestMeasurements, MeasurementIngestError, parseMeasurementPayload } from "../db/measurement-ingest";
import { provisionMeasurementDevice } from "../db/measurement-provisioning";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

const NOW = new Date("2026-11-20T15:00:00Z");

/** Exactamente lo que arma build_gateway_payload() del ESP32 (hoit-ble-gateway/main/main.c). */
function esp32Payload(sequence: number, uptimeMs: number, beacons: Array<Record<string, unknown>>) {
  return { gateway: "HOIT-BLE-1A2B3C", sequence, uptime_ms: uptimeMs, beacons };
}
const beacon = (mac: string, temperature: number, extra: Record<string, unknown> = {}) => ({
  mac, temperature, humidity: 81.4, battery_percent: 95, battery_mv: null, rssi: -71, age_ms: 4200, ...extra,
});

test("parses the ESP32 payload as-is: MAC as identity, numeric fields as measurements and age_ms as time", () => {
  const payload = parseMeasurementPayload(esp32Payload(12, 86_400_000, [beacon("c3:00:00:1a:2b:3c", 3.4)]), NOW);
  assert.equal(payload.gatewayCode, "HOIT-BLE-1A2B3C");
  assert.equal(payload.devices[0].externalId, "C3:00:00:1A:2B:3C");
  assert.deepEqual(payload.devices[0].values, { temperature: 3.4, humidity: 81.4, battery_percent: 95, rssi: -71 });
  assert.equal(payload.devices[0].recordedAt.toISOString(), "2026-11-20T14:59:55.800Z");
  assert.equal(payload.health?.uptimeS, 86_400);
});

test("parses the generic format and rejects malformed input", () => {
  const generic = parseMeasurementPayload({ gateway: "gw-1", sequence: 1, devices: [{ id: "SN-77", ts: "2026-11-20T14:58:00Z", rssi: -60, m: { voltage_l1: 221.4 } }] }, NOW);
  assert.deepEqual(generic.devices[0].values, { voltage_l1: 221.4, rssi: -60 });
  assert.throws(() => parseMeasurementPayload({ gateway: "gw", sequence: 1, beacons: [beacon("AA", 1), beacon("aa", 2)] }, NOW), /duplicado/);
  assert.throws(() => parseMeasurementPayload({ gateway: "gw", sequence: 1, beacons: [beacon("AA", 1, { "Temp C": 3 })] }, NOW), /no es válida/);
  assert.throws(() => parseMeasurementPayload({ gateway: "gw", sequence: 1, beacons: [beacon("AA", 1, { age_ms: 8 * 86_400_000 })] }, NOW), MeasurementIngestError);
  assert.throws(() => parseMeasurementPayload({ gateway: "gw", beacons: [] }, NOW), /sequence/);
});

test("accepts the gateway token as Bearer or as the ESP32 X-HOIT-Token header", () => {
  const headers = (entries: Record<string, string>) => ({ headers: new Headers(entries) });
  assert.equal(gatewayTokenFrom(headers({ authorization: "Bearer cam5gw_abc" })), "cam5gw_abc");
  assert.equal(gatewayTokenFrom(headers({ "x-hoit-token": "cam5gw_abc" })), "cam5gw_abc");
  assert.equal(gatewayTokenFrom(headers({ "x-hoit-token": "otro_token" })), null);
  assert.equal(gatewayTokenFrom(headers({ authorization: "Basic cam5gw_abc", "x-hoit-token": "cam5gw_abc" })), null);
});

test("queues unknown beacons, then stores readings and alarms once the beacon is assigned", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const [site] = await db.select().from(schema.sites).limit(1);
    const [point] = await db.select().from(schema.assets).where(eq(schema.assets.siteId, site.id)).limit(1);
    const [gateway] = await db.insert(schema.gateways).values({ siteId: site.id, code: "HOIT-BLE-1A2B3C", name: "Mini gateway casino" }).returning();
    const context = { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: site.id };
    const [model] = await db.select().from(schema.deviceModels).where(eq(schema.deviceModels.code, "BLE-KKM-TH"));
    assert.equal(model.protocol, "ble");

    // 1. Beacon desconocido: no guarda lecturas, queda en la bandeja.
    const first = await ingestMeasurements(db, context, parseMeasurementPayload(esp32Payload(1, 1000, [beacon("C3:00:00:1A:2B:3C", 3.4)]), NOW), NOW);
    assert.deepEqual(first.unknown, ["C3:00:00:1A:2B:3C"]);
    assert.equal(first.stored, 0);
    await ingestMeasurements(db, context, parseMeasurementPayload(esp32Payload(2, 31_000, [beacon("C3:00:00:1A:2B:3C", 3.6)]), NOW), NOW);
    const [detected] = await db.select().from(schema.detectedDevices);
    assert.equal(detected.seenCount, 2);
    assert.equal(detected.lastValues.temperature, 3.6);
    const [gatewayAfter] = await db.select().from(schema.gateways).where(eq(schema.gateways.id, gateway.id));
    assert.equal(gatewayAfter.state, "online");

    // 2. Asignación: canales desde la plantilla y salida de la bandeja.
    const { device, channels } = await db.transaction((tx) => provisionMeasurementDevice(tx, { gatewayId: gateway.id, assetId: point.id, modelId: model.id, externalId: "C3:00:00:1A:2B:3C", name: "Cámara fría casino" }));
    assert.equal(device.code, "BLE-1A2B3C");
    assert.equal(channels, 5);
    assert.equal((await db.select().from(schema.detectedDevices)).length, 0);
    const temperature = (await db.select().from(schema.channels).where(and(eq(schema.channels.deviceId, device.id), eq(schema.channels.metric, "temperature"))))[0];
    await db.update(schema.alarmRules).set({ warningThreshold: "5", criticalThreshold: "8", activationSamples: 1 }).where(eq(schema.alarmRules.channelId, temperature.id));

    // 3. Lecturas: se guardan con escala y unidad de la plantilla; la clave desconocida se informa y no rompe el envío.
    const at = new Date(NOW.getTime() + 60_000);
    const stored = await ingestMeasurements(db, context, parseMeasurementPayload(esp32Payload(3, 61_000, [beacon("c3:00:00:1a:2b:3c", 9.1, { battery_mv: 2950, extra_key: 1 })]), at), at);
    assert.equal(stored.unknown.length, 0);
    assert.equal(stored.stored, 5);
    assert.deepEqual(stored.ignoredKeys, { "C3:00:00:1A:2B:3C": ["extra_key"] });
    assert.equal(stored.alarms.opened, 1);
    const latest = await db.select({ metric: schema.channels.metric, value: schema.latestReadings.value, unit: schema.channels.unit })
      .from(schema.latestReadings).innerJoin(schema.channels, eq(schema.channels.id, schema.latestReadings.channelId))
      .where(eq(schema.channels.deviceId, device.id));
    const byMetric = Object.fromEntries(latest.map((row) => [row.metric, Number(row.value)]));
    assert.equal(byMetric.temperature, 9.1);
    assert.equal(byMetric.battery_voltage, 2.95);
    assert.equal(byMetric.signal_strength, -71);
    const [alarm] = await db.select().from(schema.alarms).where(eq(schema.alarms.channelId, temperature.id));
    assert.equal(alarm.severity, "critical");

    // 4. Reenvío idéntico: no duplica. Un envío a los 30 s se observa pero no se guarda (perfil: 1 lectura por minuto).
    const repeated = await ingestMeasurements(db, context, parseMeasurementPayload(esp32Payload(3, 61_000, [beacon("C3:00:00:1A:2B:3C", 9.1)]), at), at);
    assert.equal(repeated.stored, 0);
    const soon = new Date(at.getTime() + 30_000);
    const throttled = await ingestMeasurements(db, context, parseMeasurementPayload(esp32Payload(4, 91_000, [beacon("C3:00:00:1A:2B:3C", 9.0)]), soon), soon);
    assert.equal(throttled.stored, 0);
    assert.equal(throttled.observed, 4);
    assert.equal((await db.select().from(schema.readings)).length, 5);

    // 5. La credencial de un gateway no sirve para otro código.
    await assert.rejects(ingestMeasurements(db, context, parseMeasurementPayload({ ...esp32Payload(5, 1, []), gateway: "HOIT-BLE-FFFFFF" }, NOW), NOW), /no corresponde/);
  } finally {
    await client.close();
  }
});
