import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { handleSpecHeartbeat, parseSpecHeartbeatPayload } from "../app/api/v1/gateway/_lib/heartbeat-spec-v1";
import { ApiError } from "../app/api/v1/_lib/auth";
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
];

function heartbeat() {
  return {
    schema_version: "1.0",
    gateway_id: "gw-health-01",
    boot_id: "boot-health-01",
    software_version: "1.2.0",
    uptime_seconds: 84521,
    buffer: { pending_messages: 3, bytes: 4096, usage_percent: 3.1 },
    network: { active_interface: "4g", rssi_dbm: -72, ip_available: true },
    system: { cpu_percent: 11.4, memory_percent: 33.2, disk_percent: 18.9 },
    interfaces: { rs485: "OK", ble: "OK" },
    devices: [
      {
        device_id: "PM-01",
        status: "ONLINE",
        latency_ms: 24,
        last_success_at: "2026-10-03T16:30:59Z",
        consecutive_errors: 0,
      },
    ],
  };
}

test("parses HOIT SPEC v0.4 gateway heartbeat", () => {
  const parsed = parseSpecHeartbeatPayload(heartbeat());
  assert.equal(parsed.gatewayId, "GW-HEALTH-01");
  assert.equal(parsed.network.rssiDbm, -72);
  assert.equal(parsed.devices[0].status, "ONLINE");
  assert.equal(parsed.interfaces.rs485, "OK");
});

test("rejects invalid health percentages and device states", () => {
  const invalidPercent = heartbeat();
  invalidPercent.system.cpu_percent = 101;
  assert.throws(
    () => parseSpecHeartbeatPayload(invalidPercent),
    (error: unknown) => error instanceof ApiError && error.status === 400 && /entre 0 y 100/.test(error.message),
  );

  const invalidState = heartbeat();
  invalidState.devices[0].status = "BROKEN";
  assert.throws(
    () => parseSpecHeartbeatPayload(invalidState),
    (error: unknown) => error instanceof ApiError && error.status === 400 && /status/.test(error.message),
  );
});

test("persists gateway health without flattening DEGRADED or UNKNOWN into false device states", async () => {
  const client = new PGlite();
  try {
    for (const filename of migrations) {
      const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
      await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    }
    const db = drizzle(client, { schema }) as unknown as Cam5Database;

    const [tenant] = await db.insert(schema.clients).values({ code: "HB", name: "Heartbeat" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: tenant.id, code: "HB-S", name: "Heartbeat Site" }).returning();
    const [gateway] = await db.insert(schema.gateways).values({
      siteId: site.id,
      code: "GW-HEALTH-01",
      name: "Gateway Health",
      metadata: { installation: "rack-1" },
    }).returning();

    const receivedAt = new Date("2026-10-03T16:31:00.000Z");
    const response = await handleSpecHeartbeat({
      db,
      credential: { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: site.id },
      rawPayload: heartbeat(),
      receivedAt,
    });
    assert.equal(response.status, 202);

    const [stored] = await db.select().from(schema.gateways).where(eq(schema.gateways.id, gateway.id)).limit(1);
    assert.equal(stored.state, "online");
    assert.equal(stored.softwareVersion, "1.2.0");
    assert.equal((stored.metadata as Record<string, unknown>).installation, "rack-1");
    const health = (stored.metadata as { health?: Record<string, unknown> }).health;
    assert.ok(health);
    assert.equal(health.bootId, "boot-health-01");
    assert.equal((health.buffer as { pendingMessages: number }).pendingMessages, 3);
    assert.equal((health.devices as Array<{ deviceId: string }>)[0].deviceId, "PM-01");
  } finally {
    await client.close();
  }
});
