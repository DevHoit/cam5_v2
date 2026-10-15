import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { previewSchedulers, sites } from "./schema";
import { operationsPolicy } from "./operations-policy";
import { runOperationalCycle } from "./operations-cycle";

export const SCHEDULER_KEY = "preview-laboratory";

export function assertPreviewScheduler(environment: Record<string, string | undefined>) {
  const policy = operationsPolicy(environment);
  if (environment.VERCEL_ENV !== "preview" || policy.mode !== "evaluate_only" || !policy.siteCode) {
    throw new Error("El scheduler administrado sólo está disponible en Preview aislado.");
  }
  return policy;
}

export async function reservePreviewScheduler(db: Cam5Database, siteCode: string) {
  const matches = await db.select({ id: sites.id }).from(sites)
    .where(and(eq(sites.code, siteCode), eq(sites.active, true)));
  if (matches.length !== 1) throw new Error("Se requiere exactamente un sitio activo de laboratorio.");
  await db.insert(previewSchedulers).values({ key: SCHEDULER_KEY, siteId: matches[0].id, generation: randomUUID() }).onConflictDoNothing();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(previewSchedulers).where(eq(previewSchedulers.key, SCHEDULER_KEY)).for("update");
    if (row.enabled) return { created: false, scheduler: row };
    const [scheduler] = await tx.update(previewSchedulers).set({
      enabled: true, generation: randomUUID(), siteId: matches[0].id, runId: null,
      cycleCount: 0, lastExecution: null, lastStartedAt: null, lastCompletedAt: null, lastOk: null, updatedAt: new Date(),
    }).where(eq(previewSchedulers.key, SCHEDULER_KEY)).returning();
    return { created: true, scheduler };
  });
}

export async function stopPreviewScheduler(db: Cam5Database) {
  return db.update(previewSchedulers).set({ enabled: false, updatedAt: new Date() })
    .where(eq(previewSchedulers.key, SCHEDULER_KEY)).returning();
}

export async function recordPreviewRun(db: Cam5Database, generation: string, runId: string) {
  await db.update(previewSchedulers).set({ runId, updatedAt: new Date() })
    .where(and(eq(previewSchedulers.key, SCHEDULER_KEY), eq(previewSchedulers.generation, generation), eq(previewSchedulers.enabled, true)));
}

export async function executePreviewSchedulerCycle(db: Cam5Database, generation: string, executionId: string, siteCode: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(previewSchedulers).where(eq(previewSchedulers.key, SCHEDULER_KEY)).for("update");
    if (!row?.enabled || row.generation !== generation) return { active: false, nextAt: null };
    const targets = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.code, siteCode), eq(sites.active, true)));
    if (targets.length !== 1 || targets[0].id !== row.siteId) throw new Error("El alcance de laboratorio cambió; se bloqueó el ciclo.");
    if (row.lastExecution === executionId && row.lastStartedAt) {
      return { active: true, nextAt: new Date(row.lastStartedAt.getTime() + 60_000) };
    }
    const started = new Date();
    // The same transaction holds the singleton lock and commits alarm writes + receipt atomically.
    // Drizzle transactions expose the query methods used by the domain engines.
    const result = await runOperationalCycle(tx as unknown as Cam5Database, { mode: "evaluate_only", siteId: row.siteId });
    await tx.update(previewSchedulers).set({
      cycleCount: sql`${previewSchedulers.cycleCount} + 1`, lastExecution: executionId,
      lastStartedAt: started, lastCompletedAt: new Date(), lastOk: result.ok, updatedAt: new Date(),
    }).where(eq(previewSchedulers.key, SCHEDULER_KEY));
    console.info("Preview scheduler cycle", { siteId: row.siteId, ok: result.ok, evaluations: result.evaluations, failures: result.evaluationFailures, dispatchSkipped: result.dispatchSkipped });
    return { active: true, nextAt: new Date(started.getTime() + 60_000) };
  });
}
