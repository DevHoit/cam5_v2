import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { buildSpecGatewayConfig, hasSpecGatewayConfig } from "../app/api/v1/gateway/_lib/config-spec-v1";
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
  "0024_notification_suppressed_status.sql", "0025_rs485_bus_addressing.sql",
];

async function fixture() {
  const client = new PGlite();
  for (const filename of migrations) {
    const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  const db = drizzle(client, { schema }) as unknown as Cam5Database;
  const [tenant] = await db.insert(schema.clients).values({ code: "CFG", name: "Config" }).returning();
  const [site] = await db.insert(schema.sites).values({ clientId: tenant.id, code: "CFG-S", name: "Config Site" }).returning();
  const [asset] = await db.insert(schema.assets).values({ siteId: site.id, code: "ATS-01", name: "ATS", assetType: "ats" }).returning();
  const [gateway] = await db.insert(schema.gateways).values({ siteId: site.id, code: "GW-DSE-01", name: "GW DSE" }).returning();
  return { client, db, site, asset, gateway };
}

test("builds the HOIT SPEC v0.4 Cloud-to-Gateway config for a shared DSE RS-485 bus", async () => {
  const { client, db, site, asset, gateway } = await fixture();
  try {
    for (const [index, code] of ["DSE-01", "DSE-02"].entries()) {
      const [device] = await db.insert(schema.devices).values({
        assetId: asset.id,
        code,
        name: code,
        deviceType: "ats_controller",
        driver: "dse8660_mkii",
        protocol: "modbus_rtu",
        state: "commissioning",
      }).returning();
      await db.insert(schema.gatewayDeviceBindings).values({
        gatewayId: gateway.id,
        deviceId: device.id,
        interfaceType: "rs485",
        interfaceKey: "rs485-1",
        address: index + 1,
        baudRate: 19200,
        parity: "none",
        dataBits: 8,
        stopBits: 1,
        config: {
          port: "/dev/ttyS1",
          poll_profile: "dse8660_default",
          pollIntervalMs: 1000,
          readOnly: true,
        },
      });
    }

    assert.equal(await hasSpecGatewayConfig(db, gateway.id), true);
    const payload = await buildSpecGatewayConfig(db, {
      gatewayId: gateway.id,
      gatewayCode: gateway.code,
      siteId: site.id,
    });

    assert.equal(payload.schema_version, "1.0");
    assert.equal(payload.gateway_id, "GW-DSE-01");
    assert.equal(payload.upload.interval_seconds, 5);
    assert.equal(payload.upload.max_batch_samples, 100);
    assert.equal(payload.devices.length, 2);
    assert.equal(payload.devices[0].driver, "dse8660");
    assert.deepEqual(payload.devices[0].transport, {
      type: "modbus_rtu",
      port: "/dev/ttyS1",
      baud: 19200,
      parity: "N",
      stop_bits: 1,
      slave_id: 1,
    });
    assert.equal(payload.devices[0].poll_profile, "dse8660_default");
    assert.ok(Number.isSafeInteger(payload.config_version));
  } finally {
    await client.close();
  }
});

test("refuses to emit an ambiguous RS-485 contract when the physical Linux port is missing", async () => {
  const { client, db, site, asset, gateway } = await fixture();
  try {
    const [device] = await db.insert(schema.devices).values({
      assetId: asset.id,
      code: "PM-01",
      name: "PM-01",
      deviceType: "power_meter",
      driver: "schneider_pm5560",
      protocol: "modbus_rtu",
      state: "commissioning",
    }).returning();
    await db.insert(schema.gatewayDeviceBindings).values({
      gatewayId: gateway.id,
      deviceId: device.id,
      interfaceType: "rs485",
      interfaceKey: "rs485-1",
      address: 1,
      baudRate: 19200,
      parity: "even",
      dataBits: 8,
      stopBits: 1,
      config: { pollIntervalMs: 1000, readOnly: true },
    });

    await assert.rejects(
      buildSpecGatewayConfig(db, { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: site.id }),
      (error: unknown) => error instanceof ApiError && error.status === 409 && /puerto Linux/.test(error.message),
    );
  } finally {
    await client.close();
  }
});

test("builds BLE transport from the normalized Eddystone identity", async () => {
  const { client, db, site, asset, gateway } = await fixture();
  try {
    const [device] = await db.insert(schema.devices).values({
      assetId: asset.id,
      code: "TEMP-01",
      name: "TEMP-01",
      deviceType: "temperature_sensor",
      driver: "eddystone_tlm",
      protocol: "ble",
      state: "commissioning",
    }).returning();
    await db.insert(schema.gatewayDeviceBindings).values({
      gatewayId: gateway.id,
      deviceId: device.id,
      interfaceType: "ble",
      config: {
        protocol: "eddystone_tlm",
        namespace_id: "6B6B6D636E2E636FD01",
        instance_id: "000000000001",
      },
    });

    const payload = await buildSpecGatewayConfig(db, {
      gatewayId: gateway.id,
      gatewayCode: gateway.code,
      siteId: site.id,
    });
    assert.equal(payload.devices[0].driver, "ble_eddystone_tlm");
    assert.deepEqual(payload.devices[0].transport, {
      type: "ble",
      protocol: "eddystone_tlm",
      identity: {
        namespace_id: "6B6B6D636E2E636FD01",
        instance_id: "000000000001",
      },
    });
  } finally {
    await client.close();
  }
});
