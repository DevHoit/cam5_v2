import type { NextRequest } from "next/server";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import {
  assets,
  deviceMetrics,
  devices,
  metricDefinitions,
  metricReadingAggregates,
  metricReadings,
} from "../../../../../../db/schema";
import { apiErrorResponse, ApiError, requireApiSession } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;
const RAW_RANGE_MS = 2 * 60 * 60 * 1000;
const MAX_RAW_POINTS = 50_000;

function dateParam(value: string | null, fallback: Date, label: string) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ApiError(400, `${label} no es una fecha válida.`);
  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "history.read");
    const deviceId = request.nextUrl.searchParams.get("deviceId");
    const metricKey = request.nextUrl.searchParams.get("metric");
    if (!deviceId) throw new ApiError(400, "deviceId es obligatorio.");
    if (!metricKey) throw new ApiError(400, "metric es obligatorio.");

    const now = new Date();
    const to = dateParam(request.nextUrl.searchParams.get("to"), now, "to");
    const from = dateParam(request.nextUrl.searchParams.get("from"), new Date(to.getTime() - DEFAULT_RANGE_MS), "from");
    if (from >= to) throw new ApiError(400, "from debe ser anterior a to.");
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new ApiError(400, "El rango máximo para telemetría cruda es 31 días.");

    const [metric] = await db.select({
      deviceMetricId: deviceMetrics.id,
      deviceCode: devices.code,
      deviceName: devices.name,
      deviceType: devices.deviceType,
      driver: devices.driver,
      assetId: assets.id,
      assetCode: assets.code,
      assetName: assets.name,
      metricKey: metricDefinitions.key,
      metricName: deviceMetrics.name,
      unit: metricDefinitions.unit,
      dataType: metricDefinitions.dataType,
      aggregation: metricDefinitions.aggregation,
    }).from(deviceMetrics)
      .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
      .innerJoin(assets, eq(assets.id, devices.assetId))
      .innerJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
      .where(and(
        eq(devices.id, deviceId),
        eq(assets.siteId, user.siteId),
        eq(devices.active, true),
        eq(assets.active, true),
        eq(deviceMetrics.enabled, true),
        eq(metricDefinitions.key, metricKey),
      ))
      .limit(1);

    if (!metric) throw new ApiError(404, "La métrica no existe o no está disponible en el sitio activo.");

    const rangeMs = to.getTime() - from.getTime();
    const numericMetric = metric.dataType === "float" || metric.dataType === "integer";
    const rawMode = !numericMetric || rangeMs <= RAW_RANGE_MS;
    const bucketSeconds = rangeMs <= 7 * 24 * 60 * 60 * 1000 ? 300 : 3600;
    let source: "raw" | "stored_aggregate" | "hybrid" | "raw_grouped_fallback" = rawMode ? "raw" : "stored_aggregate";

    type HistoryPoint = {
      recordedAt: Date;
      receivedAt: Date | null;
      value: number | boolean | string | null;
      minimum: number | null;
      maximum: number | null;
      quality: string;
      qualityFlags: string[];
      timeQuality: string;
      sequence: number | null;
      sampleCount: number;
      invalidSampleCount: number;
    };

    let points: HistoryPoint[] = [];

    if (rawMode) {
      const rows = await db.select({
        recordedAt: metricReadings.recordedAt,
        receivedAt: metricReadings.receivedAt,
        valueNumeric: metricReadings.valueNumeric,
        valueBoolean: metricReadings.valueBoolean,
        valueText: metricReadings.valueText,
        quality: metricReadings.quality,
        qualityFlags: metricReadings.qualityFlags,
        timeQuality: metricReadings.timeQuality,
        sequence: metricReadings.sequence,
      }).from(metricReadings)
        .where(and(
          eq(metricReadings.deviceMetricId, metric.deviceMetricId),
          gte(metricReadings.recordedAt, from),
          lte(metricReadings.recordedAt, to),
        ))
        .orderBy(asc(metricReadings.recordedAt))
        .limit(MAX_RAW_POINTS + 1);

      if (rows.length > MAX_RAW_POINTS) throw new ApiError(413, "La consulta cruda supera 50.000 muestras. Usa un rango mayor para activar agregación automática.");

      points = rows.map((row) => {
        const numeric = row.valueNumeric === null ? null : Number(row.valueNumeric);
        const value = metric.dataType === "boolean"
          ? row.valueBoolean
          : metric.dataType === "string" || metric.dataType === "enum"
            ? row.valueText
            : numeric;
        return {
          recordedAt: row.recordedAt,
          receivedAt: row.receivedAt,
          value,
          minimum: numeric,
          maximum: numeric,
          quality: row.quality,
          qualityFlags: row.qualityFlags,
          timeQuality: row.timeQuality,
          sequence: row.sequence ?? null,
          sampleCount: 1,
          invalidSampleCount: row.quality === "good" && value !== null ? 0 : 1,
        };
      });
    } else {
      const aggregateRows = await db.select({
        recordedAt: metricReadingAggregates.bucketStart,
        sampleCount: metricReadingAggregates.sampleCount,
        invalidSampleCount: metricReadingAggregates.invalidSampleCount,
        minimumValue: metricReadingAggregates.minimumValue,
        maximumValue: metricReadingAggregates.maximumValue,
        averageValue: metricReadingAggregates.averageValue,
        firstValue: metricReadingAggregates.firstValue,
        lastValue: metricReadingAggregates.lastValue,
      }).from(metricReadingAggregates)
        .where(and(
          eq(metricReadingAggregates.deviceMetricId, metric.deviceMetricId),
          eq(metricReadingAggregates.bucketSeconds, bucketSeconds),
          gte(metricReadingAggregates.bucketStart, from),
          lte(metricReadingAggregates.bucketStart, to),
        ))
        .orderBy(asc(metricReadingAggregates.bucketStart));

      const aggregatePoint = (row: typeof aggregateRows[number]): HistoryPoint => {
        const total = Number(row.sampleCount);
        const invalid = Number(row.invalidSampleCount);
        const selected = metric.aggregation === "counter"
          ? row.lastValue
          : metric.aggregation === "max"
            ? row.maximumValue
            : metric.aggregation === "min"
              ? row.minimumValue
              : row.averageValue;
        return {
          recordedAt: row.recordedAt,
          receivedAt: null,
          value: selected === null ? null : Number(selected),
          minimum: row.minimumValue === null ? null : Number(row.minimumValue),
          maximum: row.maximumValue === null ? null : Number(row.maximumValue),
          quality: invalid === 0 ? "good" : invalid >= total ? "bad" : "stale",
          qualityFlags: invalid > 0 ? ["aggregate_contains_invalid_samples"] : [],
          timeQuality: "estimated",
          sequence: null,
          sampleCount: total,
          invalidSampleCount: invalid,
        };
      };
      points = aggregateRows.map(aggregatePoint);

      const aggregateEnd = aggregateRows.length
        ? new Date(aggregateRows[aggregateRows.length - 1].recordedAt.getTime() + bucketSeconds * 1000)
        : from;
      if (aggregateEnd < to) {
        const bucket = sql<Date>`date_bin(make_interval(secs => ${sql.raw(String(bucketSeconds))}), ${metricReadings.recordedAt}, '1970-01-01 00:00:00+00'::timestamptz)`;
        const tailRows = await db.select({
          recordedAt: bucket,
          sampleCount: sql<number>`count(*)::integer`,
          invalidSampleCount: sql<number>`count(*) filter (where ${metricReadings.quality} <> 'good' or ${metricReadings.valueNumeric} is null)::integer`,
          minimumValue: sql<string | null>`min(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
          maximumValue: sql<string | null>`max(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
          averageValue: sql<string | null>`avg(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
          firstValue: sql<string | null>`(array_agg(${metricReadings.valueNumeric} order by ${metricReadings.recordedAt}) filter (where ${metricReadings.quality} = 'good' and ${metricReadings.valueNumeric} is not null))[1]`,
          lastValue: sql<string | null>`(array_agg(${metricReadings.valueNumeric} order by ${metricReadings.recordedAt} desc) filter (where ${metricReadings.quality} = 'good' and ${metricReadings.valueNumeric} is not null))[1]`,
        }).from(metricReadings)
          .where(and(
            eq(metricReadings.deviceMetricId, metric.deviceMetricId),
            gte(metricReadings.recordedAt, aggregateEnd),
            lte(metricReadings.recordedAt, to),
          ))
          .groupBy(bucket)
          .orderBy(asc(bucket));

        const byBucket = new Map(points.map((point) => [point.recordedAt.toISOString(), point]));
        for (const row of tailRows) byBucket.set(new Date(row.recordedAt).toISOString(), aggregatePoint({
          ...row,
          recordedAt: new Date(row.recordedAt),
        }));
        points = [...byBucket.values()].sort((left, right) => left.recordedAt.getTime() - right.recordedAt.getTime());
        if (!aggregateRows.length) source = "raw_grouped_fallback";
        else if (tailRows.length) source = "hybrid";
      }
    }

    return Response.json({
      schemaVersion: "2.0",
      serverTime: now.toISOString(),
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        source,
        bucketSeconds: rawMode ? null : bucketSeconds,
        truncated: false,
        maxPoints: rawMode ? MAX_RAW_POINTS : null,
      },
      asset: {
        id: metric.assetId,
        code: metric.assetCode,
        name: metric.assetName,
      },
      device: {
        id: deviceId,
        code: metric.deviceCode,
        name: metric.deviceName,
        deviceType: metric.deviceType,
        driver: metric.driver,
      },
      metric: {
        key: metric.metricKey,
        name: metric.metricName,
        unit: metric.unit,
        dataType: metric.dataType,
      },
      points: points.map((point) => ({
        recordedAt: point.recordedAt.toISOString(),
        receivedAt: point.receivedAt?.toISOString() ?? null,
        value: point.value,
        minimum: point.minimum,
        maximum: point.maximum,
        quality: point.quality,
        qualityFlags: point.qualityFlags,
        timeQuality: point.timeQuality,
        sequence: point.sequence,
        sampleCount: point.sampleCount,
        invalidSampleCount: point.invalidSampleCount,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
