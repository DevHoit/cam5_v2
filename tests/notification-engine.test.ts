import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import type { Cam5Database } from "../db/index";
import { processNotificationDelivery, processNotificationQueue, queueAlarmNotifications, retryDelayMinutes, sendNotification } from "../db/notification-engine";
import { notificationAccepted, notificationStatusLabel } from "../db/notification-status";
import * as schema from "../db/schema";

async function notificationDatabase() {
  const client = new PGlite();
  for (const filename of ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql", "0005_milky_caretaker.sql", "0006_smiling_frightful_four.sql", "0007_big_frightful_four.sql", "0008_sloppy_mister_sinister.sql", "0009_cuddly_infant_terrible.sql", "0010_robust_wallop.sql", "0011_dear_prima.sql", "0024_notification_suppressed_status.sql", "0026_hoit_v1_control_plane.sql", "0029_notification_recipients.sql", "0030_fix_phone_e164_check.sql"]) {
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
    assert.deepEqual(result, { recovered: 0, repeated: 0, processed: 1, sent: 0, delivered: 1, failed: 0, suppressed: 0 });
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

test("sends a responsive branded email with a plain-text fallback", async () => {
  let providerBody: Record<string, unknown> = {};
  const result = await sendNotification(
    { kind: "email", configuration: { recipients: ["operaciones@example.test"] }, secretReference: null },
    {
      subject: "Nueva alarma · AL-003",
      payload: {
        eventType: "opened",
        severity: "critical",
        kind: "threshold",
        alarmCode: "AL-003",
        title: "Temperatura <script>alert('x')</script>",
        detail: "Umbral crítico superado en la barra principal.",
        site: "Subestación Norte",
        asset: "MCC-01 · Alimentador Norte",
        channel: "T01 · Barra fase L1",
        occurredAt: "2026-09-08T03:15:00.000Z",
        timezone: "America/Santiago",
        portalUrl: "https://cam5v2.vercel.app/?view=alarms&record=alarm-3",
      },
    },
    {
      environment: { NODE_ENV: "test", RESEND_API_KEY: "re_test", NOTIFICATION_FROM_EMAIL: "alarmas@example.test" },
      fetchImpl: async (_input, init) => {
        providerBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return Response.json({ id: "email-1" }, { status: 200 });
      },
    },
  );

  assert.equal(result.providerMessageId, "email-1");
  assert.match(String(providerBody.html), /HoitLive/);
  assert.match(String(providerBody.html), /Alarma crítica/);
  assert.match(String(providerBody.html), /Ver evento en HoitLive Core/);
  assert.match(String(providerBody.html), /&lt;script&gt;/);
  assert.doesNotMatch(String(providerBody.html), /<script>alert/);
  assert.match(String(providerBody.text), /Subestación Norte/);
});


test("suppresses a queued alarm delivery if the asset enters maintenance before dispatch", async () => {
  const { client, db } = await notificationDatabase();
  try {
    const [customer] = await db.insert(schema.clients).values({ code: "MAINT", name: "Maintenance" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: customer.id, code: "M-01", name: "Mantenimiento" }).returning();
    const [asset] = await db.insert(schema.assets).values({ siteId: site.id, code: "ASSET-M", name: "Activo M" }).returning();
    const now = new Date("2026-09-06T14:00:00.000Z");
    const [alarm] = await db.insert(schema.alarms).values({
      siteId: site.id,
      assetId: asset.id,
      code: "AL-MAINT",
      kind: "threshold",
      severity: "critical",
      title: "Alarma antes de mantenimiento",
      openedAt: now,
      lastObservedAt: now,
    }).returning();
    const [event] = await db.insert(schema.alarmEvents).values({ alarmId: alarm.id, eventType: "opened" }).returning();
    const [endpoint] = await db.insert(schema.notificationEndpoints).values({
      siteId: site.id,
      name: "Webhook",
      kind: "webhook",
      configuration: { url: "https://maintenance.example.test/events" },
    }).returning();
    await db.insert(schema.notificationPolicies).values({
      siteId: site.id,
      endpointId: endpoint.id,
      name: "Críticas",
      minimumSeverity: "critical",
      filters: { alarmKinds: ["threshold"] },
    });

    const engineDb = db as unknown as Cam5Database;
    assert.equal(await queueAlarmNotifications(engineDb, {
      siteId: site.id,
      alarmId: alarm.id,
      alarmEventId: event.id,
      severity: "critical",
      kind: "threshold",
      eventType: "opened",
      occurredAt: now,
    }), 1);

    await db.update(schema.assets).set({ state: "maintenance" }).where(eq(schema.assets.id, asset.id));
    let sent = false;
    const result = await processNotificationQueue(engineDb, {
      now,
      includeRepeats: false,
      fetchImpl: async () => {
        sent = true;
        return new Response(null, { status: 204 });
      },
    });
    assert.equal(sent, false);
    assert.equal(result.suppressed, 1);
    assert.equal(result.delivered, 0);

    const [delivery] = await db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.alarmId, alarm.id));
    assert.equal(delivery.status, "suppressed");
    assert.equal(delivery.attemptCount, 0);
    assert.match(delivery.errorMessage ?? "", /mantenimiento/i);
  } finally {
    await client.close();
  }
});


