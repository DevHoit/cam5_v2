import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
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
  "0027_rule_alarm_semantics.sql", "0028_area_scope_guards.sql",
];

function errorChainContains(error: unknown, pattern: RegExp): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (current instanceof Error) {
      if (pattern.test(current.message)) return true;
      current = (current as Error & { cause?: unknown }).cause;
      continue;
    }
    return pattern.test(String(current));
  }
  return false;
}

async function setup() {
  const client = new PGlite();
  for (const filename of migrations) {
    const sql = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  return { client, db: drizzle(client, { schema }) as unknown as Cam5Database };
}

test("areas cannot cross tenant boundaries through their site or parent", async () => {
  const { client, db } = await setup();
  try {
    const [a, b] = await db.insert(schema.clients).values([
      { code: "A", name: "Client A" },
      { code: "B", name: "Client B" },
    ]).returning();
    const [siteA, siteB] = await db.insert(schema.sites).values([
      { clientId: a.id, code: "A1", name: "Site A" },
      { clientId: b.id, code: "B1", name: "Site B" },
    ]).returning();

    await assert.rejects(
      db.insert(schema.areas).values({ clientId: a.id, siteId: siteB.id, code: "BAD", name: "Bad Area" }),
      (error: unknown) => errorChainContains(error, /Area client_id must match/),
    );

    const [areaA] = await db.insert(schema.areas).values({ clientId: a.id, siteId: siteA.id, code: "A-ROOT", name: "Root A" }).returning();
    await assert.rejects(
      db.insert(schema.areas).values({
        clientId: b.id,
        siteId: siteB.id,
        parentAreaId: areaA.id,
        code: "B-CHILD",
        name: "Invalid child",
      }),
      (error: unknown) => errorChainContains(error, /Parent area must belong/),
    );
  } finally {
    await client.close();
  }
});

test("assets cannot reference an area from another site", async () => {
  const { client, db } = await setup();
  try {
    const [customer] = await db.insert(schema.clients).values({ code: "C", name: "Client C" }).returning();
    const [site1, site2] = await db.insert(schema.sites).values([
      { clientId: customer.id, code: "S1", name: "Site 1" },
      { clientId: customer.id, code: "S2", name: "Site 2" },
    ]).returning();
    const [area1] = await db.insert(schema.areas).values({ clientId: customer.id, siteId: site1.id, code: "A1", name: "Area 1" }).returning();

    await assert.rejects(
      db.insert(schema.assets).values({
        siteId: site2.id,
        areaId: area1.id,
        code: "ASSET-X",
        name: "Cross-site asset",
        assetType: "generic",
      }),
      (error: unknown) => errorChainContains(error, /Asset area_id must belong to the same site/),
    );
  } finally {
    await client.close();
  }
});
