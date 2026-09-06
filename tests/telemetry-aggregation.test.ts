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
    for (const filename of ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql", "0005_milky_caretaker.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
      await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    }
    const db = drizzle(client, { schema });
    const aggregationDb = db as unknown as Cam5Database;
    await seedCam5Database(aggregationDb, { log: false });
    const [site] = await db.select().from(schema.sites).limit(1);
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.code, "T01")).limit(1);
    const evaluatedAt = new Date("2026-09-05T12:00:00.000Z");
    await db.insert(schema.readings).values([
      { channelId: channel.id, recordedAt: new Date("2026-09-05T11:58:10.000Z"), value: "50", rawValue: 500, quality: "good", sequence: 1 },
      { channelId: channel.id, recordedAt: new Date("2026-09-05T11:58:40.000Z"), value: "52", rawValue: 520, quality: "good", sequence: 2 },
      { channelId: channel.id, recordedAt: new Date("2026-09-05T11:58:50.000Z"), value: null, rawValue: 0xffff, quality: "bad", qualityFlags: ["over_range"], sequence: 3 },
      { channelId: channel.id, recordedAt: new Date("2026-08-04T12:00:00.000Z"), value: "44", rawValue: 440, quality: "good", sequence: 4 },
    ]);

    const result = await refreshTelemetryAggregates(aggregationDb, site.id, evaluatedAt);
    assert.deepEqual(result, { bucketsUpdated: 4, retentionApplied: true });
    const [minute] = await db.select().from(schema.readingAggregates).where(and(eq(schema.readingAggregates.channelId, channel.id), eq(schema.readingAggregates.bucketSeconds, 60))).limit(1);
    assert.equal(minute.sampleCount, 3);
    assert.equal(minute.invalidSampleCount, 1);
    assert.equal(Number(minute.averageValue), 51);
    const [rawCount] = await db.select({ value: count() }).from(schema.readings).where(eq(schema.readings.channelId, channel.id));
    assert.equal(rawCount.value, 3);
  } finally {
    await client.close();
  }
});