test("persists a suppressed delivery during an active maintenance window", async () => {
  const { client, db } = await notificationDatabase();
  try {
    const [customer] = await db.insert(schema.clients).values({ code: "MW", name: "Maintenance Window" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: customer.id, code: "MW-01", name: "Sitio MW" }).returning();
    const [asset] = await db.insert(schema.assets).values({ siteId: site.id, code: "PANEL-MW", name: "Panel MW" }).returning();
    const now = new Date("2026-10-03T18:00:00.000Z");
    const [alarm] = await db.insert(schema.alarms).values({
      siteId: site.id, assetId: asset.id, code: "AL-MW", kind: "threshold", severity: "critical",
      title: "Alarma bajo mantenimiento", openedAt: now, lastObservedAt: now,
    }).returning();
    const [event] = await db.insert(schema.alarmEvents).values({ alarmId: alarm.id, eventType: "opened" }).returning();
    const [endpoint] = await db.insert(schema.notificationEndpoints).values({
      siteId: site.id, name: "Webhook MW", kind: "webhook",
      configuration: { url: "https://maintenance-window.example.test/events" },
    }).returning();
    await db.insert(schema.notificationPolicies).values({
      siteId: site.id, endpointId: endpoint.id, name: "Critical MW",
      minimumSeverity: "critical", filters: { alarmKinds: ["threshold"] },
    });
    await db.insert(schema.maintenanceWindows).values({
      clientId: customer.id, scopeType: "asset", scopeId: asset.id,
      startsAt: new Date("2026-10-03T17:30:00.000Z"),
      endsAt: new Date("2026-10-03T19:30:00.000Z"),
      reason: "Trabajo programado",
    });

    const engineDb = db as unknown as Cam5Database;
    assert.equal(await queueAlarmNotifications(engineDb, {
      siteId: site.id, alarmId: alarm.id, alarmEventId: event.id,
      severity: "critical", kind: "threshold", eventType: "opened", occurredAt: now,
    }), 1);

    const [delivery] = await db.select().from(schema.notificationDeliveries)
      .where(eq(schema.notificationDeliveries.alarmId, alarm.id));
    assert.equal(delivery.status, "suppressed");
    assert.equal(delivery.attemptCount, 0);
    assert.match(delivery.errorMessage ?? "", /ventana de mantenimiento/i);

    let sent = false;
    const result = await processNotificationQueue(engineDb, {
      now, includeRepeats: false,
      fetchImpl: async () => { sent = true; return new Response(null, { status: 204 }); },
    });
    assert.equal(sent, false);
    assert.equal(result.processed, 0);
  } finally {
    await client.close();
  }
});

