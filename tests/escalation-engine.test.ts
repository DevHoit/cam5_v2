import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import {
  cancelEscalationJobsForAlarm,
  enqueueEscalationJob,
  processDueEscalationJobs,
} from "../db/escalation-engine";
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
  "0024_notification_suppressed_status.sql", "0025_rs485_bus_addressing.sql", "0026_hoit_v1_control_plane.sql", "0027_rule_alarm_semantics.sql", "0029_notification_recipients.sql", "0030_fix_phone_e164_check.sql",
];

async function fixture() {
  const client = new PGlite();
  for (const filename of migrations) {
    const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  const db = drizzle(client, { schema }) as unknown as Cam5Database;
  const [customer] = await db.insert(schema.clients).values({ code: "ESC", name: "Escalation" }).returning();
  const [site] = await db.insert(schema.sites).values({ clientId: customer.id, code: "ESC-S", name: "Escalation Site" }).returning();
  const [asset] = await db.insert(schema.assets).values({ siteId: site.id, code: "ESC-A", name: "Escalation Asset" }).returning();
  const openedAt = new Date("2026-10-03T18:00:00.000Z");
  const [alarm] = await db.insert(schema.alarms).values({
    siteId: site.id,
    assetId: asset.id,
    code: "ESC-ALARM-" + Math.random().toString(16).slice(2),
    kind: "threshold",
    severity: "critical",
    title: "Critical escalation",
    openedAt,
    lastObservedAt: openedAt,
  }).returning();
  const [policy] = await db.insert(schema.escalationPolicies).values({
    clientId: customer.id,
    name: "Critical operations",
  }).returning();
  const [level] = await db.insert(schema.escalationLevels).values({
    policyId: policy.id,
    levelNumber: 1,
    delaySeconds: 300,
    recipientType: "role",
    recipientRef: "operator",
    channels: ["whatsapp", "email"],
    repeatCount: 1,
  }).returning();
  return { client, db, customer, site, asset, alarm, policy, level, openedAt };
}

test("escalation jobs are persisted idempotently with explicit due_at", async () => {
  const { client, db, alarm, policy, level, openedAt } = await fixture();
  try {
    const dueAt = new Date(openedAt.getTime() + 300_000);
    const first = await enqueueEscalationJob(db, {
      alarmId: alarm.id,
      policyId: policy.id,
      levelId: level.id,
      dueAt,
    });
    assert.equal(first.created, true);
    assert.equal(first.job?.dueAt.toISOString(), dueAt.toISOString());

    const replay = await enqueueEscalationJob(db, {
      alarmId: alarm.id,
      policyId: policy.id,
      levelId: level.id,
      dueAt,
    });
    assert.equal(replay.created, false);

    const rows = await db.select().from(schema.escalationJobs);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].recipientType, "role");
    assert.equal(rows[0].recipientRef, "operator");
    assert.equal(rows[0].status, "pending");
  } finally {
    await client.close();
  }
});

test("due jobs resolve recipients at execution time through the executor boundary", async () => {
  const { client, db, alarm, policy, level, openedAt } = await fixture();
  try {
    const [recipient] = await db.insert(schema.users).values({
      email: "oncall@example.test",
      displayName: "On Call",
      status: "active",
    }).returning();
    const dueAt = new Date(openedAt.getTime() + 60_000);
    await enqueueEscalationJob(db, { alarmId: alarm.id, policyId: policy.id, levelId: level.id, dueAt });

    let executed = 0;
    const result = await processDueEscalationJobs(db, {
      now: new Date(dueAt.getTime() + 1),
      execute: async (context) => {
        executed += 1;
        assert.equal(context.job.recipientType, "role");
        assert.equal(context.job.recipientRef, "operator");
        assert.deepEqual(context.level.channels, ["whatsapp", "email"]);
        assert.equal(context.alarm.status, "open");
        return { resolvedRecipientUserId: recipient.id };
      },
    });

    assert.deepEqual(result, { processed: 1, completed: 1, cancelled: 0, failed: 0 });
    assert.equal(executed, 1);
    const [job] = await db.select().from(schema.escalationJobs);
    assert.equal(job.status, "completed");
    assert.equal(job.attemptCount, 1);
    assert.equal(job.resolvedRecipientUserId, recipient.id);
    assert.ok(job.completedAt);
  } finally {
    await client.close();
  }
});

