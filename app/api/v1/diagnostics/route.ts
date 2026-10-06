import type { NextRequest } from "next/server";
import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";
import type { Cam5Database } from "../../../../db/index";
import { assets, auditLogs, deviceMetrics, deviceModels, devices, gateways, latestMetricReadings, metricReadings, telemetryBatches, userAssetScopes } from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";
type DiagnosticUser = Awaited<ReturnType<typeof requireApiSession>>["user"];

async function requireContext(db: Cam5Database, user: DiagnosticUser, assetId: string) {
  if (!assetId) throw new ApiError(400, "Selecciona un activo.");
  const [rows, scopes] = await Promise.all([
    db.select({
      assetId: assets.id, assetCode: assets.code, assetName: assets.name,
      deviceId: devices.id, deviceCode: devices.code, deviceName: devices.name, deviceState: devices.state, lastReadAt: devices.lastReadAt,
      modelName: deviceModels.name,
      gatewayId: gateways.id, gatewayCode: gateways.code, gatewayName: gateways.name, gatewayState: gateways.state, gatewayLastSeenAt: gateways.lastSeenAt,
    }).from(assets)
      .innerJoin(devices, and(eq(devices.assetId, assets.id), eq(devices.active, true)))
      .leftJoin(deviceModels, eq(deviceModels.id, devices.modelId))
      .innerJoin(gateways, eq(gateways.id, devices.gatewayId))
      .where(and(eq(assets.id, assetId), eq(assets.siteId, user.siteId), eq(assets.active, true)))
      .orderBy(asc(devices.code)).limit(1),
    db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id)),
  ]);
  const context = rows[0];
  if (!context) throw new ApiError(404, "No existe un dispositivo activo asociado al activo.");
  if (scopes.length && !scopes.some((scope) => scope.assetId === assetId)) throw new ApiError(403, "No tienes acceso al activo indicado.");
  return context;
}

function iso(value: Date | null) { return value?.toISOString() ?? null; }
function percent(good: number, total: number) { return total ? Math.round(good / total * 10_000) / 100 : null; }

