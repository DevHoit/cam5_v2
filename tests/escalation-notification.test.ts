import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { enqueueEscalationJob, processDueEscalationJobs } from "../db/escalation-engine";
import { queueEscalationNotifications } from "../db/escalation-notification-engine";
import { processNotificationQueue, sendNotification } from "../db/notification-engine";
import type { Cam5Database } from "../db/index";
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
  "0024_notification_suppressed_status.sql", "0025_rs485_bus_addressing.sql", "0026_hoit_v1_control_plane.sql",
  "0027_rule_alarm_semantics.sql", "0028_area_scope_guards.sql", "0029_notification_recipients.sql", "0030_fix_phone_e164_check.sql",
];

async function fixture() {
  const client = new PGlite();
  for (const filename of migrations) {
    const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  const db = drizzle(client, { schema }) as unknown as Cam5Database;
  const [customer] = await db.insert(schema.clients).values({ code: "ESCN", name: "Escalation Notify" }).returning();
  const [site] = await db.insert(schema.sites).values({ clientId: customer.id, code: "ESCN-S", name: "Escalation Site" }).returning();
  const [asset] = await db.insert(schema.assets).values({ siteId: site.id, code: "ESCN-A", name: "Critical Asset" }).returning();
  const [role] = await db.insert(schema.roles).values({ key: "noc_operator", name: "NOC Operator" }).returning();
  const [user] = await db.insert(schema.users).values({
    email: "operator@example.test",
    phoneE164: "+56912345678",
    displayName: "Operator",
    status: "active",
  }).returning();
  await db.insert(schema.userRoleAssignments).values({ userId: user.id, roleId: role.id, siteId: site.id });
  const [endpoint] = await db.insert(schema.notificationEndpoints).values({
    siteId: site.id,
    name: "Escalation email",
    kind: "email",
    configuration: { recipients: ["legacy@example.test"] },
  }).returning();
  const now = new Date("2026-10-03T18:00:00.000Z");
  const [alarm] = await db.insert(schema.alarms).values({
    siteId: site.id,
    assetId: asset.id,
    code: "ESCN-001",
    kind: "threshold",
    severity: "critical",
    title: "Temperature excursion",
    openedAt: now,
    lastObservedAt: now,
  }).returning();
  const [policy] = await db.insert(schema.escalationPolicies).values({ clientId: customer.id, name: "Critical" }).returning();
  const [level] = await db.insert(schema.escalationLevels).values({
    policyId: policy.id,
    levelNumber: 1,
    delaySeconds: 0,
    recipientType: "role",
    recipientRef: role.key,
    channels: ["email"],
    repeatCount: 1,
  }).returning();
  return { client, db, site, user, endpoint, alarm, policy, level, now };
}

test("due escalation resolves role recipients and queues personal deliveries", async () => {
  const { client, db, user, alarm, policy, level, now } = await fixture();
  try {
    await enqueueEscalationJob(db, { alarmId: alarm.id, policyId: policy.id, levelId: level.id, dueAt: now });
    const result = await processDueEscalationJobs(db, {
      now,
      execute: (context) => queueEscalationNotifications(db, context, now),
    });
    assert.deepEqual(result, { processed: 1, completed: 1, cancelled: 0, failed: 0 });

    const [delivery] = await db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.alarmId, alarm.id));
    assert.equal(delivery.recipientUserId, user.id);
    assert.equal(delivery.recipient, user.email);
    assert.equal(delivery.provider, "resend");
    assert.equal(delivery.status, "queued");

    let to: string[] = [];
    const sent = await processNotificationQueue(db, {
      now,
      includeRepeats: false,
      environment: { NODE_ENV: "test", RESEND_API_KEY: "re_test", NOTIFICATION_FROM_EMAIL: "alerts@example.test" },
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { to?: string[] };
        to = body.to ?? [];
        return Response.json({ id: "email-escalation-1" }, { status: 200 });
      },
    });
    assert.equal(sent.sent, 1);
    assert.deepEqual(to, [user.email]);

    const [stored] = await db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.id, delivery.id));
    assert.equal(stored.status, "sent");
    assert.equal(stored.providerMessageId, "email-escalation-1");
    assert.ok(stored.sentAt);
    assert.equal(stored.deliveredAt, null);
  } finally {
    await client.close();
  }
});

test("ACK stops a due escalation even if a job remained pending", async () => {
  const { client, db, alarm, policy, level, now } = await fixture();
  try {
    await enqueueEscalationJob(db, { alarmId: alarm.id, policyId: policy.id, levelId: level.id, dueAt: now });
    await db.update(schema.alarms).set({ status: "acknowledged", acknowledgedAt: now }).where(eq(schema.alarms.id, alarm.id));

    let executed = false;
    const result = await processDueEscalationJobs(db, {
      now,
      execute: async () => { executed = true; },
    });
    assert.equal(executed, false);
    assert.deepEqual(result, { processed: 1, completed: 0, cancelled: 1, failed: 0 });
  } finally {
    await client.close();
  }
});

test("WhatsApp Meta adapter sends an approved template to the explicit E.164 recipient", async () => {
  let url = "";
  let authorization = "";
  let body: Record<string, unknown> = {};
  const result = await sendNotification(
    {
      kind: "whatsapp_meta",
      configuration: { phoneNumberId: "1234567890", apiVersion: "v99.0", languageCode: "es_CL" },
      secretReference: "META_TOKEN",
    },
    {
      subject: "Escalated alarm",
      recipient: "+56912345678",
      templateName: "hoit_alarm_critical_es",
      payload: {},
    },
    {
      environment: { NODE_ENV: "test", META_TOKEN: "secret-token" },
      fetchImpl: async (input, init) => {
        url = String(input);
        authorization = new Headers(init?.headers).get("Authorization") ?? "";
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return Response.json({ messages: [{ id: "wamid.123" }] }, { status: 200 });
      },
    },
  );

  assert.match(url, /graph\.facebook\.com\/v99\.0\/1234567890\/messages$/);
  assert.equal(authorization, "Bearer secret-token");
  assert.equal((body as { to?: string }).to, "56912345678");
  assert.equal(result.providerMessageId, "wamid.123");
  assert.equal(result.recipient, "+56912345678");
});
