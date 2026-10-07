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
  "0027_rule_alarm_semantics.sql",
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
