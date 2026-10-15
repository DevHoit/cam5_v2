import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Cam5Database } from "../db/index";
import { runOperationalCycle } from "../db/operations-cycle";
import * as schema from "../db/schema";

const migrations = [
  "0000_cam5_initial_schema.sql",
  "0001_eager_blockbuster.sql",
  "0002_sparkling_wallow.sql",
  "0003_rich_charles_xavier.sql",
  "0004_windy_gauntlet.sql",
  "0005_milky_caretaker.sql",
  "0006_smiling_frightful_four.sql",
  "0007_big_frightful_four.sql",
  "0008_sloppy_mister_sinister.sql",
  "0009_cuddly_infant_terrible.sql",
  "0010_robust_wallop.sql",
  "0011_dear_prima.sql",
  "0012_hoit_core_foundation.sql",
  "0013_hoit_generic_telemetry.sql",
  "0014_generic_device_transport.sql",
  "0015_operational_condition_states.sql",
  "0016_cold_chain_report_template.sql",
  "0017_generic_metric_aggregates.sql",
  "0018_pm5560_metric_catalog.sql",
  "0019_nullable_device_gateway_site_guard.sql",
  "0020_electrical_report_template.sql",
  "0021_dse8660_metric_catalog.sql",
  "0022_ats_report_template.sql",
  "0023_access_scope_roles.sql",
  "0024_notification_suppressed_status.sql", "0025_rs485_bus_addressing.sql", "0026_hoit_v1_control_plane.sql", "0027_rule_alarm_semantics.sql", "0029_notification_recipients.sql", "0030_fix_phone_e164_check.sql",
];

test("operational cycle evaluates every active domain and drains notifications independently of Vercel", async () => {
  const client = new PGlite();
  try {
    for (const filename of migrations) {
      const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
      await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    }
    const db = drizzle(client, { schema }) as unknown as Cam5Database;
    const [customer] = await db.insert(schema.clients).values({ code: "OPS", name: "Operaciones" }).returning();
    await db.insert(schema.sites).values({ clientId: customer.id, code: "OPS-01", name: "Sitio operacional" });

    const result = await runOperationalCycle(db, {
      now: new Date("2026-10-02T23:00:00.000Z"),
      includeRepeats: false,
    });

    assert.equal(result.sites, 1);
    assert.equal(result.evaluations, 5);
    assert.equal(result.evaluationFailures, 0);
    assert.equal(result.domains.length, 5);
    assert.deepEqual(new Set(result.domains.map((item) => item.domain)), new Set(["legacy", "cold_chain", "electrical", "ats", "generic_rules"]));
    assert.deepEqual(result.escalations, { processed: 0, completed: 0, cancelled: 0, failed: 0 });
    assert.equal(result.notifications.processed, 0);
    assert.equal(result.notifications.sent, 0);
    assert.equal(result.notifications.failed, 0);
    assert.equal(result.notifications.suppressed, 0);
    assert.equal(result.ok, true);
  } finally {
    await client.close();
  }
});

test("site evaluation detects offline meters without touching another site or dispatching queued deliveries", async () => {
  const client = new PGlite();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error("No provider may be contacted in evaluation mode"); };
  try {
    for (const filename of migrations) {
      await client.exec((await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8")).replaceAll("--> statement-breakpoint", ""));
    }
    const db = drizzle(client, { schema }) as unknown as Cam5Database;
    const [customer] = await db.insert(schema.clients).values({ code: "SCOPED", name: "Scoped" }).returning();
    const [lab, other] = await db.insert(schema.sites).values([
      { clientId: customer.id, code: "LAB", name: "Lab" },
      { clientId: customer.id, code: "OTHER", name: "Other" },
    ]).returning();
    const [point, otherPoint] = await db.insert(schema.assets).values([
      { siteId: lab.id, code: "PM-LAB", name: "Lab meter", assetType: "electrical_point", state: "normal" },
      { siteId: other.id, code: "PM-OTHER", name: "Other meter", assetType: "electrical_point", state: "normal" },
    ]).returning();
    await db.insert(schema.devices).values([
      { assetId: point.id, code: "LAB-METER", name: "Lab meter", deviceType: "power_meter", state: "active" },
      { assetId: otherPoint.id, code: "OTHER-METER", name: "Other meter", deviceType: "power_meter", state: "active" },
    ]);
    const [rule] = await db.insert(schema.rules).values({
      clientId: customer.id, name: "Tenant-wide voltage", scopeType: "tenant", scopeId: customer.id,
      severity: "critical", expression: { op: "lt", metric: "electrical.voltage.l1_n", value: 210 },
    }).returning();
    const [endpoint] = await db.insert(schema.notificationEndpoints).values({
      siteId: other.id, name: "Cloned recipient", kind: "webhook", configuration: { url: "https://recipient.example.test/events" },
    }).returning();
    const now = new Date("2026-10-07T15:00:00Z");
    const [delivery] = await db.insert(schema.notificationDeliveries).values({
      endpointId: endpoint.id, subject: "Pending outside lab", payload: {}, scheduledAt: now, nextAttemptAt: now,
    }).returning();

    const result = await runOperationalCycle(db, { siteId: lab.id, mode: "evaluate_only", now });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "evaluate_only");
    assert.equal(result.siteId, lab.id);
    assert.equal(result.dispatchSkipped, true);
    assert.equal(result.sites, 1);
    assert.equal(result.evaluations, 5);
    assert.ok(result.domains.every((domain) => domain.siteId === lab.id));
    const alarmRows = await db.select().from(schema.alarms);
    assert.equal(alarmRows.length, 1);
    assert.equal(alarmRows[0].siteId, lab.id);
    assert.equal(alarmRows[0].kind, "communication");
    const meterRows = await db.select().from(schema.devices);
    assert.equal(meterRows.find((meter) => meter.assetId === point.id)?.state, "offline");
    assert.equal(meterRows.find((meter) => meter.assetId === otherPoint.id)?.state, "active");
    const states = await db.select().from(schema.ruleEvaluationStates);
    assert.equal(states.length, 1);
    assert.equal(states[0].ruleId, rule.id);
    assert.equal(states[0].scopeId, point.id, "tenant-wide rules must be restricted before state writes");
    const [unchanged] = await db.select().from(schema.notificationDeliveries);
    assert.equal(unchanged.id, delivery.id);
    assert.equal(unchanged.status, "queued");
    assert.equal(unchanged.attemptCount, 0);
    assert.equal(result.escalations.processed, 0);
    assert.equal(result.notifications.processed, 0);
    assert.equal(providerCalls, 0);
    await assert.rejects(() => runOperationalCycle(db, { siteId: lab.id }), /evaluate_only/);
    await assert.rejects(() => runOperationalCycle(db, { siteId: "00000000-0000-0000-0000-000000000001", mode: "evaluate_only" }), /no existe/);
  } finally {
    globalThis.fetch = originalFetch;
    await client.close();
  }
});
