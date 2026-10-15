import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { Cam5Database } from "../db/index";
import * as schema from "../db/schema";
import { consumeGatewayQuota } from "../db/gateway-rate-limit";
import { checkIngestRateLimit } from "../app/api/v1/gateway/_lib/rate-limit";
import { apiErrorResponse } from "../app/api/v1/_lib/auth";
import { batchIsMaintenanceActive, isMaintenanceActive } from "../db/maintenance-engine";
import { siteAlarmSummary, searchSiteCriticalAlarms } from "../db/portal-alarm-overview";

async function fixture() {
  const client = new PGlite();
  for (const file of (await readdir(new URL('../drizzle/', import.meta.url))).filter((p) => p.endsWith('.sql')).sort()) {
    await client.exec((await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8')).replaceAll('--> statement-breakpoint', ''));
  }
  const db = drizzle(client, { schema }) as unknown as Cam5Database;
  const [customer] = await db.insert(schema.clients).values({ code: "TEST", name: "Test" }).returning();
  const [site] = await db.insert(schema.sites).values({ clientId: customer.id, code: "SITE", name: "Site" }).returning();
  const [otherSite] = await db.insert(schema.sites).values({ clientId: customer.id, code: "OTHER", name: "Other" }).returning();
  return { client, db, customer, site, otherSite };
}

test("shared sliding quota admits only 120 concurrent requests, keeps heartbeats independent and expires old slots", async () => {
  const { client, db, site } = await fixture();
  try {
    const [gateway] = await db.insert(schema.gateways).values({ siteId: site.id, code: "GW", name: "Gateway" }).returning();
    // Two independently constructed adapters share only database state, never a JS Map.
    const secondDb = drizzle(client, { schema }) as unknown as Cam5Database;
    const at = new Date('2026-10-15T03:00:00Z');
    const responses = await Promise.all(Array.from({ length: 140 }, (_, i) => consumeGatewayQuota(i % 2 ? db : secondDb, gateway.id, 'ingest', at)));
    assert.equal(responses.filter((r) => r.accepted).length, 120);
    assert.equal(responses.filter((r) => !r.accepted).length, 20);
    assert.equal(responses.find((r) => !r.accepted)?.retryAfterSeconds, 60);
    assert.equal((await consumeGatewayQuota(db, gateway.id, 'heartbeat', at)).accepted, true);
    assert.equal((await consumeGatewayQuota(db, gateway.id, 'ingest', new Date(+at + 59999))).accepted, false);
    assert.equal((await consumeGatewayQuota(db, gateway.id, 'ingest', new Date(+at + 60000))).accepted, true);
    const [saved] = await db.select().from(schema.gatewayRateLimits).where(eq(schema.gatewayRateLimits.operation, 'ingest'));
    assert.equal(saved.requests.length, 1);
    // Fill with current timestamps to exercise the real HTTP rejection contract.
    await client.query("UPDATE gateway_rate_limits SET requests = array_fill(statement_timestamp(), ARRAY[120]) WHERE operation = 'ingest'");
    try { await checkIngestRateLimit(db, gateway.id, 'ingest'); assert.fail('must reject'); }
    catch (error) { const response = apiErrorResponse(error); assert.equal(response.status, 429); assert.ok(Number(response.headers.get('Retry-After')) > 0); }
  } finally { await client.close(); }
});

test("batched maintenance preserves site boundaries and matches individual checks for each valid target", async () => {
  const { client, db, customer, site, otherSite } = await fixture();
  try {
    const [area] = await db.insert(schema.areas).values({ clientId: customer.id, siteId: site.id, code: 'A', name: 'Area' }).returning();
    const [asset] = await db.insert(schema.assets).values({ siteId: site.id, areaId: area.id, code: 'A', name: 'A' }).returning();
    const [otherAsset] = await db.insert(schema.assets).values({ siteId: otherSite.id, code: 'B', name: 'B' }).returning();
    const at = new Date('2026-10-15T03:00:00Z');
    await db.insert(schema.maintenanceWindows).values({ clientId: customer.id, scopeType: 'area', scopeId: area.id, startsAt: new Date(+at - 1000), endsAt: new Date(+at + 60000), reason: 'Test' });
    const targets = [{ siteId: site.id, assetId: asset.id }, { siteId: otherSite.id, assetId: otherAsset.id }, { siteId: otherSite.id, assetId: asset.id }];
    const result = await batchIsMaintenanceActive(db, targets, at);
    for (const target of targets) assert.equal(result.get(`${target.siteId}:${target.assetId}:`), await isMaintenanceActive(db, { ...target, at }));
    assert.equal(result.get(`${site.id}:${asset.id}:`), true);
    assert.equal(result.get(`${otherSite.id}:${asset.id}:`), false);
    assert.equal((await batchIsMaintenanceActive(db, [targets[0]], new Date(+at + 60000))).get(`${site.id}:${asset.id}:`), false);
  } finally { await client.close(); }
});

test("site alert counts and global search respect asset permissions, site boundary and acknowledgement", async () => {
  const { client, db, site, otherSite } = await fixture();
  try {
    const [user] = await db.insert(schema.users).values({ email: 'test@example.test', displayName: 'Test' }).returning();
    const [a] = await db.insert(schema.assets).values({ siteId: site.id, code: 'A', name: 'Freezer A' }).returning();
    const [b] = await db.insert(schema.assets).values({ siteId: site.id, code: 'B', name: 'Freezer B' }).returning();
    const [c] = await db.insert(schema.assets).values({ siteId: otherSite.id, code: 'C', name: 'Other site' }).returning();
    const [first] = await db.insert(schema.alarms).values([
      { siteId: site.id, assetId: a.id, code: 'A-OPEN', openedAt: new Date(), lastObservedAt: new Date(), kind: 'threshold', severity: 'critical', status: 'open', title: 'High temperature' },
      { siteId: site.id, assetId: a.id, code: 'A-ACK', openedAt: new Date(), lastObservedAt: new Date(), kind: 'threshold', severity: 'critical', status: 'acknowledged', title: 'Acknowledged' },
      { siteId: site.id, assetId: b.id, code: 'B-OPEN', openedAt: new Date(), lastObservedAt: new Date(), kind: 'threshold', severity: 'critical', status: 'open', title: 'Another asset' },
      { siteId: otherSite.id, assetId: c.id, code: 'C-OPEN', openedAt: new Date(), lastObservedAt: new Date(), kind: 'threshold', severity: 'critical', status: 'open', title: 'Another site' },
    ]).returning();
    assert.deepEqual(await siteAlarmSummary(db, user.id, site.id), { critical: 3, warning: 0, unacknowledgedCritical: 2 });
    assert.equal((await searchSiteCriticalAlarms(db, user.id, site.id, 'B-OPEN')).items[0]?.assetId, b.id);
    assert.equal((await searchSiteCriticalAlarms(db, user.id, site.id, 'C-OPEN')).total, 0);
    await db.insert(schema.userAssetScopes).values({ userId: user.id, assetId: a.id });
    assert.deepEqual(await siteAlarmSummary(db, user.id, site.id), { critical: 2, warning: 0, unacknowledgedCritical: 1 });
    assert.equal((await searchSiteCriticalAlarms(db, user.id, site.id, 'B-OPEN')).total, 0);
    await db.update(schema.alarms).set({ status: 'acknowledged' }).where(eq(schema.alarms.id, first.id));
    assert.equal((await siteAlarmSummary(db, user.id, site.id)).unacknowledgedCritical, 0);
    assert.equal((await searchSiteCriticalAlarms(db, user.id, site.id, '%')).total, 0);
  } finally { await client.close(); }
});
