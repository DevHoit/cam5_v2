import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  alarmRules,
  assets,
  channels,
  devices,
  gateways,
  latestReadings,
  readingProfiles,
  registerDefinitions,
} from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "condition.read");
    const requestedPointId = request.nextUrl.searchParams.get("pointId");
    const [point] = requestedPointId
      ? await db.select().from(assets).where(and(eq(assets.id, requestedPointId), eq(assets.siteId, user.siteId), eq(assets.active, true))).limit(1)
      : await db.select().from(assets).where(and(eq(assets.siteId, user.siteId), eq(assets.active, true))).orderBy(assets.code).limit(1);
    if (!point) throw new ApiError(404, "No existe un punto de medición accesible en el sitio activo.");

    const [device] = await db.select({
      id: devices.id,
      code: devices.code,
      state: devices.state,
      lastReadAt: devices.lastReadAt,
      gatewayId: gateways.id,
      gatewayCode: gateways.code,
      gatewayState: gateways.state,
      gatewayLastSeenAt: gateways.lastSeenAt,
      staleAfterSeconds: readingProfiles.staleAfterSeconds,
    }).from(devices)
      .innerJoin(gateways, eq(gateways.id, devices.gatewayId))
      .leftJoin(readingProfiles, eq(readingProfiles.id, devices.readingProfileId))
      .where(and(eq(devices.assetId, point.id), eq(devices.active, true), eq(gateways.active, true)))
      .orderBy(devices.code)
      .limit(1);

    const rows = await db.select({
      id: channels.id,
      code: channels.code,
      name: channels.name,
      zone: channels.zone,
      metric: channels.metric,
      unit: channels.unit,
      enabled: channels.enabled,
      register: registerDefinitions.nativeRegister,
      rawValue: latestReadings.rawValue,
      value: latestReadings.value,
      quality: latestReadings.quality,
      qualityFlags: latestReadings.qualityFlags,
      recordedAt: latestReadings.recordedAt,
      receivedAt: latestReadings.receivedAt,
      sequence: latestReadings.sequence,
      warningThreshold: alarmRules.warningThreshold,
      criticalThreshold: alarmRules.criticalThreshold,
    }).from(channels)
      .innerJoin(registerDefinitions, eq(registerDefinitions.id, channels.registerDefinitionId))
      .leftJoin(latestReadings, eq(latestReadings.channelId, channels.id))
      .leftJoin(alarmRules, eq(alarmRules.channelId, channels.id))
      .where(eq(channels.assetId, point.id))
      .orderBy(channels.displayOrder);

    const now = new Date();
    const staleAfterSeconds = device?.staleAfterSeconds ?? 30;
    return Response.json({
      serverTime: now.toISOString(),
      point: { id: point.id, code: point.code, name: point.name, state: point.state },
      gateway: device ? { id: device.gatewayId, code: device.gatewayCode, state: device.gatewayState, lastSeenAt: device.gatewayLastSeenAt?.toISOString() ?? null } : null,
      device: device ? { id: device.id, code: device.code, state: device.state, lastReadAt: device.lastReadAt?.toISOString() ?? null } : null,
      staleAfterSeconds,
      items: rows.map((row) => {
        const numericValue = row.value === null ? null : Number(row.value);
        const stale = !row.recordedAt || now.getTime() - row.recordedAt.getTime() > staleAfterSeconds * 1000;
        const quality = !row.enabled ? "disabled" : stale && row.quality === "good" ? "stale" : row.quality;
        const severity = numericValue === null || quality === "bad" || quality === "disabled"
          ? "normal"
          : row.criticalThreshold !== null && numericValue >= Number(row.criticalThreshold)
            ? "critical"
            : row.warningThreshold !== null && numericValue >= Number(row.warningThreshold)
              ? "warning"
              : "normal";
        return {
          ...row,
          value: numericValue,
          quality: quality ?? (row.enabled ? "stale" : "disabled"),
          qualityFlags: row.qualityFlags ?? [],
          severity,
          recordedAt: row.recordedAt?.toISOString() ?? null,
          receivedAt: row.receivedAt?.toISOString() ?? null,
          warningThreshold: row.warningThreshold === null ? null : Number(row.warningThreshold),
          criticalThreshold: row.criticalThreshold === null ? null : Number(row.criticalThreshold),
        };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
