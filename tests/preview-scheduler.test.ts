import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { Cam5Database } from "../db/index";
import * as schema from "../db/schema";
import { assertPreviewScheduler, reservePreviewScheduler, stopPreviewScheduler, executePreviewSchedulerCycle, SCHEDULER_KEY } from "../db/preview-scheduler";

test("managed scheduler rejects production, development and missing isolation config", () => {
  const config = { HOIT_PREVIEW_OPERATIONS_TOKEN: "lab", HOIT_PREVIEW_OPERATIONS_SITE_CODE: "LAB", CRON_SECRET: "prod" };
  for (const VERCEL_ENV of ["production", "development", undefined]) {
    assert.throws(() => assertPreviewScheduler({ ...config, VERCEL_ENV }));
  }
  assert.equal(assertPreviewScheduler({ ...config, VERCEL_ENV: "preview" }).mode, "evaluate_only");
  assert.throws(() => assertPreviewScheduler({ VERCEL_ENV: "preview", CRON_SECRET: "prod" }));
});

test("singleton scheduler records an idempotent cycle, stops and fences old generations", async () => {
  const client = new PGlite();
  try {
    const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
    for (const entry of journal.entries) await client.exec((await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8")).replaceAll("--> statement-breakpoint", ""));
    const db = drizzle(client, { schema }) as unknown as Cam5Database;
    const [customer] = await db.insert(schema.clients).values({ code: "SCHED", name: "Scheduler" }).returning();
    const [lab] = await db.insert(schema.sites).values({ clientId: customer.id, code: "LAB", name: "Lab" }).returning();
    const first = await reservePreviewScheduler(db, "LAB");
    assert.equal(first.created, true);
    const duplicate = await reservePreviewScheduler(db, "LAB");
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.scheduler.generation, first.scheduler.generation);
    assert.equal(duplicate.scheduler.siteId, lab.id);
    const result = await executePreviewSchedulerCycle(db, first.scheduler.generation, "step-1", "LAB");
    assert.equal(result.active, true);
    const retry = await executePreviewSchedulerCycle(db, first.scheduler.generation, "step-1", "LAB");
    assert.deepEqual(retry.nextAt, result.nextAt);
    let [row] = await db.select().from(schema.previewSchedulers).where(eq(schema.previewSchedulers.key, SCHEDULER_KEY));
    assert.equal(row.cycleCount, 1);
    assert.equal(row.lastOk, true);
    assert.equal(row.lastStartedAt!.getTime() + 60000, result.nextAt!.getTime());
    await stopPreviewScheduler(db);
    assert.equal((await executePreviewSchedulerCycle(db, first.scheduler.generation, "step-2", "LAB")).active, false);
    const restarted = await reservePreviewScheduler(db, "LAB");
    assert.notEqual(restarted.scheduler.generation, first.scheduler.generation);
    assert.equal((await executePreviewSchedulerCycle(db, first.scheduler.generation, "step-old", "LAB")).active, false);
    await assert.rejects(() => executePreviewSchedulerCycle(db, restarted.scheduler.generation, "step-wrong", "OTHER"));
    [row] = await db.select().from(schema.previewSchedulers).where(eq(schema.previewSchedulers.key, SCHEDULER_KEY));
    assert.equal(row.cycleCount, 0);
    await assert.rejects(() => reservePreviewScheduler(db, "MISSING"));
  } finally { await client.close(); }
});
