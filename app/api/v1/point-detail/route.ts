import type { NextRequest } from "next/server";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { buildHistory, energyToday, findExcursions, historyStart, loadBuckets, localMidnight } from "../../../../db/point-history";
import { classifyPoint, POINT_SYSTEMS, resolvePointConfig, type PointSensorReading } from "../../../../db/point-types";
import { alarms, assets, channels, deviceModels, devices, latestReadings, measurementQuantities, pointRangeStates, pointTypes, readingProfiles, sites } from "../../../../db/schema";
import { apiErrorResponse, ApiError, requireApiSession, requireAssetInScope } from "../_lib/auth";

export const dynamic = "force-dynamic";

/** Periodo del detalle y el agregado que usa: 24 h en intervalos de 5 min, 7 días en intervalos de 1 h. */
const PERIODS = { 24: 300, 168: 3600 } as const;

/**
 * Detalle de un punto de frío, energía o respaldo: curva de cada sensor con la banda objetivo,
 * excursiones con hora y duración, estado de cada sensor (incluida su salud) y alarmas recientes.
 */
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "condition.read");
    const assetId = request.nextUrl.searchParams.get("assetId") ?? "";
    const hours = Number(request.nextUrl.searchParams.get("hours") ?? 24) as keyof typeof PERIODS;
    if (!(hours in PERIODS)) throw new ApiError(400, "El periodo debe ser 24 o 168 horas.");
    const bucketSeconds = PERIODS[hours];
    const [point] = await db.select({
      id: assets.id,
      code: assets.code,
      name: assets.name,
      area: assets.area,
      siteId: assets.siteId,
      type: assets.assetType,
      config: assets.config,
      typeName: pointTypes.name,
      system: pointTypes.system,
      primaryQuantity: pointTypes.primaryQuantity,
      aggregation: pointTypes.aggregation,
      defaultConfig: pointTypes.defaultConfig,
    }).from(assets).innerJoin(pointTypes, eq(pointTypes.key, assets.assetType))
      .where(and(eq(assets.id, assetId), eq(assets.siteId, user.siteId), eq(assets.active, true))).limit(1);
    if (!point) throw new ApiError(404, "El punto de medición no existe en el sitio activo.");
    await requireAssetInScope(db, user.id, point.id);

    const now = new Date();
    const config = resolvePointConfig({ aggregation: point.aggregation, defaultConfig: point.defaultConfig }, point.config);
    const rows = await db.select({
      channelId: channels.id,
      channelCode: channels.code,
      channelName: channels.name,
      metric: channels.metric,
      role: channels.role,
      unit: channels.unit,
      decimals: measurementQuantities.decimals,
      quantityName: measurementQuantities.name,
      displayOrder: channels.displayOrder,
      deviceId: devices.id,
      deviceCode: devices.code,
      deviceName: devices.name,
      position: devices.position,
      externalId: devices.externalId,
      protocol: devices.protocol,
      model: deviceModels.name,
      lastReadAt: devices.lastReadAt,
      staleAfterSeconds: readingProfiles.staleAfterSeconds,
      value: latestReadings.value,
      quality: latestReadings.quality,
      recordedAt: latestReadings.recordedAt,
    }).from(channels)
      .innerJoin(devices, and(eq(devices.id, channels.deviceId), eq(devices.active, true)))
      .innerJoin(deviceModels, eq(deviceModels.id, devices.modelId))
      .innerJoin(measurementQuantities, eq(measurementQuantities.key, channels.metric))
      .leftJoin(readingProfiles, eq(readingProfiles.id, devices.readingProfileId))
      .leftJoin(latestReadings, eq(latestReadings.channelId, channels.id))
      .where(and(eq(channels.assetId, point.id), eq(channels.enabled, true)))
      .orderBy(asc(devices.position), asc(channels.displayOrder));

    const fresh = (row: (typeof rows)[number]) => Boolean(row.recordedAt && now.getTime() - row.recordedAt.getTime() <= (row.staleAfterSeconds ?? 180) * 1000);
    const primary = rows.filter((row) => row.role === "process" && row.metric === point.primaryQuantity);
    const readings: PointSensorReading[] = primary.map((row) => ({
      channelId: row.channelId, deviceId: row.deviceId, position: row.position,
      value: row.value === null ? null : Number(row.value),
      quality: row.quality === "good" && !fresh(row) ? "stale" : (row.quality ?? "stale") as PointSensorReading["quality"],
      recordedAt: row.recordedAt,
    }));
    const condition = classifyPoint(readings, config);

    const from = historyStart(now, hours, bucketSeconds);
    const buckets = await loadBuckets(db, primary.map((row) => row.channelId), from, bucketSeconds);
    const combined = buildHistory(buckets, config, from, now, bucketSeconds);
    // Cada sensor con su propia curva (con un solo canal, la regla del punto da su valor extremo por intervalo).
    const sensorSeries = primary.map((row) => ({
      deviceId: row.deviceId,
      position: row.position ?? row.deviceName,
      values: buildHistory(buckets.filter((bucket) => bucket.channelId === row.channelId), { ...config, aggregation: config.aggregation === "sum" ? "avg" : config.aggregation }, from, now, bucketSeconds).values,
    }));
    const excursions = config.rangeMin !== null || config.rangeMax !== null ? findExcursions(combined.values, sensorSeries, config, from, bucketSeconds) : [];

    const deviceIds = [...new Set(rows.map((row) => row.deviceId))];
    const sensors = deviceIds.map((deviceId) => {
      const own = rows.filter((row) => row.deviceId === deviceId);
      const first = own[0];
      const primaryRow = own.find((row) => row.role === "process" && row.metric === point.primaryQuantity);
      return {
        deviceId,
        code: first.deviceCode,
        name: first.deviceName,
        position: first.position,
        externalId: first.externalId,
        protocol: first.protocol,
        model: first.model,
        lastReadAt: first.lastReadAt?.toISOString() ?? null,
        stale: !first.lastReadAt || now.getTime() - first.lastReadAt.getTime() > (first.staleAfterSeconds ?? 180) * 1000,
        primary: primaryRow ? { value: primaryRow.value === null || !fresh(primaryRow) || primaryRow.quality !== "good" ? null : Number(primaryRow.value), unit: primaryRow.unit, decimals: primaryRow.decimals } : null,
        channels: own.map((row) => ({ code: row.channelCode, name: row.channelName, metric: row.metric, role: row.role, unit: row.unit, decimals: row.decimals, value: row.value === null || row.quality !== "good" ? null : Number(row.value) })),
      };
    });

    // Tableros: demanda máxima y energía del día, peor factor de potencia y mayor desbalance entre sus equipos.
    let electrical: null | { today: ReturnType<typeof energyToday>; powerFactor: number | null; unbalancePct: number | null } = null;
    if (point.system === "energy") {
      const [site] = await db.select({ timezone: sites.timezone }).from(sites).where(eq(sites.id, point.siteId)).limit(1);
      const midnight = localMidnight(now, site?.timezone ?? "America/Santiago");
      const energyIds = rows.filter((row) => row.role === "process" && row.metric === "energy").map((row) => row.channelId);
      const todayBuckets = await loadBuckets(db, [...primary.map((row) => row.channelId), ...energyIds], midnight, 300);
      const primaryIds = new Set(primary.map((row) => row.channelId));
      const unbalances = sensors.map((sensor) => {
        const currents = sensor.channels.filter((channel) => channel.metric === "current" && channel.value !== null).map((channel) => channel.value!);
        const average = currents.length ? currents.reduce((total, value) => total + value, 0) / currents.length : 0;
        return currents.length >= 2 && average > 0 ? Math.max(...currents.map((value) => Math.abs(value - average))) / average * 100 : null;
      }).filter((value): value is number => value !== null);
      const factors = sensors.flatMap((sensor) => sensor.channels.filter((channel) => channel.metric === "power_factor" && channel.value !== null).map((channel) => Math.abs(channel.value!)));
      electrical = {
        today: energyToday(todayBuckets.filter((bucket) => primaryIds.has(bucket.channelId)), todayBuckets.filter((bucket) => energyIds.includes(bucket.channelId)), midnight),
        powerFactor: factors.length ? Math.min(...factors) : null,
        unbalancePct: unbalances.length ? Math.round(Math.max(...unbalances) * 10) / 10 : null,
      };
    }

    const [state] = await db.select({ outSince: pointRangeStates.outSince }).from(pointRangeStates).where(eq(pointRangeStates.assetId, point.id)).limit(1);
    const recentAlarms = await db.select({
      id: alarms.id, title: alarms.title, detail: alarms.detail, severity: alarms.severity, status: alarms.status, kind: alarms.kind,
      openedAt: alarms.openedAt, resolvedAt: alarms.resolvedAt, acknowledgedAt: alarms.acknowledgedAt,
    }).from(alarms)
      .where(and(eq(alarms.assetId, point.id), gte(alarms.openedAt, new Date(now.getTime() - 7 * 24 * 3600_000))))
      .orderBy(desc(alarms.openedAt)).limit(15);
    const openAlarms = recentAlarms.filter((alarm) => alarm.status === "open" || alarm.status === "acknowledged");
    const primaryUnit = primary[0]?.unit ?? null;

    return Response.json({
      serverTime: now.toISOString(),
      point: { id: point.id, code: point.code, name: point.name, area: point.area, type: point.type, typeName: point.typeName, system: point.system, systemName: POINT_SYSTEMS[point.system], unit: primaryUnit, decimals: primary[0]?.decimals ?? 1, quantityName: primary[0]?.quantityName ?? null },
      config,
      condition: { status: condition.status, value: condition.value, deviation: condition.deviation, position: condition.decisive?.position ?? null, sensors: condition.sensors, reporting: condition.reporting, outSince: [state?.outSince?.toISOString(), combined.outSince].filter((value): value is string => Boolean(value)).sort()[0] ?? null },
      period: { hours, bucketSeconds, from: from.toISOString() },
      history: combined,
      series: sensorSeries,
      excursions,
      sensors,
      alarms: recentAlarms.map((alarm) => ({ ...alarm, openedAt: alarm.openedAt.toISOString(), resolvedAt: alarm.resolvedAt?.toISOString() ?? null, acknowledgedAt: alarm.acknowledgedAt?.toISOString() ?? null })),
      openAlarms: openAlarms.length,
      electrical,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
