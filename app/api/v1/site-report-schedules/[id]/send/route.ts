import type { NextRequest } from "next/server";
import { auditLogs } from "../../../../../../db/schema";
import { runSiteReportSchedule } from "../../../../../../db/site-report-output";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../../_lib/auth";
import { scheduleForSite } from "../../../site-reports/_lib";

export const dynamic = "force-dynamic";

/** "Enviar prueba ahora": genera el informe del periodo anterior y lo envía a los destinatarios actuales. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "reports.schedule");
    const schedule = await scheduleForSite(db, (await context.params).id, user.siteId);
    if (!schedule.recipients.length) throw new ApiError(400, "Agrega al menos un destinatario antes de enviar.");
    const result = await runSiteReportSchedule(db, schedule.id, { force: true });
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "reports.schedule.send", resourceType: "site_report_schedule", resourceId: schedule.id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, after: { status: result.status, reportId: result.reportId, recipients: schedule.recipients.map((recipient) => recipient.email) } });
    if (result.status === "failed") throw new ApiError(502, `El informe se generó, pero el correo no se pudo enviar: ${result.error}`);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
