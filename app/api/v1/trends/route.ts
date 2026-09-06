import type { NextRequest } from "next/server";
import { and, asc, between, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import {
  alarmRules,
  assets,
  channels,
  readingAggregates,
  readings,
  userAssetScopes,
} from "../../../../db/schema";
import { apiErrorResponse, ApiError, requireApiSession } from "../_lib/auth";
import { resolveTrendResolution, TREND_RESOLUTIONS, type RequestedTrendResolution } from "../_lib/trend-resolution";

export const dynamic = "force-dynamic";

function parseRange(request: NextRequest) {
  const now = new Date();
  const from = new Date(request.nextUrl.searchParams.get("from") || new Date(now.getTime() - 24 * 3600 * 1000).toISOString());
  const to = new Date(request.nextUrl.searchParams.get("to") || now.toISOString());
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) throw new ApiError(400, "El rango de la tendencia no es válido.");
  if (to.getTime() > now.getTime() + 5 * 60 * 1000) throw new ApiError(400, "La fecha final no puede estar en el futuro.");
  if (from.getTime() < now.getTime() - 5 * 365 * 86400 * 1000) throw new ApiError(400, "El periodo máximo de consulta es de cinco años.");
  return { from, to };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

type Point = {
  timestamp: string;
  value: number | null;
  minimum: number | null;
  maximum: number | null;
  quality: "good" | "stale" | "bad";
  validSamples: number;
  totalSamples: number;
};

export async function GET(request: NextRequest) {
  try {
    const format = request.nextUrl.searchParams.get("format") || "json";
    if (format !== "json" && format !== "csv") throw new ApiError(400, "El formato solicitado no es válido.");
    const { db, user } = await requireApiSession(request, "trends.read");
    if (format === "csv" && !user.permissions.includes("history.export")) throw new ApiError(403, "No tienes permisos para exportar históricos.");
    const assetId = request.nextUrl.searchParams.get("assetId") || "";
    if (!assetId) throw new ApiError(400, "Debes indicar el punto de medición.");
    const { from, to } = parseRange(request);
    const requestedResolution = request.nextUrl.searchParams.get("resolution") || "auto";
    if (!TREND_RESOLUTIONS.includes(requestedResolution as RequestedTrendResolution)) throw new ApiError(400, "La resolución solicitada no es válida.");
    const resolution = resolveTrendResolution(from, to, requestedResolution as RequestedTrendResolution);

    const [asset] = await db.select({ id: assets.id, code: assets.code, name: assets.name, siteId: assets.siteId })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.siteId, user.siteId), eq(assets.active, true)))
      .limit(1);
    if (!asset) throw new ApiError(404, "El punto de medición no existe en el sitio activo.");
    const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id));
    if (scopes.length && !scopes.some((scope) => scope.assetId === assetId)) throw new ApiError(403, "No tienes acceso al punto de medición indicado.");

    const requestedCodes = [...new Set((request.nextUrl.searchParams.get("channels") || "").split(",").map((code) => code.trim().toUpperCase()).filter(Boolean))];
    if (requestedCodes.length > 4) throw new ApiError(400, "Puedes comparar un máximo de cuatro canales.");
    const channelFilters = [eq(channels.assetId, assetId), eq(channels.enabled, true)];
    if (requestedCodes.length) channelFilters.push(inArray(channels.code, requestedCodes));
    const channelRows = await db.select({
      id: channels.id,
      code: channels.code,
      name: channels.name,
      zone: channels.zone,
      metric: channels.metric,
      unit: channels.unit,
      displayOrder: channels.displayOrder,
      warningThreshold: alarmRules.warningThreshold,
      criticalThreshold: alarmRules.criticalThreshold,
    }).from(channels)
      .leftJoin(alarmRules, eq(alarmRules.channelId, channels.id))
      .where(and(...channelFilters))
      .orderBy(asc(channels.displayOrder))
      .limit(requestedCodes.length ? 4 : 1);
    const channelRecords = requestedCodes.length
      ? [...channelRows].sort((a, b) => requestedCodes.indexOf(a.code) - requestedCodes.indexOf(b.code))
      : channelRows;
    if (!channelRecords.length) throw new ApiError(404, "No existen canales activos para la consulta.");
    if (requestedCodes.length && channelRecords.length !== requestedCodes.length) throw new ApiError(400, "Uno o más canales no pertenecen al punto activo o están deshabilitados.");
    const channelIds = channelRecords.map((channel) => channel.id);

    const pointsByChannel = new Map<string, Point[]>(channelIds.map((id) => [id, []]));
    let source: "raw" | "raw_grouped" | "stored_aggregate" | "hybrid" = resolution.bucketSeconds === 0 ? "raw" : "raw_grouped";

    if (resolution.bucketSeconds === 0) {
      const rawRows = await db.select({
        channelId: readings.channelId,
        timestamp: readings.recordedAt,
        value: readings.value,
        quality: readings.quality,
      }).from(readings)
        .where(and(inArray(readings.channelId, channelIds), between(readings.recordedAt, from, to)))
        .orderBy(asc(readings.recordedAt))
        .limit(25_001);
      if (rawRows.length > 25_000) throw new ApiError(413, "La consulta cruda supera 25.000 muestras. Reduce el rango o utiliza resolución automática.");
      rawRows.forEach((row) => pointsByChannel.get(row.channelId)?.push({
        timestamp: row.timestamp.toISOString(),
        value: row.value === null ? null : Number(row.value),
        minimum: row.value === null ? null : Number(row.value),
        maximum: row.value === null ? null : Number(row.value),
        quality: row.quality === "disabled" ? "bad" : row.quality,
        validSamples: row.quality === "good" && row.value !== null ? 1 : 0,
        totalSamples: 1,
      }));
    } else {
      const retentionCutoff = new Date(Date.now() - 30 * 86400 * 1000);
      const rawFrom = from > retentionCutoff ? from : retentionCutoff;
      const historicalTo = to < retentionCutoff ? to : retentionCutoff;

      if (from < retentionCutoff) {
        const aggregateRows = await db.select({
          channelId: readingAggregates.channelId,
          timestamp: readingAggregates.bucketStart,
          value: readingAggregates.averageValue,
          minimum: readingAggregates.minimumValue,
          maximum: readingAggregates.maximumValue,
          sampleCount: readingAggregates.sampleCount,
          invalidSampleCount: readingAggregates.invalidSampleCount,
        }).from(readingAggregates)
          .where(and(
            inArray(readingAggregates.channelId, channelIds),
            eq(readingAggregates.bucketSeconds, resolution.bucketSeconds),
            gte(readingAggregates.bucketStart, from),
            lt(readingAggregates.bucketStart, historicalTo),
          ))
          .orderBy(asc(readingAggregates.bucketStart));
        aggregateRows.forEach((row) => {
          const invalid = Number(row.invalidSampleCount);
          const total = Number(row.sampleCount);
          pointsByChannel.get(row.channelId)?.push({
            timestamp: row.timestamp.toISOString(),
            value: row.value === null ? null : Number(row.value),
            minimum: row.minimum === null ? null : Number(row.minimum),
            maximum: row.maximum === null ? null : Number(row.maximum),
            quality: invalid === 0 ? "good" : invalid >= total ? "bad" : "stale",
            validSamples: total - invalid,
            totalSamples: total,
          });
        });
        source = to <= retentionCutoff ? "stored_aggregate" : "hybrid";
      }

      if (to > retentionCutoff) {
        const bucketSeconds = sql.raw(String(resolution.bucketSeconds));
        const bucket = sql<Date>`date_bin(make_interval(secs => ${bucketSeconds}), ${readings.recordedAt}, '1970-01-01 00:00:00+00'::timestamptz)`;
        const groupedRows = await db.select({
          channelId: readings.channelId,
          timestamp: bucket,
          value: sql<string | null>`avg(${readings.value}) filter (where ${readings.quality} = 'good')`,
          minimum: sql<string | null>`min(${readings.value}) filter (where ${readings.quality} = 'good')`,
          maximum: sql<string | null>`max(${readings.value}) filter (where ${readings.quality} = 'good')`,
          sampleCount: sql<number>`count(*)::integer`,
          invalidSampleCount: sql<number>`count(*) filter (where ${readings.quality} <> 'good' or ${readings.value} is null)::integer`,
        }).from(readings)
          .where(and(inArray(readings.channelId, channelIds), gte(readings.recordedAt, rawFrom), lte(readings.recordedAt, to)))
          .groupBy(readings.channelId, bucket)
          .orderBy(asc(bucket));
        groupedRows.forEach((row) => {
          const invalid = Number(row.invalidSampleCount);
          const total = Number(row.sampleCount);
          pointsByChannel.get(row.channelId)?.push({
            timestamp: new Date(row.timestamp).toISOString(),
            value: row.value === null ? null : Number(row.value),
            minimum: row.minimum === null ? null : Number(row.minimum),
            maximum: row.maximum === null ? null : Number(row.maximum),
            quality: invalid === 0 ? "good" : invalid >= total ? "bad" : "stale",
            validSamples: total - invalid,
            totalSamples: total,
          });
        });
      }
    }

    const series = channelRecords.map((channel) => {
      const points = (pointsByChannel.get(channel.id) || []).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const valid = points.filter((point) => point.value !== null);
      const totalSamples = points.reduce((sum, point) => sum + point.totalSamples, 0);
      const validSamples = points.reduce((sum, point) => sum + point.validSamples, 0);
      const weightedTotal = valid.reduce((sum, point) => sum + (point.value || 0) * point.validSamples, 0);
      const firstValue = valid[0]?.value ?? null;
      const lastValue = valid.at(-1)?.value ?? null;
      return {
        id: channel.id,
        code: channel.code,
        name: channel.name,
        zone: channel.zone,
        metric: channel.metric,
        unit: channel.unit,
        warningThreshold: channel.warningThreshold === null ? null : Number(channel.warningThreshold),
        criticalThreshold: channel.criticalThreshold === null ? null : Number(channel.criticalThreshold),
        stats: {
          firstValue,
          lastValue,
          minimum: valid.length ? Math.min(...valid.map((point) => point.minimum ?? point.value!)) : null,
          maximum: valid.length ? Math.max(...valid.map((point) => point.maximum ?? point.value!)) : null,
          average: validSamples ? weightedTotal / validSamples : null,
          variation: firstValue === null || lastValue === null ? null : lastValue - firstValue,
          qualityPercent: totalSamples ? Math.round(validSamples / totalSamples * 10_000) / 100 : null,
          validSamples,
          totalSamples,
        },
        points,
      };
    });

    if (format === "csv") {
      const rows: unknown[][] = [["timestamp_utc", "canal", "nombre", "valor_promedio", "minimo", "maximo", "unidad", "calidad", "muestras_validas", "muestras_totales"]];
      series.forEach((channel) => channel.points.forEach((point) => rows.push([
        point.timestamp, channel.code, channel.name, point.value, point.minimum, point.maximum, channel.unit, point.quality, point.validSamples, point.totalSamples,
      ])));
      return new Response(rows.map((row) => row.map(csvCell).join(",")).join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="hoitlive-tendencias-${asset.code.toLowerCase()}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return Response.json({
      asset: { id: asset.id, code: asset.code, name: asset.name },
      from: from.toISOString(),
      to: to.toISOString(),
      resolution: { ...resolution, source, expectedStepSeconds: resolution.bucketSeconds || 2 },
      series,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
