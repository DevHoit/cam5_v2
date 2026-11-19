import type { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { auditLogs, reportRuns, siteReportSchedules } from "../../../../db/schema";
import { nextSiteReportRun } from "../../../../db/site-report-output";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../_lib/auth";
import { parseHour, parseKind, parseRecipients, serializeSchedule, siteTimezone, siteUsers } from "../site-reports/_lib";

export const dynamic = "force-dynamic";

/** Programaciones de informes del sitio activo y los usuarios que se pueden agregar como destinatarios. */
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "reports.read");
    const [rows, people] = await Promise.all([
      db.select({ schedule: siteReportSchedules, lastReportTitle: reportRuns.title }).from(siteReportSchedules)
        .leftJoin(reportRuns, eq(reportRuns.id, siteReportSchedules.lastReportId))
        .where(eq(siteReportSchedules.siteId, user.siteId)).orderBy(asc(siteReportSchedules.kind), asc(siteReportSchedules.createdAt)),
      siteUsers(db, user.siteId),
    ]);
    return Response.json({ items: rows.map((row) => serializeSchedule(row.schedule, row.lastReportTitle)), users: people, canManage: user.permissions.includes("reports.schedule") }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "reports.schedule");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibió la programación.");
    const kind = parseKind(body.kind);
    const hour = parseHour(body.hour);
    const recipients = parseRecipients(body.recipients ?? []);
    if (!recipients.length) throw new ApiError(400, "Agrega al menos un destinatario.");
    const now = new Date();
    const [row] = await db.insert(siteReportSchedules).values({
      siteId: user.siteId, kind, hour, recipients, attachPdf: body.attachPdf !== false, onlyIfFindings: body.onlyIfFindings === true,
      active: true, nextRunAt: nextSiteReportRun(kind, hour, await siteTimezone(db, user.siteId), now), createdBy: user.id,
    }).returning();
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "reports.schedule.create", resourceType: "site_report_schedule", resourceId: row.id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, after: { kind, hour, recipients: recipients.map((recipient) => recipient.email) } });
    return Response.json({ item: serializeSchedule(row) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
