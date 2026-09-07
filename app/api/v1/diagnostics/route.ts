import type { NextRequest } from "next/server";
import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";
import type { Cam5Database } from "../../../../db/index";
import {
  assets,
  auditLogs,
  channels,
  deviceModels,
  devices,
  gateways,
  ingestionBatches,
  readingProfileRanges,
  readingProfiles,
  registerDefinitions,
  userAssetScopes,
} from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

type DiagnosticUser = Awaited<ReturnType<typeof requireApiSession>>["user"];

async function requireDiagnosticContext(db: Cam5Database, user: DiagnosticUser, assetId: string) {
  if (!assetId) throw new ApiError(400, "Selecciona un punto de medición.");
  const [contextRows, scopes] = await Promise.all([
    db.select({
      assetId: assets.id,
      assetCode: assets.code,
      assetName: assets.name,
      deviceId: devices.id,
      deviceCode: devices.code,
      deviceName: devices.name,
      deviceState: devices.state,
      deviceHost: devices.host,
      devicePort: devices.port,
      deviceUnitId: devices.unitId,
      deviceProtocol: devices.protocol,
      timeoutMs: devices.timeoutMs,
      retries: devices.retries,
      lastReadAt: devices.lastReadAt,
      clockOffsetMs: devices.clockOffsetMs,
      modelId: deviceModels.id,
      modelName: deviceModels.name,
      registerMapVersion: deviceModels.registerMapVersion,
      profileId: readingProfiles.id,
      profileName: readingProfiles.name,
      staleAfterSeconds: readingProfiles.staleAfterSeconds,
      gatewayId: gateways.id,
      gatewayCode: gateways.code,
      gatewayName: gateways.name,
      gatewayState: gateways.state,
      gatewayAddress: gateways.ipAddress,
      gatewayLastSeenAt: gateways.lastSeenAt,
    }).from(assets)
      .innerJoin(devices, and(eq(devices.assetId, assets.id), eq(devices.active, true)))
      .innerJoin(deviceModels, eq(deviceModels.id, devices.modelId))
      .innerJoin(gateways, eq(gateways.id, devices.gatewayId))
      .leftJoin(readingProfiles, eq(readingProfiles.id, devices.readingProfileId))
      .where(and(eq(assets.id, assetId), eq(assets.siteId, user.siteId), eq(assets.active, true)))
      .orderBy(asc(devices.code))
      .limit(1),
    db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id)),
  ]);
  const context = contextRows[0];
  if (!context) throw new ApiError(404, "No existe un controlador activo para el punto de medición.");
  if (scopes.length && !scopes.some((scope) => scope.assetId === assetId)) throw new ApiError(403, "No tienes acceso al punto de medición indicado.");
  return context;
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

