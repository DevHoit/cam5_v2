import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { createReportRun, nextCronRun, type ReportSnapshot } from "../db/report-engine";
import { reportCsv, reportPdf } from "../db/report-export";
import { seedCam5Database } from "../db/seed";
import type { Cam5Database } from "../db/index";
import * as schema from "../db/schema";

const snapshot: ReportSnapshot = {
  generatedAt: "2026-08-11T12:00:00.000Z",
  generatedBy: "Administrador",
  template: { id: "template", key: "condition-summary", name: "Condición del activo", description: "Resumen técnico" },
  client: { code: "CLIENTE", name: "Cliente principal" },
  site: { code: "SITE", name: "Subestación Norte", timezone: "America/Santiago" },
  asset: { id: "asset", code: "MCC-01", name: "Alimentador Norte", area: "Sala eléctrica", nominalVoltageKv: 13.8 },
  period: { start: "2026-08-10T12:00:00.000Z", end: "2026-08-11T12:00:00.000Z" },
  summary: { condition: "warning", channelCount: 1, sampleCount: 2, validSampleCount: 2, qualityPercent: 100, alarmCount: 1, warningCount: 1, criticalCount: 0 },
  channels: [{ code: "T01", name: "Temperatura fase L1", zone: "Barras", unit: "°C", sampleCount: 2, validSampleCount: 2, minimum: 42, average: 43, maximum: 44, latest: 44, latestAt: "2026-08-11T11:59:00.000Z" }],
  alarms: [{ code: "ALM-001", title: "Temperatura elevada", severity: "warning", status: "open", openedAt: "2026-08-11T10:00:00.000Z", channelCode: "T01", triggerValue: 44, thresholdValue: 43 }],
};

test("calculates the next report run in the configured timezone", () => {
  const next = nextCronRun("0 8 * * 1", "America/Santiago", new Date("2026-08-11T12:00:00.000Z"));
  assert.equal(next.toISOString(), "2026-08-17T12:00:00.000Z");
});

test("exports report snapshots as CSV and valid PDF bytes", async () => {
  const csv = reportCsv(snapshot);
  assert.match(csv, /HOITLIVE CORE/);
  assert.match(csv, /T01/);
  assert.match(csv, /ALM-001/);
  const pdf = await reportPdf(snapshot);
  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
  assert.ok(pdf.length > 1_000);
});

