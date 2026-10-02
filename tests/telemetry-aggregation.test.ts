import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import type { Cam5Database } from "../db/index";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { refreshTelemetryAggregates } from "../db/telemetry-aggregation";

test("builds time buckets and applies the configured raw retention", async () => {
  const client = new PGlite();
  try {
    for (const filename of ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql", "0005_milky_caretaker.sql", "0006_smiling_frightful_four.sql", "0007_big_frightful_four.sql", "0008_sloppy_mister_sinister.sql", "0009_cuddly_infant_terrible.sql", "0010_robust_wallop.sql", "0011_dear_prima.sql", "0012_hoit_core_foundation.sql", "0013_hoit_generic_telemetry.sql", "0014_generic_device_transport.sql", "0015_operational_condition_states.sql", "0016_cold_chain_report_template.sql", "0017_generic_metric_aggregates.sql", "0018_pm5560_metric_catalog.sql", "0019_nullable_device_gateway_site_guard.sql", "0020_electrical_report_template.sql", "0021_dse8660_metric_catalog.sql", "0022_ats_report_template.sql", "0023_access_scope_roles.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
      await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    }
    const db = drizzle(client, { schema });
    const aggregationDb = db as unknown as Cam5Database;
    await seedCam5Database(aggregationDb, { log: false });
    const [site] = await db.select().from(schema.sites).limit(1);
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.code, "T01")).limit(1);
    const [gateway] = await db.select().from(schema.gateways).limit(1);
    const [device] = await db.select().from(schema.devices).limit(1);
    const [register] = await db.select().from(schema.registerDefinitions).limit(1);
    const evaluatedAt = new Date("2026-09-05T12:00:00.000Z");
    await db.insert(schema.readings).values([
      { channelId: channel.id, recordedAt: new Date("2026-09-05T11:58:10.000Z"), value: "50", rawValue: 500, quality: "good", sequence: 1 },
      { channelId: channel.id, recordedAt: new Date("2026-09-05T11:58:40.000Z"), value: "52", rawValue: 520, quality: "good", sequence: 2 },
      { channelId: channel.id, recordedAt: new Date("2026-09-05T11:58:50.000Z"), value: null, rawValue: 0xffff, quality: "bad", qualityFlags: ["over_range"], sequence: 3 },
      { channelId: channel.id, recordedAt: new Date("2026-08-04T12:00:00.000Z"), value: "44", rawValue: 440, quality: "good", sequence: 4 },
    ]);
    const [oldBatch] = await db.insert(schema.ingestionBatches).values({
      gatewayId: gateway.id,
      deviceId: device.id,
      batchKey: "retention-test-old-batch",
      startedAt: new Date("2026-08-04T12:00:00.000Z"),
      completedAt: new Date("2026-08-04T12:00:01.000Z"),
      receivedAt: new Date("2026-08-04T12:00:01.000Z"),
      expectedRegisters: 1,
      receivedRegisters: 1,
      goodRegisters: 1,
      success: true,
    }).returning();
    await db.insert(schema.deviceRegisterSamples).values({
      batchId: oldBatch.id,
      deviceId: device.id,
      registerDefinitionId: register.id,
      recordedAt: new Date("2026-08-04T12:00:00.000Z"),
      rawValue: 500,
      value: "50",
      quality: "good",
    });

    const [genericDefinition] = await db.insert(schema.metricDefinitions).values({
      key: "test.temperature.generic",
      name: "Temperatura genérica de prueba",
      category: "test",
      unit: "°C",
      dataType: "float",
      aggregation: "avg",
    }).returning();
    const [genericMetric] = await db.insert(schema.deviceMetrics).values({
      deviceId: device.id,
      metricDefinitionId: genericDefinition.id,
      code: "TEST-TEMP",
      name: "Temperatura genérica de prueba",
    }).returning();
    for (const [index, sample] of [
      { at: "2026-09-05T11:58:10.000Z", value: "4.00000000", quality: "good" as const },
      { at: "2026-09-05T11:58:40.000Z", value: "6.00000000", quality: "good" as const },
      { at: "2026-09-05T11:58:50.000Z", value: null, quality: "bad" as const },
    ].entries()) {
      const [batch] = await db.insert(schema.telemetryBatches).values({
        gatewayId: gateway.id,
        deviceId: device.id,
        batchKey: "generic-aggregate-" + index,
        gatewayBootId: "boot-generic",
        gatewaySequence: index + 1,
        sentAt: new Date(sample.at),
        sampledAt: new Date(sample.at),
        receivedAt: new Date(sample.at),
        quality: sample.quality,
        timeQuality: "synced",
        metricCount: 1,
        success: true,
      }).returning();
      await db.insert(schema.metricReadings).values({
        batchId: batch.id,
        deviceMetricId: genericMetric.id,
        recordedAt: new Date(sample.at),
        receivedAt: new Date(sample.at),
        valueNumeric: sample.value,
        quality: sample.quality,
        timeQuality: "synced",
        sequence: index + 1,
      });
    }
    const [oldGenericBatch] = await db.insert(schema.telemetryBatches).values({
      gatewayId: gateway.id,
      deviceId: device.id,
      batchKey: "generic-aggregate-old",
      gatewayBootId: "boot-generic",
      gatewaySequence: 99,
      sentAt: new Date("2026-08-04T12:00:00.000Z"),
      sampledAt: new Date("2026-08-04T12:00:00.000Z"),
      receivedAt: new Date("2026-08-04T12:00:00.000Z"),
      quality: "good",
      timeQuality: "synced",
      metricCount: 1,
      success: true,
    }).returning();
    await db.insert(schema.metricReadings).values({
      batchId: oldGenericBatch.id,
      deviceMetricId: genericMetric.id,
      recordedAt: new Date("2026-08-04T12:00:00.000Z"),
      receivedAt: new Date("2026-08-04T12:00:00.000Z"),
      valueNumeric: "3.00000000",
      quality: "good",
      timeQuality: "synced",
      sequence: 99,
    });


    const result = await refreshTelemetryAggregates(aggregationDb, site.id, evaluatedAt);
    assert.deepEqual(result, { bucketsUpdated: 8, retentionApplied: true });
    const [minute] = await db.select().from(schema.readingAggregates).where(and(eq(schema.readingAggregates.channelId, channel.id), eq(schema.readingAggregates.bucketSeconds, 60))).limit(1);
    assert.equal(minute.sampleCount, 3);
    assert.equal(minute.invalidSampleCount, 1);
    assert.equal(Number(minute.averageValue), 51);
    const [genericMinute] = await db.select().from(schema.metricReadingAggregates).where(and(
      eq(schema.metricReadingAggregates.deviceMetricId, genericMetric.id),
      eq(schema.metricReadingAggregates.bucketSeconds, 60),
    )).limit(1);
    assert.equal(genericMinute.sampleCount, 3);
    assert.equal(genericMinute.invalidSampleCount, 1);
    assert.equal(Number(genericMinute.minimumValue), 4);
    assert.equal(Number(genericMinute.maximumValue), 6);
    assert.equal(Number(genericMinute.averageValue), 5);
    const [genericRawCount] = await db.select({ value: count() }).from(schema.metricReadings).where(eq(schema.metricReadings.deviceMetricId, genericMetric.id));
    assert.equal(genericRawCount.value, 3);
    const [oldGenericBatchCount] = await db.select({ value: count() }).from(schema.telemetryBatches).where(eq(schema.telemetryBatches.id, oldGenericBatch.id));
    assert.equal(oldGenericBatchCount.value, 0);
    const [rawCount] = await db.select({ value: count() }).from(schema.readings).where(eq(schema.readings.channelId, channel.id));
    assert.equal(rawCount.value, 3);
    const [batchCount] = await db.select({ value: count() }).from(schema.ingestionBatches).where(eq(schema.ingestionBatches.id, oldBatch.id));
    const [sampleCount] = await db.select({ value: count() }).from(schema.deviceRegisterSamples).where(eq(schema.deviceRegisterSamples.batchId, oldBatch.id));
    assert.equal(batchCount.value, 0);
    assert.equal(sampleCount.value, 0);
  } finally {
    await client.close();
  }
});
