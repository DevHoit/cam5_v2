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
