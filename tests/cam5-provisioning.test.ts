import assert from "node:assert/strict";
import test from "node:test";
import { and, count, eq } from "drizzle-orm";
import { provisionCam5Device } from "../db/cam5-provisioning";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

test("provisions a second CAM5 controller with the standard inputs, channels, rules and relays", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Admin", adminPassword: "Cam5-Prueba-2026", log: false });
    const [site] = await db.select().from(schema.sites).limit(1);
    const [gateway] = await db.select().from(schema.gateways).limit(1);
    const [model] = await db.select().from(schema.deviceModels).where(eq(schema.deviceModels.code, "CAM5-TPH-XDCW")).limit(1);
    const [point] = await db.insert(schema.assets).values({ siteId: site.id, code: "EQ-02", name: "Equipo 2" }).returning();
    const [device] = await db.insert(schema.devices).values({ assetId: point.id, gatewayId: gateway.id, modelId: model.id, code: "CAM5-CTRL-02", name: "CAM5 Equipo 2", host: "10.0.0.2", unitId: 1 }).returning();
    // Mismo gateway y Unit ID 1 que el equipo del seed, pero otra IP: son dos CAM5 distintos.
    await assert.rejects(
      db.insert(schema.devices).values({ assetId: point.id, gatewayId: gateway.id, modelId: model.id, code: "CAM5-CTRL-03", name: "Duplicado", host: "10.0.0.2", unitId: 1 }),
      "the same host, port and Unit ID cannot be registered twice",
    );

    assert.deepEqual(await provisionCam5Device(db, { id: device.id, assetId: point.id, modelId: model.id }), { inputs: 24, channels: 36 });
    await db.update(schema.channels).set({ name: "Barra L1 equipo 2" }).where(and(eq(schema.channels.deviceId, device.id), eq(schema.channels.code, "T01")));
    assert.deepEqual(await provisionCam5Device(db, { id: device.id, assetId: point.id, modelId: model.id }), { inputs: 24, channels: 36 });

    const countFor = async (table: typeof schema.relayConfigurations | typeof schema.commissioningItems) =>
      (await db.select({ value: count() }).from(table).where(eq(table.deviceId, device.id)))[0].value;
    assert.equal(await countFor(schema.relayConfigurations), 6);
    assert.ok(await countFor(schema.commissioningItems) > 0);
    const rules = await db.select({ value: count() }).from(schema.alarmRules)
      .innerJoin(schema.channels, eq(schema.channels.id, schema.alarmRules.channelId))
      .where(eq(schema.channels.deviceId, device.id));
    assert.equal(rules[0].value, 36);
    const [renamed] = await db.select().from(schema.channels).where(and(eq(schema.channels.deviceId, device.id), eq(schema.channels.code, "T01")));
    assert.equal(renamed.name, "Barra L1 equipo 2", "re-provisioning must not overwrite field edits");
    assert.equal(renamed.assetId, point.id);
  } finally {
    await client.close();
  }
});
