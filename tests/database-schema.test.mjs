import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const expectedTables = [
  "alarm_events",
  "areas",
  "escalation_jobs",
  "escalation_levels",
  "escalation_policies",
  "maintenance_windows",
  "on_call_assignments",
  "rule_evaluation_states",
  "rules",
  "shift_schedules",
  "shifts",
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
  "device_capabilities",
  "device_metrics",
  "device_models",
  "device_register_samples",
  "devices",
  "gateway_api_credentials",
  "gateway_device_bindings",
  "gateways",
  "ingestion_batches",
  "integrations",
  "latest_metric_readings",
  "latest_readings",
  "metric_definitions",
  "metric_reading_aggregates",
  "metric_readings",
  "notification_endpoints",
  "notification_deliveries",
  "notification_policies",
  "operational_condition_states",
  "password_reset_tokens",
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
  "telemetry_batches",
  "user_asset_scopes",
  "user_channel_preferences",
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
    for (const filename of ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql", "0005_milky_caretaker.sql", "0006_smiling_frightful_four.sql", "0007_big_frightful_four.sql", "0008_sloppy_mister_sinister.sql", "0009_cuddly_infant_terrible.sql", "0010_robust_wallop.sql", "0011_dear_prima.sql", "0012_hoit_core_foundation.sql", "0013_hoit_generic_telemetry.sql", "0014_generic_device_transport.sql", "0015_operational_condition_states.sql", "0016_cold_chain_report_template.sql", "0017_generic_metric_aggregates.sql", "0018_pm5560_metric_catalog.sql", "0019_nullable_device_gateway_site_guard.sql", "0020_electrical_report_template.sql", "0021_dse8660_metric_catalog.sql", "0022_ats_report_template.sql", "0023_access_scope_roles.sql", "0024_notification_suppressed_status.sql", "0025_rs485_bus_addressing.sql", "0026_hoit_v1_control_plane.sql", "0027_rule_alarm_semantics.sql"]) {
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
    assert.deepEqual(alarmStatuses.rows.map((row) => row.enumlabel), ["open", "acknowledged", "resolved", "closed", "suppressed"]);

    const severities = await database.query(`
      select e.enumlabel
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname = 'severity'
      order by e.enumsortorder
    `);
    assert.deepEqual(severities.rows.map((row) => row.enumlabel), ["normal", "info", "warning", "critical"]);

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

    const authColumns = await database.query(`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'auth_identities' and column_name = 'must_change_password')
          or (table_name = 'password_reset_tokens' and column_name in ('token_hash', 'expires_at', 'used_at')))
      order by table_name, column_name
    `);
    assert.deepEqual(authColumns.rows, [
      { column_name: "must_change_password", is_nullable: "NO" },
      { column_name: "expires_at", is_nullable: "NO" },
      { column_name: "token_hash", is_nullable: "NO" },
      { column_name: "used_at", is_nullable: "YES" },
    ]);

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

    const profilePolicyColumns = await database.query(`
      select column_name, column_default, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'reading_profiles'
        and column_name in ('storage_interval_seconds', 'heartbeat_interval_seconds', 'diagnostic_interval_seconds')
      order by column_name
    `);
    assert.deepEqual(profilePolicyColumns.rows, [
      { column_name: "diagnostic_interval_seconds", column_default: "300", is_nullable: "NO" },
      { column_name: "heartbeat_interval_seconds", column_default: "30", is_nullable: "NO" },
      { column_name: "storage_interval_seconds", column_default: "60", is_nullable: "NO" },
    ]);

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

    const v1ControlPlaneTables = ["areas", "rules", "rule_evaluation_states", "maintenance_windows", "escalation_policies", "escalation_levels", "escalation_jobs", "shifts", "shift_schedules", "on_call_assignments"];
    for (const table of v1ControlPlaneTables) assert.ok(expectedTables.includes(table), `Falta la tabla HOIT V1 ${table}`);

    const normalizedScopeColumns = await database.query(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'assets' and column_name = 'area_id')
          or (table_name = 'alarms' and column_name in ('device_id', 'generic_rule_id')))
      order by table_name, column_name
    `);
    assert.deepEqual(normalizedScopeColumns.rows, [
      { table_name: "alarms", column_name: "device_id" },
      { table_name: "alarms", column_name: "generic_rule_id" },
      { table_name: "assets", column_name: "area_id" },
    ]);

    const controlClientResult = await database.query(`insert into clients (code, name) values ('CTRL', 'Control') returning id`);
    const controlClient = controlClientResult.rows[0];
    const controlSiteResult = await database.query(`insert into sites (client_id, code, name) values ('${controlClient.id}', 'CTRL-01', 'Control') returning id`);
    const controlSite = controlSiteResult.rows[0];
    await assert.rejects(
      database.query(`
        insert into maintenance_windows (client_id, scope_type, scope_id, starts_at, ends_at, reason)
        values ('${controlClient.id}', 'site', '${controlSite.id}', '2026-10-03T10:00:00Z', '2026-10-03T09:00:00Z', 'Inválida')
      `),
      /maintenance_windows_time_chk/,
    );

    const operationalActiveColumns = await database.query(`
      select table_name
      from information_schema.columns
      where table_schema = 'public' and column_name = 'active'
        and table_name in ('assets', 'gateways', 'devices')
      order by table_name
    `);
    assert.deepEqual(operationalActiveColumns.rows.map((row) => row.table_name), ["assets", "devices", "gateways"]);

    const genericDeviceColumns = await database.query(`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'devices'
        and column_name in ('device_type', 'driver', 'metadata')
      order by column_name
    `);
    assert.deepEqual(genericDeviceColumns.rows, [
      { column_name: "device_type", is_nullable: "NO" },
      { column_name: "driver", is_nullable: "NO" },
      { column_name: "metadata", is_nullable: "NO" },
    ]);

    const genericFoundationTables = ["device_capabilities", "device_metrics", "gateway_device_bindings", "metric_definitions"];
    for (const table of genericFoundationTables) assert.ok(expectedTables.includes(table), `Falta la tabla HOIT genérica ${table}`);

    await assert.rejects(
      database.query(`
        insert into metric_definitions (key, name, category, unit, data_type, aggregation)
        values ('invalid.metric', 'Inválida', 'test', 'x', 'binary', 'last')
      `),
      /metric_definitions_data_type_chk/,
    );

    const genericTelemetryTables = ["telemetry_batches", "metric_readings", "latest_metric_readings"];
    for (const table of genericTelemetryTables) assert.ok(expectedTables.includes(table), `Falta la tabla de telemetría HOIT ${table}`);

    await assert.rejects(
      database.query(`
        insert into telemetry_batches
          (gateway_id, device_id, batch_key, gateway_boot_id, gateway_sequence, sent_at, sampled_at, quality, time_quality, metric_count)
        values
          ('00000000-0000-0000-0000-000000000001',
           '00000000-0000-0000-0000-000000000002',
           'invalid', 'boot', 1, now(), now(), 'good', 'future', 1)
      `),
      /(foreign key|telemetry_batches_time_quality_chk)/i,
    );
  } finally {
    await database.close();
  }
});
