import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Cam5Database } from "../db/index";
import {
  listMaintenanceWindowsForSite,
  maintenanceWindowStatus,
  resolveMaintenanceScope,
} from "../db/maintenance-window-service";
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
];

async function fixture() {
  const client = new PGlite();
  for (const filename of migrations) {
    const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return { client, db: drizzle(client, { schema }) as unknown as Cam5Database };
}

test("maintenance scopes cannot cross the active client or site boundary", async () => {
  const { client, db } = await fixture();
  try {
    const [clientA] = await db.insert(schema.clients).values({ code: "MA", name: "Maintenance A" }).returning();
    const [clientB] = await db.insert(schema.clients).values({ code: "MB", name: "Maintenance B" }).returning();
    const [siteA] = await db.insert(schema.sites).values({ clientId: clientA.id, code: "MA-1", name: "MA-1" }).returning();
    const [siteA2] = await db.insert(schema.sites).values({ clientId: clientA.id, code: "MA-2", name: "MA-2" }).returning();
    const [siteB] = await db.insert(schema.sites).values({ clientId: clientB.id, code: "MB-1", name: "MB-1" }).returning();
    const [areaA] = await db.insert(schema.areas).values({ clientId: clientA.id, siteId: siteA.id, code: "AREA-A", name: "Área A" }).returning();
    const [assetA] = await db.insert(schema.assets).values({ siteId: siteA.id, areaId: areaA.id, code: "AS-A", name: "Asset A" }).returning();
    const [assetA2] = await db.insert(schema.assets).values({ siteId: siteA2.id, code: "AS-A2", name: "Asset A2" }).returning();
    const [deviceA] = await db.insert(schema.devices).values({
      assetId: assetA.id, code: "DEV-A", name: "Device A",
      deviceType: "generic", driver: "generic", protocol: "virtual",
    }).returning();

    assert.ok(await resolveMaintenanceScope(db, {
      clientId: clientA.id, siteId: siteA.id, scopeType: "tenant", scopeId: clientA.id,
    }));
    assert.ok(await resolveMaintenanceScope(db, {
      clientId: clientA.id, siteId: siteA.id, scopeType: "area", scopeId: areaA.id,
    }));
    assert.ok(await resolveMaintenanceScope(db, {
      clientId: clientA.id, siteId: siteA.id, scopeType: "device", scopeId: deviceA.id,
    }));
    assert.equal(await resolveMaintenanceScope(db, {
      clientId: clientA.id, siteId: siteA.id, scopeType: "asset", scopeId: assetA2.id,
    }), null);
    assert.equal(await resolveMaintenanceScope(db, {
      clientId: clientA.id, siteId: siteA.id, scopeType: "site", scopeId: siteB.id,
    }), null);
    assert.equal(await resolveMaintenanceScope(db, {
      clientId: clientA.id, siteId: siteA.id, scopeType: "tenant", scopeId: clientB.id,
    }), null);
  } finally {
    await client.close();
  }
});

test("site maintenance listing contains only windows that can affect that active site", async () => {
  const { client, db } = await fixture();
  try {
    const [customer] = await db.insert(schema.clients).values({ code: "LIST", name: "List" }).returning();
    const [siteA] = await db.insert(schema.sites).values({ clientId: customer.id, code: "L-A", name: "L-A" }).returning();
    const [siteB] = await db.insert(schema.sites).values({ clientId: customer.id, code: "L-B", name: "L-B" }).returning();
    const [area] = await db.insert(schema.areas).values({ clientId: customer.id, siteId: siteA.id, code: "AREA", name: "Area" }).returning();
    const [asset] = await db.insert(schema.assets).values({ siteId: siteA.id, areaId: area.id, code: "ASSET", name: "Asset" }).returning();
    const [device] = await db.insert(schema.devices).values({
      assetId: asset.id, code: "DEV", name: "Device",
      deviceType: "generic", driver: "generic", protocol: "virtual",
    }).returning();

    const startsAt = new Date("2026-10-03T18:00:00.000Z");
    const endsAt = new Date("2026-10-03T20:00:00.000Z");
    await db.insert(schema.maintenanceWindows).values([
      { clientId: customer.id, scopeType: "tenant", scopeId: customer.id, startsAt, endsAt, reason: "tenant" },
      { clientId: customer.id, scopeType: "site", scopeId: siteA.id, startsAt, endsAt, reason: "site-a" },
      { clientId: customer.id, scopeType: "site", scopeId: siteB.id, startsAt, endsAt, reason: "site-b" },
      { clientId: customer.id, scopeType: "area", scopeId: area.id, startsAt, endsAt, reason: "area" },
      { clientId: customer.id, scopeType: "asset", scopeId: asset.id, startsAt, endsAt, reason: "asset" },
      { clientId: customer.id, scopeType: "device", scopeId: device.id, startsAt, endsAt, reason: "device" },
    ]);

    const rows = await listMaintenanceWindowsForSite(db, { clientId: customer.id, siteId: siteA.id });
    assert.deepEqual(new Set(rows.map((row) => row.reason)), new Set(["tenant", "site-a", "area", "asset", "device"]));
    assert.equal(rows.some((row) => row.reason === "site-b"), false);

    const sample = rows.find((row) => row.reason === "asset");
    assert.ok(sample);
    assert.equal(maintenanceWindowStatus(sample, new Date("2026-10-03T17:00:00.000Z")), "scheduled");
    assert.equal(maintenanceWindowStatus(sample, new Date("2026-10-03T19:00:00.000Z")), "active");
    assert.equal(maintenanceWindowStatus(sample, new Date("2026-10-03T21:00:00.000Z")), "expired");
  } finally {
    await client.close();
  }
});
