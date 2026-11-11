import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { historyCsvRows, listHistoryColumns, listHistoryRows, resolveHistoryResolution, HistoryRangeError } from "../db/history";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

test("picks per-batch rows for recent ranges and stored averages for longer ones", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
  assert.equal(resolveHistoryResolution(hoursAgo(24), now, "auto", 7, now).key, "raw");
  assert.equal(resolveHistoryResolution(hoursAgo(24 * 10), hoursAgo(24 * 8), "auto", 7, now).key, "300");
  assert.equal(resolveHistoryResolution(hoursAgo(24 * 30), now, "auto", 7, now).key, "3600");
  assert.equal(resolveHistoryResolution(hoursAgo(24 * 365), now, "auto", 7, now).key, "86400");
  assert.throws(() => resolveHistoryResolution(hoursAgo(24 * 40), now, "raw", 7, now), HistoryRangeError);
});

test("groups readings from the same gateway batch into a single row", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const [admin] = await db.select().from(schema.users).limit(1);
    const [device] = await db.select().from(schema.devices).limit(1);
    const enabled = await db.select().from(schema.channels).where(and(eq(schema.channels.assetId, device.assetId), eq(schema.channels.enabled, true))).orderBy(schema.channels.displayOrder).limit(3);
    assert.equal(enabled.length, 3);

    const base = new Date("2026-11-11T10:00:00Z");
    const batches = await db.insert(schema.ingestionBatches).values([0, 1].map((index) => ({
      gatewayId: device.gatewayId,
      deviceId: device.id,
      batchKey: `lote-${index}`,
      startedAt: new Date(base.getTime() + index * 60_000),
      completedAt: new Date(base.getTime() + index * 60_000 + 400),
      expectedRegisters: 3,
      receivedRegisters: 3,
      latencyMs: 400 + index,
      success: true,
    }))).returning();
    await db.insert(schema.readings).values([
      ...batches.flatMap((batch, index) => enabled.map((channel, position) => ({
        channelId: channel.id,
        batchId: batch.id,
        recordedAt: new Date(base.getTime() + index * 60_000),
        value: String(40 + index * 10 + position),
        rawValue: 400 + position,
        quality: position === 2 && index === 1 ? "bad" as const : "good" as const,
        sequence: index,
      }))),
      // Lectura antigua sin lote: forma su propia fila.
      { channelId: enabled[0].id, recordedAt: new Date(base.getTime() - 3_600_000), value: "35", quality: "good" as const, sequence: 99 },
    ]);

    const columns = await listHistoryColumns(db, device.assetId, admin.id, "all");
    const selected = columns.filter((column) => enabled.some((channel) => channel.id === column.id));
    const result = await listHistoryRows(db, {
      channelIds: selected.map((column) => column.id),
      from: new Date(base.getTime() - 2 * 3_600_000),
      to: new Date(base.getTime() + 3_600_000),
      resolution: { key: "raw", bucketSeconds: 0, label: "Por envío" },
      limit: 10,
      offset: 0,
    });

    assert.equal(result.total, 3);
    assert.equal(result.rows.length, 3);
    const [latest, previous, legacy] = result.rows;
    assert.equal(latest.recordedAt, new Date(base.getTime() + 60_000).toISOString());
    assert.equal(Object.keys(latest.cells).length, 3);
    assert.equal(latest.cells[enabled[0].id].value, 50);
    assert.equal(latest.cells[enabled[2].id].quality, "bad");
    assert.equal(latest.latencyMs, 401);
    assert.equal(Object.keys(previous.cells).length, 3);
    assert.equal(Object.keys(legacy.cells).length, 1);

    const paged = await listHistoryRows(db, { channelIds: selected.map((column) => column.id), from: new Date(base.getTime() - 2 * 3_600_000), to: new Date(base.getTime() + 3_600_000), resolution: { key: "raw", bucketSeconds: 0, label: "Por envío" }, limit: 1, offset: 1 });
    assert.equal(paged.total, 3);
    assert.equal(paged.rows[0].recordedAt, previous.recordedAt);

    const csv = historyCsvRows(selected, result.rows, { key: "raw", bucketSeconds: 0, label: "Por envío" });
    assert.equal(csv.length, 4);
    assert.equal(csv[0][0], "fecha_utc");
    assert.equal(csv[0].length, selected.length + 2);
    assert.match(String(csv[1][csv[1].length - 1]), /inválida/);
  } finally {
    await client.close();
  }
});

test("returns one row per aggregation bucket", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const [device] = await db.select().from(schema.devices).limit(1);
    const enabled = await db.select().from(schema.channels).where(and(eq(schema.channels.assetId, device.assetId), eq(schema.channels.enabled, true))).limit(2);
    const bucket = new Date("2026-11-10T00:00:00Z");
    await db.insert(schema.readingAggregates).values(enabled.flatMap((channel, position) => [0, 1].map((hour) => ({
      channelId: channel.id,
      bucketStart: new Date(bucket.getTime() + hour * 3_600_000),
      bucketSeconds: 3600,
      sampleCount: 60,
      invalidSampleCount: position,
      minimumValue: "10",
      maximumValue: "30",
      averageValue: String(20 + hour),
    }))));
    const result = await listHistoryRows(db, { channelIds: enabled.map((channel) => channel.id), from: bucket, to: new Date(bucket.getTime() + 86_400_000), resolution: { key: "3600", bucketSeconds: 3600, label: "Promedio 1 hora" }, limit: 10, offset: 0 });
    assert.equal(result.total, 2);
    assert.equal(Object.keys(result.rows[0].cells).length, 2);
    assert.equal(result.rows[0].cells[enabled[0].id].value, 21);
    assert.equal(result.rows[0].cells[enabled[0].id].maximum, 30);
  } finally {
    await client.close();
  }
});
