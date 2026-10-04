import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import {
  handleSpecIngest,
  parseSpecIngestPayload,
  specIngestToGenericPayloads,
} from "../app/api/v1/gateway/_lib/ingest-spec-v1";
import { ApiError } from "../app/api/v1/_lib/auth";
import type { Cam5Database } from "../db/index";
import * as schema from "../db/schema";

const now = new Date("2026-10-03T16:30:10.000Z");
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

function payload() {
  return {
    schema_version: "1.0",
    gateway_id: "gw-contract-01",
    boot_id: "550e8400-e29b-41d4-a716-446655440000",
    message_id: "d1025c19-cfa7-4b90-93d7-725ad310d431",
    sequence: 18452,
    created_at: "2026-10-03T16:30:05.210Z",
    time_quality: "SYNCED",
    samples: [
      {
        device_id: "temp-01",
        sampled_at: "2026-10-03T16:30:04.900Z",
        quality: "GOOD",
        metrics: { "environment.temperature": -18.3 },
      },
      {
        device_id: "temp-02",
        sampled_at: "2026-10-03T16:30:04.950Z",
        quality: "GOOD",
        metrics: { "environment.temperature": -18.1 },
      },
    ],
  };
}

test("parses the HOIT SPEC v0.4 telemetry envelope and maps it to generic ingest", () => {
  const parsed = parseSpecIngestPayload(payload(), now);
  assert.equal(parsed.gatewayId, "GW-CONTRACT-01");
  assert.equal(parsed.samples.length, 2);

  const generic = specIngestToGenericPayloads(parsed);
  assert.equal(generic.length, 2);
  assert.equal(generic[0].schemaVersion, "2.0");
  assert.equal(generic[0].gateway.sequence, 18452);
  assert.equal(generic[0].device.code, "TEMP-01");
  assert.equal(generic[0].quality, "good");
  assert.ok(generic[0].batchKey.startsWith(parsed.messageId + ":TEMP-01:"));
});

test("maps non-good SPEC qualities conservatively without treating them as normal data", () => {
  const raw = payload();
  raw.samples[0].quality = "INVALID";
  raw.samples[1].quality = "UNKNOWN";
  const generic = specIngestToGenericPayloads(parseSpecIngestPayload(raw, now));
  assert.equal(generic[0].quality, "bad");
  assert.deepEqual(generic[0].qualityFlags, ["spec_quality_invalid"]);
  assert.equal(generic[1].quality, "bad");
  assert.deepEqual(generic[1].qualityFlags, ["spec_quality_unknown"]);
});

test("rejects malformed message ids and duplicate sample identities", () => {
  const malformed = payload();
  malformed.message_id = "not-a-uuid";
  assert.throws(
    () => parseSpecIngestPayload(malformed, now),
    (error: unknown) => error instanceof ApiError && error.status === 400 && /UUID/.test(error.message),
  );

  const duplicated = payload();
  duplicated.samples[1].device_id = duplicated.samples[0].device_id;
  duplicated.samples[1].sampled_at = duplicated.samples[0].sampled_at;
  assert.throws(
    () => parseSpecIngestPayload(duplicated, now),
    (error: unknown) => error instanceof ApiError && error.status === 400 && /duplica/.test(error.message),
  );
});

test("rejects protocol details in the HOIT V1 cloud envelope", () => {
  const withProtocolDetails = payload() as ReturnType<typeof payload> & {
    protocol?: string;
    samples: Array<ReturnType<typeof payload>["samples"][number] & { register?: number; raw_value?: number }>;
  };
  withProtocolDetails.protocol = "modbus_rtu";
  assert.throws(
    () => parseSpecIngestPayload(withProtocolDetails, now),
    (error: unknown) => error instanceof ApiError && error.status === 400 && /campos no permitidos/.test(error.message),
  );

  const withRawRegister = payload() as ReturnType<typeof payload> & {
    samples: Array<ReturnType<typeof payload>["samples"][number] & { register?: number; raw_value?: number }>;
  };
  withRawRegister.samples[0].register = 3027;
  withRawRegister.samples[0].raw_value = 17234;
  assert.throws(
    () => parseSpecIngestPayload(withRawRegister, now),
    (error: unknown) => error instanceof ApiError && error.status === 400 && /campos no permitidos/.test(error.message),
  );
});

test("accepts a multi-device SPEC message idempotently", async () => {
  const client = new PGlite();
  try {
    for (const filename of migrations) {
      const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
      await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    }
    const db = drizzle(client, { schema }) as unknown as Cam5Database;

    const [tenant] = await db.insert(schema.clients).values({ code: "SPEC", name: "SPEC" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: tenant.id, code: "SPEC-S", name: "SPEC Site" }).returning();
    const [asset] = await db.insert(schema.assets).values({
      siteId: site.id,
      code: "SPEC-A",
      name: "SPEC Asset",
      assetType: "generic",
    }).returning();
    const [gateway] = await db.insert(schema.gateways).values({
      siteId: site.id,
      code: "GW-CONTRACT-01",
      name: "Gateway Contract",
    }).returning();

    await db.insert(schema.metricDefinitions).values({
      key: "environment.temperature",
      name: "Temperatura",
      category: "environment",
      unit: "°C",
      dataType: "float",
      aggregation: "avg",
    }).onConflictDoNothing();
    const [definition] = await db.select().from(schema.metricDefinitions)
      .where(eq(schema.metricDefinitions.key, "environment.temperature")).limit(1);
    assert.ok(definition);

    for (const code of ["TEMP-01", "TEMP-02"]) {
      const [device] = await db.insert(schema.devices).values({
        assetId: asset.id,
        code,
        name: code,
        deviceType: "temperature_sensor",
        driver: "eddystone_tlm",
        protocol: "ble",
        state: "commissioning",
      }).returning();
      await db.insert(schema.gatewayDeviceBindings).values({
        gatewayId: gateway.id,
        deviceId: device.id,
        interfaceType: "ble",
      });
      await db.insert(schema.deviceMetrics).values({
        deviceId: device.id,
        metricDefinitionId: definition.id,
        code: "TEMP",
        name: "Temperatura",
      });
    }

    const credential = { gatewayId: gateway.id, gatewayCode: gateway.code, siteId: site.id };
    const first = await handleSpecIngest({ db, credential, rawPayload: payload(), receivedAt: now });
    assert.equal(first.status, 202);
    assert.deepEqual(await first.json(), {
      accepted: true,
      message_id: "d1025c19-cfa7-4b90-93d7-725ad310d431",
      server_time: now.toISOString(),
    });

    const afterFirst = await db.select().from(schema.metricReadings);
    assert.equal(afterFirst.length, 2);

    const replay = await handleSpecIngest({ db, credential, rawPayload: payload(), receivedAt: now });
    assert.equal(replay.status, 202);
    const afterReplay = await db.select().from(schema.metricReadings);
    assert.equal(afterReplay.length, 2);
  } finally {
    await client.close();
  }
});
