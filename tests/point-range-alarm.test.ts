import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { ingestMeasurements, parseMeasurementPayload } from "../db/measurement-ingest";
import { provisionMeasurementDevice } from "../db/measurement-provisioning";
import { criticalAfterMinutes } from "../db/point-range-alarm";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

test("critical escalation waits three tolerances, at least 30 minutes", () => {
  assert.equal(criticalAfterMinutes({ toleranceMinutes: 10 }), 30);
  assert.equal(criticalAfterMinutes({ toleranceMinutes: 15 }), 45);
  assert.equal(criticalAfterMinutes({ toleranceMinutes: 0 }), 30);
});

test("a cold room alarms only after its tolerance, escalates and resolves itself", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const [site] = await db.select().from(schema.sites).limit(1);
    const [room] = await db.insert(schema.assets).values({ siteId: site.id, code: "CF-01", name: "Refrigerados 1", assetType: "cold_room" }).returning();
    const [gateway] = await db.insert(schema.gateways).values({ siteId: site.id, code: "HOIT-BLE-1A2B3C", name: "Mini gateway" }).returning();
    const [model] = await db.select().from(schema.deviceModels).where(eq(schema.deviceModels.code, "BLE-KKM-TH"));
    await db.transaction((tx) => provisionMeasurementDevice(tx, { gatewayId: gateway.id, assetId: room.id, modelId: model.id, externalId: "AA:00:00:00:00:01", name: "Sensor fondo", position: "Fondo" }));
    await db.transaction((tx) => provisionMeasurementDevice(tx, { gatewayId: gateway.id, assetId: room.id, modelId: model.id, externalId: "AA:00:00:00:00:02", name: "Sensor puerta", position: "Puerta" }));

    const start = new Date(Date.now() - 60 * 60_000);
    let sequence = 0;
    const send = async (minute: number, fondo: number, puerta = 3) => {
      const at = new Date(start.getTime() + minute * 60_000);
      sequence += 1;
      return ingestMeasurements(db, { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: site.id }, parseMeasurementPayload({
        gateway: gateway.code, sequence, bootId: "test",
        devices: [{ id: "AA:00:00:00:00:01", ts: at.toISOString(), m: { temperature: fondo } }, { id: "AA:00:00:00:00:02", ts: at.toISOString(), m: { temperature: puerta } }],
      }, at), at);
    };
    const rangeAlarms = () => db.select().from(schema.alarms).where(eq(schema.alarms.assetId, room.id));

    await send(0, 3.5);
    await send(2, 6.4); // sale de rango
    await send(8, 6.9);
    assert.equal((await rangeAlarms()).length, 0, "8 min fuera: dentro de la tolerancia de 10 min");
    const [state] = await db.select().from(schema.pointRangeStates).where(eq(schema.pointRangeStates.assetId, room.id));
    assert.equal(state.outSince?.toISOString(), new Date(start.getTime() + 2 * 60_000).toISOString());

    await send(13, 7.4);
    const [opened] = await rangeAlarms();
    assert.equal(opened.severity, "warning");
    assert.equal(opened.title, "Refrigerados 1 fuera de rango");
    assert.match(opened.detail ?? "", /^Fondo: 7,4 °C \(máx\. 5,0 °C\) desde hace 11 min\.$/);

    await send(33, 8.1);
    const [escalated] = await rangeAlarms();
    assert.equal(escalated.severity, "critical", "31 min fuera escala a crítica");
    assert.equal((await db.select().from(schema.assets).where(eq(schema.assets.id, room.id)))[0].state, "critical");

    await send(40, 4.2);
    const [resolved] = await rangeAlarms();
    assert.equal(resolved.status, "resolved");
    const [cleared] = await db.select().from(schema.pointRangeStates).where(eq(schema.pointRangeStates.assetId, room.id));
    assert.equal(cleared.outSince, null);
    assert.equal((await db.select().from(schema.assets).where(eq(schema.assets.id, room.id)))[0].state, "normal");

    // Una apertura corta de puerta no alarma: vuelve al rango antes de la tolerancia.
    await send(45, 3.2, 7.5);
    await send(50, 3.1, 3.4);
    assert.equal((await rangeAlarms()).length, 1);

    // Bajo el mínimo también alarma (cámara que se congela).
    await send(52, -1.5);
    await send(64, -1.8);
    const below = (await rangeAlarms()).find((alarm) => alarm.status === "open");
    assert.match(below?.detail ?? "", /mín\. 0,0 °C/);
  } finally {
    await client.close();
  }
});
