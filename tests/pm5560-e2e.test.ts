import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { handleGenericIngest } from "../app/api/v1/gateway/_lib/ingest-v2";
import type { Cam5Database } from "../db/index";
import { PM5560_CORE_METRIC_KEYS, pm5560MetricCode } from "../db/pm5560";
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
  "0018_pm5560_metric_catalog.sql", "0019_nullable_device_gateway_site_guard.sql", "0020_electrical_report_template.sql", "0021_dse8660_metric_catalog.sql", "0022_ats_report_template.sql", "0023_access_scope_roles.sql", "0024_notification_suppressed_status.sql", "0025_rs485_bus_addressing.sql", "0026_hoit_v1_control_plane.sql",
];

async function database() {
  const client = new PGlite();
  for (const filename of migrations) {
    const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return { client, db: drizzle(client, { schema }) as unknown as Cam5Database };
}

test("PM5560 normalized telemetry persists all V1 electrical metrics", async () => {
  const { client, db } = await database();
  try {
    const [owner] = await db.insert(schema.clients).values({ code: "CLIENT-PM", name: "Cliente PM" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: owner.id, code: "SITE-PM", name: "Sitio PM" }).returning();
    const [asset] = await db.insert(schema.assets).values({
      siteId: site.id,
      code: "TAB-01",
      name: "Tablero principal",
      assetType: "electrical_point",
      nominalVoltageKv: "0.4",
      state: "offline",
      metadata: {
        electrical: {
          alarms: {
            staleAfterSeconds: 30,
            thresholdDelaySeconds: 0,
            voltageMinV: 210,
            voltageMaxV: 250,
            currentMaxA: 80,
            frequencyMinHz: 49,
            frequencyMaxHz: 51,
            powerFactorMin: 0.9,
            voltageHysteresisV: 2,
            currentHysteresisA: 2,
            frequencyHysteresisHz: 0.1,
            powerFactorHysteresis: 0.02,
          },
        },
      },
    }).returning();
    const [gateway] = await db.insert(schema.gateways).values({
      siteId: site.id,
      code: "GW-PM01",
      name: "Gateway PM",
    }).returning();
    const [device] = await db.insert(schema.devices).values({
      assetId: asset.id,
      code: "PM5560-01",
      name: "PM5560 principal",
      deviceType: "power_meter",
      protocol: "modbus_rtu",
      unitId: 1,
      state: "commissioning",
    }).returning();
    await db.insert(schema.gatewayDeviceBindings).values({
      gatewayId: gateway.id,
      deviceId: device.id,
      interfaceType: "rs485",
      interfaceKey: "rs485-1",
      address: 1,
      baudRate: 19200,
      parity: "even",
      dataBits: 8,
      stopBits: 1,
      config: { interfaceKey: "rs485-1", unitId: 1, baudRate: 19200, parity: "even", dataBits: 8, stopBits: 1, pollIntervalMs: 1000, readOnly: true },
    });

    const definitions = await db.select().from(schema.metricDefinitions);
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
    for (const [index, key] of PM5560_CORE_METRIC_KEYS.entries()) {
      const definition = byKey.get(key);
      assert.ok(definition, "Falta definición " + key);
      await db.insert(schema.deviceMetrics).values({
        deviceId: device.id,
        metricDefinitionId: definition.id,
        code: pm5560MetricCode(key),
        name: definition.name,
        displayOrder: index,
      });
    }

    const values: Record<(typeof PM5560_CORE_METRIC_KEYS)[number], number> = {
      "electrical.voltage.l1_n": 230.1,
      "electrical.voltage.l2_n": 229.8,
      "electrical.voltage.l3_n": 230.4,
      "electrical.voltage.l1_l2": 398.5,
      "electrical.voltage.l2_l3": 398.1,
      "electrical.voltage.l3_l1": 399.0,
      "electrical.current.l1": 42.1,
      "electrical.current.l2": 41.3,
      "electrical.current.l3": 43.0,
      "electrical.power.active.total": 27.6,
      "electrical.power.reactive.total": 7.4,
      "electrical.power.apparent.total": 28.6,
      "electrical.power_factor": 0.965,
      "electrical.frequency": 50.01,
      "electrical.energy.import": 12540.4,
      "electrical.energy.export": 0,
      "electrical.demand.active": 29.1,
    };

    const response = await handleGenericIngest({
      db,
      credential: { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: site.id },
      rawPayload: {
        schemaVersion: "2.0",
        batchKey: "GW-PM01:boot-pm:1:PM5560-01",
        sentAt: "2026-10-02T18:00:00.000Z",
        sampledAt: "2026-10-02T18:00:00.000Z",
        timeQuality: "synced",
        quality: "good",
        qualityFlags: [],
        gateway: { code: "GW-PM01", bootId: "boot-pm", sequence: 1 },
        device: { code: "PM5560-01" },
        metrics: values,
      },
      receivedAt: new Date("2026-10-02T18:00:00.000Z"),
    });
    assert.equal(response.status, 202);

    const readings = await db.select().from(schema.metricReadings);
    assert.equal(readings.length, PM5560_CORE_METRIC_KEYS.length);

    const latest = await db.select({
      key: schema.metricDefinitions.key,
      value: schema.latestMetricReadings.valueNumeric,
    }).from(schema.latestMetricReadings)
      .innerJoin(schema.deviceMetrics, eq(schema.deviceMetrics.id, schema.latestMetricReadings.deviceMetricId))
      .innerJoin(schema.metricDefinitions, eq(schema.metricDefinitions.id, schema.deviceMetrics.metricDefinitionId))
      .where(eq(schema.deviceMetrics.deviceId, device.id));
    assert.equal(latest.length, PM5560_CORE_METRIC_KEYS.length);
    assert.equal(Number(latest.find((item) => item.key === "electrical.power.active.total")?.value), 27.6);
    assert.equal(Number(latest.find((item) => item.key === "electrical.demand.active")?.value), 29.1);

    const [storedAsset] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, asset.id), eq(schema.assets.siteId, site.id)));
    assert.equal(storedAsset.state, "normal");

    const highCurrent = { ...values, "electrical.current.l1": 96 };
    const alarmResponse = await handleGenericIngest({
      db,
      credential: { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: site.id },
      rawPayload: {
        schemaVersion: "2.0",
        batchKey: "GW-PM01:boot-pm:2:PM5560-01",
        sentAt: "2026-10-02T18:00:05.000Z",
        sampledAt: "2026-10-02T18:00:05.000Z",
        timeQuality: "synced",
        quality: "good",
        qualityFlags: [],
        gateway: { code: "GW-PM01", bootId: "boot-pm", sequence: 2 },
        device: { code: "PM5560-01" },
        metrics: highCurrent,
      },
      receivedAt: new Date("2026-10-02T18:00:05.000Z"),
    });
    assert.equal(alarmResponse.status, 202);
    const [currentAlarm] = await db.select().from(schema.alarms).where(and(
      eq(schema.alarms.assetId, asset.id),
      eq(schema.alarms.kind, "threshold"),
    )).limit(1);
    assert.ok(currentAlarm);
    assert.equal(currentAlarm.status, "open");
    assert.equal(currentAlarm.severity, "critical");
    assert.match(currentAlarm.title, /Sobrecorriente L1/);

    const recoveryResponse = await handleGenericIngest({
      db,
      credential: { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: site.id },
      rawPayload: {
        schemaVersion: "2.0",
        batchKey: "GW-PM01:boot-pm:3:PM5560-01",
        sentAt: "2026-10-02T18:00:10.000Z",
        sampledAt: "2026-10-02T18:00:10.000Z",
        timeQuality: "synced",
        quality: "good",
        qualityFlags: [],
        gateway: { code: "GW-PM01", bootId: "boot-pm", sequence: 3 },
        device: { code: "PM5560-01" },
        metrics: values,
      },
      receivedAt: new Date("2026-10-02T18:00:10.000Z"),
    });
    assert.equal(recoveryResponse.status, 202);
    const [resolvedAlarm] = await db.select().from(schema.alarms).where(eq(schema.alarms.id, currentAlarm.id));
    assert.equal(resolvedAlarm.status, "resolved");
    assert.ok(resolvedAlarm.resolvedAt);
    const [recoveredAsset] = await db.select().from(schema.assets).where(eq(schema.assets.id, asset.id));
    assert.equal(recoveredAsset.state, "normal");
  } finally {
    await client.close();
  }
});
