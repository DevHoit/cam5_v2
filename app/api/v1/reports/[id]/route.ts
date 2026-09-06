import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { assets, reportRuns, reportTemplates, users } from "../../../../../db/schema";
import type { ReportSnapshot } from "../../../../../db/report-engine";
import { apiErrorResponse, ApiError, requireApiSession } from "../../_lib/auth";
import { requireReportAsset } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "reports.read");
    const { id } = await context.params;
    const [item] = await db.select({
      id: reportRuns.id,
      title: reportRuns.title,
      format: reportRuns.format,
      status: reportRuns.status,
      periodStart: reportRuns.periodStart,
      periodEnd: reportRuns.periodEnd,
      createdAt: reportRuns.createdAt,
      completedAt: reportRuns.completedAt,
      errorMessage: reportRuns.errorMessage,
      payload: reportRuns.payload,
      templateId: reportTemplates.id,
      templateName: reportTemplates.name,
      assetId: assets.id,
      assetCode: assets.code,
      assetName: assets.name,
      requestedBy: users.displayName,
    }).from(reportRuns)
      .innerJoin(reportTemplates, eq(reportTemplates.id, reportRuns.templateId))
      .innerJoin(assets, eq(assets.id, reportRuns.assetId))
      .leftJoin(users, eq(users.id, reportRuns.requestedBy))
      .where(eq(reportRuns.id, id)).limit(1);
    if (!item) throw new ApiError(404, "El reporte solicitado no existe.");
    await requireReportAsset(db, user, item.assetId);
    return Response.json({ item: { ...item, requestedBy: item.requestedBy ?? "Sistema", payload: item.payload as ReportSnapshot, periodStart: item.periodStart.toISOString(), periodEnd: item.periodEnd.toISOString(), createdAt: item.createdAt.toISOString(), completedAt: item.completedAt?.toISOString() ?? null } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