test("suppresses a queued delivery if maintenance starts before dispatch", async () => {
  const { client, db } = await notificationDatabase();
  try {
    const [customer] = await db.insert(schema.clients).values({ code: "MWQ", name: "Maintenance Queue" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: customer.id, code: "MWQ-01", name: "Sitio MWQ" }).returning();
    const [asset] = await db.insert(schema.assets).values({ siteId: site.id, code: "PANEL-MWQ", name: "Panel MWQ" }).returning();
    const openedAt = new Date("2026-10-03T17:00:00.000Z");
    const [alarm] = await db.insert(schema.alarms).values({
      siteId: site.id, assetId: asset.id, code: "AL-MWQ", kind: "threshold", severity: "critical",
      title: "Alarma antes de ventana", openedAt, lastObservedAt: openedAt,
    }).returning();
    const [event] = await db.insert(schema.alarmEvents).values({ alarmId: alarm.id, eventType: "opened" }).returning();
    const [endpoint] = await db.insert(schema.notificationEndpoints).values({
      siteId: site.id, name: "Webhook MWQ", kind: "webhook",
      configuration: { url: "https://maintenance-queue.example.test/events" },
    }).returning();
    await db.insert(schema.notificationPolicies).values({
      siteId: site.id, endpointId: endpoint.id, name: "Critical MWQ",
      minimumSeverity: "critical", filters: { alarmKinds: ["threshold"] },
    });

    const engineDb = db as unknown as Cam5Database;
    assert.equal(await queueAlarmNotifications(engineDb, {
      siteId: site.id, alarmId: alarm.id, alarmEventId: event.id,
      severity: "critical", kind: "threshold", eventType: "opened", occurredAt: openedAt,
    }), 1);

    await db.insert(schema.maintenanceWindows).values({
      clientId: customer.id, scopeType: "site", scopeId: site.id,
      startsAt: new Date("2026-10-03T17:30:00.000Z"),
      endsAt: new Date("2026-10-03T19:00:00.000Z"),
      reason: "Ventana de sitio",
    });

    const dispatchAt = new Date("2026-10-03T18:00:00.000Z");
    let sent = false;
    const result = await processNotificationQueue(engineDb, {
      now: dispatchAt, includeRepeats: false,
      fetchImpl: async () => { sent = true; return new Response(null, { status: 204 }); },
    });
    assert.equal(sent, false);
    assert.equal(result.suppressed, 1);

    const [delivery] = await db.select().from(schema.notificationDeliveries)
      .where(eq(schema.notificationDeliveries.alarmId, alarm.id));
    assert.equal(delivery.status, "suppressed");
    assert.match(delivery.errorMessage ?? "", /mantenimiento activo/i);
  } finally {
    await client.close();
  }
});


test("a Resend-accepted test succeeds without claiming delivery or becoming eligible for another send", async () => {
  const { client, db } = await notificationDatabase();
  try {
    const [customer] = await db.insert(schema.clients).values({ code: "EMAIL", name: "Email" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: customer.id, code: "MAIL", name: "Mail" }).returning();
    const [endpoint] = await db.insert(schema.notificationEndpoints).values({ siteId: site.id, name: "Email", kind: "email", configuration: { recipients: ["test@example.test"] } }).returning();
    const now = new Date("2026-10-07T22:25:22.000Z");
    const [delivery] = await db.insert(schema.notificationDeliveries).values({ endpointId: endpoint.id, eventType: "test", subject: "Test", payload: { title: "Test" }, scheduledAt: now, nextAttemptAt: now }).returning();
    let requests = 0;
    const options = { now, environment: { NODE_ENV: "test", RESEND_API_KEY: "test-key", NOTIFICATION_FROM_EMAIL: "Alerts <alerts@example.test>" } as NodeJS.ProcessEnv, fetchImpl: async () => {
      requests++;
      return Response.json({ id: "resend-accepted-1" });
    } };
    const engineDb = db as unknown as Cam5Database;
    const result = await processNotificationDelivery(engineDb, delivery.id, options);
    assert.equal(result.status, "sent");
    assert.equal(notificationAccepted(result.status), true);
    assert.equal(notificationStatusLabel(result.status), "Enviada al proveedor");
    const [saved] = await db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.id, delivery.id));
    assert.equal(saved.providerMessageId, "resend-accepted-1");
    assert.equal(saved.deliveredAt, null);
    assert.equal(saved.sentAt?.toISOString(), now.toISOString());
    await processNotificationQueue(engineDb, { ...options, includeRepeats: false });
    assert.equal(requests, 1);
    assert.equal(notificationAccepted("failed"), false);
    assert.equal(notificationAccepted("suppressed"), false);
    assert.equal(notificationAccepted("queued"), false);
    assert.equal(notificationAccepted("delivered"), true);
  } finally { await client.close(); }
});
