import type { NextRequest } from "next/server";
import { and, count, eq, max, min, sql } from "drizzle-orm";
import { evaluateCommissioning, type CommissioningValidationInput } from "../../../../db/commissioning-engine";
import type { Cam5Database } from "../../../../db/index";
import {
  alarmRules,
  assets,
  auditLogs,
  channels,
  commissioningItems,
  configurationSnapshots,
  deviceModels,
  devices,
  gateways,
  physicalInputs,
  readings,
  registerDefinitions,
  relayConfigurations,
  sites,
  userAssetScopes,
  users,
} from "../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

async function requireCommissioningContext(db: Cam5Database, user: Awaited<ReturnType<typeof requireApiSession>>["user"], assetId: string) {
  if (!assetId) throw new ApiError(400, "Selecciona un punto de medición.");
  const [context, scopes] = await Promise.all([
    db.select({
      assetId: assets.id,
      assetCode: assets.code,
      assetName: assets.name,
      assetState: assets.state,
      siteId: sites.id,
      siteName: sites.name,
      timezone: sites.timezone,
      deviceId: devices.id,
      deviceCode: devices.code,
      deviceName: devices.name,
      deviceState: devices.state,
      serialNumber: devices.serialNumber,
      firmwareVersion: devices.firmwareVersion,
      dataVersion: devices.dataVersion,
      protocol: devices.protocol,
      host: devices.host,
      port: devices.port,
      unitId: devices.unitId,
      lastReadAt: devices.lastReadAt,
      modelId: deviceModels.id,
      modelCode: deviceModels.code,
      modelName: deviceModels.name,
      registerMapVersion: deviceModels.registerMapVersion,
      gatewayId: gateways.id,
      gatewayCode: gateways.code,
      gatewayName: gateways.name,
      gatewayState: gateways.state,
      gatewayLastSeenAt: gateways.lastSeenAt,
    }).from(assets)
      .innerJoin(sites, eq(sites.id, assets.siteId))
      .innerJoin(devices, and(eq(devices.assetId, assets.id), eq(devices.active, true)))
      .innerJoin(deviceModels, eq(deviceModels.id, devices.modelId))
      .innerJoin(gateways, eq(gateways.id, devices.gatewayId))
      .where(and(eq(assets.id, assetId), eq(assets.siteId, user.siteId), eq(assets.active, true)))
      .limit(1),
    db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id)),
  ]);
  if (!context[0]) throw new ApiError(404, "No existe un controlador activo para el punto de medición.");
  if (scopes.length && !scopes.some((scope) => scope.assetId === assetId)) throw new ApiError(403, "No tienes acceso al punto de medición indicado.");
  return context[0];
}

async function loadMetrics(db: Cam5Database, context: Awaited<ReturnType<typeof requireCommissioningContext>>) {
  const [inputRows, registerRows, channelRows, relayRows, snapshotRows, readingRows] = await Promise.all([
    db.select({ total: count(), enabled: sql<number>`count(*) filter (where ${physicalInputs.enabled} = true)` }).from(physicalInputs).where(eq(physicalInputs.deviceId, context.deviceId)),
    db.select({ total: count(), minimum: min(registerDefinitions.nativeRegister), maximum: max(registerDefinitions.nativeRegister) }).from(registerDefinitions).where(eq(registerDefinitions.modelId, context.modelId)),
    db.select({ enabled: sql<number>`count(*) filter (where ${channels.enabled} = true)`, configuredRules: sql<number>`count(${alarmRules.id}) filter (where ${channels.enabled} = true and ${alarmRules.enabled} = true and ${alarmRules.warningThreshold} is not null and ${alarmRules.criticalThreshold} is not null)` }).from(channels).leftJoin(alarmRules, eq(alarmRules.channelId, channels.id)).where(eq(channels.deviceId, context.deviceId)),
    db.select({ total: count(), enabled: sql<number>`count(*) filter (where ${relayConfigurations.enabled} = true)` }).from(relayConfigurations).where(eq(relayConfigurations.deviceId, context.deviceId)),
    db.select({ total: count(), latestAt: max(configurationSnapshots.createdAt) }).from(configurationSnapshots).where(eq(configurationSnapshots.deviceId, context.deviceId)),
    db.select({ total: count(), valid: sql<number>`count(${readings.id}) filter (where ${readings.quality} = 'good')`, firstAt: min(readings.recordedAt), lastAt: max(readings.recordedAt) }).from(readings).innerJoin(channels, eq(channels.id, readings.channelId)).where(eq(channels.deviceId, context.deviceId)),
  ]);
  const totalReadings = Number(readingRows[0]?.total ?? 0);
  const validReadings = Number(readingRows[0]?.valid ?? 0);
  const firstReadingAt = readingRows[0]?.firstAt ?? null;
  const lastReadingAt = readingRows[0]?.lastAt ?? null;
  const stabilityHours = firstReadingAt && lastReadingAt ? Math.max(0, (lastReadingAt.getTime() - firstReadingAt.getTime()) / 3_600_000) : 0;
  return {
    inputs: { total: Number(inputRows[0]?.total ?? 0), enabled: Number(inputRows[0]?.enabled ?? 0) },
    registers: { total: Number(registerRows[0]?.total ?? 0), minimum: registerRows[0]?.minimum ?? null, maximum: registerRows[0]?.maximum ?? null },
    alarms: { enabledChannels: Number(channelRows[0]?.enabled ?? 0), configuredRules: Number(channelRows[0]?.configuredRules ?? 0) },
    relays: { total: Number(relayRows[0]?.total ?? 0), enabled: Number(relayRows[0]?.enabled ?? 0) },
    snapshots: { total: Number(snapshotRows[0]?.total ?? 0), latestAt: snapshotRows[0]?.latestAt ?? null },
    readings: { total: totalReadings, valid: validReadings, qualityPercent: totalReadings ? Math.round(validReadings / totalReadings * 10_000) / 100 : null, firstAt: firstReadingAt, lastAt: lastReadingAt, stabilityHours: Math.round(stabilityHours * 10) / 10 },
  };
}

