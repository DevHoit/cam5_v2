import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  assets,
  deviceMetrics,
  devices,
  gatewayDeviceBindings,
  gateways,
  latestMetricReadings,
  metricDefinitions,
} from "../../../../../db/schema";
import { apiErrorResponse, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "condition.read");
    const rows = await db.select({
      assetId: assets.id,
      assetCode: assets.code,
      assetName: assets.name,
      area: assets.area,
      assetState: assets.state,
      nominalVoltageKv: assets.nominalVoltageKv,
      deviceId: devices.id,
      deviceCode: devices.code,
      deviceName: devices.name,
      deviceState: devices.state,
      unitId: devices.unitId,
      gatewayId: gateways.id,
      gatewayCode: gateways.code,
      gatewayName: gateways.name,
      gatewayState: gateways.state,
      bindingConfig: gatewayDeviceBindings.config,
      metricKey: metricDefinitions.key,
      metricName: deviceMetrics.name,
      unit: metricDefinitions.unit,
      valueNumeric: latestMetricReadings.valueNumeric,
      quality: latestMetricReadings.quality,
      timeQuality: latestMetricReadings.timeQuality,
      recordedAt: latestMetricReadings.recordedAt,
    }).from(devices)
      .innerJoin(assets, eq(assets.id, devices.assetId))
      .leftJoin(gatewayDeviceBindings, and(
        eq(gatewayDeviceBindings.deviceId, devices.id),
        eq(gatewayDeviceBindings.enabled, true),
      ))
      .leftJoin(gateways, eq(gateways.id, gatewayDeviceBindings.gatewayId))
      .leftJoin(deviceMetrics, and(eq(deviceMetrics.deviceId, devices.id), eq(deviceMetrics.enabled, true)))
      .leftJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
      .leftJoin(latestMetricReadings, eq(latestMetricReadings.deviceMetricId, deviceMetrics.id))
      .where(and(
        eq(assets.siteId, user.siteId),
        eq(assets.assetType, "electrical_point"),
        eq(assets.active, true),
        eq(devices.deviceType, "power_meter"),
        eq(devices.driver, "schneider_pm5560"),
        eq(devices.active, true),
      ))
      .orderBy(assets.code, devices.code, deviceMetrics.displayOrder);

    const now = new Date();
    const points = new Map<string, {
      id: string;
      code: string;
      name: string;
      area: string | null;
      state: string;
      nominalVoltageKv: number | null;
      meters: Map<string, {
        id: string;
        code: string;
        name: string;
        state: string;
        unitId: number | null;
        gateway: { id: string; code: string; name: string; state: string } | null;
        acquisition: Record<string, unknown>;
        lastReadingAt: string | null;
        online: boolean;
        metrics: Array<Record<string, unknown>>;
      }>;
    }>();

    for (const row of rows) {
      let point = points.get(row.assetId);
      if (!point) {
        point = {
          id: row.assetId,
          code: row.assetCode,
          name: row.assetName,
          area: row.area,
          state: row.assetState,
          nominalVoltageKv: row.nominalVoltageKv === null ? null : Number(row.nominalVoltageKv),
          meters: new Map(),
        };
        points.set(row.assetId, point);
      }

      let meter = point.meters.get(row.deviceId);
      if (!meter) {
        meter = {
          id: row.deviceId,
          code: row.deviceCode,
          name: row.deviceName,
          state: row.deviceState,
          unitId: row.unitId,
          gateway: row.gatewayId && row.gatewayCode && row.gatewayName && row.gatewayState
            ? { id: row.gatewayId, code: row.gatewayCode, name: row.gatewayName, state: row.gatewayState }
            : null,
          acquisition: row.bindingConfig ?? {},
          lastReadingAt: null,
          online: false,
          metrics: [],
        };
        point.meters.set(row.deviceId, meter);
      }

      if (!row.metricKey) continue;
      const ageSeconds = row.recordedAt ? Math.max(0, (now.getTime() - row.recordedAt.getTime()) / 1000) : null;
      const pollIntervalMs = typeof meter.acquisition.pollIntervalMs === "number" ? meter.acquisition.pollIntervalMs : 1000;
      const staleAfterSeconds = Math.max(30, Math.ceil((pollIntervalMs / 1000) * 6));
      const stale = ageSeconds === null || ageSeconds > staleAfterSeconds;
      const quality = stale && row.quality === "good" ? "stale" : row.quality ?? "stale";
      if (row.recordedAt && (!meter.lastReadingAt || row.recordedAt > new Date(meter.lastReadingAt))) {
        meter.lastReadingAt = row.recordedAt.toISOString();
      }
      if (quality === "good") meter.online = true;

      meter.metrics.push({
        key: row.metricKey,
        name: row.metricName,
        unit: row.unit,
        value: row.valueNumeric === null ? null : Number(row.valueNumeric),
        quality,
        timeQuality: row.timeQuality ?? "unsynced",
        recordedAt: row.recordedAt?.toISOString() ?? null,
      });
    }

    return Response.json({
      schemaVersion: "2.0",
      serverTime: now.toISOString(),
      points: Array.from(points.values()).map((point) => ({
        ...point,
        meters: Array.from(point.meters.values()),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
