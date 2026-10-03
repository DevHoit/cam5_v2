import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { Cam5Database } from "../db/index";
import { processMetaWhatsAppWebhook, verifyMetaWebhookSignature } from "../db/whatsapp-webhook";
import * as schema from "../db/schema";

const migrations = [
  "0000_cam5_initial_schema.sql","0001_eager_blockbuster.sql","0002_sparkling_wallow.sql",
  "0003_rich_charles_xavier.sql","0004_windy_gauntlet.sql","0005_milky_caretaker.sql",
  "0006_smiling_frightful_four.sql","0007_big_frightful_four.sql","0008_sloppy_mister_sinister.sql",
  "0009_cuddly_infant_terrible.sql","0010_robust_wallop.sql","0011_dear_prima.sql",
  "0012_hoit_core_foundation.sql","0013_hoit_generic_telemetry.sql","0014_generic_device_transport.sql",
  "0015_operational_condition_states.sql","0016_cold_chain_report_template.sql","0017_generic_metric_aggregates.sql",
  "0018_pm5560_metric_catalog.sql","0019_nullable_device_gateway_site_guard.sql","0020_electrical_report_template.sql",
  "0021_dse8660_metric_catalog.sql","0022_ats_report_template.sql","0023_access_scope_roles.sql",
  "0024_notification_suppressed_status.sql","0025_rs485_bus_addressing.sql","0026_hoit_v1_control_plane.sql",
  "0027_rule_alarm_semantics.sql","0028_area_scope_guards.sql","0029_notification_recipients.sql",
  "0030_fix_phone_e164_check.sql","0031_whatsapp_webhook_audit.sql",
];

async function fixture() {
  const client = new PGlite();
  for (const filename of migrations) {
    const sql = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  const db = drizzle(client, { schema }) as unknown as Cam5Database;
  const [customer] = await db.insert(schema.clients).values({ code: "WA", name: "WhatsApp" }).returning();
  const [site] = await db.insert(schema.sites).values({ clientId: customer.id, code: "WA-S", name: "WhatsApp Site" }).returning();
  const [asset] = await db.insert(schema.assets).values({ siteId: site.id, code: "WA-A", name: "WhatsApp Asset" }).returning();
  const [operatorRole] = await db.select().from(schema.roles).where(eq(schema.roles.key, "operator")).limit(1);
  assert.ok(operatorRole);
  const [user] = await db.insert(schema.users).values({
    email: "wa.operator@example.test",
    phoneE164: "+56912345678",
    displayName: "WA Operator",
    status: "active",
  }).returning();
  await db.insert(schema.userRoleAssignments).values({ userId: user.id, roleId: operatorRole.id, siteId: site.id });
  const [endpoint] = await db.insert(schema.notificationEndpoints).values({
    siteId: site.id,
    name: "WhatsApp",
    kind: "whatsapp_meta",
    configuration: { phoneNumberId: "1234567890", apiVersion: "v99.0", templateName: "hoit_alarm_critical_es" },
    secretReference: "META_ACCESS_TOKEN",
  }).returning();
  const now = new Date("2026-10-03T20:00:00.000Z");
  const [alarm] = await db.insert(schema.alarms).values({
    siteId: site.id,
    assetId: asset.id,
    code: "WA-AL-1",
    kind: "threshold",
    severity: "critical",
    title: "Alarm",
    status: "open",
    openedAt: now,
    lastObservedAt: now,
  }).returning();
  const [policy] = await db.insert(schema.escalationPolicies).values({ clientId: customer.id, name: "WA Policy" }).returning();
  const [level] = await db.insert(schema.escalationLevels).values({
    policyId: policy.id,
    levelNumber: 2,
    delaySeconds: 0,
    recipientType: "user",
    recipientRef: user.id,
    channels: ["whatsapp_meta"],
  }).returning();
  await db.insert(schema.escalationJobs).values({
    alarmId: alarm.id,
    policyId: policy.id,
    levelId: level.id,
    status: "pending",
    dueAt: now,
    recipientType: "user",
    recipientRef: user.id,
  });
  const [delivery] = await db.insert(schema.notificationDeliveries).values({
    endpointId: endpoint.id,
    alarmId: alarm.id,
    eventType: "escalated",
    subject: "Escalated",
    payload: {},
    recipient: user.phoneE164,
    recipientUserId: user.id,
    provider: "meta_whatsapp_cloud",
    templateName: "hoit_alarm_critical_es",
    status: "sent",
    providerMessageId: "wamid.outgoing.1",
    sentAt: now,
    scheduledAt: now,
    nextAttemptAt: now,
  }).returning();
  return { client, db, user, alarm, delivery, now };
}

function bodyWithMessage(from: string, messageId = "wamid.incoming.ack.1") {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-1",
      changes: [{
        field: "messages",
        value: {
          messages: [{
            id: messageId,
            from,
            timestamp: "1791057600",
            type: "button",
            context: { id: "wamid.outgoing.1" },
            button: { payload: "ACK", text: "ACK" },
          }],
        },
      }],
    }],
  };
}