function rounded(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

async function diagnosticPayload(db: Cam5Database, user: DiagnosticUser, assetId: string, page: number, pageSize: number, offset: number) {
  const context = await requireDiagnosticContext(db, user, assetId);
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const batchFilter = and(eq(ingestionBatches.deviceId, context.deviceId), gte(ingestionBatches.startedAt, from));

  const [batchStatsRows, recentBatches, latestBatchRows, rangeRows, registerRows, channelRows] = await Promise.all([
    db.select({
      total: count(),
      successful: sql<number>`count(*) filter (where ${ingestionBatches.success} = true)::int`,
      failed: sql<number>`count(*) filter (where ${ingestionBatches.success} = false)::int`,
      averageLatencyMs: sql<number | null>`round(avg(${ingestionBatches.latencyMs}))::int`,
      p95LatencyMs: sql<number | null>`round(percentile_cont(0.95) within group (order by ${ingestionBatches.latencyMs}))::int`,
      totalSamples: sql<number>`coalesce(sum(${ingestionBatches.receivedRegisters}), 0)::int`,
      goodSamples: sql<number>`coalesce(sum(${ingestionBatches.goodRegisters}), 0)::int`,
      badSamples: sql<number>`coalesce(sum(${ingestionBatches.badRegisters}), 0)::int`,
      staleSamples: sql<number>`coalesce(sum(${ingestionBatches.staleRegisters}), 0)::int`,
    }).from(ingestionBatches).where(batchFilter),
    db.select({
      id: ingestionBatches.id,
      batchKey: ingestionBatches.batchKey,
      startedAt: ingestionBatches.startedAt,
      completedAt: ingestionBatches.completedAt,
      expectedRegisters: ingestionBatches.expectedRegisters,
      receivedRegisters: ingestionBatches.receivedRegisters,
      latencyMs: ingestionBatches.latencyMs,
      success: ingestionBatches.success,
      errorMessage: ingestionBatches.errorMessage,
      receivedAt: ingestionBatches.receivedAt,
    }).from(ingestionBatches).where(batchFilter).orderBy(desc(ingestionBatches.startedAt)).limit(pageSize).offset(offset),
    db.select({
      startedAt: ingestionBatches.startedAt,
      receivedAt: ingestionBatches.receivedAt,
      expectedRegisters: ingestionBatches.expectedRegisters,
      receivedRegisters: ingestionBatches.receivedRegisters,
      latencyMs: ingestionBatches.latencyMs,
      success: ingestionBatches.success,
    }).from(ingestionBatches).where(batchFilter).orderBy(desc(ingestionBatches.startedAt)).limit(1),
    context.profileId
      ? db.select({ name: readingProfileRanges.name, startRegister: readingProfileRanges.startRegister, endRegister: readingProfileRanges.endRegister, functionCode: readingProfileRanges.functionCode, intervalMs: readingProfileRanges.intervalMs })
        .from(readingProfileRanges).where(and(eq(readingProfileRanges.profileId, context.profileId), eq(readingProfileRanges.enabled, true))).orderBy(asc(readingProfileRanges.priority))
      : Promise.resolve([]),
    db.select({ total: count() }).from(registerDefinitions).where(eq(registerDefinitions.modelId, context.modelId)),
    db.select({ total: count(), enabled: sql<number>`count(*) filter (where ${channels.enabled} = true)::int` }).from(channels).where(eq(channels.deviceId, context.deviceId)),
  ]);

  const stats = batchStatsRows[0];
  const totalBatches = Number(stats?.total ?? 0);
  const successfulBatches = Number(stats?.successful ?? 0);
  const totalSamples = Number(stats?.totalSamples ?? 0);
  const goodSamples = Number(stats?.goodSamples ?? 0);
  const staleAfterSeconds = context.staleAfterSeconds ?? 30;
  const freshnessBoundary = now.getTime() - staleAfterSeconds * 1000;
  const latestBatch = latestBatchRows[0] ?? null;
  const controllerFresh = Boolean(context.lastReadAt && context.lastReadAt.getTime() >= freshnessBoundary);
  const gatewayFresh = context.gatewayState === "online" && Boolean(context.gatewayLastSeenAt && context.gatewayLastSeenAt.getTime() >= freshnessBoundary);
  const modbusHealthy = Boolean(latestBatch?.success && latestBatch.startedAt.getTime() >= freshnessBoundary);
  const coreHealthy = gatewayFresh && Boolean(latestBatch?.receivedAt && latestBatch.receivedAt.getTime() >= freshnessBoundary);
  const stageStates = [controllerFresh, modbusHealthy, gatewayFresh, coreHealthy];
  const overallState = stageStates.every(Boolean) ? "healthy" : stageStates.some(Boolean) ? "warning" : "offline";
  const totalRegisters = Number(registerRows[0]?.total ?? 0);
  const enabledChannels = Number(channelRows[0]?.enabled ?? 0);

  return {
    serverTime: now.toISOString(),
    window: { from: from.toISOString(), to: now.toISOString(), label: "Últimas 24 horas" },
    asset: { id: context.assetId, code: context.assetCode, name: context.assetName },
    device: {
      id: context.deviceId,
      code: context.deviceCode,
      name: context.deviceName,
      state: context.deviceState,
      protocol: context.deviceProtocol,
      host: context.deviceHost,
      port: context.devicePort,
      unitId: context.deviceUnitId,
      timeoutMs: context.timeoutMs,
      retries: context.retries,
      lastReadAt: iso(context.lastReadAt),
      clockOffsetMs: context.clockOffsetMs,
      modelName: context.modelName,
      registerMapVersion: context.registerMapVersion,
    },
    gateway: {
      id: context.gatewayId,
      code: context.gatewayCode,
      name: context.gatewayName,
      state: context.gatewayState,
      address: context.gatewayAddress,
      lastSeenAt: iso(context.gatewayLastSeenAt),
    },
    profile: {
      name: context.profileName ?? "Sin perfil de lectura",
      staleAfterSeconds,
      cycleIntervalMs: rangeRows.length ? Math.min(...rangeRows.map((range) => range.intervalMs)) : null,
      ranges: rangeRows,
      registerCount: totalRegisters,
      enabledChannelCount: enabledChannels,
    },
    summary: {
      state: overallState,
      totalBatches,
      successfulBatches,
      failedBatches: Number(stats?.failed ?? 0),
      successRate: totalBatches ? Math.round(successfulBatches / totalBatches * 10_000) / 100 : null,
      averageLatencyMs: rounded(stats?.averageLatencyMs),
      p95LatencyMs: rounded(stats?.p95LatencyMs),
      totalSamples,
      goodSamples,
      badSamples: Number(stats?.badSamples ?? 0),
      staleSamples: Number(stats?.staleSamples ?? 0),
      qualityRate: totalSamples ? Math.round(goodSamples / totalSamples * 10_000) / 100 : null,
    },
    stages: [
      { key: "controller", label: "Controlador CAM-5", state: controllerFresh ? "healthy" : "offline", detail: `${context.deviceHost}:${context.devicePort} · Unit ID ${context.deviceUnitId}`, evidence: controllerFresh ? "Lectura reciente" : "Sin lectura reciente" },
      { key: "modbus", label: "Adquisición Modbus", state: modbusHealthy ? "healthy" : latestBatch ? "warning" : "offline", detail: `${rangeRows.length} bloque${rangeRows.length === 1 ? "" : "s"} · ${totalRegisters} registros`, evidence: latestBatch ? `${latestBatch.receivedRegisters}/${latestBatch.expectedRegisters} recibidos · ${latestBatch.latencyMs ?? "—"} ms` : "Sin ciclos registrados" },
      { key: "gateway", label: "Gateway", state: gatewayFresh ? "healthy" : "offline", detail: context.gatewayAddress || "Dirección no informada", evidence: gatewayFresh ? "Enlace reciente" : "Enlace sin actividad" },
      { key: "core", label: "HoitLive Core", state: coreHealthy ? "healthy" : totalSamples ? "warning" : "offline", detail: "Ingesta, calidad y persistencia", evidence: totalSamples ? `${totalSamples.toLocaleString("es-CL")} muestras en 24 h` : "Sin muestras persistidas" },
    ],
    transactions: recentBatches.map((batch) => ({
      id: batch.id,
      batchKey: batch.batchKey,
      startedAt: batch.startedAt.toISOString(),
      completedAt: iso(batch.completedAt),
      receivedAt: batch.receivedAt.toISOString(),
      expectedRegisters: batch.expectedRegisters,
      receivedRegisters: batch.receivedRegisters,
      latencyMs: batch.latencyMs,
      success: batch.success,
      errorMessage: batch.errorMessage,
    })),
    pagination: { page, pageSize, total: totalBatches, totalPages: Math.max(1, Math.ceil(totalBatches / pageSize)) },
  };
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "diagnostics.read");
    const { page, pageSize, offset } = parsePage(request);
    const assetId = request.nextUrl.searchParams.get("assetId") || "";
    return Response.json(await diagnosticPayload(db, user, assetId, page, pageSize, offset), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "diagnostics.execute");
    const body = await request.json().catch(() => null) as { assetId?: unknown } | null;
    const assetId = typeof body?.assetId === "string" ? body.assetId : "";
    const context = await requireDiagnosticContext(db, user, assetId);
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({
      siteId: user.siteId,
      actorUserId: user.id,
      action: "diagnostics.refresh",
      resourceType: "device",
      resourceId: context.deviceId,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: { assetId, mode: "passive", requestedAt: new Date().toISOString() },
    });
    return Response.json({ accepted: true, mode: "passive", requestedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
