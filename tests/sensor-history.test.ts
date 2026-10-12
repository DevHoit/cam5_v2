import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { Cam5Database } from "../db/index";
import * as schema from "../db/schema";
import { sensorCatalog, saveSensors } from "../db/sensor-installation";
import { sensorInstalled, historyCsv } from "../db/sensor-contract";
import { wideHistory } from "../db/wide-history";
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


test("installed sensors, wide rows, pagination, typed cells, aggregation, CSV and access isolation", async () => {
  const f = await fixture();
  try {
    const [user] = await f.db.insert(schema.users).values({ email: "sensor-test@example.invalid", displayName: "Lab" }).returning();
    const actor = { id: user.id, siteId: f.site.id, permissions: ["history.read", "history.export", "settings.write"] };
    const [def] = await f.db.insert(schema.metricDefinitions).values({ key: "lab.humidity", name: "Humidity", category: "environment", unit: "%", dataType: "float" }).returning();
    const [m2] = await f.db.insert(schema.deviceMetrics).values({ deviceId: f.device.id, metricDefinitionId: def.id, code: "H01", name: "Humidity" }).returning();
    const save = (updatedAt: string, installed: boolean) => saveSensors(f.db, actor, { assetId: f.asset.id, deviceId: f.device.id, updatedAt, sensors: [{ id: f.metric.id, installed: true, alias: "Borne A" }, { id: m2.id, installed, alias: "Humedad" }] });
    const saved = await save(f.device.updatedAt.toISOString(), false);
    await assert.rejects(save(f.device.updatedAt.toISOString(), true), /cambió/);
    let cat = await sensorCatalog(f.db, actor, f.asset.id);
    assert.equal(cat.filter((r) => sensorInstalled(r.metric.metadata, r.device.metadata)).length, 1);
    assert.equal(cat[0].metric.enabled, true, "installation does not disable ingestion");
    const saved2 = await save(saved.updatedAt, true);
    const [def3] = await f.db.insert(schema.metricDefinitions).values({ key: "lab.state", name: "State", category: "environment", unit: "", dataType: "boolean" }).returning();
    const [m3] = await f.db.insert(schema.deviceMetrics).values({ deviceId: f.device.id, metricDefinitionId: def3.id, code: "STATE", name: "State" }).returning();
    cat = await sensorCatalog(f.db, actor, f.asset.id);
    assert.equal(sensorInstalled(cat.find((r) => r.metric.id === m3.id)!.metric.metadata, cat[0].device.metadata), false, "new metrics await confirmation");
    await saveSensors(f.db, actor, { assetId: f.asset.id, deviceId: f.device.id, updatedAt: saved2.updatedAt, sensors: cat.map((r) => ({ id: r.metric.id, installed: true, alias: r.metric.id === f.metric.id ? "=unsafe" : r.metric.name })) });
    const at = new Date("2026-10-12T10:00:00Z");
    async function batch(key: string, time: Date, values: Array<{ id: string; value: number | boolean; quality?: "good" | "bad" }>) {
      const [b] = await f.db.insert(schema.telemetryBatches).values({ gatewayId: f.gateway.id, deviceId: f.device.id, batchKey: key, gatewayBootId: "test", gatewaySequence: 1, sentAt: time, sampledAt: time, metricCount: values.length }).returning();
      for (const v of values) await f.db.insert(schema.metricReadings).values({ batchId: b.id, deviceMetricId: v.id, recordedAt: time, quality: v.quality ?? "good", valueNumeric: typeof v.value === "number" ? String(v.value) : null, valueBoolean: typeof v.value === "boolean" ? v.value : null });
    }
    await batch("one", at, [{ id: f.metric.id, value: 0 }, { id: m2.id, value: 80 }, { id: m3.id, value: false }]);
    await batch("two", at, [{ id: f.metric.id, value: 20 }]);
    await batch("three", new Date(+at + 20000), [{ id: f.metric.id, value: 100, quality: "bad" }]);
    const params = new URLSearchParams({ assetId: f.asset.id, from: "2026-10-12T09:00:00Z", to: "2026-10-12T12:00:00Z" });
    const raw = await wideHistory(f.db, actor, params);
    assert.equal(raw.rows.length, 3, "separate batches at identical time stay separate");
    const full = raw.rows.find((r) => Object.keys(r.cells).length === 3)!;
    assert.equal(full.cells[f.metric.id].value, 0);
    assert.equal(full.cells[m3.id].value, false);
    assert.equal(raw.rows.find((r) => r.cells[f.metric.id].value === 20)!.cells[m2.id], undefined);
    assert.ok(historyCsv(raw).includes("=unsafe"));
    assert.ok(historyCsv({ ...raw, rows: [{ ...full, deviceName: "=unsafe" }] }).includes("'=unsafe"));
    params.set("mode", "minute");
    const grouped = await wideHistory(f.db, actor, params);
    assert.equal(grouped.rows.length, 1);
    assert.equal(grouped.rows[0].cells[f.metric.id].value, 10, "invalid readings excluded from mean");
    assert.equal(grouped.rows[0].cells[f.metric.id].quality, "partial");
    assert.equal(grouped.rows[0].cells[m3.id].value, false);
    params.set("aggregation", "max");
    assert.equal((await wideHistory(f.db, actor, params)).rows[0].cells[f.metric.id].value, 20);
    params.set("mode", "raw"); params.set("columns", `${m3.id},${m2.id}`);
    const selected = await wideHistory(f.db, actor, params);
    assert.deepEqual(selected.columns.map((c) => c.id), [m3.id, m2.id]);
    assert.equal(selected.rows.length, 1);
    await assert.rejects(wideHistory(f.db, { ...actor, siteId: crypto.randomUUID() }, params), /disponible/);
    await assert.rejects(wideHistory(f.db, { ...actor, permissions: ["history.read"] }, params, true), /permiso/);
    await assert.rejects(saveSensors(f.db, { ...actor, permissions: [] }, {}), /permiso/);
    await f.db.insert(schema.userAssetScopes).values({ userId: user.id, assetId: f.asset.id });
    const [asset2] = await f.db.insert(schema.assets).values({ siteId: f.site.id, code: "SECOND", name: "Second" }).returning();
    await assert.rejects(sensorCatalog(f.db, actor, asset2.id), /acceso/);
    params.delete("columns");
    for (let i = 0; i < 100; i++) await batch(`page-${i}`, new Date(+at + 60000 + i * 1000), [{ id: f.metric.id, value: i }, { id: m2.id, value: 50 }]);
    const first = await wideHistory(f.db, actor, params);
    assert.equal(first.rows.length, 100); assert.equal(first.hasMore, true);
    assert.ok(first.rows.every((r) => Object.keys(r.cells).length === 2));
    params.set("page", "2"); const second = await wideHistory(f.db, actor, params);
    assert.equal(second.rows.length, 3); assert.equal(second.hasMore, false);
    assert.ok(!second.rows.some((r) => first.rows.some((x) => x.id === r.id)));
    const [rule] = await f.db.insert(schema.rules).values({ clientId: f.customer.id, siteId: f.site.id, name: "Humidity alarm", severity: "warning", scopeType: "device", scopeId: f.device.id, expression: { op: "gte", metric: def.key, value: 80 }, enabled: true }).returning();
    cat = await sensorCatalog(f.db, actor, f.asset.id);
    await assert.rejects(saveSensors(f.db, actor, { assetId: f.asset.id, deviceId: f.device.id, updatedAt: cat[0].device.updatedAt.toISOString(), sensors: cat.map((r) => ({ id: r.metric.id, installed: r.metric.id !== m2.id, alias: r.metric.name })) }), /Desactiva/);
    await f.db.update(schema.rules).set({ enabled: false }).where(eq(schema.rules.id, rule.id));
  } finally { await f.client.close(); }
});
