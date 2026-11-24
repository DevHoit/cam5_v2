import assert from "node:assert/strict";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { ingestMeasurements, parseMeasurementPayload } from "../db/measurement-ingest";
import { provisionMeasurementDevice } from "../db/measurement-provisioning";
import { findSites, resetOperationalData } from "../db/reset-operational-data";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

test("resets the operational history of one site and keeps its configuration and other sites", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const [seedSite] = await db.select().from(schema.sites).limit(1);
    const [model] = await db.select().from(schema.deviceModels).where(eq(schema.deviceModels.code, "BLE-KKM-TH"));

    const prepare = async (code: string, mac: string) => {
      const [site] = await db.insert(schema.sites).values({ clientId: seedSite.clientId, code, name: `Sitio ${code}` }).returning();
      const [room] = await db.insert(schema.assets).values({ siteId: site.id, code: `CF-${code}`, name: `Cámara ${code}`, assetType: "cold_room" }).returning();
      const [gateway] = await db.insert(schema.gateways).values({ siteId: site.id, code: `GW-${code}`, name: `Gateway ${code}` }).returning();
      await db.transaction((tx) => provisionMeasurementDevice(tx, { gatewayId: gateway.id, assetId: room.id, modelId: model.id, externalId: mac, name: "Sensor", position: "Fondo" }));
      const start = new Date(Date.now() - 60 * 60_000);
      for (const [index, [minute, value]] of ([[0, 3], [2, 7], [20, 8]] as const).entries()) {
        const at = new Date(start.getTime() + minute * 60_000);
        await ingestMeasurements(db, { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: site.id }, parseMeasurementPayload({
          gateway: gateway.code, sequence: index + 1, bootId: "test", devices: [{ id: mac, ts: at.toISOString(), m: { temperature: value } }],
        }, at), at);
      }
      return { site, room, gateway };
    };
    const simulated = await prepare("SIM", "AA:00:00:00:00:01");
    const kept = await prepare("REAL", "AA:00:00:00:00:02");

    const readingsOf = async (assetId: string) => {
      const channelIds = (await db.select({ id: schema.channels.id }).from(schema.channels).where(eq(schema.channels.assetId, assetId))).map((row) => row.id);
      return db.select().from(schema.readings).where(inArray(schema.readings.channelId, channelIds));
    };
    assert.ok((await readingsOf(simulated.room.id)).length > 0);
    assert.equal((await db.select().from(schema.alarms).where(eq(schema.alarms.siteId, simulated.site.id))).length, 1);

    const [match] = await findSites(db, { site: "sim" });
    assert.equal(match.id, simulated.site.id);

    const preview = await resetOperationalData(db, [simulated.site.id], { apply: false });
    assert.ok(preview["Lecturas"] > 0);
    assert.equal(preview["Alertas"], 1);
    assert.ok((await readingsOf(simulated.room.id)).length > 0, "la simulación no borra");

    const counts = await resetOperationalData(db, [simulated.site.id], { apply: true, note: "test" });
    assert.deepEqual(counts, preview);
    assert.equal((await readingsOf(simulated.room.id)).length, 0);
    assert.equal((await db.select().from(schema.alarms).where(eq(schema.alarms.siteId, simulated.site.id))).length, 0);
    assert.equal((await db.select().from(schema.ingestionBatches).where(eq(schema.ingestionBatches.gatewayId, simulated.gateway.id))).length, 0);
    assert.equal((await db.select().from(schema.pointRangeStates).where(eq(schema.pointRangeStates.assetId, simulated.room.id))).length, 0);
    const [room] = await db.select().from(schema.assets).where(eq(schema.assets.id, simulated.room.id));
    assert.equal(room.state, "offline");
    // La configuración se conserva.
    assert.equal((await db.select().from(schema.devices).where(eq(schema.devices.assetId, simulated.room.id))).length, 1);
    assert.ok((await db.select().from(schema.channels).where(eq(schema.channels.assetId, simulated.room.id))).length > 0);
    const [audit] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "site.operational_data_reset"));
    assert.equal(audit.siteId, simulated.site.id);

    // El otro sitio queda intacto.
    assert.ok((await readingsOf(kept.room.id)).length > 0);
    assert.equal((await db.select().from(schema.alarms).where(eq(schema.alarms.siteId, kept.site.id))).length, 1);
  } finally {
    await client.close();
  }
});