test("resolved alarms cancel due escalation without dispatching", async () => {
  const { client, db, alarm, policy, level, openedAt } = await fixture();
  try {
    const dueAt = new Date(openedAt.getTime() + 60_000);
    await enqueueEscalationJob(db, { alarmId: alarm.id, policyId: policy.id, levelId: level.id, dueAt });
    await db.update(schema.alarms).set({
      status: "resolved",
      resolvedAt: new Date(openedAt.getTime() + 30_000),
    }).where(eq(schema.alarms.id, alarm.id));

    let executed = false;
    const result = await processDueEscalationJobs(db, {
      now: new Date(dueAt.getTime() + 1),
      execute: async () => {
        executed = true;
      },
    });
    assert.equal(executed, false);
    assert.deepEqual(result, { processed: 1, completed: 0, cancelled: 1, failed: 0 });

    const [job] = await db.select().from(schema.escalationJobs);
    assert.equal(job.status, "cancelled");
  } finally {
    await client.close();
  }
});

test("future jobs stay pending and explicit cancellation removes active alarm work", async () => {
  const { client, db, alarm, policy, level, openedAt } = await fixture();
  try {
    const dueAt = new Date(openedAt.getTime() + 3_600_000);
    await enqueueEscalationJob(db, { alarmId: alarm.id, policyId: policy.id, levelId: level.id, dueAt });

    let executed = false;
    const result = await processDueEscalationJobs(db, {
      now: new Date(openedAt.getTime() + 10_000),
      execute: async () => {
        executed = true;
      },
    });
    assert.equal(executed, false);
    assert.equal(result.processed, 0);

    assert.equal(await cancelEscalationJobsForAlarm(db, alarm.id, new Date(openedAt.getTime() + 20_000)), 1);
    const [job] = await db.select().from(schema.escalationJobs);
    assert.equal(job.status, "cancelled");
  } finally {
    await client.close();
  }
});

test("a cancelled escalation level is requeued when the same alarm reopens", async () => {
  const { client, db, alarm, policy, level, openedAt } = await fixture();
  try {
    const firstDue = new Date(openedAt.getTime() + 60_000);
    await enqueueEscalationJob(db, { alarmId: alarm.id, policyId: policy.id, levelId: level.id, dueAt: firstDue });
    assert.equal(await cancelEscalationJobsForAlarm(db, alarm.id, new Date(openedAt.getTime() + 30_000)), 1);

    const secondDue = new Date(openedAt.getTime() + 600_000);
    const replay = await enqueueEscalationJob(db, { alarmId: alarm.id, policyId: policy.id, levelId: level.id, dueAt: secondDue });
    assert.equal(replay.created, false);
    assert.equal(replay.requeued, true);

    const [job] = await db.select().from(schema.escalationJobs);
    assert.equal(job.status, "pending");
    assert.equal(job.dueAt.toISOString(), secondDue.toISOString());
    assert.equal(job.attemptCount, 0);
    assert.equal(job.completedAt, null);
  } finally {
    await client.close();
  }
});

test("cross-client escalation policies cannot be attached to an alarm", async () => {
  const { client, db, alarm, level, openedAt } = await fixture();
  try {
    const [otherClient] = await db.insert(schema.clients).values({ code: "OTHER", name: "Other" }).returning();
    const [otherPolicy] = await db.insert(schema.escalationPolicies).values({ clientId: otherClient.id, name: "Other policy" }).returning();
    const [otherLevel] = await db.insert(schema.escalationLevels).values({
      policyId: otherPolicy.id,
      levelNumber: 1,
      recipientType: "user",
      recipientRef: "someone",
      channels: ["email"],
    }).returning();

    await assert.rejects(
      enqueueEscalationJob(db, {
        alarmId: alarm.id,
        policyId: otherPolicy.id,
        levelId: otherLevel.id,
        dueAt: new Date(openedAt.getTime() + 60_000),
      }),
      /mismo cliente/,
    );
    assert.notEqual(level.id, otherLevel.id);
  } finally {
    await client.close();
  }
});
