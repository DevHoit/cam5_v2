import type { NextRequest } from "next/server";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  assets,
  deviceMetrics,
  devices,
  metricDefinitions,
  metricReadings,
} from "../../../../../db/schema";
import { parseColdChainConfig } from "../../../../../db/cold-chain";
import { detectTemperatureExcursions } from "../../../../../db/cold-chain-history";
import { apiErrorResponse, ApiError, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_POINTS_PER_SENSOR = 20_000;

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
        range: { from: from.toISOString(), to: to.toISOString() },
        summary: { minimumC: null, maximumC: null, averageC: null, excursionCount: 0, totalOutOfRangeSeconds: 0, dataGapCount: 0 },
        sensors: [],
        excursions: [],
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const metricIds = sensorMetrics.map((item) => item.metricId);
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
      .orderBy(asc(metricReadings.recordedAt));

    const sensorByMetric = new Map(sensorMetrics.map((item) => [item.metricId, item]));
    const grouped = new Map<string, Array<{ recordedAt: Date; valueC: number | null; quality: string }>>();
    for (const row of rows) {
      const list = grouped.get(row.metricId) ?? [];
      if (list.length < MAX_POINTS_PER_SENSOR) {
        list.push({
          recordedAt: row.recordedAt,
          valueC: row.valueNumeric === null ? null : Number(row.valueNumeric),
          quality: row.quality,
        });
      }
      grouped.set(row.metricId, list);
    }

    const sensors = sensorMetrics.map((sensor) => {
      const points = grouped.get(sensor.metricId) ?? [];
      const numeric = points.filter((point) => point.quality === "good" && point.valueC !== null).map((point) => point.valueC as number);
      const excursions = detectTemperatureExcursions({
        points,
        minimumC: config.minimumC,
        maximumC: config.maximumC,
        staleAfterSeconds: config.staleAfterSeconds,
        excursionDelaySeconds: config.excursionDelaySeconds,
        rangeEnd: to,
      });
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
          minimumC: numeric.length ? Math.min(...numeric) : null,
          maximumC: numeric.length ? Math.max(...numeric) : null,
          averageC: numeric.length ? numeric.reduce((total, value) => total + value, 0) / numeric.length : null,
          samples: points.length,
          goodSamples: numeric.length,
        },
        excursions: excursions.map((item) => ({
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
    const excursions = sensors.flatMap((sensor) => sensor.excursions.map((item) => ({
      ...item,
      sensorId: sensor.id,
      sensorCode: sensor.code,
      sensorName: sensor.name,
    }))).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const thermalExcursions = excursions.filter((item) => item.type === "low" || item.type === "high");

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
        totalOutOfRangeSeconds: thermalExcursions.reduce((total, item) => total + item.durationSeconds, 0),
        dataGapCount: excursions.filter((item) => item.type === "data_gap").length,
      },
      sensors,
      excursions,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