test("creates an immutable report snapshot from the operational database", async () => {
  const client = new PGlite();
  try {
    for (const filename of ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql", "0005_milky_caretaker.sql", "0006_smiling_frightful_four.sql", "0007_big_frightful_four.sql", "0008_sloppy_mister_sinister.sql", "0009_cuddly_infant_terrible.sql", "0010_robust_wallop.sql", "0011_dear_prima.sql", "0012_hoit_core_foundation.sql", "0013_hoit_generic_telemetry.sql", "0014_generic_device_transport.sql", "0015_operational_condition_states.sql", "0016_cold_chain_report_template.sql", "0017_generic_metric_aggregates.sql", "0018_pm5560_metric_catalog.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
      await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    }
    const database = drizzle(client, { schema }) as unknown as Cam5Database;
    await seedCam5Database(database, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Cam5-Prueba-2026", log: false });
    const [asset] = await database.select().from(schema.assets).limit(1);
    const [template] = await database.select().from(schema.reportTemplates).where(eq(schema.reportTemplates.key, "condition-summary")).limit(1);
    const [user] = await database.select().from(schema.users).limit(1);
    const [channel] = await database.select().from(schema.channels).limit(1);
    await database.insert(schema.readings).values({
      channelId: channel.id,
      recordedAt: new Date("2026-08-10T12:00:00.000Z"),
      value: "48.500000",
      quality: "good",
      sequence: 1,
    });
    const result = await createReportRun(database, { templateId: template.id, assetId: asset.id, requestedBy: user.id, generatedBy: user.displayName, periodStart: new Date("2026-08-10T00:00:00.000Z"), periodEnd: new Date("2026-08-11T00:00:00.000Z"), format: "pdf" });
    assert.equal(result.run.status, "completed");
    assert.deepEqual(result.run.payload, result.snapshot);
    assert.equal(result.snapshot.asset.code, "MCC-01");
    assert.ok(result.snapshot.channels.length > 0);
    assert.equal(result.snapshot.channels.find((item) => item.code === channel.code)?.latestAt, "2026-08-10T12:00:00.000Z");
  } finally {
    await client.close();
  }
});


test("creates a cold-chain report from generic telemetry and persisted operational alarms", async () => {
  const client = new PGlite();
  try {
    for (const filename of ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql", "0005_milky_caretaker.sql", "0006_smiling_frightful_four.sql", "0007_big_frightful_four.sql", "0008_sloppy_mister_sinister.sql", "0009_cuddly_infant_terrible.sql", "0010_robust_wallop.sql", "0011_dear_prima.sql", "0012_hoit_core_foundation.sql", "0013_hoit_generic_telemetry.sql", "0014_generic_device_transport.sql", "0015_operational_condition_states.sql", "0016_cold_chain_report_template.sql", "0017_generic_metric_aggregates.sql", "0018_pm5560_metric_catalog.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
      await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    }
    const database = drizzle(client, { schema }) as unknown as Cam5Database;
    await seedCam5Database(database, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Cam5-Prueba-2026", log: false });
    const [site] = await database.select().from(schema.sites).limit(1);
    const [gateway] = await database.select().from(schema.gateways).limit(1);
    const [user] = await database.select().from(schema.users).limit(1);
    const [template] = await database.select().from(schema.reportTemplates).where(eq(schema.reportTemplates.key, "cold-chain-summary")).limit(1);
    const [temperatureMetric] = await database.select().from(schema.metricDefinitions).where(eq(schema.metricDefinitions.key, "environment.temperature")).limit(1);

    const [asset] = await database.insert(schema.assets).values({
      siteId: site.id,
      code: "CR-REPORT",
      name: "Cámara reporte",
      assetType: "cold_room",
      metadata: { coldChain: { minimumC: 2, maximumC: 8, targetC: 5, staleAfterSeconds: 180, excursionDelaySeconds: 300 } },
    }).returning();
    const [device] = await database.insert(schema.devices).values({
      assetId: asset.id,
      code: "TEMP-REPORT",
      name: "Sensor reporte",
      deviceType: "temperature_sensor",
      driver: "eddystone_tlm",
      protocol: "ble",
    }).returning();
    const [deviceMetric] = await database.insert(schema.deviceMetrics).values({
      deviceId: device.id,
      metricDefinitionId: temperatureMetric.id,
      code: "TEMPERATURE",
      name: "Temperatura",
    }).returning();

    for (const [index, sample] of [
      { at: "2026-10-01T10:00:00.000Z", value: "5.00000000" },
      { at: "2026-10-01T10:01:00.000Z", value: "9.00000000" },
      { at: "2026-10-01T10:07:00.000Z", value: "9.50000000" },
      { at: "2026-10-01T10:08:00.000Z", value: "5.00000000" },
    ].entries()) {
      const [batch] = await database.insert(schema.telemetryBatches).values({
        gatewayId: gateway.id,
        deviceId: device.id,
        batchKey: "report-generic-" + index,
        gatewayBootId: "report-boot",
        gatewaySequence: index + 1,
        sentAt: new Date(sample.at),
        sampledAt: new Date(sample.at),
        receivedAt: new Date(sample.at),
        quality: "good",
        timeQuality: "synced",
        metricCount: 1,
        success: true,
      }).returning();
      await database.insert(schema.metricReadings).values({
        batchId: batch.id,
        deviceMetricId: deviceMetric.id,
        recordedAt: new Date(sample.at),
        receivedAt: new Date(sample.at),
        valueNumeric: sample.value,
        quality: "good",
        timeQuality: "synced",
        sequence: index + 1,
      });
    }

    await database.insert(schema.alarms).values({
      siteId: site.id,
      assetId: asset.id,
      code: "CC-REPORT-HIGH",
      kind: "threshold",
      severity: "critical",
      status: "resolved",
      title: "Temperatura alta · TEMP-REPORT",
      triggerValue: "9.500000",
      thresholdValue: "8.000000",
      openedAt: new Date("2026-10-01T10:01:00.000Z"),
      lastObservedAt: new Date("2026-10-01T10:08:00.000Z"),
      resolvedAt: new Date("2026-10-01T10:08:00.000Z"),
      context: { source: "cold_chain", subtype: "temperature_high", sensorCode: "TEMP-REPORT" },
    });

    const result = await createReportRun(database, {
      templateId: template.id,
      assetId: asset.id,
      requestedBy: user.id,
      generatedBy: user.displayName,
      periodStart: new Date("2026-10-01T00:00:00.000Z"),
      periodEnd: new Date("2026-10-02T00:00:00.000Z"),
      format: "pdf",
    });

    assert.equal(result.snapshot.asset.assetType, "cold_room");
    assert.equal(result.snapshot.summary.sampleCount, 4);
    assert.equal(result.snapshot.summary.validSampleCount, 4);
    assert.equal(result.snapshot.coldChain?.excursionCount, 1);
    assert.equal(result.snapshot.coldChain?.totalOutOfRangeSeconds, 420);
    assert.equal(result.snapshot.coldChain?.sensors[0]?.minimumC, 5);
    assert.equal(result.snapshot.coldChain?.sensors[0]?.maximumC, 9.5);
    assert.equal(result.snapshot.coldChain?.excursions[0]?.type, "high");
  } finally {
    await client.close();
  }
});
