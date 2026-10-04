import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { handleGenericIngest } from "../app/api/v1/gateway/_lib/ingest-v2";
import { DSE8660_CORE_METRIC_KEYS, dse8660MetricCode } from "../db/dse8660";
import type { Cam5Database } from "../db/index";
import { PM5560_CORE_METRIC_KEYS, pm5560MetricCode } from "../db/pm5560";
import { createReportRun } from "../db/report-engine";
import * as schema from "../db/schema";

const migrations = [
  "0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql",
  "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql", "0005_milky_caretaker.sql",
  "0006_smiling_frightful_four.sql", "0007_big_frightful_four.sql", "0008_sloppy_mister_sinister.sql",
  "0009_cuddly_infant_terrible.sql", "0010_robust_wallop.sql", "0011_dear_prima.sql",
  "0012_hoit_core_foundation.sql", "0013_hoit_generic_telemetry.sql", "0014_generic_device_transport.sql",
  "0015_operational_condition_states.sql", "0016_cold_chain_report_template.sql", "0017_generic_metric_aggregates.sql",
  "0018_pm5560_metric_catalog.sql", "0019_nullable_device_gateway_site_guard.sql", "0020_electrical_report_template.sql",
  "0021_dse8660_metric_catalog.sql", "0022_ats_report_template.sql", "0023_access_scope_roles.sql",
  "0024_notification_suppressed_status.sql", "0025_rs485_bus_addressing.sql", "0026_hoit_v1_control_plane.sql", "0029_notification_recipients.sql", "0030_fix_phone_e164_check.sql",
];

