import type { NextRequest } from "next/server";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { MeasurementProvisioningError, provisionMeasurementDevice } from "../../../../db/measurement-provisioning";
import { assets, auditLogs, detectedDevices, deviceModels, gateways, measurementQuantities, registerDefinitions } from "../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession, requireAssetInScope, requireSitePermission } from "../_lib/auth";

export const dynamic = "force-dynamic";

/**
 * Bandeja de equipos detectados del sitio activo: beacons (u otros equipos) que un gateway reporta
 * y que todavía no están asignados a un punto de medición.
 */
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.read");
    const siteGateways = await db.select({ id: gateways.id, code: gateways.code, name: gateways.name })
      .from(gateways).where(and(eq(gateways.siteId, user.siteId), eq(gateways.active, true)));
    const gatewayIds = siteGateways.map((gateway) => gateway.id);
    const [items, templates, definitions, points] = await Promise.all([
      gatewayIds.length ? db.select().from(detectedDevices)
        .where(and(inArray(detectedDevices.gatewayId, gatewayIds), isNull(detectedDevices.dismissedAt)))
        .orderBy(desc(detectedDevices.lastSeenAt)).limit(200) : [],
      db.select({ id: deviceModels.id, code: deviceModels.code, name: deviceModels.name, manufacturer: deviceModels.manufacturer, protocol: deviceModels.protocol })
        .from(deviceModels).where(ne(deviceModels.protocol, "modbus_tcp")).orderBy(asc(deviceModels.name)),
      db.select({ modelId: registerDefinitions.modelId, key: registerDefinitions.sourceKey, name: registerDefinitions.name, unit: registerDefinitions.unit, quantity: measurementQuantities.name })
        .from(registerDefinitions)
        .innerJoin(deviceModels, eq(deviceModels.id, registerDefinitions.modelId))
        .innerJoin(measurementQuantities, eq(measurementQuantities.key, registerDefinitions.metric))
        .where(and(ne(deviceModels.protocol, "modbus_tcp"), isNotNull(registerDefinitions.sourceKey))),
      db.select({ id: assets.id, code: assets.code, name: assets.name }).from(assets)
        .where(and(eq(assets.siteId, user.siteId), eq(assets.active, true))).orderBy(asc(assets.code)),
    ]);
    const gatewayById = new Map(siteGateways.map((gateway) => [gateway.id, gateway]));
    return Response.json({
      items: items.map((item) => ({
        id: item.id,
        gatewayId: item.gatewayId,
        gatewayCode: gatewayById.get(item.gatewayId)?.code ?? "",
        gatewayName: gatewayById.get(item.gatewayId)?.name ?? "",
        externalId: item.externalId,
        firstSeenAt: item.firstSeenAt.toISOString(),
        lastSeenAt: item.lastSeenAt.toISOString(),
        seenCount: item.seenCount,
        lastRssi: item.lastRssi,
        lastValues: item.lastValues,
      })),
      templates: templates.map((template) => ({
        ...template,
        measurements: definitions.filter((definition) => definition.modelId === template.id).map(({ key, name, unit, quantity }) => ({ key, name, unit, quantity })),
      })),
      points,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function text(body: Record<string, unknown>, field: string, label: string, maximum: number) {
  const value = typeof body[field] === "string" ? body[field].trim() : "";
  if (value.length < 2 || value.length > maximum) throw new ApiError(400, `${label} es obligatorio.`);
  return value;
}

/** {"action":"assign","id","pointId","modelId","name","code"?,"position"?} o {"action":"dismiss","id"} */
export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.read");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.id !== "string") throw new ApiError(400, "Indica el equipo detectado.");
    const [detected] = await db.select({ id: detectedDevices.id, gatewayId: detectedDevices.gatewayId, externalId: detectedDevices.externalId, siteId: gateways.siteId })
      .from(detectedDevices).innerJoin(gateways, eq(gateways.id, detectedDevices.gatewayId))
      .where(eq(detectedDevices.id, body.id)).limit(1);
    if (!detected || detected.siteId !== user.siteId) throw new ApiError(404, "El equipo detectado no existe en este sitio.");
    await requireSitePermission(db, user, detected.siteId, "settings.write");
    const metadata = requestMetadata(request);

    if (body.action === "dismiss") {
      await db.update(detectedDevices).set({ dismissedAt: new Date() }).where(eq(detectedDevices.id, detected.id));
      await db.insert(auditLogs).values({ siteId: detected.siteId, actorUserId: user.id, action: "detected_device.dismiss", resourceType: "detected_device", resourceId: detected.externalId, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent });
      return Response.json({ status: "dismissed" }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action !== "assign") throw new ApiError(400, "La acción no es válida.");

    const pointId = text(body, "pointId", "El punto de medición", 80);
    const modelId = text(body, "modelId", "La plantilla", 80);
    const name = text(body, "name", "El nombre", 160);
    const code = typeof body.code === "string" && body.code.trim() ? body.code.trim() : undefined;
    const position = typeof body.position === "string" && body.position.trim() ? body.position.trim().slice(0, 80) : null;
    if (code && !/^[A-Za-z0-9._-]{2,60}$/.test(code)) throw new ApiError(400, "El código solo admite letras, números, punto, guion y guion bajo.");
    const [point] = await db.select({ id: assets.id, siteId: assets.siteId }).from(assets).where(and(eq(assets.id, pointId), eq(assets.active, true))).limit(1);
    if (!point || point.siteId !== detected.siteId) throw new ApiError(400, "El punto de medición debe pertenecer al mismo sitio que el gateway.");
    await requireAssetInScope(db, user.id, point.id);

    const created = await db.transaction(async (tx) => {
      const result = await provisionMeasurementDevice(tx, { gatewayId: detected.gatewayId, assetId: point.id, modelId, externalId: detected.externalId, name, code, position });
      await tx.insert(auditLogs).values({
        siteId: detected.siteId,
        actorUserId: user.id,
        action: "detected_device.assign",
        resourceType: "controller",
        resourceId: result.device.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        after: { code: result.device.code, name: result.device.name, externalId: detected.externalId, pointId: point.id, modelId, channels: result.channels },
      });
      return result;
    });
    return Response.json({ status: "assigned", item: { id: created.device.id, code: created.device.code, name: created.device.name, channels: created.channels } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MeasurementProvisioningError) return apiErrorResponse(new ApiError(error.status, error.message));
    return apiErrorResponse(error);
  }
}
