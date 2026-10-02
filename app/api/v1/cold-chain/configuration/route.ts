import type { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  assets,
  auditLogs,
  deviceCapabilities,
  deviceMetrics,
  devices,
  gatewayDeviceBindings,
  gateways,
  metricDefinitions,
} from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, label + " no es válido.");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min) throw new ApiError(400, label + " es obligatorio.");
  return value.trim();
}
function optionalNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ApiError(400, label + " debe ser numérico.");
  return value;
}
function positiveInt(value: unknown, label: string, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new ApiError(400, label + " debe ser un entero positivo.");
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "assets.read");
    const [chambers, gatewayRows] = await Promise.all([
      db.select({
        id: assets.id,
        code: assets.code,
        name: assets.name,
        area: assets.area,
        state: assets.state,
        active: assets.active,
        metadata: assets.metadata,
      }).from(assets)
        .where(and(eq(assets.siteId, user.siteId), eq(assets.assetType, "cold_room")))
        .orderBy(assets.code),
      db.select({
        id: gateways.id,
        code: gateways.code,
        name: gateways.name,
        state: gateways.state,
        active: gateways.active,
      }).from(gateways)
        .where(eq(gateways.siteId, user.siteId))
        .orderBy(gateways.code),
    ]);

    return Response.json({ chambers, gateways: gatewayRows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request);
    const body = object(await request.json().catch(() => null), "El cuerpo");
    const action = text(body.action, "action");
    const meta = requestMetadata(request);

    if (action === "create_chamber") {
      if (!user.permissions.includes("assets.write")) throw new ApiError(403, "No tienes permisos para crear cámaras.");
      const code = text(body.code, "El código", 2).toUpperCase();
      const name = text(body.name, "El nombre", 2);
      const minimumC = optionalNumber(body.minimumC, "minimumC");
      const maximumC = optionalNumber(body.maximumC, "maximumC");
      const targetC = optionalNumber(body.targetC, "targetC");
      if (minimumC !== null && maximumC !== null && minimumC >= maximumC) throw new ApiError(400, "minimumC debe ser menor que maximumC.");

      const coldChain = {
        minimumC,
        maximumC,
        targetC,
        staleAfterSeconds: positiveInt(body.staleAfterSeconds, "staleAfterSeconds", 180),
        disagreementThresholdC: optionalNumber(body.disagreementThresholdC, "disagreementThresholdC"),
        excursionDelaySeconds: positiveInt(body.excursionDelaySeconds, "excursionDelaySeconds", 300),
        batteryLowVoltage: optionalNumber(body.batteryLowVoltage, "batteryLowVoltage"),
        temperatureHysteresisC: optionalNumber(body.temperatureHysteresisC, "temperatureHysteresisC") ?? 0,
      };

      const [row] = await db.insert(assets).values({
        siteId: user.siteId,
        code,
        name,
        area: typeof body.area === "string" && body.area.trim() ? body.area.trim() : null,
        assetType: "cold_room",
        state: "offline",
        metadata: { coldChain },
      }).returning();

      await db.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "cold_chain.chamber.create",
        resourceType: "asset",
        resourceId: row.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        after: row,
      });

      return Response.json({ chamber: row }, { status: 201 });
    }

    if (action === "create_sensor") {
      if (!user.permissions.includes("settings.write")) throw new ApiError(403, "No tienes permisos para crear sensores.");
      const chamberId = text(body.chamberId, "La cámara");
      const gatewayId = text(body.gatewayId, "El gateway");
      const code = text(body.code, "El código", 2).toUpperCase();
      const name = text(body.name, "El nombre", 2);
      const namespaceId = text(body.namespaceId, "namespaceId", 4).toUpperCase();
      const instanceId = text(body.instanceId, "instanceId", 4).toUpperCase();

      const [[chamber], [gateway]] = await Promise.all([
        db.select({ id: assets.id }).from(assets).where(and(
          eq(assets.id, chamberId),
          eq(assets.siteId, user.siteId),
          eq(assets.assetType, "cold_room"),
          eq(assets.active, true),
        )).limit(1),
        db.select({ id: gateways.id }).from(gateways).where(and(
          eq(gateways.id, gatewayId),
          eq(gateways.siteId, user.siteId),
          eq(gateways.active, true),
        )).limit(1),
      ]);
      if (!chamber) throw new ApiError(404, "La cámara no existe en el sitio activo.");
      if (!gateway) throw new ApiError(404, "El gateway no existe en el sitio activo.");

      const metrics = await db.select({ id: metricDefinitions.id, key: metricDefinitions.key, name: metricDefinitions.name })
        .from(metricDefinitions)
        .where(inArray(metricDefinitions.key, ["environment.temperature", "sensor.battery_voltage", "sensor.rssi", "sensor.adv_count"]));
      if (metrics.length < 4) throw new ApiError(409, "El catálogo de métricas HOIT no está inicializado.");

      const sensor = await db.transaction(async (tx) => {
        const [row] = await tx.insert(devices).values({
          assetId: chamberId,
          gatewayId: null,
          modelId: null,
          readingProfileId: null,
          code,
          name,
          deviceType: "temperature_sensor",
          driver: "eddystone_tlm",
          protocol: "ble",
          host: null,
          port: null,
          unitId: null,
          state: "commissioning",
          metadata: { namespaceId, instanceId },
        }).returning();

        await tx.insert(gatewayDeviceBindings).values({
          gatewayId,
          deviceId: row.id,
          interfaceType: "ble",
          config: { protocol: "eddystone_tlm", namespace_id: namespaceId, instance_id: instanceId },
        });

        await tx.insert(deviceCapabilities).values([
          { deviceId: row.id, capabilityKey: "temperature" },
          { deviceId: row.id, capabilityKey: "battery" },
          { deviceId: row.id, capabilityKey: "rssi" },
        ]);

        await tx.insert(deviceMetrics).values(metrics.map((metric, index) => ({
          deviceId: row.id,
          metricDefinitionId: metric.id,
          code: metric.key.split(".").slice(-1)[0].replaceAll("_", "-").toUpperCase(),
          name: metric.name,
          displayOrder: index,
        })));

        return row;
      });

      await db.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "cold_chain.sensor.create",
        resourceType: "device",
        resourceId: sensor.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        after: sensor,
      });

      return Response.json({ sensor }, { status: 201 });
    }

    throw new ApiError(400, "La acción no es válida.");
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "assets.write");
    const body = object(await request.json().catch(() => null), "El cuerpo");
    const chamberId = text(body.chamberId, "La cámara");
    const meta = requestMetadata(request);

    const [current] = await db.select().from(assets).where(and(
      eq(assets.id, chamberId),
      eq(assets.siteId, user.siteId),
      eq(assets.assetType, "cold_room"),
    )).limit(1);
    if (!current) throw new ApiError(404, "La cámara no existe en el sitio activo.");

    const currentMetadata = current.metadata ?? {};
    const currentColdChain = currentMetadata.coldChain && typeof currentMetadata.coldChain === "object" && !Array.isArray(currentMetadata.coldChain)
      ? currentMetadata.coldChain as Record<string, unknown>
      : {};

    const minimumC = body.minimumC === undefined ? currentColdChain.minimumC ?? null : optionalNumber(body.minimumC, "minimumC");
    const maximumC = body.maximumC === undefined ? currentColdChain.maximumC ?? null : optionalNumber(body.maximumC, "maximumC");
    if (typeof minimumC === "number" && typeof maximumC === "number" && minimumC >= maximumC) throw new ApiError(400, "minimumC debe ser menor que maximumC.");

    const coldChain = {
      ...currentColdChain,
      ...(body.minimumC !== undefined ? { minimumC } : {}),
      ...(body.maximumC !== undefined ? { maximumC } : {}),
      ...(body.targetC !== undefined ? { targetC: optionalNumber(body.targetC, "targetC") } : {}),
      ...(body.staleAfterSeconds !== undefined ? { staleAfterSeconds: positiveInt(body.staleAfterSeconds, "staleAfterSeconds", 180) } : {}),
      ...(body.disagreementThresholdC !== undefined ? { disagreementThresholdC: optionalNumber(body.disagreementThresholdC, "disagreementThresholdC") } : {}),
      ...(body.excursionDelaySeconds !== undefined ? { excursionDelaySeconds: positiveInt(body.excursionDelaySeconds, "excursionDelaySeconds", 300) } : {}),
      ...(body.batteryLowVoltage !== undefined ? { batteryLowVoltage: optionalNumber(body.batteryLowVoltage, "batteryLowVoltage") } : {}),
      ...(body.temperatureHysteresisC !== undefined ? { temperatureHysteresisC: optionalNumber(body.temperatureHysteresisC, "temperatureHysteresisC") ?? 0 } : {}),
    };

    const [updated] = await db.update(assets).set({
      ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
      ...(typeof body.area === "string" ? { area: body.area.trim() || null } : {}),
      metadata: { ...currentMetadata, coldChain },
      updatedAt: new Date(),
    }).where(eq(assets.id, chamberId)).returning();

    await db.insert(auditLogs).values({
      siteId: user.siteId,
      actorUserId: user.id,
      action: "cold_chain.chamber.update",
      resourceType: "asset",
      resourceId: updated.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      before: current,
      after: updated,
    });

    return Response.json({ chamber: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
