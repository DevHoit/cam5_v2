import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const expectedTables = [
  "alarm_events",
  "alarm_rules",
  "alarms",
  "assets",
  "audit_logs",
  "auth_identities",
  "auth_sessions",
  "channels",
  "clients",
  "commissioning_items",
  "configuration_snapshots",
  "device_models",
  "device_register_samples",
  "devices",
  "gateway_api_credentials",
  "gateways",
  "ingestion_batches",
  "integrations",
  "latest_readings",
  "notification_endpoints",
  "notification_deliveries",
  "notification_policies",
  "permissions",
  "physical_inputs",
  "reading_profile_ranges",
  "reading_profiles",
  "reading_aggregates",
  "readings",
  "register_definitions",
  "relay_configurations",
  "report_runs",
  "report_schedules",
  "report_templates",
  "role_permissions",
  "roles",
  "sites",
  "user_asset_scopes",
  "user_client_assignments",
  "user_invitations",
  "user_role_assignments",
  "users",
  "work_order_alarms",
  "work_orders",
].sort();

test("applies the CAM5 PostgreSQL migration with access profiles and telemetry constraints", async () => {
  const database = new PGlite();
  try {
    for (const filename of ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
      await database.exec(migration.replaceAll("--> statement-breakpoint", ""));
    }

    const tableResult = await database.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `);
    assert.deepEqual(tableResult.rows.map((row) => row.table_name), expectedTables);

    const enumResult = await database.query(`
      select count(distinct t.typname)::int as count
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typtype = 'e'
    `);
    assert.equal(enumResult.rows[0].count, 19);

    await assert.rejects(
      database.query(`
        insert into reading_profiles
          (key, name, stale_after_seconds, raw_retention_days, aggregate_retention_days)
        values ('invalid', 'Inválido', 0, 0, 0)
      `),
      /reading_profiles_(stale|retention)_positive_chk/,
    );

    const accessTables = ["users", "roles", "permissions", "role_permissions", "user_client_assignments", "user_role_assignments", "user_asset_scopes"];
    for (const table of accessTables) assert.ok(expectedTables.includes(table), `Falta la tabla de acceso ${table}`);

    const siteColumns = await database.query(`
      select is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'sites' and column_name = 'client_id'
    `);
    assert.equal(siteColumns.rows[0]?.is_nullable, "NO");
  } finally {
    await database.close();
  }
});
