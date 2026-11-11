import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { and, count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import type { Cam5Database } from "../db/index";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { DIAGNOSTIC_RETENTION_DAYS, refreshTelemetryAggregates } from "../db/telemetry-aggregation";

test("builds time buckets and applies the configured raw retention", async () => {
  const client = new PGlite();
  try {
    for (const filename of ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql", "0005_milky_caretaker.sql", "0006_smiling_frightful_four.sql", "0007_big_frightful_four.sql", "0008_sloppy_mister_sinister.sql", "0009_cuddly_infant_terrible.sql", "0010_robust_wallop.sql", "0011_dear_prima.sql", "0012_login_lockout.sql", "0013_client_logo.sql"]) {
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

    const result = await refreshTelemetryAggregates(aggregationDb, site.id, evaluatedAt);
    assert.deepEqual(result, { bucketsUpdated: 4, retentionApplied: true });
    const [minute] = await db.select().from(schema.readingAggregates).where(and(eq(schema.readingAggregates.channelId, channel.id), eq(schema.readingAggregates.bucketSeconds, 60))).limit(1);
    assert.equal(minute.sampleCount, 3);
    assert.equal(minute.invalidSampleCount, 1);
    assert.equal(Number(minute.averageValue), 51);
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

test("keeps diagnostic register samples for at most two days while raw readings follow the profile", async () => {
  const client = new PGlite();
  try {
    for (const filename of ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql", "0005_milky_caretaker.sql", "0006_smiling_frightful_four.sql", "0007_big_frightful_four.sql", "0008_sloppy_mister_sinister.sql", "0009_cuddly_infant_terrible.sql", "0010_robust_wallop.sql", "0011_dear_prima.sql", "0012_login_lockout.sql", "0013_client_logo.sql"]) {
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
    const [profile] = await db.select({ rawRetentionDays: schema.readingProfiles.rawRetentionDays }).from(schema.readingProfiles).where(eq(schema.readingProfiles.id, device.readingProfileId!)).limit(1);
    assert.ok(profile.rawRetentionDays > DIAGNOSTIC_RETENTION_DAYS, "el perfil de prueba debe retener lecturas más días que los diagnósticos");

    const evaluatedAt = new Date("2026-09-10T12:00:00.000Z");
    const daysAgo = (days: number) => new Date(evaluatedAt.getTime() - days * 86_400_000);
    const batches = await db.insert(schema.ingestionBatches).values([3, 1].map((days) => ({
      gatewayId: gateway.id,
      deviceId: device.id,
      batchKey: `diagnostic-retention-${days}d`,
      startedAt: daysAgo(days),
      completedAt: daysAgo(days),
      receivedAt: daysAgo(days),
      expectedRegisters: 1,
      receivedRegisters: 1,
      goodRegisters: 1,
      success: true,
    }))).returning();
    await db.insert(schema.deviceRegisterSamples).values(batches.map((batch, index) => ({
      batchId: batch.id, deviceId: device.id, registerDefinitionId: register.id, recordedAt: batch.startedAt, rawValue: index, value: String(index), quality: "good" as const,
    })));
    await db.insert(schema.readings).values({ channelId: channel.id, recordedAt: daysAgo(3), value: "40", rawValue: 400, quality: "good", sequence: 1 });

    await refreshTelemetryAggregates(aggregationDb, site.id, evaluatedAt);

    const samples = await db.select({ recordedAt: schema.deviceRegisterSamples.recordedAt }).from(schema.deviceRegisterSamples).where(inArray(schema.deviceRegisterSamples.batchId, batches.map((batch) => batch.id)));
    assert.deepEqual(samples.map((sample) => sample.recordedAt.toISOString()), [daysAgo(1).toISOString()]);
    // La lectura de hace 3 días sigue dentro de la retención cruda del perfil (histórico y reportes la usan).
    const [readingCount] = await db.select({ value: count() }).from(schema.readings).where(eq(schema.readings.channelId, channel.id));
    assert.equal(readingCount.value, 1);
  } finally {
    await client.close();
  }
});