function validationInput(context: Awaited<ReturnType<typeof requireCommissioningContext>>, metrics: Awaited<ReturnType<typeof loadMetrics>>): CommissioningValidationInput {
  return {
    serialNumber: context.serialNumber,
    firmwareVersion: context.firmwareVersion,
    dataVersion: context.dataVersion,
    registerCount: metrics.registers.total,
    minimumRegister: metrics.registers.minimum,
    maximumRegister: metrics.registers.maximum,
    lastReadAt: context.lastReadAt,
    enabledChannelCount: metrics.alarms.enabledChannels,
    configuredRuleCount: metrics.alarms.configuredRules,
    relayCount: metrics.relays.total,
    snapshotCount: metrics.snapshots.total,
    readingCount: metrics.readings.total,
    validReadingCount: metrics.readings.valid,
    firstReadingAt: metrics.readings.firstAt,
    lastReadingAt: metrics.readings.lastAt,
  };
}

async function responsePayload(db: Cam5Database, context: Awaited<ReturnType<typeof requireCommissioningContext>>) {
  const [metrics, itemRows] = await Promise.all([
    loadMetrics(db, context),
    db.select({
      id: commissioningItems.id,
      itemKey: commissioningItems.itemKey,
      label: commissioningItems.label,
      status: commissioningItems.status,
      evidence: commissioningItems.evidence,
      note: commissioningItems.note,
      checkedAt: commissioningItems.checkedAt,
      checkedById: commissioningItems.checkedBy,
      checkedByName: users.displayName,
    }).from(commissioningItems).leftJoin(users, eq(users.id, commissioningItems.checkedBy)).where(eq(commissioningItems.deviceId, context.deviceId)).orderBy(commissioningItems.itemKey),
  ]);
  const passed = itemRows.filter((item) => item.status === "passed").length;
  const failed = itemRows.filter((item) => item.status === "failed").length;
  const pending = itemRows.filter((item) => item.status === "pending").length;
  const applicable = itemRows.filter((item) => item.status !== "not_applicable").length;
  return {
    asset: { id: context.assetId, code: context.assetCode, name: context.assetName, state: context.assetState },
    site: { id: context.siteId, name: context.siteName, timezone: context.timezone },
    device: { id: context.deviceId, code: context.deviceCode, name: context.deviceName, state: context.deviceState, serialNumber: context.serialNumber, firmwareVersion: context.firmwareVersion, dataVersion: context.dataVersion, protocol: context.protocol, host: context.host, port: context.port, unitId: context.unitId, lastReadAt: context.lastReadAt?.toISOString() ?? null, modelCode: context.modelCode, modelName: context.modelName, registerMapVersion: context.registerMapVersion },
    gateway: { id: context.gatewayId, code: context.gatewayCode, name: context.gatewayName, state: context.gatewayState, lastSeenAt: context.gatewayLastSeenAt?.toISOString() ?? null },
    metrics: { ...metrics, snapshots: { ...metrics.snapshots, latestAt: metrics.snapshots.latestAt?.toISOString() ?? null }, readings: { ...metrics.readings, firstAt: metrics.readings.firstAt?.toISOString() ?? null, lastAt: metrics.readings.lastAt?.toISOString() ?? null } },
    items: itemRows.map((item) => ({ ...item, checkedAt: item.checkedAt?.toISOString() ?? null, checkedByName: item.checkedByName ?? null, automatic: !["inputs", "clock"].includes(item.itemKey) })),
    summary: { total: itemRows.length, applicable, passed, failed, pending, percentage: applicable ? Math.round(passed / applicable * 100) : 0, ready: applicable > 0 && passed === applicable },
  };
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "commissioning.read");
    const context = await requireCommissioningContext(db, user, request.nextUrl.searchParams.get("assetId") || "");
    return Response.json(await responsePayload(db, context), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "commissioning.execute");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibió la acción de puesta en marcha.");
    const context = await requireCommissioningContext(db, user, String(body.assetId ?? ""));
    const action = String(body.action ?? "validate");
    const metadata = requestMetadata(request);
    if (action === "validate") {
      const metrics = await loadMetrics(db, context);
      const evaluations = evaluateCommissioning(validationInput(context, metrics));
      await db.transaction(async (tx) => {
        for (const result of evaluations) {
          await tx.update(commissioningItems).set({ status: result.status, evidence: result.evidence, note: result.message, checkedBy: user.id, checkedAt: new Date() }).where(and(eq(commissioningItems.deviceId, context.deviceId), eq(commissioningItems.itemKey, result.itemKey)));
        }
        await tx.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "commissioning.validate", resourceType: "device", resourceId: context.deviceId, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, after: { evaluations } });
      });
      return Response.json(await responsePayload(db, context), { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "activate") {
      const freshnessLimit = Date.now() - 5 * 60_000;
      const gatewayIsFresh = context.gatewayState === "online" && Boolean(context.gatewayLastSeenAt && context.gatewayLastSeenAt.getTime() >= freshnessLimit);
      const controllerIsFresh = Boolean(context.lastReadAt && context.lastReadAt.getTime() >= freshnessLimit);
      if (!gatewayIsFresh || !controllerIsFresh) throw new ApiError(409, "La habilitación requiere comunicación reciente del gateway y una lectura CAM-5 recibida durante los últimos 5 minutos.");
      const items = await db.select({ status: commissioningItems.status }).from(commissioningItems).where(eq(commissioningItems.deviceId, context.deviceId));
      const applicable = items.filter((item) => item.status !== "not_applicable");
      if (!applicable.length || applicable.some((item) => item.status !== "passed")) throw new ApiError(409, "Todos los controles aplicables deben estar aprobados antes de habilitar el equipo.");
      await db.transaction(async (tx) => {
        await tx.update(devices).set({ state: "active", updatedAt: new Date() }).where(eq(devices.id, context.deviceId));
        await tx.update(assets).set({ state: "normal", updatedAt: new Date() }).where(eq(assets.id, context.assetId));
        await tx.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "commissioning.activate", resourceType: "device", resourceId: context.deviceId, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, before: { deviceState: context.deviceState, assetState: context.assetState }, after: { deviceState: "active", assetState: "normal" } });
      });
      const refreshed = await requireCommissioningContext(db, user, context.assetId);
      return Response.json(await responsePayload(db, refreshed), { headers: { "Cache-Control": "no-store" } });
    }
    throw new ApiError(400, "La acción solicitada no es válida.");
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "commissioning.execute");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibió la evidencia del control.");
    const context = await requireCommissioningContext(db, user, String(body.assetId ?? ""));
    const itemId = String(body.itemId ?? "");
    const status = String(body.status ?? "");
    const note = String(body.note ?? "").trim();
    if (!["pending", "passed", "failed", "not_applicable"].includes(status)) throw new ApiError(400, "El estado del control no es válido.");
    const [current] = await db.select().from(commissioningItems).where(and(eq(commissioningItems.id, itemId), eq(commissioningItems.deviceId, context.deviceId))).limit(1);
    if (!current) throw new ApiError(404, "El control de puesta en marcha no existe.");
    if (!["inputs", "clock"].includes(current.itemKey)) throw new ApiError(409, "Este control se actualiza mediante la validación automática.");
    if ((status === "passed" || status === "failed") && note.length < 3) throw new ApiError(400, "Agrega una nota de evidencia antes de aprobar o rechazar el control.");
    const metadata = requestMetadata(request);
    const [updated] = await db.transaction(async (tx) => {
      const result = await tx.update(commissioningItems).set({ status: status as "pending" | "passed" | "failed" | "not_applicable", note: note || null, evidence: { source: "field_confirmation", recordedAt: new Date().toISOString() }, checkedBy: status === "pending" ? null : user.id, checkedAt: status === "pending" ? null : new Date() }).where(eq(commissioningItems.id, current.id)).returning();
      await tx.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "commissioning.evidence.update", resourceType: "commissioning_item", resourceId: current.id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, before: current, after: result[0] });
      return result;
    });
    return Response.json({ item: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
