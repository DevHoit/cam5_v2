import type { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  assets,
  deviceMetrics,
  devices,
  latestMetricReadings,
  metricDefinitions,
} from "../../../../../db/schema";
import { parseColdChainConfig, summarizeColdChain, type ColdChainSensorSnapshot } from "../../../../../db/cold-chain";
import { apiErrorResponse, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

const COLD_CHAIN_METRICS = [
  "environment.temperature",
  "sensor.battery_voltage",
  "sensor.rssi",
] as const;

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "condition.read");
    const now = new Date();

    const chamberRows = await db.select({
      id: assets.id,
      code: assets.code,
      name: assets.name,
      area: assets.area,
      state: assets.state,
      metadata: assets.metadata,
    }).from(assets)
      .where(and(
        eq(assets.siteId, user.siteId),
        eq(assets.assetType, "cold_room"),
        eq(assets.active, true),
      ))
      .orderBy(assets.code);

    if (!chamberRows.length) {
      return Response.json({
        schemaVersion: "2.0",
        serverTime: now.toISOString(),
        chambers: [],
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const chamberIds = chamberRows.map((chamber) => chamber.id);
    const metricRows = await db.select({
      assetId: devices.assetId,
      deviceId: devices.id,
      deviceCode: devices.code,
      deviceName: devices.name,
      deviceState: devices.state,
      deviceType: devices.deviceType,
      driver: devices.driver,
      lastReadAt: devices.lastReadAt,
      metricKey: metricDefinitions.key,
      valueNumeric: latestMetricReadings.valueNumeric,
      quality: latestMetricReadings.quality,
      recordedAt: latestMetricReadings.recordedAt,
    }).from(devices)
      .leftJoin(deviceMetrics, and(
        eq(deviceMetrics.deviceId, devices.id),
        eq(deviceMetrics.enabled, true),
      ))
      .leftJoin(metricDefinitions, and(
        eq(metricDefinitions.id, deviceMetrics.metricDefinitionId),
        inArray(metricDefinitions.key, [...COLD_CHAIN_METRICS]),
      ))
      .leftJoin(latestMetricReadings, eq(latestMetricReadings.deviceMetricId, deviceMetrics.id))
      .where(and(
        inArray(devices.assetId, chamberIds),
        eq(devices.active, true),
      ))
      .orderBy(devices.code);

    const sensorsByChamber = new Map<string, Map<string, ColdChainSensorSnapshot & { deviceType: string; driver: string }>>();
    for (const row of metricRows) {
      let devicesMap = sensorsByChamber.get(row.assetId);
      if (!devicesMap) {
        devicesMap = new Map();
        sensorsByChamber.set(row.assetId, devicesMap);
      }

      let sensor = devicesMap.get(row.deviceId);
      if (!sensor) {
        sensor = {
          id: row.deviceId,
          code: row.deviceCode,
          name: row.deviceName,
          deviceState: row.deviceState,
          deviceType: row.deviceType,
          driver: row.driver,
          lastReadAt: row.lastReadAt,
          temperatureC: null,
          temperatureRecordedAt: null,
          temperatureQuality: null,
          batteryVoltage: null,
          rssi: null,
        };
        devicesMap.set(row.deviceId, sensor);
      }

      if (row.metricKey === "environment.temperature") {
        sensor.temperatureC = row.valueNumeric === null ? null : Number(row.valueNumeric);
        sensor.temperatureRecordedAt = row.recordedAt;
        sensor.temperatureQuality = row.quality;
      } else if (row.metricKey === "sensor.battery_voltage") {
        sensor.batteryVoltage = row.valueNumeric === null ? null : Number(row.valueNumeric);
      } else if (row.metricKey === "sensor.rssi") {
        sensor.rssi = row.valueNumeric === null ? null : Number(row.valueNumeric);
      }
    }

    const chambers = chamberRows.map((chamber) => {
      const config = parseColdChainConfig(chamber.metadata);
      const deviceSnapshots = Array.from(sensorsByChamber.get(chamber.id)?.values() ?? []);
      const summary = summarizeColdChain(deviceSnapshots, config, now);

      return {
        id: chamber.id,
        code: chamber.code,
        name: chamber.name,
        area: chamber.area,
        assetState: chamber.state,
        status: chamber.state === "maintenance" ? "maintenance" : summary.status,
        config,
        summary: {
          minimumObservedC: summary.minimumObservedC,
          maximumObservedC: summary.maximumObservedC,
          averageC: summary.averageC,
          spreadC: summary.spreadC,
          sensorsOnline: summary.sensorsOnline,
          sensorsTotal: summary.sensorsTotal,
          disagreement: summary.disagreement,
        },
        sensors: summary.sensors.map((sensor) => {
          const source = deviceSnapshots.find((device) => device.id === sensor.id);
          return {
            id: sensor.id,
            code: sensor.code,
            name: sensor.name,
            deviceType: source?.deviceType ?? "temperature_sensor",
            driver: source?.driver ?? "unknown",
            deviceState: sensor.deviceState,
            status: sensor.status,
            stale: sensor.stale,
            temperatureC: sensor.temperatureC,
            temperatureQuality: sensor.temperatureQuality,
            temperatureRecordedAt: sensor.temperatureRecordedAt?.toISOString() ?? null,
            batteryVoltage: sensor.batteryVoltage,
            rssi: sensor.rssi,
            lastReadAt: sensor.lastReadAt?.toISOString() ?? null,
          };
        }),
      };
    });

    return Response.json({
      schemaVersion: "2.0",
      serverTime: now.toISOString(),
      chambers,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
