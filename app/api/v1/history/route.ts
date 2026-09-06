import type { NextRequest } from "next/server";
import { and, asc, between, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  alarms,
  assets,
  auditLogs,
  channels,
  readings,
  userAssetScopes,
  users,
} from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

function parsePeriod(request: NextRequest) {
  const now = new Date();
  const fallbackFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const from = new Date(request.nextUrl.searchParams.get("from") || fallbackFrom.toISOString());
  const to = new Date(request.nextUrl.searchParams.get("to") || now.toISOString());
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new ApiError(400, "El rango de fechas no es válido.");
  return { from, to };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvResponse(filename: string, rows: unknown[][]) {
  return new Response(rows.map((row) => row.map(csvCell).join(",")).join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const tab = request.nextUrl.searchParams.get("tab") || "measurements";
    if (!(["measurements", "alarms", "audit"] as const).includes(tab as "measurements")) throw new ApiError(400, "El tipo de histórico no es válido.");
    const format = request.nextUrl.searchParams.get("format") || "json";
    if (format !== "json" && format !== "csv") throw new ApiError(400, "El formato solicitado no es válido.");
    const exporting = format === "csv";
    const requiredPermission = tab === "audit" ? "audit.read" : tab === "alarms" ? "alarms.read" : "history.read";
    const { db, user } = await requireApiSession(request, requiredPermission);
    if (exporting && !user.permissions.includes("history.export")) throw new ApiError(403, "No tienes permisos para exportar históricos.");
    const { page, pageSize, offset } = parsePage(request);
    const queryLimit = exporting ? 20_000 : pageSize;
    const queryOffset = exporting ? 0 : offset;
    const { from, to } = parsePeriod(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const channel = request.nextUrl.searchParams.get("channel") || "all";
    const assetId = request.nextUrl.searchParams.get("assetId") || "";
    const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id));
    const allowedAssetIds = scopes.map((scope) => scope.assetId);

    if (tab === "measurements") {
      const filters: SQL[] = [eq(assets.siteId, user.siteId), eq(channels.enabled, true)];
      if (allowedAssetIds.length) filters.push(inArray(assets.id, allowedAssetIds));
      if (assetId) {
        if (allowedAssetIds.length && !allowedAssetIds.includes(assetId)) throw new ApiError(403, "No tienes acceso al punto de medición indicado.");
        filters.push(eq(assets.id, assetId));
      }
      if (channel !== "all") filters.push(eq(channels.code, channel));
      if (q) filters.push(or(ilike(channels.code, `%${q}%`), ilike(channels.name, `%${q}%`), ilike(channels.zone, `%${q}%`))!);
      const where = and(...filters);
      const [items, totals] = await Promise.all([
        db.select({
          id: channels.id,
          code: channels.code,
          name: channels.name,
          zone: channels.zone,
          unit: channels.unit,
          lastRecordedAt: sql<Date | null>`max(${readings.recordedAt})`,
          lastValue: sql<string | null>`(array_agg(${readings.value} order by ${readings.recordedAt} desc) filter (where ${readings.id} is not null))[1]`,
          averageValue: sql<string | null>`avg(${readings.value})`,
          minimumValue: sql<string | null>`min(${readings.value})`,
          maximumValue: sql<string | null>`max(${readings.value})`,
          validSamples: sql<number>`count(${readings.id}) filter (where ${readings.quality} = 'good')`,
          totalSamples: count(readings.id),
        })
          .from(channels)
          .innerJoin(assets, eq(assets.id, channels.assetId))
          .leftJoin(readings, and(eq(readings.channelId, channels.id), between(readings.recordedAt, from, to)))
          .where(where)
          .groupBy(channels.id)
          .orderBy(asc(channels.displayOrder))
          .limit(queryLimit)
          .offset(queryOffset),
        db.select({ total: count() }).from(channels).innerJoin(assets, eq(assets.id, channels.assetId)).where(where),
      ]);
      const total = Number(totals[0]?.total ?? 0);
      if (exporting) return csvResponse("hoitlive-historico-mediciones.csv", [
        ["canal", "nombre", "zona", "ultima_lectura_utc", "ultimo_valor", "promedio", "minimo", "maximo", "unidad", "muestras_validas", "muestras_totales"],
        ...items.map((item) => [item.code, item.name, item.zone, item.lastRecordedAt?.toISOString() ?? null, item.lastValue, item.averageValue, item.minimumValue, item.maximumValue, item.unit, Number(item.validSamples), Number(item.totalSamples)]),
      ]);
      return Response.json({
        items: items.map((item) => ({
          ...item,
          lastRecordedAt: item.lastRecordedAt?.toISOString() ?? null,
          qualityPercent: Number(item.totalSamples) ? Math.round(Number(item.validSamples) / Number(item.totalSamples) * 10_000) / 100 : null,
          totalSamples: Number(item.totalSamples),
        })),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        from: from.toISOString(),
        to: to.toISOString(),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (tab === "alarms") {
      const filters: SQL[] = [eq(alarms.siteId, user.siteId), between(alarms.openedAt, from, to)];
      if (allowedAssetIds.length) filters.push(inArray(alarms.assetId, allowedAssetIds));
      if (assetId) {
        if (allowedAssetIds.length && !allowedAssetIds.includes(assetId)) throw new ApiError(403, "No tienes acceso al punto de medición indicado.");
        filters.push(eq(alarms.assetId, assetId));
      }
      if (q) filters.push(or(ilike(alarms.code, `%${q}%`), ilike(alarms.title, `%${q}%`), ilike(alarms.detail, `%${q}%`))!);
      const where = and(...filters);
      const [items, totals] = await Promise.all([
        db.select({
          id: alarms.id,
          code: alarms.code,
          openedAt: alarms.openedAt,
          severity: alarms.severity,
          status: alarms.status,
          title: alarms.title,
          detail: alarms.detail,
          triggerValue: alarms.triggerValue,
          channelCode: channels.code,
          unit: channels.unit,
        }).from(alarms)
          .innerJoin(assets, eq(assets.id, alarms.assetId))
          .leftJoin(channels, eq(channels.id, alarms.channelId))
          .where(where)
          .orderBy(desc(alarms.openedAt))
          .limit(queryLimit)
          .offset(queryOffset),
        db.select({ total: count() }).from(alarms).innerJoin(assets, eq(assets.id, alarms.assetId)).where(where),
      ]);
      const total = Number(totals[0]?.total ?? 0);
      if (exporting) return csvResponse("hoitlive-historico-alarmas.csv", [
        ["fecha_apertura_utc", "codigo", "severidad", "estado", "canal", "titulo", "detalle", "valor", "unidad"],
        ...items.map((item) => [item.openedAt.toISOString(), item.code, item.severity, item.status, item.channelCode, item.title, item.detail, item.triggerValue, item.unit]),
      ]);
      return Response.json({
        items: items.map((item) => ({ ...item, openedAt: item.openedAt.toISOString() })),
        page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), from: from.toISOString(), to: to.toISOString(),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const filters: SQL[] = [eq(auditLogs.siteId, user.siteId), between(auditLogs.createdAt, from, to)];
    if (q) filters.push(or(ilike(auditLogs.action, `%${q}%`), ilike(auditLogs.resourceType, `%${q}%`), ilike(auditLogs.resourceId, `%${q}%`))!);
    const where = and(...filters);
    const [items, totals] = await Promise.all([
      db.select({
        id: auditLogs.id,
        createdAt: auditLogs.createdAt,
        actor: users.displayName,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        outcome: auditLogs.outcome,
        metadata: auditLogs.metadata,
      }).from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(queryLimit)
        .offset(queryOffset),
      db.select({ total: count() }).from(auditLogs).where(where),
    ]);
    const total = Number(totals[0]?.total ?? 0);
    if (exporting) return csvResponse("hoitlive-historico-auditoria.csv", [
      ["fecha_utc", "usuario", "accion", "tipo_recurso", "id_recurso", "resultado"],
      ...items.map((item) => [item.createdAt.toISOString(), item.actor ?? "Sistema", item.action, item.resourceType, item.resourceId, item.outcome]),
    ]);
    return Response.json({
      items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), actor: item.actor ?? "Sistema" })),
      page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), from: from.toISOString(), to: to.toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
