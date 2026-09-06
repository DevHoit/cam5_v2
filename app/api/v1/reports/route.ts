import type { NextRequest } from "next/server";
import { and, between, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { createReportRun } from "../../../../db/report-engine";
import { assets, auditLogs, reportRuns, reportTemplates, userAssetScopes, users } from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requestMetadata, requireApiSession } from "../_lib/auth";
import { parseReportPeriod, requireReportAsset } from "./_lib";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "reports.read");
    const { page, pageSize, offset } = parsePage(request);
    const assetId = request.nextUrl.searchParams.get("assetId") || "";
    if (assetId) await requireReportAsset(db, user, assetId);
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const status = request.nextUrl.searchParams.get("status") || "all";
    const templateId = request.nextUrl.searchParams.get("templateId") || "all";
    if (!["all", "queued", "running", "completed", "failed"].includes(status)) throw new ApiError(400, "El filtro de estado no es válido.");
    const fromValue = request.nextUrl.searchParams.get("from");
    const toValue = request.nextUrl.searchParams.get("to");
    const from = fromValue ? new Date(`${fromValue}T00:00:00`) : null;
    const to = toValue ? new Date(`${toValue}T23:59:59.999`) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) throw new ApiError(400, "El rango de fechas no es válido.");
    const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id));
    const filters: SQL[] = [eq(assets.siteId, user.siteId)];
    if (scopes.length) filters.push(inArray(reportRuns.assetId, scopes.map((scope) => scope.assetId)));
    if (assetId) filters.push(eq(reportRuns.assetId, assetId));
    if (q) filters.push(or(ilike(reportRuns.title, `%${q}%`), ilike(reportTemplates.name, `%${q}%`), ilike(assets.code, `%${q}%`))!);
    if (status !== "all") filters.push(eq(reportRuns.status, status as "queued" | "running" | "completed" | "failed"));
    if (templateId !== "all") filters.push(eq(reportRuns.templateId, templateId));
    if (from && to) filters.push(between(reportRuns.createdAt, from, to));
    else if (from) filters.push(between(reportRuns.createdAt, from, new Date("9999-12-31T23:59:59.999Z")));
    else if (to) filters.push(between(reportRuns.createdAt, new Date(0), to));
    const where = and(...filters);
    const summaryFilters: SQL[] = [eq(assets.siteId, user.siteId)];
    if (scopes.length) summaryFilters.push(inArray(reportRuns.assetId, scopes.map((scope) => scope.assetId)));
    if (assetId) summaryFilters.push(eq(reportRuns.assetId, assetId));
    const projection = {
      id: reportRuns.id,
      title: reportRuns.title,
      format: reportRuns.format,
      status: reportRuns.status,
      periodStart: reportRuns.periodStart,
      periodEnd: reportRuns.periodEnd,
      createdAt: reportRuns.createdAt,
      completedAt: reportRuns.completedAt,
      errorMessage: reportRuns.errorMessage,
      templateId: reportTemplates.id,
      templateName: reportTemplates.name,
      assetId: assets.id,
      assetCode: assets.code,
      assetName: assets.name,
      requestedBy: users.displayName,
    };
    const [items, totalRows, summaryRows] = await Promise.all([
      db.select(projection).from(reportRuns)
        .innerJoin(reportTemplates, eq(reportTemplates.id, reportRuns.templateId))
        .innerJoin(assets, eq(assets.id, reportRuns.assetId))
        .leftJoin(users, eq(users.id, reportRuns.requestedBy))
        .where(where).orderBy(desc(reportRuns.createdAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(reportRuns).innerJoin(assets, eq(assets.id, reportRuns.assetId)).innerJoin(reportTemplates, eq(reportTemplates.id, reportRuns.templateId)).where(where),
      db.select({ status: reportRuns.status, total: count() }).from(reportRuns).innerJoin(assets, eq(assets.id, reportRuns.assetId)).where(and(...summaryFilters)).groupBy(reportRuns.status),
    ]);
    const total = Number(totalRows[0]?.total ?? 0);
    const summary = { total: 0, completed: 0, pending: 0, failed: 0 };
    for (const row of summaryRows) {
      const value = Number(row.total);
      summary.total += value;
      if (row.status === "completed") summary.completed += value;
      else if (row.status === "failed") summary.failed += value;
      else summary.pending += value;
    }
    return Response.json({
      items: items.map((item) => ({ ...item, requestedBy: item.requestedBy ?? "Sistema", periodStart: item.periodStart.toISOString(), periodEnd: item.periodEnd.toISOString(), createdAt: item.createdAt.toISOString(), completedAt: item.completedAt?.toISOString() ?? null })),
      page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), summary,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "reports.generate");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron los parámetros del reporte.");
    const assetId = String(body.assetId ?? "");
    const templateId = String(body.templateId ?? "");
    if (!templateId) throw new ApiError(400, "Selecciona una plantilla.");
    await requireReportAsset(db, user, assetId);
    const { periodStart, periodEnd } = parseReportPeriod(body);
    const format = body.format === "csv" ? "csv" : "pdf";
    const result = await createReportRun(db, { templateId, assetId, periodStart, periodEnd, requestedBy: user.id, generatedBy: user.displayName, format });
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "reports.generate", resourceType: "report_run", resourceId: result.run.id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, after: { title: result.run.title, templateId, assetId, periodStart, periodEnd, format } });
    return Response.json({ item: { id: result.run.id, title: result.run.title, status: result.run.status } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
