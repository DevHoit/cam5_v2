import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { ApiError } from "../app/api/v1/_lib/auth";
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
  "0016_cold_chain_report_template.sql", "0017_generic_metric_aggregates.sql", "0018_pm5560_metric_catalog.sql", "0019_nullable_device_gateway_site_guard.sql", "0020_electrical_report_template.sql", "0021_dse8660_metric_catalog.sql",
];

async function database() {
  const client = new PGlite();
  for (const filename of migrations) {
    const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return { client, db: drizzle(client, { schema }) as unknown as Cam5Database };
}

async function fixture(db: Cam5Database) {
  const [client] = await db.insert(schema.clients).values({ code: "CLIENT-E2E", name: "Cliente E2E" }).returning();
  const [site] = await db.insert(schema.sites).values({ clientId: client.id, code: "SITE-E2E", name: "Sitio E2E" }).returning();
  const [asset] = await db.insert(schema.assets).values({
    siteId: site.id,
    code: "CR-01",
    name: "Cámara E2E",
    area: "Farmacia",
    assetType: "cold_room",
    state: "offline",
    metadata: {
      coldChain: {
        minimumC: 2,
        maximumC: 8,
        targetC: 5,
        staleAfterSeconds: 180,
        disagreementThresholdC: 2,
        excursionDelaySeconds: 300,
        temperatureHysteresisC: 0.5,
        batteryLowVoltage: 3.1,
      },
    },
  }).returning();
  const [gateway] = await db.insert(schema.gateways).values({
    siteId: site.id,
    code: "GW-TEMP-01",
    name: "Gateway BLE E2E",
  }).returning();
  const [device] = await db.insert(schema.devices).values({
    assetId: asset.id,
    gatewayId: null,
    modelId: null,
    readingProfileId: null,
    code: "TEMP-01",
    name: "Sensor TEMP-01",
    deviceType: "temperature_sensor",
    driver: "eddystone_tlm",
    protocol: "ble",
    host: null,
    port: null,
    unitId: null,
    state: "commissioning",
    metadata: { namespaceId: "00112233445566778899", instanceId: "AABBCCDDEEFF" },
  }).returning();
  await db.insert(schema.gatewayDeviceBindings).values({
    gatewayId: gateway.id,
    deviceId: device.id,
    interfaceType: "ble",
    config: { format: "eddystone_tlm" },
  });

  const definitions = [
    { key: "environment.temperature", name: "Temperatura", category: "environment", unit: "°C", dataType: "float", aggregation: "avg" },
    { key: "sensor.battery_voltage", name: "Voltaje de batería", category: "sensor.health", unit: "V", dataType: "float", aggregation: "last" },
    { key: "sensor.rssi", name: "RSSI", category: "sensor.health", unit: "dBm", dataType: "integer", aggregation: "avg" },
    { key: "sensor.adv_count", name: "Contador de advertising", category: "sensor.health", unit: "", dataType: "integer", aggregation: "counter" },
  ] as const;

  for (const [index, definition] of definitions.entries()) {
    const [metric] = await db.insert(schema.metricDefinitions).values(definition).returning();
    await db.insert(schema.deviceMetrics).values({
      deviceId: device.id,
      metricDefinitionId: metric.id,
      code: definition.key,
      name: definition.name,
      displayOrder: index,
    });
  }

  return { client, site, asset, gateway, device };
}

function payload(input: { at: string; sequence: number; temperature: number; deviceCode?: string }) {
  return {
    schemaVersion: "2.0",
    batchKey: `GW-TEMP-01:boot-e2e:${input.sequence}:${input.deviceCode ?? "TEMP-01"}`,
    sentAt: input.at,
    sampledAt: input.at,
    timeQuality: "synced",
    quality: "good",
    gateway: { code: "GW-TEMP-01", bootId: "boot-e2e", sequence: input.sequence },
    device: { code: input.deviceCode ?? "TEMP-01", driver: "eddystone_tlm" },
    metrics: {
      "environment.temperature": input.temperature,
      "sensor.battery_voltage": 3.55,
      "sensor.rssi": -64,
      "sensor.adv_count": 10000 + input.sequence,
    },
  };
}

test("cold-chain telemetry opens a persisted high alarm and resolves it after recovery", async () => {
  const { client, db } = await database();
  try {
    const { site, asset, gateway } = await fixture(db);
    const credential = { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: site.id };

    const samples = [
      { at: "2026-10-02T10:00:00.000Z", sequence: 1, temperature: 5 },
      { at: "2026-10-02T10:01:00.000Z", sequence: 2, temperature: 9 },
      { at: "2026-10-02T10:07:00.000Z", sequence: 3, temperature: 9.5 },
      { at: "2026-10-02T10:08:00.000Z", sequence: 4, temperature: 5 },
    ];

    for (const sample of samples) {
      const response = await handleGenericIngest({
        db,
        credential,
        rawPayload: payload(sample),
        receivedAt: new Date(sample.at),
      });
      assert.equal(response.status, 202);
    }

    const readings = await db.select().from(schema.metricReadings);
    assert.equal(readings.length, 16);

    const highAlarms = await db.select().from(schema.alarms).where(and(
      eq(schema.alarms.assetId, asset.id),
      eq(schema.alarms.kind, "threshold"),
    ));
    assert.equal(highAlarms.length, 1);
    assert.equal(highAlarms[0].status, "resolved");
    assert.match(highAlarms[0].title, /Temperatura alta/);
    assert.equal(Number(highAlarms[0].thresholdValue), 8);
    assert.ok(highAlarms[0].resolvedAt);

    const [storedAsset] = await db.select().from(schema.assets).where(eq(schema.assets.id, asset.id));
    assert.equal(storedAsset.state, "normal");

    const states = await db.select().from(schema.operationalConditionStates).where(eq(schema.operationalConditionStates.assetId, asset.id));
    const highState = states.find((state) => state.conditionKey.endsWith(":temperature_high"));
    assert.equal(highState?.observed, false);
  } finally {
    await client.close();
  }
});

test("generic ingest cannot cross the credential site boundary even with a gateway binding", async () => {
  const { client, db } = await database();
  try {
    const { client: owner, site, gateway } = await fixture(db);
    const [otherSite] = await db.insert(schema.sites).values({ clientId: owner.id, code: "SITE-OTHER", name: "Otro sitio" }).returning();
    const [otherAsset] = await db.insert(schema.assets).values({
      siteId: otherSite.id,
      code: "CR-X",
      name: "Cámara externa",
      assetType: "cold_room",
    }).returning();
    const [otherDevice] = await db.insert(schema.devices).values({
      assetId: otherAsset.id,
      code: "TEMP-X",
      name: "Sensor externo",
      deviceType: "temperature_sensor",
      driver: "eddystone_tlm",
      protocol: "ble",
    }).returning();
    await db.insert(schema.gatewayDeviceBindings).values({
      gatewayId: gateway.id,
      deviceId: otherDevice.id,
      interfaceType: "ble",
    });

    await assert.rejects(
      () => handleGenericIngest({
        db,
        credential: { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: site.id },
        rawPayload: payload({ at: "2026-10-02T11:00:00.000Z", sequence: 10, temperature: 5, deviceCode: "TEMP-X" }),
        receivedAt: new Date("2026-10-02T11:00:00.000Z"),
      }),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
  } finally {
    await client.close();
  }
});
