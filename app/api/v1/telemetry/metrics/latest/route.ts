import { effectiveDeviceState, telemetryIsStale, telemetryTimeoutSeconds } from "../../../../../../db/telemetry-freshness";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  assets,
  deviceMetrics,
  devices,
  latestMetricReadings,
  metricDefinitions,
  readingProfiles,
} from "../../../../../../db/schema";
import { apiErrorResponse, requireApiSession } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "condition.read");
    const assetId = request.nextUrl.searchParams.get("assetId");
    const deviceId = request.nextUrl.searchParams.get("deviceId");

    const conditions = [
      eq(assets.siteId, user.siteId),
      eq(assets.active, true),
      eq(devices.active, true),
      eq(deviceMetrics.enabled, true),
    ];
    if (assetId) conditions.push(eq(assets.id, assetId));
    if (deviceId) conditions.push(eq(devices.id, deviceId));

    const rows = await db.select({
      assetId: assets.id,
      assetCode: assets.code,
      assetName: assets.name,
      assetType: assets.assetType,
      assetMetadata: assets.metadata,
      assetState: assets.state,
      deviceId: devices.id,
      deviceCode: devices.code,
      deviceName: devices.name,
      deviceType: devices.deviceType,
      driver: devices.driver,
      deviceState: devices.state,
      deviceLastReadAt: devices.lastReadAt,
      staleAfterSeconds: readingProfiles.staleAfterSeconds,
      deviceMetricId: deviceMetrics.id,
      metricCode: deviceMetrics.code,
      metricName: deviceMetrics.name,
      metricDisplayOrder: deviceMetrics.displayOrder,
      metricKey: metricDefinitions.key,
      category: metricDefinitions.category,
      unit: metricDefinitions.unit,
      dataType: metricDefinitions.dataType,
      aggregation: metricDefinitions.aggregation,
      valueNumeric: latestMetricReadings.valueNumeric,
      valueBoolean: latestMetricReadings.valueBoolean,
      valueText: latestMetricReadings.valueText,
      quality: latestMetricReadings.quality,
      qualityFlags: latestMetricReadings.qualityFlags,
      timeQuality: latestMetricReadings.timeQuality,
      recordedAt: latestMetricReadings.recordedAt,
      receivedAt: latestMetricReadings.receivedAt,
      sequence: latestMetricReadings.sequence,
    }).from(deviceMetrics)
      .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
      .innerJoin(assets, eq(assets.id, devices.assetId))
      .innerJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
      .leftJoin(latestMetricReadings, eq(latestMetricReadings.deviceMetricId, deviceMetrics.id))
      .leftJoin(readingProfiles, eq(readingProfiles.id, devices.readingProfileId))
      .where(and(...conditions))
      .orderBy(assets.code, devices.code, deviceMetrics.displayOrder, metricDefinitions.key);

    const now = new Date();
    const assetsMap = new Map<string, {
      id: string;
      code: string;
      name: string;
      assetType: string;
      state: string;
      devices: Map<string, {
        id: string;
        code: string;
        name: string;
        deviceType: string;
        driver: string;
        state: string;
        lastReadAt: string | null;
        staleAfterSeconds: number;
        metrics: Array<Record<string, unknown>>;
      }>;
    }>();

    for (const row of rows) {
      let asset = assetsMap.get(row.assetId);
      if (!asset) {
        asset = {
          id: row.assetId,
          code: row.assetCode,
          name: row.assetName,
          assetType: row.assetType,
          state: row.assetState,
          devices: new Map(),
        };
        assetsMap.set(row.assetId, asset);
      }

      let device = asset.devices.get(row.deviceId);
      if (!device) {
        device = {
          id: row.deviceId,
          code: row.deviceCode,
          name: row.deviceName,
          deviceType: row.deviceType,
          driver: row.driver,
          state: effectiveDeviceState(row.deviceState, row.deviceLastReadAt, telemetryTimeoutSeconds(row.assetType, row.assetMetadata, row.staleAfterSeconds), now),
          lastReadAt: row.deviceLastReadAt?.toISOString() ?? null,
          staleAfterSeconds: telemetryTimeoutSeconds(row.assetType, row.assetMetadata, row.staleAfterSeconds),
          metrics: [],
        };
        asset.devices.set(row.deviceId, device);
      }

      const stale = telemetryIsStale(row.recordedAt, device.staleAfterSeconds, now);
      const effectiveQuality = stale && row.quality === "good" ? "stale" : row.quality ?? "stale";
      const value = row.dataType === "boolean"
        ? row.valueBoolean
        : row.dataType === "string" || row.dataType === "enum"
          ? row.valueText
          : row.valueNumeric === null
            ? null
            : Number(row.valueNumeric);

      device.metrics.push({
        id: row.deviceMetricId,
        code: row.metricCode,
        name: row.metricName,
        key: row.metricKey,
        category: row.category,
        unit: row.unit,
        dataType: row.dataType,
        aggregation: row.aggregation,
        value,
        quality: effectiveQuality,
        qualityFlags: row.qualityFlags ?? [],
        timeQuality: row.timeQuality ?? "unsynced",
        recordedAt: row.recordedAt?.toISOString() ?? null,
        receivedAt: row.receivedAt?.toISOString() ?? null,
        sequence: row.sequence ?? null,
      });
    }

    return Response.json({
      schemaVersion: "2.0",
      serverTime: now.toISOString(),
      assets: Array.from(assetsMap.values()).map((asset) => ({
        id: asset.id,
        code: asset.code,
        name: asset.name,
        assetType: asset.assetType,
        state: asset.state,
        devices: Array.from(asset.devices.values()).map((device) => ({
          ...device,
          state: device.state === "active" && !device.metrics.some((metric) => metric.quality === "good") ? "offline" : device.state,
        })),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