async function database() {
  const client = new PGlite();
  for (const filename of migrations) {
    const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return { client, db: drizzle(client, { schema }) as unknown as Cam5Database };
}

async function addMetric(db: Cam5Database, deviceId: string, key: string, code: string, order: number) {
  const [definition] = await db.select().from(schema.metricDefinitions).where(eq(schema.metricDefinitions.key, key)).limit(1);
  assert.ok(definition, `Falta definición ${key}`);
  await db.insert(schema.deviceMetrics).values({
    deviceId,
    metricDefinitionId: definition.id,
    code,
    name: definition.name,
    displayOrder: order,
  });
}

function pmValues(overrides: Partial<Record<(typeof PM5560_CORE_METRIC_KEYS)[number], number>> = {}) {
  return {
    "electrical.voltage.l1_n": 230,
    "electrical.voltage.l2_n": 230,
    "electrical.voltage.l3_n": 230,
    "electrical.voltage.l1_l2": 398,
    "electrical.voltage.l2_l3": 398,
    "electrical.voltage.l3_l1": 398,
    "electrical.current.l1": 35,
    "electrical.current.l2": 34,
    "electrical.current.l3": 36,
    "electrical.power.active.total": 22,
    "electrical.power.reactive.total": 5,
    "electrical.power.apparent.total": 23,
    "electrical.power_factor": 0.96,
    "electrical.frequency": 50,
    "electrical.energy.import": 1000,
    "electrical.energy.export": 0,
    "electrical.demand.active": 24,
    ...overrides,
  };
}

function atsValues(source1Available = true) {
  return {
    "ats.source1.voltage.l1_n": source1Available ? 230 : 0,
    "ats.source1.voltage.l2_n": source1Available ? 230 : 0,
    "ats.source1.voltage.l3_n": source1Available ? 230 : 0,
    "ats.source1.frequency": source1Available ? 50 : 0,
    "ats.source2.voltage.l1_n": 230,
    "ats.source2.voltage.l2_n": 230,
    "ats.source2.voltage.l3_n": 230,
    "ats.source2.frequency": 50,
    "ats.load.current.l1": 28,
    "ats.load.current.l2": 27,
    "ats.load.current.l3": 29,
    "ats.load.power.active.total": 18,
    "ats.load.power.reactive.total": 4,
    "ats.load.power.apparent.total": 19,
    "ats.load.power_factor": 0.95,
    "ats.source1.available": source1Available,
    "ats.source2.available": true,
    "ats.breaker.source1_closed": source1Available,
    "ats.breaker.source2_closed": !source1Available,
    "ats.transfer.position": source1Available ? "source1" : "source2",
    "ats.common_alarm": false,
    "ats.active_alarm_count": 0,
    "dse.mode": "auto",
  };
}

async function ingest(db: Cam5Database, input: {
  gateway: { id: string; code: string };
  siteId: string;
  deviceCode: string;
  sequence: number;
  at: string;
  metrics: Record<string, number | boolean | string>;
}) {
  const response = await handleGenericIngest({
    db,
    credential: { gatewayId: input.gateway.id, gatewayCode: input.gateway.code, siteId: input.siteId },
    rawPayload: {
      schemaVersion: "2.0",
      batchKey: `${input.gateway.code}:boot-v1:${input.sequence}:${input.deviceCode}`,
      sentAt: input.at,
      sampledAt: input.at,
      timeQuality: "synced",
      quality: "good",
      qualityFlags: [],
      gateway: { code: input.gateway.code, bootId: "boot-v1", sequence: input.sequence },
      device: { code: input.deviceCode },
      metrics: input.metrics,
    },
    receivedAt: new Date(input.at),
  });
  assert.equal(response.status, 202);
}

test("V1 integrated site handles simultaneous PM5560, DSE8660 and cold-chain faults and recovery", async () => {
  const { client, db } = await database();
  try {
    await db.insert(schema.metricDefinitions).values([
      { key: "environment.temperature", name: "Temperatura", category: "environment", unit: "°C", dataType: "float", aggregation: "avg" },
      { key: "sensor.battery_voltage", name: "Batería", category: "sensor.health", unit: "V", dataType: "float", aggregation: "last" },
    ]).onConflictDoNothing();

    const [customer] = await db.insert(schema.clients).values({ code: "V1", name: "Cliente V1" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: customer.id, code: "V1-SITE", name: "Sitio V1" }).returning();
    const [gateway] = await db.insert(schema.gateways).values({ siteId: site.id, code: "GW-V1", name: "Gateway V1" }).returning();

    const [electrical] = await db.insert(schema.assets).values({
      siteId: site.id, code: "ELEC-01", name: "Tablero V1", assetType: "electrical_point", state: "offline",
      metadata: { electrical: { alarms: { staleAfterSeconds: 30, thresholdDelaySeconds: 0, currentMaxA: 80, voltageMinV: 210, voltageMaxV: 250, frequencyMinHz: 49, frequencyMaxHz: 51, powerFactorMin: 0.9 } } },
    }).returning();
    const [ats] = await db.insert(schema.assets).values({
      siteId: site.id, code: "ATS-01", name: "ATS V1", assetType: "ats", state: "offline",
      metadata: { ats: { source1Label: "Red", source2Label: "Respaldo", alarms: { staleAfterSeconds: 30, source1Required: true, source2Required: false, sourceUnavailableDelaySeconds: 0, commonAlarmDelaySeconds: 0, unexpectedPositionDelaySeconds: 0 } } },
    }).returning();
    const [cold] = await db.insert(schema.assets).values({
      siteId: site.id, code: "CR-01", name: "Cámara V1", assetType: "cold_room", state: "offline",
      metadata: { coldChain: { minimumC: 2, maximumC: 8, targetC: 5, staleAfterSeconds: 30, disagreementThresholdC: 3, excursionDelaySeconds: 1, temperatureHysteresisC: 0.5, batteryLowVoltage: 3.1 } },
    }).returning();

    const [endpoint] = await db.insert(schema.notificationEndpoints).values({
      siteId: site.id, name: "Centro de operaciones", kind: "webhook",
      configuration: { url: "https://ops.example.test/alarm" },
    }).returning();
    await db.insert(schema.notificationPolicies).values({
      siteId: site.id, endpointId: endpoint.id, name: "V1 todas las alarmas",
      minimumSeverity: "warning", filters: { notifyOnRecovery: true },
    });

    const pmDevices = [];
    for (let i = 1; i <= 2; i++) {
      const code = `PM5560-0${i}`;
      const [device] = await db.insert(schema.devices).values({
        assetId: electrical.id, code, name: code, deviceType: "power_meter", driver: "schneider_pm5560",
        protocol: "modbus_rtu", unitId: i, state: "commissioning",
      }).returning();
      await db.insert(schema.gatewayDeviceBindings).values({
        gatewayId: gateway.id, deviceId: device.id, interfaceType: "rs485", interfaceKey: "rs485-1",
        address: i, baudRate: 19200, parity: "even", dataBits: 8, stopBits: 1,
      });
      for (const [order, key] of PM5560_CORE_METRIC_KEYS.entries()) await addMetric(db, device.id, key, pm5560MetricCode(key), order);
      pmDevices.push(device);
    }

    const atsDevices = [];
    for (let i = 1; i <= 2; i++) {
      const code = `DSE8660-0${i}`;
      const [device] = await db.insert(schema.devices).values({
        assetId: ats.id, code, name: code, deviceType: "ats_controller", driver: "dse8660_mkii",
        protocol: "modbus_rtu", unitId: 10 + i, state: "commissioning",
      }).returning();
      await db.insert(schema.gatewayDeviceBindings).values({
        gatewayId: gateway.id, deviceId: device.id, interfaceType: "rs485", interfaceKey: "rs485-2",
        address: 10 + i, baudRate: 19200, parity: "even", dataBits: 8, stopBits: 1,
      });
      for (const [order, key] of DSE8660_CORE_METRIC_KEYS.entries()) await addMetric(db, device.id, key, dse8660MetricCode(key), order);
      atsDevices.push(device);
    }

    const coldDevices = [];
    for (let i = 1; i <= 2; i++) {
      const code = `TEMP-0${i}`;
      const [device] = await db.insert(schema.devices).values({
        assetId: cold.id, code, name: code, deviceType: "temperature_sensor", driver: "eddystone_tlm",
        protocol: "ble", state: "commissioning",
      }).returning();
      await db.insert(schema.gatewayDeviceBindings).values({ gatewayId: gateway.id, deviceId: device.id, interfaceType: "ble" });
      await addMetric(db, device.id, "environment.temperature", "TEMP", 0);
      await addMetric(db, device.id, "sensor.battery_voltage", "BATTERY", 1);
      coldDevices.push(device);
    }

    let sequence = 1;
    const normalAt = "2026-10-03T00:00:00.000Z";
    for (const device of pmDevices) await ingest(db, { gateway, siteId: site.id, deviceCode: device.code, driver: "schneider_pm5560", sequence: sequence++, at: normalAt, metrics: pmValues() });
    for (const device of atsDevices) await ingest(db, { gateway, siteId: site.id, deviceCode: device.code, driver: "dse8660_mkii", sequence: sequence++, at: normalAt, metrics: atsValues(true) });
    for (const device of coldDevices) await ingest(db, { gateway, siteId: site.id, deviceCode: device.code, driver: "eddystone_tlm", sequence: sequence++, at: normalAt, metrics: { "environment.temperature": 5, "sensor.battery_voltage": 3.5 } });

    const faultAt = "2026-10-03T00:01:00.000Z";
    await ingest(db, { gateway, siteId: site.id, deviceCode: pmDevices[0].code, driver: "schneider_pm5560", sequence: sequence++, at: faultAt, metrics: pmValues({ "electrical.current.l1": 110 }) });
    await ingest(db, { gateway, siteId: site.id, deviceCode: atsDevices[0].code, driver: "dse8660_mkii", sequence: sequence++, at: faultAt, metrics: atsValues(false) });
    await ingest(db, { gateway, siteId: site.id, deviceCode: coldDevices[0].code, driver: "eddystone_tlm", sequence: sequence++, at: faultAt, metrics: { "environment.temperature": 10, "sensor.battery_voltage": 3.5 } });
    await ingest(db, { gateway, siteId: site.id, deviceCode: coldDevices[0].code, driver: "eddystone_tlm", sequence: sequence++, at: "2026-10-03T00:01:02.000Z", metrics: { "environment.temperature": 10, "sensor.battery_voltage": 3.5 } });

    const open = await db.select().from(schema.alarms).where(and(
      inArray(schema.alarms.assetId, [electrical.id, ats.id, cold.id]),
      eq(schema.alarms.status, "open"),
    ));
    assert.ok(open.some((alarm) => alarm.assetId === electrical.id && /Sobrecorriente/.test(alarm.title)));
    assert.ok(open.some((alarm) => alarm.assetId === ats.id && /no disponible/.test(alarm.title)));
    assert.ok(open.some((alarm) => alarm.assetId === cold.id && /Temperatura alta/.test(alarm.title)));

    const deliveries = await db.select().from(schema.notificationDeliveries);
    assert.ok(deliveries.length >= 3);
    assert.ok(deliveries.every((delivery) => delivery.status === "queued"));

    const readings = await db.select({
      deviceId: schema.deviceMetrics.deviceId,
    }).from(schema.metricReadings)
      .innerJoin(schema.deviceMetrics, eq(schema.deviceMetrics.id, schema.metricReadings.deviceMetricId));
    assert.ok(readings.length > 100);
    for (const device of [...pmDevices, ...atsDevices, ...coldDevices]) {
      assert.ok(readings.some((reading) => reading.deviceId === device.id), `Sin histórico para ${device.code}`);
    }

    const recoveryAt = "2026-10-03T00:02:00.000Z";
    for (const device of pmDevices) {
      await ingest(db, { gateway, siteId: site.id, deviceCode: device.code, driver: "schneider_pm5560", sequence: sequence++, at: recoveryAt, metrics: pmValues() });
    }
    for (const device of atsDevices) {
      await ingest(db, { gateway, siteId: site.id, deviceCode: device.code, driver: "dse8660_mkii", sequence: sequence++, at: recoveryAt, metrics: atsValues(true) });
    }
    for (const device of coldDevices) {
      await ingest(db, { gateway, siteId: site.id, deviceCode: device.code, driver: "eddystone_tlm", sequence: sequence++, at: recoveryAt, metrics: { "environment.temperature": 5, "sensor.battery_voltage": 3.5 } });
    }

    const unresolved = await db.select().from(schema.alarms).where(and(
      inArray(schema.alarms.assetId, [electrical.id, ats.id, cold.id]),
      inArray(schema.alarms.status, ["open", "acknowledged"]),
    ));
    assert.equal(unresolved.length, 0);

    const assets = await db.select().from(schema.assets).where(inArray(schema.assets.id, [electrical.id, ats.id, cold.id]));
    assert.ok(assets.every((asset) => asset.state === "normal"));

    const templates = await db.select().from(schema.reportTemplates).where(inArray(schema.reportTemplates.key, ["electrical-summary", "ats-summary", "cold-chain-summary"]));
    const template = (key: string) => {
      const row = templates.find((item) => item.key === key);
      assert.ok(row, `Falta plantilla ${key}`);
      return row;
    };
    const periodStart = new Date("2026-10-02T23:59:00.000Z");
    const periodEnd = new Date("2026-10-03T00:03:00.000Z");

    const electricalReport = await createReportRun(db, { templateId: template("electrical-summary").id, assetId: electrical.id, periodStart, periodEnd, generatedBy: "V1 E2E" });
    assert.equal(electricalReport.snapshot.electrical?.meterCount, 2);
    assert.ok((electricalReport.snapshot.summary.alarmCount ?? 0) >= 1);

    const atsReport = await createReportRun(db, { templateId: template("ats-summary").id, assetId: ats.id, periodStart, periodEnd, generatedBy: "V1 E2E" });
    assert.equal(atsReport.snapshot.ats?.controllerCount, 2);
    assert.ok((atsReport.snapshot.summary.alarmCount ?? 0) >= 1);

    const coldReport = await createReportRun(db, { templateId: template("cold-chain-summary").id, assetId: cold.id, periodStart, periodEnd, generatedBy: "V1 E2E" });
    assert.equal(coldReport.snapshot.coldChain?.sensors.length, 2);
    assert.ok((coldReport.snapshot.coldChain?.excursionCount ?? 0) >= 1);
  } finally {
    await client.close();
  }
});