test("valid Meta signatures are verified with constant-time HMAC comparison", () => {
  const raw = JSON.stringify({ object: "whatsapp_business_account" });
  const secret = "app-secret";
  const signature = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyMetaWebhookSignature(raw, signature, secret), true);
  assert.equal(verifyMetaWebhookSignature(raw + "x", signature, secret), false);
  assert.equal(verifyMetaWebhookSignature(raw, null, secret), false);
});

test("authorized Quick Reply ACK changes an open alarm once and records transition plus audit", async () => {
  const { client, db, user, alarm, delivery, now } = await fixture();
  try {
    const result = await processMetaWhatsAppWebhook(db, bodyWithMessage("56912345678"), new Date(now.getTime() + 60_000));
    assert.deepEqual(result, { processed: 1, duplicate: 0, rejected: 0 });

    const [updated] = await db.select().from(schema.alarms).where(eq(schema.alarms.id, alarm.id));
    assert.equal(updated.status, "acknowledged");
    assert.equal(updated.acknowledgedBy, user.id);

    const transitions = await db.select().from(schema.alarmTransitions).where(eq(schema.alarmTransitions.alarmId, alarm.id));
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].fromStatus, "open");
    assert.equal(transitions[0].toStatus, "acknowledged");
    assert.equal(transitions[0].source, "whatsapp_meta");

    const [storedDelivery] = await db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.id, delivery.id));
    assert.ok(storedDelivery.ackAt);

    const [job] = await db.select().from(schema.escalationJobs).where(eq(schema.escalationJobs.alarmId, alarm.id));
    assert.equal(job.status, "cancelled");

    const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.resourceId, alarm.id));
    assert.ok(audits.some((entry) => entry.action === "alarms.acknowledge.whatsapp"));

    const duplicate = await processMetaWhatsAppWebhook(db, bodyWithMessage("56912345678"), new Date(now.getTime() + 120_000));
    assert.deepEqual(duplicate, { processed: 0, duplicate: 1, rejected: 0 });
    assert.equal((await db.select().from(schema.alarmTransitions).where(eq(schema.alarmTransitions.alarmId, alarm.id))).length, 1);
  } finally {
    await client.close();
  }
});

test("unknown phone cannot acknowledge an alarm even with a correlated provider message id", async () => {
  const { client, db, alarm, now } = await fixture();
  try {
    const result = await processMetaWhatsAppWebhook(db, bodyWithMessage("56999999999", "wamid.unknown.1"), new Date(now.getTime() + 60_000));
    assert.deepEqual(result, { processed: 0, duplicate: 0, rejected: 1 });
    const [updated] = await db.select().from(schema.alarms).where(eq(schema.alarms.id, alarm.id));
    assert.equal(updated.status, "open");
    assert.equal((await db.select().from(schema.alarmTransitions)).length, 0);
  } finally {
    await client.close();
  }
});

test("Meta delivery callbacks advance sent to delivered and read without regressing", async () => {
  const { client, db, delivery, now } = await fixture();
  try {
    const statusBody = (status: string, timestamp: string) => ({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: { statuses: [{ id: "wamid.outgoing.1", status, timestamp, recipient_id: "56912345678" }] },
        }],
      }],
    });

    assert.deepEqual(await processMetaWhatsAppWebhook(db, statusBody("delivered", "1"), new Date(now.getTime() + 10_000)), { processed: 1, duplicate: 0, rejected: 0 });
    assert.deepEqual(await processMetaWhatsAppWebhook(db, statusBody("read", "2"), new Date(now.getTime() + 20_000)), { processed: 1, duplicate: 0, rejected: 0 });
    assert.deepEqual(await processMetaWhatsAppWebhook(db, statusBody("delivered", "3"), new Date(now.getTime() + 30_000)), { processed: 1, duplicate: 0, rejected: 0 });

    const [stored] = await db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.id, delivery.id));
    assert.equal(stored.status, "read");
    assert.ok(stored.deliveredAt);
    assert.ok(stored.readAt);
  } finally {
    await client.close();
  }
});
