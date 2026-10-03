import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { resolveOnCallUser, scheduleMatches } from "../db/on-call-engine";
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
  "0027_rule_alarm_semantics.sql",
];

async function fixture() {
  const client = new PGlite();
  for (const filename of migrations) {
    const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  const db = drizzle(client, { schema }) as unknown as Cam5Database;
  const [customer] = await db.insert(schema.clients).values({ code: "SHIFT", name: "Shift client" }).returning();
  const [shift] = await db.insert(schema.shifts).values({
    clientId: customer.id,
    name: "NOC noche",
    timezone: "America/Santiago",
  }).returning();
  return { client, db, customer, shift };
}

test("weekly schedules are evaluated in the shift timezone including overnight windows", () => {
  const schedule = {
    dayOfWeek: 5,
    startTime: "22:00:00",
    endTime: "06:00:00",
    validFrom: "2026-10-01",
    validTo: "2026-10-31",
  };
  assert.equal(scheduleMatches({
    at: new Date("2026-10-03T07:30:00.000Z"),
    timezone: "America/Santiago",
    schedule,
  }), true);
  assert.equal(scheduleMatches({
    at: new Date("2026-10-03T12:00:00.000Z"),
    timezone: "America/Santiago",
    schedule,
  }), false);
});

test("on-call resolution uses active assignment windows and explicit priority", async () => {
  const { client, db, shift } = await fixture();
  try {
    await db.insert(schema.shiftSchedules).values({
      shiftId: shift.id,
      dayOfWeek: 6,
      startTime: "18:00:00",
      endTime: "23:59:00",
    });
    const [primary, backup] = await db.insert(schema.users).values([
      { email: "primary@example.test", displayName: "Primary", status: "active" },
      { email: "backup@example.test", displayName: "Backup", status: "active" },
    ]).returning();
    await db.insert(schema.onCallAssignments).values([
      {
        shiftId: shift.id,
        userId: primary.id,
        startsAt: new Date("2026-10-03T00:00:00.000Z"),
        endsAt: new Date("2026-10-04T00:00:00.000Z"),
        priority: 0,
      },
      {
        shiftId: shift.id,
        userId: backup.id,
        startsAt: new Date("2026-10-03T00:00:00.000Z"),
        endsAt: new Date("2026-10-04T00:00:00.000Z"),
        priority: 1,
      },
    ]);

    const result = await resolveOnCallUser(db, shift.id, new Date("2026-10-03T22:00:00.000Z"));
    assert.deepEqual(result, { status: "resolved", shiftId: shift.id, userId: primary.id, priority: 0 });
  } finally {
    await client.close();
  }
});

test("equal top priority remains ambiguous instead of choosing an arbitrary operator", async () => {
  const { client, db, shift } = await fixture();
  try {
    const users = await db.insert(schema.users).values([
      { email: "a@example.test", displayName: "A", status: "active" },
      { email: "b@example.test", displayName: "B", status: "active" },
    ]).returning();
    await db.insert(schema.onCallAssignments).values(users.map((user) => ({
      shiftId: shift.id,
      userId: user.id,
      startsAt: new Date("2026-10-03T00:00:00.000Z"),
      endsAt: new Date("2026-10-04T00:00:00.000Z"),
      priority: 0,
    })));

    const result = await resolveOnCallUser(db, shift.id, new Date("2026-10-03T18:00:00.000Z"));
    assert.equal(result.status, "ambiguous");
    if (result.status === "ambiguous") assert.deepEqual(new Set(result.userIds), new Set(users.map((user) => user.id)));
  } finally {
    await client.close();
  }
});

test("inactive schedule and inactive users never resolve as on-call", async () => {
  const { client, db, shift } = await fixture();
  try {
    await db.insert(schema.shiftSchedules).values({
      shiftId: shift.id,
      dayOfWeek: 1,
      startTime: "08:00:00",
      endTime: "17:00:00",
    });
    const [user] = await db.insert(schema.users).values({
      email: "inactive@example.test",
      displayName: "Inactive",
      status: "suspended",
    }).returning();
    await db.insert(schema.onCallAssignments).values({
      shiftId: shift.id,
      userId: user.id,
      startsAt: new Date("2026-10-03T00:00:00.000Z"),
      endsAt: new Date("2026-10-04T00:00:00.000Z"),
    });

    assert.deepEqual(
      await resolveOnCallUser(db, shift.id, new Date("2026-10-03T18:00:00.000Z")),
      { status: "outside_schedule", shiftId: shift.id },
    );
  } finally {
    await client.close();
  }
});
