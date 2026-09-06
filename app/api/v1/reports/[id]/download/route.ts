import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { reportRuns } from "../../../../../../db/schema";
import type { ReportSnapshot } from "../../../../../../db/report-engine";
import { reportCsv, reportPdf } from "../../../../../../db/report-export";
import { apiErrorResponse, ApiError, requireApiSession } from "../../../_lib/auth";
import { requireReportAsset } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function filename(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "reports.read");
    const { id } = await context.params;
    const [run] = await db.select({ id: reportRuns.id, title: reportRuns.title, status: reportRuns.status, assetId: reportRuns.assetId, payload: reportRuns.payload }).from(reportRuns).where(eq(reportRuns.id, id)).limit(1);
    if (!run || !run.assetId) throw new ApiError(404, "El reporte solicitado no existe.");
    if (run.status !== "completed") throw new ApiError(409, "El reporte todavía no está disponible para descarga.");
    await requireReportAsset(db, user, run.assetId);
    const snapshot = run.payload as ReportSnapshot;
    const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "pdf";
    const base = filename(run.title) || `reporte-${run.id}`;
    if (format === "csv") {
      return new Response(`\uFEFF${reportCsv(snapshot)}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Cache-Control": "no-store" } });
    }
    const bytes = await reportPdf(snapshot);
    return new Response(bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"`, "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
