import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { provisionMeasurementDevice } from "../db/measurement-provisioning";
import { classifyPoint, parsePointConfig, PointConfigError, resolvePointConfig, type PointSensorReading } from "../db/point-types";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

const coldRoom = { aggregation: "max" as const, defaultConfig: { rangeMin: 0, rangeMax: 5, toleranceMinutes: 10 } };
const sensor = (value: number | null, position: string, quality: PointSensorReading["quality"] = "good"): PointSensorReading => ({ channelId: position, deviceId: position, position, value, quality, recordedAt: new Date() });

test("validates point settings and keeps only known keys", () => {
  assert.deepEqual(parsePointConfig({ rangeMin: "0", rangeMax: "4,5", toleranceMinutes: 15, aggregation: "avg", other: 1 }), { rangeMin: 0, rangeMax: 4.5, toleranceMinutes: 15, aggregation: "avg" });
  assert.deepEqual(parsePointConfig({ rangeMin: "" }), { rangeMin: null });
  assert.throws(() => parsePointConfig({ rangeMin: 6, rangeMax: 5 }), PointConfigError);
  assert.throws(() => parsePointConfig({ toleranceMinutes: 2.5 }), /entero/);
  assert.throws(() => parsePointConfig({ aggregation: "median" }), /combinar/);
});

test("a point inherits its type settings and overrides only what it defines", () => {
  assert.deepEqual(resolvePointConfig(coldRoom, {}), { rangeMin: 0, rangeMax: 5, toleranceMinutes: 10, aggregation: "max" });
  assert.deepEqual(resolvePointConfig(coldRoom, { rangeMax: 8, aggregation: "avg" }), { rangeMin: 0, rangeMax: 8, toleranceMinutes: 10, aggregation: "avg" });
  assert.deepEqual(resolvePointConfig({ aggregation: "max", defaultConfig: { rangeMax: -18 } }, { rangeMin: null }), { rangeMin: null, rangeMax: -18, toleranceMinutes: 0, aggregation: "max" });
});

test("a cold room takes its worst valid sensor and ignores stale or invalid ones", () => {
  const config = resolvePointConfig(coldRoom, {});
  const outside = classifyPoint([sensor(3.4, "Fondo"), sensor(7.8, "Puerta"), sensor(25, "Estante", "stale"), sensor(null, "Evaporador", "bad")], config);
  assert.equal(outside.status, "out_of_range");
  assert.equal(outside.value, 7.8);
  assert.equal(outside.decisive?.position, "Puerta");
  assert.equal(Number(outside.deviation!.toFixed(1)), 2.8);
  assert.equal(outside.sensors, 4);
  assert.equal(outside.reporting, 2);

  assert.equal(classifyPoint([sensor(-1.2, "Fondo")], config).status, "out_of_range");
  assert.equal(classifyPoint([sensor(2, "Fondo"), sensor(4, "Puerta")], resolvePointConfig(coldRoom, { aggregation: "avg" })).value, 3);
  assert.equal(classifyPoint([sensor(null, "Puerta", "bad")], config).status, "no_data");
  assert.equal(classifyPoint([sensor(48.6, "Tablero")], resolvePointConfig({ aggregation: "sum", defaultConfig: {} }, {})).status, "no_range");
});

test("ships point types by system and assigns beacon battery and signal as sensor health", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const types = await db.select().from(schema.pointTypes);
    const byKey = Object.fromEntries(types.map((type) => [type.key, type]));
    assert.equal(byKey.cold_room.system, "cold");
    assert.equal(byKey.electrical_panel.system, "energy");
    assert.equal(byKey.ups.system, "backup");
    const [existing] = await db.select().from(schema.assets).limit(1);
    assert.equal(existing.assetType, "switchgear_cabinet");

    const [site] = await db.select().from(schema.sites).limit(1);
    const [room] = await db.insert(schema.assets).values({ siteId: site.id, code: "CF-01", name: "Cámara fría 1", assetType: "cold_room" }).returning();
    await assert.rejects(db.insert(schema.assets).values({ siteId: site.id, code: "X-01", name: "Tipo inexistente", assetType: "nave_espacial" }));
    const [gateway] = await db.insert(schema.gateways).values({ siteId: site.id, code: "HOIT-BLE-1A2B3C", name: "Mini gateway" }).returning();
    const [model] = await db.select().from(schema.deviceModels).where(eq(schema.deviceModels.code, "BLE-KKM-TH"));
    const { device } = await db.transaction((tx) => provisionMeasurementDevice(tx, { gatewayId: gateway.id, assetId: room.id, modelId: model.id, externalId: "C3:00:00:1A:2B:3C", name: "Sensor puerta", position: "Puerta" }));
    assert.equal(device.position, "Puerta");
    const created = await db.select({ code: schema.channels.code, role: schema.channels.role, zone: schema.channels.zone, order: schema.channels.displayOrder })
      .from(schema.channels).where(and(eq(schema.channels.deviceId, device.id))).orderBy(schema.channels.displayOrder);
    assert.deepEqual(created.map((channel) => `${channel.code}:${channel.role}`), ["HR:process", "TEMP:process", "BAT:health", "RSSI:health", "VBAT:health"]);
    assert.ok(created.every((channel) => channel.zone === "Puerta"));
  } finally {
    await client.close();
  }
});
