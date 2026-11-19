import type { NextRequest } from "next/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { auditLogs, reportRuns, users } from "../../../../db/schema";
import { createSiteReportRun } from "../../../../db/site-report-output";
import { previousPeriod, type SiteReport } from "../../../../db/site-report";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../_lib/auth";
import { allowedAssets, parseKind, siteTimezone } from "./_lib";

export const dynamic = "force-dynamic";

/** Informes de subestación del sitio activo (los más recientes primero). */
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "reports.read");
    const rows = await db.select({ id: reportRuns.id, title: reportRuns.title, kind: reportRuns.kind, periodStart: reportRuns.periodStart, periodEnd: reportRuns.periodEnd, createdAt: reportRuns.createdAt, requestedBy: users.displayName, payload: reportRuns.payload })
      .from(reportRuns).leftJoin(users, eq(users.id, reportRuns.requestedBy))
      .where(and(eq(reportRuns.siteId, user.siteId), isNotNull(reportRuns.kind))).orderBy(desc(reportRuns.createdAt)).limit(40);
    return Response.json({
      items: rows.map((row) => {
        const report = row.payload as unknown as SiteReport;
        return { id: row.id, title: row.title, kind: row.kind, periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString(), createdAt: row.createdAt.toISOString(), requestedBy: row.requestedBy ?? "Programación", label: report.period?.label ?? "", conclusion: report.conclusion ?? null, actions: report.actions?.length ?? 0 };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Genera un informe en línea: el periodo cerrado anterior o el periodo en curso hasta ahora. */
export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "reports.generate");
    const body = await request.json().catch(() => null) as { kind?: unknown; range?: unknown } | null;
    const kind = parseKind(body?.kind);
    const range = body?.range === "current" ? "current" : body?.range === "previous" || body?.range === undefined ? "previous" : null;
    if (!range) throw new ApiError(400, "El periodo debe ser el anterior o el en curso.");
    const now = new Date();
    const closed = previousPeriod(kind, now, await siteTimezone(db, user.siteId));
    const period = range === "previous" ? closed : { start: closed.end, end: now };
    if (period.end.getTime() - period.start.getTime() < 60 * 60_000) throw new ApiError(400, "El periodo en curso recién comienza: genera el del periodo anterior.");
    const run = await createSiteReportRun(db, { siteId: user.siteId, kind, periodStart: period.start, periodEnd: period.end, requestedBy: user.id, allowedAssetIds: await allowedAssets(db, user.id), now });
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "reports.site.generate", resourceType: "report", resourceId: run.id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, after: { kind, range, periodStart: period.start.toISOString(), periodEnd: period.end.toISOString() } });
    return Response.json({ id: run.id, title: run.title }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