async function payload(db: Cam5Database, user: DiagnosticUser, assetId: string, page: number, pageSize: number, offset: number) {
  const context = await requireContext(db, user, assetId);
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const freshnessBoundary = new Date(now.getTime() - 10 * 60 * 1000);
  const batchFilter = and(eq(telemetryBatches.deviceId, context.deviceId), gte(telemetryBatches.receivedAt, from));

  const [statsRows, recentBatches, metricRows, latestRows] = await Promise.all([
    db.select({
      total: count(),
      successful: sql<number>`count(*) filter (where ${telemetryBatches.success} = true)::int`,
      failed: sql<number>`count(*) filter (where ${telemetryBatches.success} = false)::int`,
      totalSamples: sql<number>`coalesce(sum(${telemetryBatches.metricCount}), 0)::int`,
    }).from(telemetryBatches).where(batchFilter),
    db.select({
      id: telemetryBatches.id, batchKey: telemetryBatches.batchKey, sampledAt: telemetryBatches.sampledAt,
      receivedAt: telemetryBatches.receivedAt, metricCount: telemetryBatches.metricCount, success: telemetryBatches.success,
      errorMessage: telemetryBatches.errorMessage, quality: telemetryBatches.quality, timeQuality: telemetryBatches.timeQuality,
    }).from(telemetryBatches).where(batchFilter).orderBy(desc(telemetryBatches.receivedAt)).limit(pageSize).offset(offset),
    db.select({ total: count() }).from(deviceMetrics).where(and(eq(deviceMetrics.deviceId, context.deviceId), eq(deviceMetrics.enabled, true))),
    db.select({
      total: count(),
      good: sql<number>`count(*) filter (where ${latestMetricReadings.quality} = 'good')::int`,
      recent: sql<number>`count(*) filter (where ${latestMetricReadings.recordedAt} >= ${freshnessBoundary.toISOString()}::timestamptz)::int`,
    }).from(latestMetricReadings).innerJoin(deviceMetrics, eq(deviceMetrics.id, latestMetricReadings.deviceMetricId))
      .where(and(eq(deviceMetrics.deviceId, context.deviceId), eq(deviceMetrics.enabled, true))),
  ]);

  const stats = statsRows[0];
  const totalBatches = Number(stats?.total ?? 0);
  const successfulBatches = Number(stats?.successful ?? 0);
  const configuredMetrics = Number(metricRows[0]?.total ?? 0);
  const latestMetrics = Number(latestRows[0]?.total ?? 0);
  const goodMetrics = Number(latestRows[0]?.good ?? 0);
  const recentMetrics = Number(latestRows[0]?.recent ?? 0);
  const gatewayFresh = (context.gatewayState === "online" || context.gatewayState === "degraded") && Boolean(context.gatewayLastSeenAt && context.gatewayLastSeenAt >= freshnessBoundary);
  const deviceFresh = Boolean(context.lastReadAt && context.lastReadAt >= freshnessBoundary);
  const telemetryHealthy = configuredMetrics > 0 && recentMetrics === configuredMetrics;
  const qualityHealthy = latestMetrics > 0 && goodMetrics === latestMetrics;
  const states = [deviceFresh, gatewayFresh, telemetryHealthy, qualityHealthy];
  const overall = states.every(Boolean) ? "healthy" : states.some(Boolean) ? "warning" : "offline";

  return {
    serverTime: now.toISOString(),
    window: { from: from.toISOString(), to: now.toISOString(), label: "Últimas 24 horas" },
    asset: { id: context.assetId, code: context.assetCode, name: context.assetName },
    device: { id: context.deviceId, code: context.deviceCode, name: context.deviceName, state: context.deviceState, modelName: context.modelName ?? "Sin modelo", lastReadAt: iso(context.lastReadAt) },
    gateway: { id: context.gatewayId, code: context.gatewayCode, name: context.gatewayName, state: context.gatewayState, lastSeenAt: iso(context.gatewayLastSeenAt) },
    metrics: { configured: configuredMetrics, latest: latestMetrics, recent: recentMetrics, good: goodMetrics },
    summary: {
      state: overall, totalBatches, successfulBatches, failedBatches: Number(stats?.failed ?? 0),
      successRate: percent(successfulBatches, totalBatches), totalSamples: Number(stats?.totalSamples ?? 0),
      qualityRate: percent(goodMetrics, latestMetrics),
    },
    stages: [
      { key: "device", label: "Dispositivo", state: deviceFresh ? "healthy" : "offline", detail: context.deviceCode, evidence: deviceFresh ? "Telemetría reciente" : "Sin telemetría reciente" },
      { key: "gateway", label: "Gateway", state: gatewayFresh ? "healthy" : "offline", detail: context.gatewayCode, evidence: gatewayFresh ? "Enlace reciente" : "Enlace sin actividad reciente" },
      { key: "ingestion", label: "Ingesta normalizada", state: telemetryHealthy ? "healthy" : totalBatches ? "warning" : "offline", detail: `${recentMetrics}/${configuredMetrics} métricas recientes`, evidence: totalBatches ? `${totalBatches} lotes en 24 h` : "Sin lotes normalizados" },
      { key: "core", label: "HoitLive Core", state: qualityHealthy ? "healthy" : latestMetrics ? "warning" : "offline", detail: "Persistencia y calidad", evidence: latestMetrics ? `${goodMetrics}/${latestMetrics} métricas con calidad válida` : "Sin métricas persistidas" },
    ],
    transactions: recentBatches.map((batch) => ({ ...batch, sampledAt: batch.sampledAt.toISOString(), receivedAt: batch.receivedAt.toISOString() })),
    pagination: { page, pageSize, total: totalBatches, totalPages: Math.max(1, Math.ceil(totalBatches / pageSize)) },
  };
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "diagnostics.read");
    const { page, pageSize, offset } = parsePage(request);
    return Response.json(await payload(db, user, request.nextUrl.searchParams.get("assetId") || "", page, pageSize, offset), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "diagnostics.execute");
    const body = await request.json().catch(() => null) as { assetId?: unknown } | null;
    const assetId = typeof body?.assetId === "string" ? body.assetId : "";
    const context = await requireContext(db, user, assetId);
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "diagnostics.refresh", resourceType: "device", resourceId: context.deviceId, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, metadata: { assetId, mode: "passive_normalized", requestedAt: new Date().toISOString() } });
    return Response.json({ accepted: true, mode: "passive_normalized", requestedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
