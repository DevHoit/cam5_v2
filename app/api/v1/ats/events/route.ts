import type { NextRequest } from "next/server";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  assets,
  deviceMetrics,
  devices,
  metricDefinitions,
  metricReadings,
} from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;
const STATE_KEYS = [
  "ats.source1.available",
  "ats.source2.available",
  "ats.breaker.source1_closed",
  "ats.breaker.source2_closed",
  "ats.transfer.position",
  "ats.common_alarm",
  "dse.mode",
] as const;

function parseDate(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "El rango de fechas no es válido.");
  return date;
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "history.read");
    const assetId = request.nextUrl.searchParams.get("assetId");
    if (!assetId) throw new ApiError(400, "assetId es obligatorio.");

    const to = parseDate(request.nextUrl.searchParams.get("to"), new Date());
    const from = parseDate(request.nextUrl.searchParams.get("from"), new Date(to.getTime() - DEFAULT_RANGE_MS));
    if (from >= to) throw new ApiError(400, "El inicio debe ser anterior al fin.");
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new ApiError(400, "El rango máximo es de 31 días.");

    const [asset] = await db.select({
      id: assets.id,
      code: assets.code,
      name: assets.name,
    }).from(assets).where(and(
      eq(assets.id, assetId),
      eq(assets.siteId, user.siteId),
      eq(assets.assetType, "ats"),
      eq(assets.active, true),
    )).limit(1);
    if (!asset) throw new ApiError(404, "El ATS no existe en el sitio activo.");

    const metricRows = await db.select({
      deviceMetricId: deviceMetrics.id,
    }).from(deviceMetrics)
      .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
      .innerJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
      .where(and(
        eq(devices.assetId, assetId),
        eq(devices.active, true),
        eq(devices.deviceType, "ats_controller"),
        eq(deviceMetrics.enabled, true),
        inArray(metricDefinitions.key, [...STATE_KEYS]),
      ));
    const metricIds = metricRows.map((item) => item.deviceMetricId);

    if (!metricIds.length) {
      return Response.json({
        range: { from: from.toISOString(), to: to.toISOString() },
        asset,
        events: [],
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const stateValue = sql<string | null>\`
      case
        when \${metricDefinitions.dataType} = 'boolean' then
          case when \${metricReadings.valueBoolean} is true then 'true'
               when \${metricReadings.valueBoolean} is false then 'false'
               else null end
        else \${metricReadings.valueText}
      end
    \`;
    const ordered = db.select({
      recordedAt: metricReadings.recordedAt,
      deviceCode: devices.code,
      deviceName: devices.name,
      metricKey: metricDefinitions.key,
      metricName: metricDefinitions.name,
      currentValue: stateValue.as("current_value"),
      previousValue: sql<string | null>\`lag(\${stateValue}) over (
        partition by \${metricReadings.deviceMetricId}
        order by \${metricReadings.recordedAt}
      )\`.as("previous_value"),
      quality: metricReadings.quality,
    }).from(metricReadings)
      .innerJoin(deviceMetrics, eq(deviceMetrics.id, metricReadings.deviceMetricId))
      .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
      .innerJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
      .where(and(
        inArray(metricReadings.deviceMetricId, metricIds),
        gte(metricReadings.recordedAt, from),
        lte(metricReadings.recordedAt, to),
      ))
      .as("ats_state_ordered");

    const events = await db.select().from(ordered)
      .where(sql\`\${ordered.currentValue} is distinct from \${ordered.previousValue}\`)
      .orderBy(asc(ordered.recordedAt))
      .limit(1000);

    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString(), truncated: events.length === 1000 },
      asset,
      events: events.map((event) => ({
        recordedAt: event.recordedAt.toISOString(),
        deviceCode: event.deviceCode,
        deviceName: event.deviceName,
        metricKey: event.metricKey,
        metricName: event.metricName,
        previousValue: event.previousValue,
        value: event.currentValue,
        quality: event.quality,
        initialObservation: event.previousValue === null,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
