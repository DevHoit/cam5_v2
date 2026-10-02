import type { NextRequest } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import {
  assets,
  deviceMetrics,
  devices,
  metricDefinitions,
  metricReadings,
} from "../../../../../../db/schema";
import { apiErrorResponse, ApiError, requireApiSession } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;
const MAX_POINTS = 20_000;

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
      .limit(MAX_POINTS);

    return Response.json({
      schemaVersion: "2.0",
      serverTime: now.toISOString(),
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        truncated: rows.length === MAX_POINTS,
        maxPoints: MAX_POINTS,
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
      points: rows.map((row) => ({
        recordedAt: row.recordedAt.toISOString(),
        receivedAt: row.receivedAt.toISOString(),
        value: metric.dataType === "boolean"
          ? row.valueBoolean
          : metric.dataType === "string" || metric.dataType === "enum"
            ? row.valueText
            : row.valueNumeric === null
              ? null
              : Number(row.valueNumeric),
        quality: row.quality,
        qualityFlags: row.qualityFlags,
        timeQuality: row.timeQuality,
        sequence: row.sequence ?? null,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
