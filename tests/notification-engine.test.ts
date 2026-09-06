import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import type { Cam5Database } from "../db/index";
import { processNotificationQueue, queueAlarmNotifications, retryDelayMinutes, sendNotification } from "../db/notification-engine";
import * as schema from "../db/schema";

async function notificationDatabase() {
  const client = new PGlite();
  for (const filename of ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql", "0005_milky_caretaker.sql", "0006_smiling_frightful_four.sql"]) {
    const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return { client, db: drizzle(client, { schema }) };
}

test("queues one deduplicated delivery per eligible policy and delivers it through the configured webhook", async () => {
  const { client, db } = await notificationDatabase();
  try {
    const [customer] = await db.insert(schema.clients).values({ code: "ACME", name: "ACME" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: customer.id, code: "NORTE", name: "Norte" }).returning();
    const [asset] = await db.insert(schema.assets).values({ siteId: site.id, code: "MCC-01", name: "Alimentador" }).returning();
    const now = new Date("2026-09-06T12:00:00.000Z");
    const [alarm] = await db.insert(schema.alarms).values({ siteId: site.id, assetId: asset.id, code: "AL-001", kind: "threshold", severity: "critical", title: "Temperatura crítica", openedAt: now, lastObservedAt: now }).returning();
    const [alarmEvent] = await db.insert(schema.alarmEvents).values({ alarmId: alarm.id, eventType: "opened" }).returning();
    const [endpoint] = await db.insert(schema.notificationEndpoints).values({ siteId: site.id, name: "CMMS", kind: "webhook", configuration: { url: "https://cmms.example.test/events", destination: "CMMS" } }).returning();
    await db.insert(schema.notificationPolicies).values({ siteId: site.id, endpointId: endpoint.id, name: "Críticas", minimumSeverity: "critical", filters: { alarmKinds: ["threshold"], notifyOnRecovery: true } });
    const engineDb = db as unknown as Cam5Database;

    assert.equal(await queueAlarmNotifications(engineDb, { siteId: site.id, alarmId: alarm.id, alarmEventId: alarmEvent.id, severity: "critical", kind: "threshold", eventType: "opened", occurredAt: now }), 1);
    assert.equal(await queueAlarmNotifications(engineDb, { siteId: site.id, alarmId: alarm.id, alarmEventId: alarmEvent.id, severity: "critical", kind: "threshold", eventType: "opened", occurredAt: now }), 0);

    let body = "";
    const result = await processNotificationQueue(engineDb, { now, includeRepeats: false, fetchImpl: async (_input, init) => { body = String(init?.body || ""); return new Response(null, { status: 204, headers: { "x-request-id": "provider-1" } }); } });
    assert.deepEqual(result, { recovered: 0, repeated: 0, processed: 1, delivered: 1, failed: 0 });
    assert.match(body, /Temperatura crítica/);
    const [delivery] = await db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.alarmId, alarm.id));
    assert.equal(delivery.status, "delivered");
    assert.equal(delivery.attemptCount, 1);
    assert.equal(delivery.providerMessageId, "provider-1");
  } finally {
    await client.close();
  }
});

test("records provider failures and applies bounded exponential retry delays", async () => {
  const { client, db } = await notificationDatabase();
  try {
    const [customer] = await db.insert(schema.clients).values({ code: "FAIL", name: "Fail" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: customer.id, code: "SUR", name: "Sur" }).returning();
    const [endpoint] = await db.insert(schema.notificationEndpoints).values({ siteId: site.id, name: "Webhook", kind: "webhook", configuration: { url: "https://fail.example.test/events" } }).returning();
    const now = new Date("2026-09-06T13:00:00.000Z");
    const [delivery] = await db.insert(schema.notificationDeliveries).values({ endpointId: endpoint.id, subject: "Prueba", payload: { title: "Falla" }, scheduledAt: now, nextAttemptAt: now }).returning();
    const result = await processNotificationQueue(db as unknown as Cam5Database, { now, includeRepeats: false, fetchImpl: async () => new Response(null, { status: 503 }) });
    assert.equal(result.failed, 1);
    const [failed] = await db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.id, delivery.id));
    assert.equal(failed.status, "failed");
    assert.equal(failed.attemptCount, 1);
    assert.equal(failed.nextAttemptAt.toISOString(), "2026-09-06T13:05:00.000Z");
    assert.equal(retryDelayMinutes(1), 5);
    assert.equal(retryDelayMinutes(2), 10);
    assert.equal(retryDelayMinutes(10), 60);
  } finally {
    await client.close();
  }
});

test("signs webhook payloads without exposing the signing secret", async () => {
  let signature = "";
  await sendNotification(
    { kind: "webhook", configuration: { url: "https://signed.example.test/events" }, secretReference: "HOOK_SECRET" },
    { subject: "Evento", payload: { alarmCode: "AL-002" } },
    { environment: { NODE_ENV: "test", HOOK_SECRET: "super-secret" }, fetchImpl: async (_input, init) => { signature = new Headers(init?.headers).get("X-HoitLive-Signature") || ""; return new Response(null, { status: 200 }); } },
  );
  assert.match(signature, /^sha256=[a-f0-9]{64}$/);
  assert.doesNotMatch(signature, /super-secret/);
});
