import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import {
  evaluateGenericRule,
  evaluateGenericRulesForTelemetry,
  evaluateRuleExpression,
  ruleMetricKeys,
  validateRuleExpression,
} from "../db/rule-engine";
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
  "0027_rule_alarm_semantics.sql", "0028_area_scope_guards.sql", "0029_notification_recipients.sql", "0030_fix_phone_e164_check.sql", "0031_whatsapp_webhook_audit.sql", "0032_preview_operational_scheduler.sql",
];

async function fixture() {
  const client = new PGlite();
  for (const filename of migrations) {
    const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  const db = drizzle(client, { schema }) as unknown as Cam5Database;
  const [customer] = await db.insert(schema.clients).values({ code: "RULE", name: "Rules" }).returning();
  const [site] = await db.insert(schema.sites).values({ clientId: customer.id, code: "RULE-S", name: "Rules Site" }).returning();
  const [area] = await db.insert(schema.areas).values({ clientId: customer.id, siteId: site.id, code: "COLD", name: "Cold" }).returning();
  const [asset] = await db.insert(schema.assets).values({ siteId: site.id, areaId: area.id, code: "CH-01", name: "Chamber 01", assetType: "cold_room" }).returning();
  const [device] = await db.insert(schema.devices).values({
    assetId: asset.id,
    code: "TEMP-01",
    name: "Temperature 01",
    deviceType: "temperature_sensor",
    driver: "eddystone_tlm",
    protocol: "ble",
    state: "active",
  }).returning();
  const [gateway] = await db.insert(schema.gateways).values({ siteId: site.id, code: "GW-TEMP", name: "Gateway TEMP" }).returning();
  const [definition] = await db.insert(schema.metricDefinitions).values({
    key: "environment.temperature",
    name: "Temperature",
    category: "environment",
    unit: "°C",
    dataType: "float",
    aggregation: "avg",
  }).onConflictDoUpdate({
    target: schema.metricDefinitions.key,
    set: { name: "Temperature" },
  }).returning();
  const [metric] = await db.insert(schema.deviceMetrics).values({
    deviceId: device.id,
    metricDefinitionId: definition.id,
    code: "TEMP",
    name: "Temperature",
  }).returning();
  return { client, db, customer, site, asset, device, gateway, metric };
}

async function writeLatest(
  db: Cam5Database,
  input: { gatewayId: string; deviceId: string; deviceMetricId: string; value: number; at: Date; key: string },
) {
  const [batch] = await db.insert(schema.telemetryBatches).values({
    gatewayId: input.gatewayId,
    deviceId: input.deviceId,
    batchKey: input.key,
    gatewayBootId: "boot-rule",
    gatewaySequence: Math.max(1, Math.floor(input.at.getTime() / 1000)),
    sentAt: input.at,
    sampledAt: input.at,
    receivedAt: input.at,
    quality: "good",
    timeQuality: "synced",
    metricCount: 1,
  }).returning();
  const [reading] = await db.insert(schema.metricReadings).values({
    batchId: batch.id,
    deviceMetricId: input.deviceMetricId,
    recordedAt: input.at,
    receivedAt: input.at,
    valueNumeric: String(input.value),
    quality: "good",
    timeQuality: "synced",
  }).returning();
  await db.insert(schema.latestMetricReadings).values({
    deviceMetricId: input.deviceMetricId,
    readingId: reading.id,
    recordedAt: input.at,
    receivedAt: input.at,
    valueNumeric: String(input.value),
    quality: "good",
    timeQuality: "synced",
  }).onConflictDoUpdate({
    target: schema.latestMetricReadings.deviceMetricId,
    set: {
      readingId: reading.id,
      recordedAt: input.at,
      receivedAt: input.at,
      valueNumeric: String(input.value),
      valueBoolean: null,
      valueText: null,
      quality: "good",
      timeQuality: "synced",
    },
  });
}

test("safe rule expressions support comparisons and boolean composition without executable code", () => {
  const expression = validateRuleExpression({
    op: "and",
    conditions: [
      { op: "gt", metric: "environment.temperature", value: -15 },
      { op: "not", condition: { op: "eq", metric: "ats.mains.available", value: false } },
    ],
  });
  assert.deepEqual(new Set(ruleMetricKeys(expression)), new Set(["environment.temperature", "ats.mains.available"]));
  assert.equal(evaluateRuleExpression(expression, new Map<string, number | boolean | string>([
    ["environment.temperature", -12.5],
    ["ats.mains.available", true],
  ])), true);
  assert.equal(evaluateRuleExpression(expression, new Map<string, number | boolean | string>([
    ["environment.temperature", -18],
    ["ats.mains.available", true],
  ])), false);
  assert.throws(() => validateRuleExpression({ op: "javascript", code: "process.exit()" }), /no soportado/);
});

test("generic rules honor duration, open once, and resolve on recovery", async () => {
  const { client, db, customer, site, asset, device, gateway, metric } = await fixture();
  try {
    const [rule] = await db.insert(schema.rules).values({
      clientId: customer.id,
      siteId: site.id,
      name: "Cold excursion",
      scopeType: "device",
      scopeId: device.id,
      severity: "critical",
      expression: { op: "gt", metric: "environment.temperature", value: -15 },
      durationSeconds: 300,
    }).returning();

    const t0 = new Date("2026-10-03T18:00:00.000Z");
    await writeLatest(db, { gatewayId: gateway.id, deviceId: device.id, deviceMetricId: metric.id, value: -12, at: t0, key: "r1" });
    assert.equal((await evaluateGenericRule(db, rule, t0)).pending, 1);
    assert.equal((await db.select().from(schema.alarms)).length, 0);

    const t1 = new Date(t0.getTime() + 300_000);
    await writeLatest(db, { gatewayId: gateway.id, deviceId: device.id, deviceMetricId: metric.id, value: -12, at: t1, key: "r2" });
    const firing = await evaluateGenericRule(db, rule, t1);
    assert.equal(firing.opened, 1);
    const alarms = await db.select().from(schema.alarms);
    assert.equal(alarms.length, 1);
    assert.equal(alarms[0].genericRuleId, rule.id);
    assert.equal(alarms[0].assetId, asset.id);
    assert.equal(alarms[0].deviceId, device.id);
    assert.equal(alarms[0].status, "open");
    assert.equal(alarms[0].context?.metricKey, "environment.temperature");
    assert.deepEqual(alarms[0].context?.metricKeys, ["environment.temperature"]);

    const repeated = await evaluateGenericRule(db, rule, new Date(t1.getTime() + 10_000));
    assert.equal(repeated.opened, 0);
    assert.equal((await db.select().from(schema.alarms)).length, 1);

    const t2 = new Date(t1.getTime() + 20_000);
    await writeLatest(db, { gatewayId: gateway.id, deviceId: device.id, deviceMetricId: metric.id, value: -18, at: t2, key: "r3" });
    assert.equal((await evaluateGenericRule(db, rule, t2)).resolved, 1);
    const [resolved] = await db.select().from(schema.alarms).where(eq(schema.alarms.id, alarms[0].id));
    assert.equal(resolved.status, "resolved");
  } finally {
    await client.close();
  }
});

test("undefined schedule or hysteresis semantics fail closed instead of being ignored", async () => {
  const { client, db, customer, site, device } = await fixture();
  try {
    const [rule] = await db.insert(schema.rules).values({
      clientId: customer.id,
      siteId: site.id,
      name: "Scheduled rule",
      scopeType: "device",
      scopeId: device.id,
      severity: "info",
      expression: { op: "gt", metric: "environment.temperature", value: -15 },
      durationSeconds: 0,
      scheduleId: crypto.randomUUID(),
    }).returning();
    assert.equal((await evaluateGenericRule(db, rule, new Date("2026-10-03T18:00:00.000Z"))).unsupported, 1);
  } finally {
    await client.close();
  }
});


test("telemetry-triggered generic rules evaluate only the affected scope and resolve on recovery", async () => {
  const { client, db, customer, site, asset, device, gateway, metric } = await fixture();
  try {
    await db.insert(schema.rules).values({
      clientId: customer.id,
      siteId: site.id,
      name: "Unrelated device rule",
      scopeType: "device",
      scopeId: crypto.randomUUID(),
      severity: "warning",
      expression: { op: "gt", metric: "environment.temperature", value: -15 },
      durationSeconds: 0,
    });
    await db.insert(schema.rules).values({
      clientId: customer.id,
      siteId: site.id,
      name: "Telemetry rule",
      scopeType: "device",
      scopeId: device.id,
      severity: "critical",
      expression: { op: "gt", metric: "environment.temperature", value: -15 },
      durationSeconds: 0,
    });

    const t0 = new Date("2026-10-03T20:00:00.000Z");
    await writeLatest(db, { gatewayId: gateway.id, deviceId: device.id, deviceMetricId: metric.id, value: -12, at: t0, key: "telemetry-rule-1" });
    const firing = await evaluateGenericRulesForTelemetry(db, {
      siteId: site.id,
      assetId: asset.id,
      deviceId: device.id,
    }, t0);
    assert.equal(firing.evaluatedRules, 1);
    assert.equal(firing.opened, 1);

    const [opened] = await db.select().from(schema.alarms);
    assert.equal(opened.title, "Telemetry rule");
    assert.equal(opened.deviceId, device.id);
    assert.equal(opened.genericRuleId !== null, true);

    const t1 = new Date("2026-10-03T20:01:00.000Z");
    await writeLatest(db, { gatewayId: gateway.id, deviceId: device.id, deviceMetricId: metric.id, value: -18, at: t1, key: "telemetry-rule-2" });
    const recovered = await evaluateGenericRulesForTelemetry(db, {
      siteId: site.id,
      assetId: asset.id,
      deviceId: device.id,
    }, t1);
    assert.equal(recovered.resolved, 1);

    const [resolved] = await db.select().from(schema.alarms).where(eq(schema.alarms.id, opened.id));
    assert.equal(resolved.status, "resolved");
  } finally {
    await client.close();
  }
});

// Portal rules use the same ingestion engine as the laboratory but remain scoped
// to an exact device metric and a versioned recovery contract.
import { listMetricRules, saveMetricRule, MetricRuleError } from "../db/metric-rules";
async function configuredFixture() {
  const f = await fixture();
  const [user] = await f.db.insert(schema.users).values({ email: "rules@example.test", displayName: "Rule engineer" }).returning();
  const actor = { id: user.id, siteId: f.site.id, permissions: ["alarms.read", "settings.write"] };
  const input = { assetId: f.asset.id, deviceMetricId: f.metric.id, name: "Temperature high", enabled: true, severity: "critical", op: "gte", value: 75, durationSeconds: 60, recoveryThreshold: 70, recoverySeconds: 40, staleAfterSeconds: 120 };
  return { ...f, actor, input };
}

test("portal metric rules list unconfigured sensors, isolate devices and enforce permissions/site/asset scope", async () => {
  const f = await configuredFixture();
  try {
    const { db, actor, asset, metric, device, input } = f;
    const before = await listMetricRules(db, actor, asset.id);
    assert.equal(before.metrics.length, 1);
    assert.equal(before.metrics[0].rules.length, 0);
    await assert.rejects(saveMetricRule(db, { ...actor, permissions: ["alarms.read"] }, input), (e) => e instanceof MetricRuleError && e.status === 403);
    await assert.rejects(listMetricRules(db, { ...actor, siteId: crypto.randomUUID() }, asset.id), (e) => e instanceof MetricRuleError && e.status === 404);
    const [otherAsset] = await db.insert(schema.assets).values({ siteId: f.site.id, code: "OTHER", name: "Other" }).returning();
    await assert.rejects(saveMetricRule(db, actor, { ...input, assetId: otherAsset.id }), /no pertenece/);
    await db.insert(schema.userAssetScopes).values({ userId: actor.id, assetId: otherAsset.id });
    await assert.rejects(listMetricRules(db, actor, asset.id), /No tienes acceso/);
    await db.delete(schema.userAssetScopes).where(eq(schema.userAssetScopes.userId, actor.id));
    const first = await saveMetricRule(db, actor, input);
    await saveMetricRule(db, actor, { ...input, name: "Temperature low", op: "lte", value: 10, recoveryThreshold: 15, severity: "warning" });
    const after = await listMetricRules(db, actor, asset.id);
    assert.equal(after.metrics[0].id, metric.id);
    assert.equal(after.metrics[0].rules.length, 2);
    assert.equal(after.metrics[0].rules[0].state, "unevaluated");
    const [otherDevice] = await db.insert(schema.devices).values({ assetId: asset.id, code: "TEMP-02", name: "Second sensor" }).returning();
    const [otherMetric] = await db.insert(schema.deviceMetrics).values({ deviceId: otherDevice.id, metricDefinitionId: metric.metricDefinitionId, code: "TEMP", name: "Temperature" }).returning();
    await assert.rejects(saveMetricRule(db, actor, { ...input, deviceMetricId: otherMetric.id, updatedAt: first.updatedAt }, first.id), /no pertenece/);
    const listed = await listMetricRules(db, actor, asset.id);
    assert.equal(listed.metrics.find((m) => m.deviceId === otherDevice.id)?.rules.length, 0);
    assert.equal(listed.metrics.find((m) => m.deviceId === device.id)?.rules.length, 2);
  } finally { await f.client.close(); }
});

test("managed metric rules require continuous fresh readings, recover with hysteresis and preserve ACK", async () => {
  const f = await configuredFixture();
  try {
    const saved = await saveMetricRule(f.db, f.actor, f.input);
    const [rule] = await f.db.select().from(schema.rules).where(eq(schema.rules.id, saved.id));
    const t0 = new Date("2026-10-09T22:00:00Z");
    const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
    const sample = async (seconds: number, value: number) => {
      await writeLatest(f.db, { gatewayId: f.gateway.id, deviceId: f.device.id, deviceMetricId: f.metric.id, value, at: at(seconds), key: `managed-${seconds}` });
      return evaluateGenericRule(f.db, rule, at(seconds));
    };
    assert.equal((await sample(0, 90)).pending, 1);
    // Re-evaluating the same high sample must not satisfy elapsed persistence.
    assert.equal((await evaluateGenericRule(f.db, rule, at(60))).opened, 0);
    assert.equal((await evaluateGenericRule(f.db, rule, at(121))).skipped, 1);
    assert.equal((await sample(140, 90)).pending, 1);
    assert.equal((await sample(200, 90)).opened, 1);
    const [alarm] = await f.db.select().from(schema.alarms);
    await f.db.update(schema.alarms).set({ status: "acknowledged", acknowledgedAt: at(201), acknowledgedBy: f.actor.id }).where(eq(schema.alarms.id, alarm.id));
    await sample(220, 73); // Below trigger, above recovery: stay in alarm.
    let [observed] = await f.db.select().from(schema.alarms);
    assert.equal(observed.status, "acknowledged");
    await sample(240, 69);
    assert.equal((await evaluateGenericRule(f.db, rule, at(280))).resolved, 0); // old recovery sample
    assert.equal((await sample(280, 69)).resolved, 1);
    [observed] = await f.db.select().from(schema.alarms);
    assert.equal(observed.status, "resolved");
    assert.equal((await sample(300, 90)).pending, 1);
    assert.equal((await sample(360, 90)).reopened, 1);
    assert.equal((await f.db.select().from(schema.alarms)).length, 1);
  } finally { await f.client.close(); }
});

test("managed rules reset gaps and invalid quality; updates retire active alarms and reject stale edits", async () => {
  const f = await configuredFixture();
  try {
    const saved = await saveMetricRule(f.db, f.actor, { ...f.input, durationSeconds: 0 });
    const [rule] = await f.db.select().from(schema.rules).where(eq(schema.rules.id, saved.id));
    const at = new Date("2026-10-09T22:00:00Z");
    await writeLatest(f.db, { gatewayId: f.gateway.id, deviceId: f.device.id, deviceMetricId: f.metric.id, value: 90, at, key: "disable" });
    assert.equal((await evaluateGenericRule(f.db, rule, at)).opened, 1);
    await f.db.update(schema.latestMetricReadings).set({ quality: "bad" }).where(eq(schema.latestMetricReadings.deviceMetricId, f.metric.id));
    assert.equal((await evaluateGenericRule(f.db, rule, at)).skipped, 1);
    assert.equal((await f.db.select().from(schema.alarms))[0].status, "open");
    await assert.rejects(saveMetricRule(f.db, f.actor, { ...f.input, updatedAt: "stale" }, saved.id), /Actualiza/);
    await saveMetricRule(f.db, f.actor, { ...f.input, enabled: false, updatedAt: saved.updatedAt }, saved.id);
    assert.equal((await f.db.select().from(schema.alarms))[0].status, "resolved");
    assert.equal((await f.db.select().from(schema.ruleEvaluationStates)).length, 0);
    assert.equal((await evaluateGenericRule(f.db, rule, at)).opened, 0); // refreshed under lock
    assert.equal((await f.db.select().from(schema.auditLogs)).length, 2);
    await assert.rejects(saveMetricRule(f.db, f.actor, { ...f.input, recoveryThreshold: 80 }), /recuperación/);
    await assert.rejects(saveMetricRule(f.db, f.actor, { ...f.input, value: "90" }), /tipo de métrica/);
    await assert.rejects(saveMetricRule(f.db, f.actor, { ...f.input, name: "LAB-MAIL-reserved" }), /reservado/);
  } finally { await f.client.close(); }
});

test("laboratory and legacy rules remain visible but cannot be modified by the metric editor", async () => {
  const f = await configuredFixture();
  try {
    const [lab] = await f.db.insert(schema.rules).values({ clientId: f.customer.id, siteId: f.site.id, name: "LAB-MAIL-protected", scopeType: "device", scopeId: f.device.id, severity: "critical", expression: { op: "gte", metric: "environment.temperature", value: 75 } }).returning();
    assert.equal((await listMetricRules(f.db, f.actor, f.asset.id)).metrics[0].rules[0].editable, false);
    await assert.rejects(saveMetricRule(f.db, f.actor, { ...f.input, updatedAt: lab.updatedAt.toISOString() }, lab.id), /módulo de origen/);
    const [definition] = await f.db.insert(schema.metricDefinitions).values({ key: "test.running", name: "Running", category: "test", unit: "", dataType: "boolean" }).returning();
    const [metric] = await f.db.insert(schema.deviceMetrics).values({ deviceId: f.device.id, metricDefinitionId: definition.id, code: "RUNNING", name: "Running" }).returning();
    await saveMetricRule(f.db, f.actor, { ...f.input, deviceMetricId: metric.id, op: "eq", value: false, recoveryThreshold: null });
    await assert.rejects(saveMetricRule(f.db, f.actor, { ...f.input, deviceMetricId: metric.id, op: "gte", value: false, recoveryThreshold: null }), /Operador/);
  } finally { await f.client.close(); }
});
