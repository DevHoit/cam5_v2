import type { NextRequest } from "next/server";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  alarms,
  assets,
  deviceMetrics,
  devices,
  metricDefinitions,
  metricReadingAggregates,
  metricReadings,
} from "../../../../../db/schema";
import { parseColdChainConfig } from "../../../../../db/cold-chain";
import { detectTemperatureExcursions } from "../../../../../db/cold-chain-history";
import { apiErrorResponse, ApiError, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const RAW_RANGE_MS = 30 * 60 * 60 * 1000;
const MAX_RAW_POINTS = 25_000;

function parseDate(value: string | null, fallback: Date, label: string) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ApiError(400, label + " no es una fecha válida.");
  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "history.read");
    const chamberId = request.nextUrl.searchParams.get("chamberId");
    if (!chamberId) throw new ApiError(400, "chamberId es obligatorio.");

    const now = new Date();
    const to = parseDate(request.nextUrl.searchParams.get("to"), now, "to");
    const from = parseDate(request.nextUrl.searchParams.get("from"), new Date(to.getTime() - DEFAULT_RANGE_MS), "from");
    if (from >= to) throw new ApiError(400, "from debe ser anterior a to.");
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new ApiError(400, "El rango máximo es 31 días.");

    const [chamber] = await db.select({
      id: assets.id,
      code: assets.code,
      name: assets.name,
      area: assets.area,
      state: assets.state,
      metadata: assets.metadata,
    }).from(assets).where(and(
      eq(assets.id, chamberId),
      eq(assets.siteId, user.siteId),
      eq(assets.assetType, "cold_room"),
      eq(assets.active, true),
    )).limit(1);
    if (!chamber) throw new ApiError(404, "La cámara no existe en el sitio activo.");

    const config = parseColdChainConfig(chamber.metadata);

    const sensorMetrics = await db.select({
      deviceId: devices.id,
      deviceCode: devices.code,
      deviceName: devices.name,
      metricId: deviceMetrics.id,
    }).from(deviceMetrics)
      .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
      .innerJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
      .where(and(
        eq(devices.assetId, chamberId),
        eq(devices.active, true),
        eq(deviceMetrics.enabled, true),
        eq(metricDefinitions.key, "environment.temperature"),
      ))
      .orderBy(devices.code);

    if (!sensorMetrics.length) {
      return Response.json({
        schemaVersion: "2.0",
        serverTime: now.toISOString(),
        chamber: { id: chamber.id, code: chamber.code, name: chamber.name, area: chamber.area, state: chamber.state, config },
        range: { from: from.toISOString(), to: to.toISOString(), source, bucketSeconds: rawMode ? null : bucketSeconds },
        summary: { minimumC: null, maximumC: null, averageC: null, excursionCount: 0, totalOutOfRangeSeconds: 0, dataGapCount: 0 },
        sensors: [],
        excursions: [],
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const metricIds = sensorMetrics.map((item) => item.metricId);
    const rangeMs = to.getTime() - from.getTime();
    const rawMode = rangeMs <= RAW_RANGE_MS;
    const bucketSeconds = rangeMs <= 7 * 24 * 60 * 60 * 1000 ? 300 : 3600;

    type HistoryPoint = {
      recordedAt: Date;
      valueC: number | null;
      minimumC: number | null;
      maximumC: number | null;
      quality: string;
      validSamples: number;
      totalSamples: number;
    };
    const grouped = new Map<string, HistoryPoint[]>(metricIds.map((id) => [id, []]));
    let source: "raw" | "stored_aggregate" | "raw_grouped_fallback" = rawMode ? "raw" : "stored_aggregate";

    if (rawMode) {
      const rows = await db.select({
        metricId: metricReadings.deviceMetricId,
        recordedAt: metricReadings.recordedAt,
        valueNumeric: metricReadings.valueNumeric,
        quality: metricReadings.quality,
      }).from(metricReadings)
        .where(and(
          inArray(metricReadings.deviceMetricId, metricIds),
          gte(metricReadings.recordedAt, from),
          lte(metricReadings.recordedAt, to),
        ))
        .orderBy(asc(metricReadings.recordedAt))
        .limit(MAX_RAW_POINTS + 1);
      if (rows.length > MAX_RAW_POINTS) throw new ApiError(413, "La consulta cruda supera 25.000 muestras. Utiliza un rango mayor para activar agregación automática.");
      for (const row of rows) {
        grouped.get(row.metricId)?.push({
          recordedAt: row.recordedAt,
          valueC: row.valueNumeric === null ? null : Number(row.valueNumeric),
          minimumC: row.valueNumeric === null ? null : Number(row.valueNumeric),
          maximumC: row.valueNumeric === null ? null : Number(row.valueNumeric),
          quality: row.quality,
          validSamples: row.quality === "good" && row.valueNumeric !== null ? 1 : 0,
          totalSamples: 1,
        });
      }
    } else {
      const aggregateRows = await db.select({
        metricId: metricReadingAggregates.deviceMetricId,
        recordedAt: metricReadingAggregates.bucketStart,
        averageValue: metricReadingAggregates.averageValue,
        minimumValue: metricReadingAggregates.minimumValue,
        maximumValue: metricReadingAggregates.maximumValue,
        sampleCount: metricReadingAggregates.sampleCount,
        invalidSampleCount: metricReadingAggregates.invalidSampleCount,
      }).from(metricReadingAggregates)
        .where(and(
          inArray(metricReadingAggregates.deviceMetricId, metricIds),
          eq(metricReadingAggregates.bucketSeconds, bucketSeconds),
          gte(metricReadingAggregates.bucketStart, from),
          lte(metricReadingAggregates.bucketStart, to),
        ))
        .orderBy(asc(metricReadingAggregates.bucketStart));

      const coveredMetrics = new Set(aggregateRows.map((row) => row.metricId));
      for (const row of aggregateRows) {
        const totalSamples = Number(row.sampleCount);
        const invalidSamples = Number(row.invalidSampleCount);
        grouped.get(row.metricId)?.push({
          recordedAt: row.recordedAt,
          valueC: row.averageValue === null ? null : Number(row.averageValue),
          minimumC: row.minimumValue === null ? null : Number(row.minimumValue),
          maximumC: row.maximumValue === null ? null : Number(row.maximumValue),
          quality: invalidSamples === 0 ? "good" : invalidSamples >= totalSamples ? "bad" : "stale",
          validSamples: Math.max(0, totalSamples - invalidSamples),
          totalSamples,
        });
      }

      const missingMetricIds = metricIds.filter((id) => !coveredMetrics.has(id));
      if (missingMetricIds.length) {
        source = "raw_grouped_fallback";
        const bucket = sql<Date>`date_bin(make_interval(secs => ${sql.raw(String(bucketSeconds))}), ${metricReadings.recordedAt}, '1970-01-01 00:00:00+00'::timestamptz)`;
        const fallbackRows = await db.select({
          metricId: metricReadings.deviceMetricId,
          recordedAt: bucket,
          averageValue: sql<string | null>`avg(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
          minimumValue: sql<string | null>`min(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
          maximumValue: sql<string | null>`max(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
          sampleCount: sql<number>`count(*)::integer`,
          invalidSampleCount: sql<number>`count(*) filter (where ${metricReadings.quality} <> 'good' or ${metricReadings.valueNumeric} is null)::integer`,
        }).from(metricReadings)
          .where(and(
            inArray(metricReadings.deviceMetricId, missingMetricIds),
            gte(metricReadings.recordedAt, from),
            lte(metricReadings.recordedAt, to),
          ))
          .groupBy(metricReadings.deviceMetricId, bucket)
          .orderBy(asc(bucket));
        for (const row of fallbackRows) {
          const totalSamples = Number(row.sampleCount);
          const invalidSamples = Number(row.invalidSampleCount);
          grouped.get(row.metricId)?.push({
            recordedAt: new Date(row.recordedAt),
            valueC: row.averageValue === null ? null : Number(row.averageValue),
            minimumC: row.minimumValue === null ? null : Number(row.minimumValue),
            maximumC: row.maximumValue === null ? null : Number(row.maximumValue),
            quality: invalidSamples === 0 ? "good" : invalidSamples >= totalSamples ? "bad" : "stale",
            validSamples: Math.max(0, totalSamples - invalidSamples),
            totalSamples,
          });
        }
      }
    }

    const alarmRows = rawMode ? [] : await db.select({
      id: alarms.id,
      status: alarms.status,
      openedAt: alarms.openedAt,
      resolvedAt: alarms.resolvedAt,
      closedAt: alarms.closedAt,
      triggerValue: alarms.triggerValue,
      thresholdValue: alarms.thresholdValue,
      context: alarms.context,
    }).from(alarms)
      .where(and(eq(alarms.assetId, chamberId), lte(alarms.openedAt, to)))
      .orderBy(desc(alarms.openedAt))
      .limit(1000);

    const historicalAlarmExcursions = alarmRows.flatMap((alarm) => {
      const context = alarm.context ?? {};
      if (context.source !== "cold_chain" || typeof context.subtype !== "string") return [];
      const endedAt = alarm.resolvedAt ?? alarm.closedAt;
      if (endedAt && endedAt < from) return [];
      const type = context.subtype === "temperature_high"
        ? "high"
        : context.subtype === "temperature_low"
          ? "low"
          : null;
      if (!type || typeof context.sensorCode !== "string") return [];
      const sensor = sensorMetrics.find((item) => item.deviceCode === context.sensorCode);
      if (!sensor) return [];
      const effectiveStart = alarm.openedAt < from ? from : alarm.openedAt;
      const effectiveEnd = endedAt && endedAt < to ? endedAt : to;
      return [{
        type,
        startedAt: effectiveStart.toISOString(),
        endedAt: endedAt ? effectiveEnd.toISOString() : null,
        durationSeconds: Math.max(0, Math.round((effectiveEnd.getTime() - effectiveStart.getTime()) / 1000)),
        extremeC: alarm.triggerValue === null ? null : Number(alarm.triggerValue),
        thresholdC: alarm.thresholdValue === null ? null : Number(alarm.thresholdValue),
        active: !endedAt,
        sensorId: sensor.deviceId,
        sensorCode: sensor.deviceCode,
        sensorName: sensor.deviceName,
      }];
    });

    const sensors = sensorMetrics.map((sensor) => {
      const points = (grouped.get(sensor.metricId) ?? []).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
      const totalSamples = points.reduce((sum, point) => sum + point.totalSamples, 0);
      const goodSamples = points.reduce((sum, point) => sum + point.validSamples, 0);
      const weightedTotal = points.reduce((sum, point) => sum + (point.valueC ?? 0) * point.validSamples, 0);
      const minimumValues = points.filter((point) => point.minimumC !== null).map((point) => point.minimumC as number);
      const maximumValues = points.filter((point) => point.maximumC !== null).map((point) => point.maximumC as number);
      const detected = rawMode ? detectTemperatureExcursions({
        points: points.map((point) => ({ recordedAt: point.recordedAt, valueC: point.valueC, quality: point.quality })),
        minimumC: config.minimumC,
        maximumC: config.maximumC,
        staleAfterSeconds: config.staleAfterSeconds,
        excursionDelaySeconds: config.excursionDelaySeconds,
        rangeEnd: to,
      }) : [];
      return {
        id: sensor.deviceId,
        code: sensor.deviceCode,
        name: sensor.deviceName,
        points: points.map((point) => ({
          recordedAt: point.recordedAt.toISOString(),
          valueC: point.valueC,
          quality: point.quality,
        })),
        summary: {
          minimumC: minimumValues.length ? Math.min(...minimumValues) : null,
          maximumC: maximumValues.length ? Math.max(...maximumValues) : null,
          averageC: goodSamples ? weightedTotal / goodSamples : null,
          samples: totalSamples,
          goodSamples,
        },
        excursions: detected.map((item) => ({
          type: item.type,
          startedAt: item.startedAt.toISOString(),
          endedAt: item.endedAt?.toISOString() ?? null,
          durationSeconds: item.durationSeconds,
          extremeC: item.extremeC,
          thresholdC: item.thresholdC,
          active: item.active,
        })),
      };
    });

    const allValues = sensors.flatMap((sensor) => sensor.points)
      .filter((point) => point.quality === "good" && point.valueC !== null)
      .map((point) => point.valueC as number);
    const rawExcursions = sensors.flatMap((sensor) => sensor.excursions.map((item) => ({
      ...item,
      sensorId: sensor.id,
      sensorCode: sensor.code,
      sensorName: sensor.name,
    })));
    const excursions = (rawMode ? rawExcursions : historicalAlarmExcursions)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const thermalExcursions = excursions.filter((item) => item.type === "low" || item.type === "high");
    const intervals = thermalExcursions
      .map((item) => ({
        start: Math.max(from.getTime(), new Date(item.startedAt).getTime()),
        end: Math.min(to.getTime(), item.endedAt ? new Date(item.endedAt).getTime() : to.getTime()),
      }))
      .filter((item) => item.end > item.start)
      .sort((a, b) => a.start - b.start);
    let affectedMs = 0;
    let current: { start: number; end: number } | null = null;
    for (const interval of intervals) {
      if (!current) current = { ...interval };
      else if (interval.start <= current.end) current.end = Math.max(current.end, interval.end);
      else {
        affectedMs += current.end - current.start;
        current = { ...interval };
      }
    }
    if (current) affectedMs += current.end - current.start;

    return Response.json({
      schemaVersion: "2.0",
      serverTime: now.toISOString(),
      chamber: { id: chamber.id, code: chamber.code, name: chamber.name, area: chamber.area, state: chamber.state, config },
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        minimumC: allValues.length ? Math.min(...allValues) : null,
        maximumC: allValues.length ? Math.max(...allValues) : null,
        averageC: allValues.length ? allValues.reduce((total, value) => total + value, 0) / allValues.length : null,
        excursionCount: thermalExcursions.length,
        totalOutOfRangeSeconds: Math.round(affectedMs / 1000),
        dataGapCount: excursions.filter((item) => item.type === "data_gap").length,
      },
      sensors,
      excursions,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
