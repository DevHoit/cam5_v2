import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
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
  "0024_notification_suppressed_status.sql",
  "0025_rs485_bus_addressing.sql",
];

async function database() {
  const client = new PGlite();
  for (const filename of migrations) {
    const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return { client, db: drizzle(client, { schema }) };
}

test("RS485 address uniqueness is scoped by gateway and physical bus", async () => {
  const { client, db } = await database();
  try {
    const [owner] = await db.insert(schema.clients).values({ code: "RS485", name: "RS485" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: owner.id, code: "RS485-SITE", name: "RS485 Site" }).returning();
    const [asset] = await db.insert(schema.assets).values({ siteId: site.id, code: "ASSET-RS", name: "RS485 Asset" }).returning();
    const [gateway] = await db.insert(schema.gateways).values({ siteId: site.id, code: "GW-RS", name: "Gateway RS485" }).returning();

    const makeDevice = async (code: string, unitId: number) => {
      const [device] = await db.insert(schema.devices).values({
        assetId: asset.id,
        code,
        name: code,
        protocol: "modbus_rtu",
        unitId,
      }).returning();
      return device;
    };

    const first = await makeDevice("DEV-1", 7);
    await db.insert(schema.gatewayDeviceBindings).values({
      gatewayId: gateway.id,
      deviceId: first.id,
      interfaceType: "rs485",
      interfaceKey: "rs485-1",
      address: 7,
      baudRate: 19200,
      parity: "even",
      dataBits: 8,
      stopBits: 1,
    });

    const second = await makeDevice("DEV-2", 7);
    await assert.rejects(
      db.insert(schema.gatewayDeviceBindings).values({
        gatewayId: gateway.id,
        deviceId: second.id,
        interfaceType: "rs485",
        interfaceKey: "rs485-1",
        address: 7,
        baudRate: 19200,
        parity: "even",
        dataBits: 8,
        stopBits: 1,
      }),
      /unique|duplicate/i,
    );

    const third = await makeDevice("DEV-3", 7);
    await db.insert(schema.gatewayDeviceBindings).values({
      gatewayId: gateway.id,
      deviceId: third.id,
      interfaceType: "rs485",
      interfaceKey: "rs485-2",
      address: 7,
      baudRate: 9600,
      parity: "none",
      dataBits: 8,
      stopBits: 1,
    });

    const bindings = await db.select().from(schema.gatewayDeviceBindings);
    assert.equal(bindings.length, 2);
    assert.deepEqual(new Set(bindings.map((row) => row.interfaceKey)), new Set(["rs485-1", "rs485-2"]));
  } finally {
    await client.close();
  }
});

test("RS485 bindings require an explicit bus and Modbus address", async () => {
  const { client, db } = await database();
  try {
    const [owner] = await db.insert(schema.clients).values({ code: "REQ", name: "Required" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: owner.id, code: "REQ-S", name: "Required Site" }).returning();
    const [asset] = await db.insert(schema.assets).values({ siteId: site.id, code: "REQ-A", name: "Required Asset" }).returning();
    const [gateway] = await db.insert(schema.gateways).values({ siteId: site.id, code: "REQ-GW", name: "Required Gateway" }).returning();
    const [device] = await db.insert(schema.devices).values({ assetId: asset.id, code: "REQ-D", name: "Required Device", protocol: "modbus_rtu", unitId: 3 }).returning();

    await assert.rejects(
      db.insert(schema.gatewayDeviceBindings).values({
        gatewayId: gateway.id,
        deviceId: device.id,
        interfaceType: "rs485",
      }),
      /check|constraint/i,
    );
  } finally {
    await client.close();
  }
});
