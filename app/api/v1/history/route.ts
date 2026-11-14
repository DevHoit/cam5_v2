import type { NextRequest } from "next/server";
import { and, between, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import {
  alarms,
  assets,
  auditLogs,
  channels,
  userAssetScopes,
  users,
} from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requireApiSession } from "../_lib/auth";
import {
  HISTORY_CHANNEL_GROUPS,
  HISTORY_RESOLUTIONS,
  HistoryRangeError,
  historyCsvRows,
  historyRetention,
  listHistoryColumns,
  listHistoryRows,
  resolveHistoryResolution,
  type HistoryChannelGroup,
  type HistoryResolutionRequest,
} from "../../../../db/history";

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
    const assetId = request.nextUrl.searchParams.get("assetId") || "";
    const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id));
    const allowedAssetIds = scopes.map((scope) => scope.assetId);

    if (tab === "measurements") {
      if (!assetId) throw new ApiError(400, "Selecciona un punto de medición.");
      if (allowedAssetIds.length && !allowedAssetIds.includes(assetId)) throw new ApiError(403, "No tienes acceso al punto de medición indicado.");
      const [asset] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.id, assetId), eq(assets.siteId, user.siteId))).limit(1);
      if (!asset) throw new ApiError(404, "El punto de medición no pertenece al sitio activo.");
      const requestedResolution = request.nextUrl.searchParams.get("resolution") || "auto";
      if (!HISTORY_RESOLUTIONS.includes(requestedResolution as HistoryResolutionRequest)) throw new ApiError(400, "La resolución no es válida.");
      const group = request.nextUrl.searchParams.get("group") || "visible";
      if (!HISTORY_CHANNEL_GROUPS.includes(group as HistoryChannelGroup)) throw new ApiError(400, "El grupo de canales no es válido.");
      const retention = await historyRetention(db, assetId);
      let resolution;
      try {
        resolution = resolveHistoryResolution(from, to, requestedResolution as HistoryResolutionRequest, retention.rawDays, new Date(), retention.aggregateDays);
      } catch (resolutionError) {
        if (resolutionError instanceof HistoryRangeError) throw new ApiError(400, resolutionError.message);
        throw resolutionError;
      }
      const columns = await listHistoryColumns(db, assetId, user.id, group as HistoryChannelGroup);
      const rowsPageSize = Math.min(100, Math.max(10, Number.parseInt(request.nextUrl.searchParams.get("pageSize") || "50", 10) || 50));
      const { rows, total } = await listHistoryRows(db, {
        channelIds: columns.map((column) => column.id),
        from,
        to,
        resolution,
        limit: exporting ? 20_000 : rowsPageSize,
        offset: exporting ? 0 : (page - 1) * rowsPageSize,
      });
      if (exporting) return csvResponse(`hoitlive-historico-mediciones-${resolution.key === "raw" ? "por-envio" : resolution.key + "s"}.csv`, historyCsvRows(columns, rows, resolution));
      return Response.json({
        resolution,
        columns,
        rows,
        page,
        pageSize: rowsPageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / rowsPageSize)),
        from: from.toISOString(),
        to: to.toISOString(),
        retention: { ...retention, rawAvailableSince: new Date(Date.now() - retention.rawDays * 86_400_000).toISOString() },
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
