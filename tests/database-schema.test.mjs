import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const expectedTables = [
  "alarm_events",
  "alarm_rules",
  "alarm_rule_states",
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
    for (const filename of ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql", "0005_milky_caretaker.sql", "0006_smiling_frightful_four.sql", "0007_big_frightful_four.sql", "0008_sloppy_mister_sinister.sql"]) {
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

    const alarmStatuses = await database.query(`
      select e.enumlabel
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname = 'alarm_status'
      order by e.enumsortorder
    `);
    assert.deepEqual(alarmStatuses.rows.map((row) => row.enumlabel), ["open", "acknowledged", "resolved", "closed"]);

    const alarmColumns = await database.query(`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'alarms'
        and column_name in ('kind', 'assigned_to', 'resolved_at', 'resolved_by')
      order by column_name
    `);
    assert.deepEqual(alarmColumns.rows.map((row) => row.column_name), ["assigned_to", "kind", "resolved_at", "resolved_by"]);

    const deliveryColumns = await database.query(`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'notification_deliveries'
        and column_name in ('policy_id', 'alarm_event_id', 'event_type', 'subject', 'payload', 'next_attempt_at', 'max_attempts', 'dedupe_key')
      order by column_name
    `);
    assert.deepEqual(deliveryColumns.rows.map((row) => row.column_name), ["alarm_event_id", "dedupe_key", "event_type", "max_attempts", "next_attempt_at", "payload", "policy_id", "subject"]);

    const reportRunColumns = await database.query(`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'report_runs'
        and column_name in ('title', 'format', 'payload')
      order by column_name
    `);
    assert.deepEqual(reportRunColumns.rows, [
      { column_name: "format", is_nullable: "NO" },
      { column_name: "payload", is_nullable: "NO" },
      { column_name: "title", is_nullable: "NO" },
    ]);

    const diagnosticColumns = await database.query(`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'ingestion_batches'
        and column_name in ('gateway_boot_id', 'gateway_sequence', 'gateway_uptime_seconds', 'sent_at', 'received_at', 'good_registers', 'stale_registers', 'bad_registers')
      order by column_name
    `);
    assert.deepEqual(diagnosticColumns.rows.map((row) => row.column_name), ["bad_registers", "gateway_boot_id", "gateway_sequence", "gateway_uptime_seconds", "good_registers", "received_at", "sent_at", "stale_registers"]);

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

    const operationalActiveColumns = await database.query(`
      select table_name
      from information_schema.columns
      where table_schema = 'public' and column_name = 'active'
        and table_name in ('assets', 'gateways', 'devices')
      order by table_name
    `);
    assert.deepEqual(operationalActiveColumns.rows.map((row) => row.table_name), ["assets", "devices", "gateways"]);
  } finally {
    await database.close();
  }
});
