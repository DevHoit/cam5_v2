import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { parseAtsConfig } from "../../../../../db/ats";
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
      assetMetadata: assets.metadata,
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
      dataType: metricDefinitions.dataType,
      unit: metricDefinitions.unit,
      valueNumeric: latestMetricReadings.valueNumeric,
      valueBoolean: latestMetricReadings.valueBoolean,
      valueText: latestMetricReadings.valueText,
      quality: latestMetricReadings.quality,
      timeQuality: latestMetricReadings.timeQuality,
      recordedAt: latestMetricReadings.recordedAt,
    }).from(devices)
      .innerJoin(assets, eq(assets.id, devices.assetId))
      .leftJoin(gatewayDeviceBindings, and(eq(gatewayDeviceBindings.deviceId, devices.id), eq(gatewayDeviceBindings.enabled, true)))
      .leftJoin(gateways, eq(gateways.id, gatewayDeviceBindings.gatewayId))
      .leftJoin(deviceMetrics, and(eq(deviceMetrics.deviceId, devices.id), eq(deviceMetrics.enabled, true)))
      .leftJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
      .leftJoin(latestMetricReadings, eq(latestMetricReadings.deviceMetricId, deviceMetrics.id))
      .where(and(
        eq(assets.siteId, user.siteId),
        eq(assets.assetType, "ats"),
        eq(assets.active, true),
        eq(devices.deviceType, "ats_controller"),
        eq(devices.driver, "dse8660_mkii"),
        eq(devices.active, true),
      ))
      .orderBy(assets.code, devices.code, deviceMetrics.displayOrder);

    const now = new Date();
    const units = new Map<string, {
      id: string;
      code: string;
      name: string;
      area: string | null;
      state: string;
      config: ReturnType<typeof parseAtsConfig>;
      controllers: Map<string, {
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
      let unit = units.get(row.assetId);
      if (!unit) {
        unit = {
          id: row.assetId,
          code: row.assetCode,
          name: row.assetName,
          area: row.area,
          state: row.assetState,
          config: parseAtsConfig(row.assetMetadata),
          controllers: new Map(),
        };
        units.set(row.assetId, unit);
      }

      let controller = unit.controllers.get(row.deviceId);
      if (!controller) {
        controller = {
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
        unit.controllers.set(row.deviceId, controller);
      }

      if (!row.metricKey) continue;
      const ageSeconds = row.recordedAt ? Math.max(0, (now.getTime() - row.recordedAt.getTime()) / 1000) : null;
      const stale = ageSeconds === null || ageSeconds > unit.config.staleAfterSeconds;
      const quality = stale && row.quality === "good" ? "stale" : row.quality ?? "stale";
      if (row.recordedAt && (!controller.lastReadingAt || row.recordedAt > new Date(controller.lastReadingAt))) {
        controller.lastReadingAt = row.recordedAt.toISOString();
      }
      if (quality === "good") controller.online = true;

      const value = row.dataType === "boolean"
        ? row.valueBoolean
        : row.dataType === "string" || row.dataType === "enum"
          ? row.valueText
          : row.valueNumeric === null
            ? null
            : Number(row.valueNumeric);

      controller.metrics.push({
        key: row.metricKey,
        name: row.metricName,
        dataType: row.dataType,
        unit: row.unit,
        value,
        quality,
        timeQuality: row.timeQuality ?? "unsynced",
        recordedAt: row.recordedAt?.toISOString() ?? null,
      });
    }

    return Response.json({
      schemaVersion: "2.0",
      serverTime: now.toISOString(),
      units: Array.from(units.values()).map((unit) => ({
        ...unit,
        controllers: Array.from(unit.controllers.values()),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
