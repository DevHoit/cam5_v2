import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { handleGenericIngest } from "../app/api/v1/gateway/_lib/ingest-v2";
import type { Cam5Database } from "../db/index";
import * as schema from "../db/schema";

const migrations = [
  "0000_cam5_initial_schema.sql",
  "0001_eager_blockbuster.sql",
  "0002_sparkling_wallow.sql",
  "0003_rich_charles_xavier.sql",
  "0004_windy_gauntlet.sql",
  "0005_milky_caretaker.sql",
  "0006_smiling_frightful_four.sql",
  "0007_big_frightful_four.sql",
  "0008_sloppy_mister_sinister.sql",
  "0009_cuddly_infant_terrible.sql",
  "0010_robust_wallop.sql",
  "0011_dear_prima.sql",
  "0012_hoit_core_foundation.sql",
  "0013_hoit_generic_telemetry.sql",
  "0014_generic_device_transport.sql",
  "0015_operational_condition_states.sql",
  "0016_cold_chain_report_template.sql",
  "0017_generic_metric_aggregates.sql",
  "0018_pm5560_metric_catalog.sql",
  "0019_nullable_device_gateway_site_guard.sql",
  "0020_electrical_report_template.sql",
  "0021_dse8660_metric_catalog.sql",
];

async function database() {
  const client = new PGlite();
  for (const filename of migrations) {
    const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return { client, db: drizzle(client, { schema }) as unknown as Cam5Database };
}

test("DSE8660 normalized telemetry drives ATS source alarms and recovery", async () => {
  const { client, db } = await database();
  try {
    const [owner] = await db.insert(schema.clients).values({ code: "CLIENT-ATS", name: "Cliente ATS" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: owner.id, code: "SITE-ATS", name: "Sitio ATS" }).returning();
    const [asset] = await db.insert(schema.assets).values({
      siteId: site.id,
      code: "ATS-01",
      name: "ATS principal",
      assetType: "ats",
      state: "offline",
      metadata: {
        ats: {
          source1Label: "Red A",
          source2Label: "Red B",
          expectedPosition: null,
          alarms: {
            staleAfterSeconds: 30,
            source1Required: true,
            source2Required: false,
            sourceUnavailableDelaySeconds: 0,
            commonAlarmDelaySeconds: 0,
            unexpectedPositionDelaySeconds: 0,
          },
        },
      },
    }).returning();
    const [gateway] = await db.insert(schema.gateways).values({ siteId: site.id, code: "GW-DSE", name: "Gateway DSE" }).returning();
    const [device] = await db.insert(schema.devices).values({
      assetId: asset.id,
      code: "DSE8660-01",
      name: "DSE8660 MKII",
      deviceType: "ats_controller",
      driver: "dse8660_mkii",
      protocol: "modbus_rtu",
      unitId: 10,
      state: "commissioning",
    }).returning();
    await db.insert(schema.gatewayDeviceBindings).values({
      gatewayId: gateway.id,
      deviceId: device.id,
      interfaceType: "rs485",
      config: { unitId: 10, baudRate: 19200, parity: "even", pollIntervalMs: 1000, readOnly: true },
    });

    const definitions = await db.select().from(schema.metricDefinitions);
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
    const keys = [
      "ats.source1.available",
      "ats.source2.available",
      "ats.transfer.position",
      "ats.common_alarm",
      "ats.source1.voltage.l1_n",
      "ats.load.power.active.total",
      "dse.mode",
    ];
    for (const [index, key] of keys.entries()) {
      const definition = byKey.get(key);
      assert.ok(definition, "Falta definición " + key);
      await db.insert(schema.deviceMetrics).values({
        deviceId: device.id,
        metricDefinitionId: definition.id,
        code: "ATS-" + index,
        name: definition.name,
        displayOrder: index,
      });
    }

    const credential = { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: site.id };
    const payload = (sequence: number, at: string, source1Available: boolean) => ({
      schemaVersion: "2.0",
      batchKey: `GW-DSE:boot-ats:${sequence}:DSE8660-01`,
      sentAt: at,
      sampledAt: at,
      timeQuality: "synced",
      quality: "good",
      qualityFlags: [],
      gateway: { code: "GW-DSE", bootId: "boot-ats", sequence },
      device: { code: "DSE8660-01", driver: "dse8660_mkii" },
      metrics: {
        "ats.source1.available": source1Available,
        "ats.source2.available": true,
        "ats.transfer.position": "source1",
        "ats.common_alarm": false,
        "ats.source1.voltage.l1_n": source1Available ? 230.2 : 0,
        "ats.load.power.active.total": 34.5,
        "dse.mode": "auto",
      },
    });

    const first = await handleGenericIngest({
      db,
      credential,
      rawPayload: payload(1, "2026-10-02T18:00:00.000Z", true),
      receivedAt: new Date("2026-10-02T18:00:00.000Z"),
    });
    assert.equal(first.status, 202);
    const [normalAsset] = await db.select().from(schema.assets).where(eq(schema.assets.id, asset.id));
    assert.equal(normalAsset.state, "normal");

    const second = await handleGenericIngest({
      db,
      credential,
      rawPayload: payload(2, "2026-10-02T18:00:05.000Z", false),
      receivedAt: new Date("2026-10-02T18:00:05.000Z"),
    });
    assert.equal(second.status, 202);
    const [sourceAlarm] = await db.select().from(schema.alarms).where(and(
      eq(schema.alarms.assetId, asset.id),
      eq(schema.alarms.status, "open"),
    )).limit(1);
    assert.ok(sourceAlarm);
    assert.equal(sourceAlarm.severity, "critical");
    assert.match(sourceAlarm.title, /Red A no disponible/);
    const [criticalAsset] = await db.select().from(schema.assets).where(eq(schema.assets.id, asset.id));
    assert.equal(criticalAsset.state, "critical");

    const third = await handleGenericIngest({
      db,
      credential,
      rawPayload: payload(3, "2026-10-02T18:00:10.000Z", true),
      receivedAt: new Date("2026-10-02T18:00:10.000Z"),
    });
    assert.equal(third.status, 202);
    const [resolved] = await db.select().from(schema.alarms).where(eq(schema.alarms.id, sourceAlarm.id));
    assert.equal(resolved.status, "resolved");
    const [recoveredAsset] = await db.select().from(schema.assets).where(eq(schema.assets.id, asset.id));
    assert.equal(recoveredAsset.state, "normal");
  } finally {
    await client.close();
  }
});
