import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { loadSiteOverview, loadSiteTrend, sortPoints, summarizeGroups, type SitePoint } from "../db/site-overview";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

const now = new Date("2026-11-16T20:00:00Z");
const row = (metric: string, code: string, value: number | null, extra: Partial<{ quality: string; ageS: number; warning: number; critical: number; unit: string }> = {}) => ({
  assetId: "a", metric, code, name: code, unit: extra.unit ?? (metric === "humidity" ? "%RH" : metric === "temperature" ? "°C" : "idx"),
  value: value === null ? null : String(value), quality: extra.quality ?? "good",
  recordedAt: new Date(now.getTime() - (extra.ageS ?? 10) * 1000),
  warningThreshold: extra.warning === undefined ? null : String(extra.warning), criticalThreshold: extra.critical === undefined ? null : String(extra.critical),
});

test("summarizes each group with its highest fresh value and worst severity", () => {
  const groups = summarizeGroups([
    row("temperature", "T01", 41.2, { warning: 65, critical: 80 }),
    row("temperature", "T07", 67.8, { warning: 65, critical: 80 }),
    row("temperature", "T09", 99, { quality: "bad" }),
    row("temperature", "T10", 95, { ageS: 600 }),
    row("humidity", "H01", 58),
    row("partial_discharge", "PD2", 85, { warning: 70 }),
    row("surface_discharge", "SD1", 12),
  ], now, 180);
  assert.deepEqual({ value: groups.temperature.value, channel: groups.temperature.channelCode, severity: groups.temperature.severity }, { value: 67.8, channel: "T07", severity: "warning" });
  assert.equal(groups.humidity.value, 58);
  assert.equal(groups.humidity.severity, "normal");
  assert.deepEqual({ value: groups.discharge.value, channel: groups.discharge.channelCode, severity: groups.discharge.severity }, { value: 85, channel: "PD2", severity: "warning" });
  const empty = summarizeGroups([row("temperature", "T01", 50, { ageS: 900 })], now, 180);
  assert.equal(empty.temperature.value, null, "stale readings do not count");
});

test("sorts points with the most serious first", () => {
  const point = (code: string, status: SitePoint["status"], openAlarms = 0, temp: number | null = 40): SitePoint => ({
    id: code, code, name: code, deviceCode: null, status, lastReadAt: null, openAlarms, alarmSeverity: null,
    groups: { temperature: { value: temp, unit: "°C", channelCode: null, channelName: null, severity: "normal" }, humidity: { value: null, unit: null, channelCode: null, channelName: null, severity: "normal" }, discharge: { value: null, unit: null, channelCode: null, channelName: null, severity: "normal" } },
  });
  const sorted = sortPoints([point("A", "normal", 0, 30), point("B", "offline"), point("C", "warning"), point("D", "critical"), point("E", "normal", 0, 50)]);
  assert.deepEqual(sorted.map((item) => item.code), ["D", "C", "B", "E", "A"]);
});

test("loads the site points and compares one group over time from the aggregates", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { log: false });
    const [asset] = await db.select().from(schema.assets).limit(1);
    const overview = await loadSiteOverview(db, asset.siteId, [], now);
    assert.equal(overview.points.length, 1);
    assert.equal(overview.points[0].status, "offline", "a point without recent readings shows as offline");
    assert.equal(overview.summary.online, 0);

    const temps = await db.select({ id: schema.channels.id }).from(schema.channels)
      .where(and(eq(schema.channels.assetId, asset.id), eq(schema.channels.metric, "temperature"))).limit(2);
    await db.update(schema.channels).set({ enabled: true }).where(eq(schema.channels.id, temps[0].id));
    await db.update(schema.channels).set({ enabled: true }).where(eq(schema.channels.id, temps[1].id));
    const bucket = (minutesAgo: number) => new Date(Math.floor((now.getTime() - minutesAgo * 60_000) / 300_000) * 300_000);
    await db.insert(schema.readingAggregates).values([
      { channelId: temps[0].id, bucketStart: bucket(30), bucketSeconds: 300, sampleCount: 5, maximumValue: "40.5" },
      { channelId: temps[1].id, bucketStart: bucket(30), bucketSeconds: 300, sampleCount: 5, maximumValue: "52.25" },
      { channelId: temps[0].id, bucketStart: bucket(10), bucketSeconds: 300, sampleCount: 5, maximumValue: "41" },
      { channelId: temps[0].id, bucketStart: bucket(60 * 30), bucketSeconds: 300, sampleCount: 5, maximumValue: "90" },
    ]);
    const trend = await loadSiteTrend(db, asset.siteId, [], "temperature", 24, now);
    assert.equal(trend.bucketSeconds, 300);
    assert.deepEqual(trend.points[0].series.map(([, value]) => value), [52.3, 41], "max per bucket across the point's channels, only inside the period");
    const outOfScope = await loadSiteTrend(db, asset.siteId, ["00000000-0000-4000-8000-000000000000"], "temperature", 24, now);
    assert.equal(outOfScope.points.length, 0, "asset scopes are respected");
  } finally {
    await client.close();
  }
});
