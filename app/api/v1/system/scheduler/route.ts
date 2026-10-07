import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { start, getRun } from "workflow/api";
import { getDb } from "../../../../../db/index";
import { previewSchedulers } from "../../../../../db/schema";
import { assertPreviewScheduler, reservePreviewScheduler, recordPreviewRun, stopPreviewScheduler, SCHEDULER_KEY } from "../../../../../db/preview-scheduler";
import { previewOperations } from "../../../../../workflows/preview-operations";

export const dynamic = "force-dynamic";

function authorize(request: Request) {
  const policy = assertPreviewScheduler(process.env);
  const value = request.headers.get("authorization") || "";
  const token = value.startsWith("Bearer ") ? value.slice(7) : "";
  const expected = Buffer.from(policy.secret), received = Buffer.from(token);
  if (!token || expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error("UNAUTHORIZED");
  return policy;
}

async function handle(request: Request) {
  try {
    const policy = authorize(request);
    const db = getDb();
    if (request.method === "POST") {
      const reservation = await reservePreviewScheduler(db, policy.siteCode!);
      if (reservation.created) {
        try {
          const run = await start(previewOperations, [reservation.scheduler.generation]);
          await recordPreviewRun(db, reservation.scheduler.generation, run.runId);
        } catch (error) {
          await db.update(previewSchedulers).set({ enabled: false, updatedAt: new Date() })
            .where(eq(previewSchedulers.generation, reservation.scheduler.generation));
          throw error;
        }
      }
    }
    if (request.method === "DELETE") await stopPreviewScheduler(db);
    const [scheduler] = await db.select().from(previewSchedulers).where(eq(previewSchedulers.key, SCHEDULER_KEY));
    let workflowStatus: string | null = null;
    if (scheduler?.runId) workflowStatus = await getRun(scheduler.runId).status;
    const lastCycleAgeSeconds = scheduler?.lastCompletedAt ? Math.max(0, (Date.now() - scheduler.lastCompletedAt.getTime()) / 1000) : null;
    const healthy = Boolean(scheduler?.enabled && workflowStatus === "running" && scheduler.lastOk && lastCycleAgeSeconds !== null && lastCycleAgeSeconds < 180);
    return Response.json({ ok: true, healthy, lastCycleAgeSeconds, mode: "evaluate_only", dispatchSkipped: true, intervalSeconds: 60, scheduler: scheduler ?? null, workflowStatus }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
    if (!unauthorized) console.error("Preview scheduler request failed", error);
    return Response.json({ error: unauthorized ? "No autorizado." : "Scheduler aislado no disponible; revisa configuración y estado." }, { status: unauthorized ? 401 : 503, headers: { "Cache-Control": "no-store" } });
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
