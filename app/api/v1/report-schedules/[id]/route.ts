import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { nextCronRun } from "../../../../../db/report-engine";
import { assets, auditLogs, reportSchedules } from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";
import { requireReportAsset } from "../../reports/_lib";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "reports.schedule");
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibió el cambio de programación.");
    const [current] = await db.select({ schedule: reportSchedules, siteId: assets.siteId }).from(reportSchedules).innerJoin(assets, eq(assets.id, reportSchedules.assetId)).where(and(eq(reportSchedules.id, id), eq(assets.siteId, user.siteId))).limit(1);
    if (!current || !current.schedule.assetId) throw new ApiError(404, "La programación no existe.");
    await requireReportAsset(db, user, current.schedule.assetId);
    const active = typeof body.active === "boolean" ? body.active : current.schedule.active;
    const now = new Date();
    const [item] = await db.update(reportSchedules).set({ active, nextRunAt: active ? nextCronRun(current.schedule.cronExpression, current.schedule.timezone, now) : null, updatedAt: now }).where(eq(reportSchedules.id, id)).returning();
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "report_schedules.update", resourceType: "report_schedule", resourceId: id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, before: current.schedule, after: item });
    return Response.json({ item }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "reports.schedule");
    const { id } = await context.params;
    const [current] = await db.select({ schedule: reportSchedules, siteId: assets.siteId }).from(reportSchedules).innerJoin(assets, eq(assets.id, reportSchedules.assetId)).where(and(eq(reportSchedules.id, id), eq(assets.siteId, user.siteId))).limit(1);
    if (!current || !current.schedule.assetId) throw new ApiError(404, "La programación no existe.");
    await requireReportAsset(db, user, current.schedule.assetId);
    await db.delete(reportSchedules).where(eq(reportSchedules.id, id));
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "report_schedules.delete", resourceType: "report_schedule", resourceId: id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, before: current.schedule });
    return new Response(null, { status: 204 });
  } catch (error) { return apiErrorResponse(error); }
}
