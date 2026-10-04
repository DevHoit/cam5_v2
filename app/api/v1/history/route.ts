import type { NextRequest } from "next/server";
import { and, between, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import {
  alarms,
  assets,
  auditLogs,
  channels,
  deviceMetrics,
  devices,
  metricDefinitions,
  metricReadings,
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
      const [targetAsset] = assetId
        ? await db.select({ id: assets.id }).from(assets)
            .where(and(eq(assets.id, assetId), eq(assets.siteId, user.siteId), eq(assets.active, true)))
            .limit(1)
        : [];
      if (assetId && !targetAsset) throw new ApiError(404, "El activo no existe en el sitio activo.");

      // Prefer the normalized device -> metric model whenever the selected asset
      // actually exposes enabled metrics. This deliberately avoids branching on
      // assetType: capabilities may evolve independently from the asset label.
      const [normalizedMetric] = targetAsset
        ? await db.select({ id: deviceMetrics.id }).from(deviceMetrics)
            .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
            .where(and(
              eq(devices.assetId, targetAsset.id),
              eq(devices.active, true),
              eq(deviceMetrics.enabled, true),
            ))
            .limit(1)
        : [];
      const hasNormalizedMetrics = Boolean(normalizedMetric);

      if (hasNormalizedMetrics) {
        if (allowedAssetIds.length && assetId && !allowedAssetIds.includes(assetId)) throw new ApiError(403, "No tienes acceso al activo indicado.");
        const filters: SQL[] = [
          eq(assets.siteId, user.siteId),
          eq(assets.id, assetId),
          eq(assets.active, true),
          eq(devices.active, true),
          eq(deviceMetrics.enabled, true),
          between(metricReadings.recordedAt, from, to),
        ];
        if (channel !== "all") filters.push(or(eq(deviceMetrics.code, channel), eq(metricDefinitions.key, channel))!);
        if (q) filters.push(or(
          ilike(deviceMetrics.code, `%${q}%`),
          ilike(deviceMetrics.name, `%${q}%`),
          ilike(metricDefinitions.key, `%${q}%`),
          ilike(devices.code, `%${q}%`),
          ilike(devices.name, `%${q}%`),
        )!);
        const where = and(...filters);
        const [items, totals] = await Promise.all([
          db.select({
            id: metricReadings.id,
            recordedAt: metricReadings.recordedAt,
            receivedAt: metricReadings.receivedAt,
            code: deviceMetrics.code,
            name: deviceMetrics.name,
            deviceId: devices.id,
            deviceCode: devices.code,
            category: metricDefinitions.category,
            metricKey: metricDefinitions.key,
            unit: metricDefinitions.unit,
            dataType: metricDefinitions.dataType,
            valueNumeric: metricReadings.valueNumeric,
            valueBoolean: metricReadings.valueBoolean,
            valueText: metricReadings.valueText,
            quality: metricReadings.quality,
            qualityFlags: metricReadings.qualityFlags,
            sequence: metricReadings.sequence,
          }).from(metricReadings)
            .innerJoin(deviceMetrics, eq(deviceMetrics.id, metricReadings.deviceMetricId))
            .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
            .innerJoin(assets, eq(assets.id, devices.assetId))
            .innerJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
            .where(where)
            .orderBy(desc(metricReadings.recordedAt), desc(metricReadings.id))
            .limit(queryLimit)
            .offset(queryOffset),
          db.select({ total: count() }).from(metricReadings)
            .innerJoin(deviceMetrics, eq(deviceMetrics.id, metricReadings.deviceMetricId))
            .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
            .innerJoin(assets, eq(assets.id, devices.assetId))
            .innerJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
            .where(where),
        ]);
        const normalized = items.map((item) => {
          const value = item.dataType === "boolean"
            ? item.valueBoolean
            : item.dataType === "string" || item.dataType === "enum"
              ? item.valueText
              : item.valueNumeric === null ? null : Number(item.valueNumeric);
          return {
            id: item.id,
            recordedAt: item.recordedAt,
            receivedAt: item.receivedAt ?? item.recordedAt,
            code: item.code,
            name: item.name,
            zone: `${item.deviceCode} · ${item.category}`,
            deviceId: item.deviceId,
            metricKey: item.metricKey,
            dataType: item.dataType,
            unit: item.unit,
            value,
            rawValue: null,
            quality: item.quality,
            qualityFlags: item.qualityFlags,
            sequence: item.sequence,
          };
        });
        const total = Number(totals[0]?.total ?? 0);
        if (exporting) return csvResponse("hoitlive-historico-mediciones.csv", [
          ["fecha_medicion_utc", "fecha_recepcion_utc", "dispositivo", "metrica", "nombre", "valor", "unidad", "calidad", "banderas", "secuencia"],
          ...normalized.map((item) => [item.recordedAt.toISOString(), item.receivedAt.toISOString(), item.zone, item.metricKey, item.name, item.value, item.unit, item.quality, item.qualityFlags.join("|"), item.sequence]),
        ]);
        return Response.json({
          items: normalized.map((item) => ({
            ...item,
            recordedAt: item.recordedAt.toISOString(),
            receivedAt: item.receivedAt.toISOString(),
          })),
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
          from: from.toISOString(),
          to: to.toISOString(),
          source: "normalized_metrics",
        }, { headers: { "Cache-Control": "no-store" } });
      }

      const filters: SQL[] = [eq(assets.siteId, user.siteId), eq(channels.enabled, true), between(readings.recordedAt, from, to)];
      if (allowedAssetIds.length) filters.push(inArray(assets.id, allowedAssetIds));
      if (assetId) {
        if (allowedAssetIds.length && !allowedAssetIds.includes(assetId)) throw new ApiError(403, "No tienes acceso al activo indicado.");
        filters.push(eq(assets.id, assetId));
      }
      if (channel !== "all") filters.push(eq(channels.code, channel));
      if (q) filters.push(or(ilike(channels.code, `%${q}%`), ilike(channels.name, `%${q}%`), ilike(channels.zone, `%${q}%`))!);
      const where = and(...filters);
      const [items, totals] = await Promise.all([
        db.select({
          id: readings.id,
          recordedAt: readings.recordedAt,
          receivedAt: readings.receivedAt,
          code: channels.code,
          name: channels.name,
          zone: channels.zone,
          unit: channels.unit,
          value: readings.value,
          rawValue: readings.rawValue,
          quality: readings.quality,
          qualityFlags: readings.qualityFlags,
          sequence: readings.sequence,
        })
          .from(readings)
          .innerJoin(channels, eq(channels.id, readings.channelId))
          .innerJoin(assets, eq(assets.id, channels.assetId))
          .where(where)
          .orderBy(desc(readings.recordedAt), desc(readings.id))
          .limit(queryLimit)
          .offset(queryOffset),
        db.select({ total: count() }).from(readings).innerJoin(channels, eq(channels.id, readings.channelId)).innerJoin(assets, eq(assets.id, channels.assetId)).where(where),
      ]);
      const total = Number(totals[0]?.total ?? 0);
      if (exporting) return csvResponse("hoitlive-historico-mediciones.csv", [
        ["fecha_medicion_utc", "fecha_recepcion_utc", "canal", "nombre", "zona", "valor", "unidad", "valor_crudo", "calidad", "banderas", "secuencia"],
        ...items.map((item) => [item.recordedAt.toISOString(), item.receivedAt.toISOString(), item.code, item.name, item.zone, item.value, item.unit, item.rawValue, item.quality, item.qualityFlags.join("|"), item.sequence]),
      ]);
      return Response.json({
        items: items.map((item) => ({
          ...item,
          recordedAt: item.recordedAt.toISOString(),
          receivedAt: item.receivedAt.toISOString(),
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
        if (allowedAssetIds.length && !allowedAssetIds.includes(assetId)) throw new ApiError(403, "No tienes acceso al activo indicado.");
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
          deviceCode: devices.code,
          context: alarms.context,
          channelCode: channels.code,
          unit: channels.unit,
        }).from(alarms)
          .innerJoin(assets, eq(assets.id, alarms.assetId))
          .leftJoin(devices, eq(devices.id, alarms.deviceId))
          .leftJoin(channels, eq(channels.id, alarms.channelId))
          .where(where)
          .orderBy(desc(alarms.openedAt))
          .limit(queryLimit)
          .offset(queryOffset),
        db.select({ total: count() }).from(alarms).innerJoin(assets, eq(assets.id, alarms.assetId)).where(where),
      ]);
      const total = Number(totals[0]?.total ?? 0);
      if (exporting) return csvResponse("hoitlive-historico-alarmas.csv", [
        ["fecha_apertura_utc", "codigo", "severidad", "estado", "dispositivo", "origen", "titulo", "detalle", "valor", "unidad"],
        ...items.map((item) => [item.openedAt.toISOString(), item.code, item.severity, item.status, item.deviceCode, typeof item.context?.metricKey === "string" ? item.context.metricKey : item.channelCode, item.title, item.detail, item.triggerValue, item.unit]),
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
