import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { auditLogs, siteReportSchedules } from "../../../../../db/schema";
import { nextSiteReportRun } from "../../../../../db/site-report-output";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";
import { parseHour, parseKind, parseRecipients, scheduleForSite, serializeSchedule, siteTimezone } from "../../site-reports/_lib";

export const dynamic = "force-dynamic";

/** Cambia tipo, hora, destinatarios, opciones o la pausa de una programación. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "reports.schedule");
    const current = await scheduleForSite(db, (await context.params).id, user.siteId);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron cambios.");
    const kind = body.kind === undefined ? current.kind as "weekly" | "monthly" : parseKind(body.kind);
    const hour = parseHour(body.hour, current.hour);
    const recipients = body.recipients === undefined ? current.recipients : parseRecipients(body.recipients);
    const active = typeof body.active === "boolean" ? body.active : current.active;
    if (active && !recipients.length) throw new ApiError(400, "Agrega al menos un destinatario o pausa la programación.");
    const now = new Date();
    const timingChanged = kind !== current.kind || hour !== current.hour || (active && !current.active);
    const [row] = await db.update(siteReportSchedules).set({
      kind, hour, recipients, active,
      attachPdf: typeof body.attachPdf === "boolean" ? body.attachPdf : current.attachPdf,
      onlyIfFindings: typeof body.onlyIfFindings === "boolean" ? body.onlyIfFindings : current.onlyIfFindings,
      nextRunAt: timingChanged ? nextSiteReportRun(kind, hour, await siteTimezone(db, user.siteId), now) : current.nextRunAt,
      updatedAt: now,
    }).where(eq(siteReportSchedules.id, current.id)).returning();
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "reports.schedule.update", resourceType: "site_report_schedule", resourceId: current.id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, before: { kind: current.kind, hour: current.hour, active: current.active, recipients: current.recipients.map((recipient) => recipient.email) }, after: { kind, hour, active, recipients: recipients.map((recipient) => recipient.email) } });
    return Response.json({ item: serializeSchedule(row) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "reports.schedule");
    const current = await scheduleForSite(db, (await context.params).id, user.siteId);
    await db.delete(siteReportSchedules).where(eq(siteReportSchedules.id, current.id));
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "reports.schedule.delete", resourceType: "site_report_schedule", resourceId: current.id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, before: { kind: current.kind, recipients: current.recipients.map((recipient) => recipient.email) } });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
