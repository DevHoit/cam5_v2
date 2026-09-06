import type { NextRequest } from "next/server";
import { and, count, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { nextCronRun } from "../../../../db/report-engine";
import { assets, auditLogs, reportSchedules, reportTemplates, userAssetScopes } from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requestMetadata, requireApiSession } from "../_lib/auth";
import { requireReportAsset } from "../reports/_lib";

export const dynamic = "force-dynamic";

const allowedExpressions = new Set(["0 8 * * *", "0 8 * * 1", "0 8 1 * *"]);

function parseScheduleBody(body: Record<string, unknown>) {
  const templateId = String(body.templateId ?? "");
  const assetId = String(body.assetId ?? "");
  const cronExpression = String(body.cronExpression ?? "");
  const timezone = String(body.timezone ?? "America/Santiago");
  const active = body.active !== false;
  const recipients = Array.isArray(body.recipients) ? body.recipients.map(String).map((value) => value.trim().toLowerCase()).filter(Boolean) : [];
  if (!templateId || !assetId) throw new ApiError(400, "Selecciona una plantilla y un punto de medición.");
  if (!allowedExpressions.has(cronExpression)) throw new ApiError(400, "Selecciona una frecuencia válida.");
  try { new Intl.DateTimeFormat("es-CL", { timeZone: timezone }).format(new Date()); } catch { throw new ApiError(400, "La zona horaria no es válida."); }
  if (recipients.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new ApiError(400, "Hay un correo destinatario no válido.");
  return { templateId, assetId, cronExpression, timezone, active, recipients };
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "reports.read");
    const { page, pageSize, offset } = parsePage(request);
    const assetId = request.nextUrl.searchParams.get("assetId") || "";
    if (assetId) await requireReportAsset(db, user, assetId);
    const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id));
    const filters: SQL[] = [eq(assets.siteId, user.siteId)];
    if (assetId) filters.push(eq(reportSchedules.assetId, assetId));
    if (scopes.length) filters.push(inArray(reportSchedules.assetId, scopes.map((scope) => scope.assetId)));
    const where = and(...filters);
    const [items, totalRows] = await Promise.all([
      db.select({
        id: reportSchedules.id,
        templateId: reportTemplates.id,
        templateName: reportTemplates.name,
        assetId: assets.id,
        assetCode: assets.code,
        assetName: assets.name,
        cronExpression: reportSchedules.cronExpression,
        timezone: reportSchedules.timezone,
        recipients: reportSchedules.recipients,
        active: reportSchedules.active,
        nextRunAt: reportSchedules.nextRunAt,
        createdAt: reportSchedules.createdAt,
        updatedAt: reportSchedules.updatedAt,
      }).from(reportSchedules).innerJoin(reportTemplates, eq(reportTemplates.id, reportSchedules.templateId)).innerJoin(assets, eq(assets.id, reportSchedules.assetId)).where(where).orderBy(desc(reportSchedules.active), reportSchedules.nextRunAt).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(reportSchedules).innerJoin(assets, eq(assets.id, reportSchedules.assetId)).where(where),
    ]);
    const total = Number(totalRows[0]?.total ?? 0);
    return Response.json({ items: items.map((item) => ({ ...item, nextRunAt: item.nextRunAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "reports.schedule");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibió la programación.");
    const values = parseScheduleBody(body);
    await requireReportAsset(db, user, values.assetId);
    const [template] = await db.select({ id: reportTemplates.id }).from(reportTemplates).where(and(eq(reportTemplates.id, values.templateId), eq(reportTemplates.active, true), or(isNull(reportTemplates.siteId), eq(reportTemplates.siteId, user.siteId)))).limit(1);
    if (!template) throw new ApiError(400, "La plantilla no está disponible para el sitio activo.");
    const now = new Date();
    const [item] = await db.insert(reportSchedules).values({ ...values, createdBy: user.id, nextRunAt: values.active ? nextCronRun(values.cronExpression, values.timezone, now) : null, createdAt: now, updatedAt: now }).returning();
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "report_schedules.create", resourceType: "report_schedule", resourceId: item.id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, after: item });
    return Response.json({ item }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
