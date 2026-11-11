import assert from "node:assert/strict";
import test from "node:test";
import { count, eq } from "drizzle-orm";
import { processScheduledReports } from "../db/report-engine";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

test("overlapping cron runs generate a scheduled report only once", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Cam5-Prueba-2026", log: false });
    const [asset] = await db.select().from(schema.assets).limit(1);
    const [template] = await db.select().from(schema.reportTemplates).limit(1);
    const now = new Date("2026-11-11T12:00:00.000Z");
    const [schedule] = await db.insert(schema.reportSchedules).values({
      templateId: template.id,
      assetId: asset.id,
      cronExpression: "0 8 * * 1",
      timezone: "America/Santiago",
      nextRunAt: new Date(now.getTime() - 60_000),
    }).returning();

    const [first, second] = await Promise.all([processScheduledReports(db, now), processScheduledReports(db, now)]);
    assert.equal(first.completed + second.completed, 1);

    const [runs] = await db.select({ value: count() }).from(schema.reportRuns);
    assert.equal(runs.value, 1);
    const [updated] = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.id, schedule.id));
    assert.ok(updated.nextRunAt && updated.nextRunAt > now);

    const rerun = await processScheduledReports(db, new Date(now.getTime() + 60_000));
    assert.equal(rerun.due, 0);
  } finally {
    await client.close();
  }
});
