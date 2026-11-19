import type { NextRequest } from "next/server";
import { siteReportPdf } from "../../../../../../db/site-report-output";
import type { SiteReport } from "../../../../../../db/site-report";
import { apiErrorResponse, requireApiSession } from "../../../_lib/auth";
import { loadSiteReportRun } from "../../_lib";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "reports.read");
    const row = await loadSiteReportRun(db, (await context.params).id, user);
    const report = row.payload as unknown as SiteReport;
    const bytes = await siteReportPdf(report);
    const filename = `${row.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}.pdf`;
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`, "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
