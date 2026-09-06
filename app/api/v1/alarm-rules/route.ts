import type { NextRequest } from "next/server";
import { and, count, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  alarmRules,
  alarmRuleStates,
  assets,
  channels,
  userAssetScopes,
} from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "alarms.read");
    const { page, pageSize, offset } = parsePage(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const enabled = request.nextUrl.searchParams.get("enabled") || "all";
    const assetId = request.nextUrl.searchParams.get("assetId") || "";
    if (!(enabled === "all" || enabled === "true" || enabled === "false")) throw new ApiError(400, "El filtro de reglas no es válido.");
    const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id));
    const allowedAssetIds = scopes.map((scope) => scope.assetId);
    const filters: SQL[] = [eq(assets.siteId, user.siteId)];
    if (allowedAssetIds.length) filters.push(inArray(assets.id, allowedAssetIds));
    if (assetId) {
      if (allowedAssetIds.length && !allowedAssetIds.includes(assetId)) throw new ApiError(403, "No tienes acceso al punto de medición indicado.");
      filters.push(eq(assets.id, assetId));
    }
    if (enabled !== "all") filters.push(eq(alarmRules.enabled, enabled === "true"));
    if (q) filters.push(or(ilike(channels.code, `%${q}%`), ilike(channels.name, `%${q}%`), ilike(channels.zone, `%${q}%`))!);
    const where = and(...filters);
    const [items, totals, summaryRows] = await Promise.all([
      db.select({
        id: alarmRules.id,
        channelId: channels.id,
        channelCode: channels.code,
        channelName: channels.name,
        zone: channels.zone,
        unit: channels.unit,
        assetId: assets.id,
        assetCode: assets.code,
        enabled: alarmRules.enabled,
        warningThreshold: alarmRules.warningThreshold,
        criticalThreshold: alarmRules.criticalThreshold,
        hysteresis: alarmRules.hysteresis,
        activationSamples: alarmRules.activationSamples,
        recoverySamples: alarmRules.recoverySamples,
        staleAfterSeconds: alarmRules.staleAfterSeconds,
        updatedAt: alarmRules.updatedAt,
        currentSeverity: alarmRuleStates.currentSeverity,
        breachCount: alarmRuleStates.breachCount,
        recoveryCount: alarmRuleStates.recoveryCount,
        lastValue: alarmRuleStates.lastValue,
        lastQuality: alarmRuleStates.lastQuality,
        lastEvaluatedAt: alarmRuleStates.lastEvaluatedAt,
      }).from(alarmRules)
        .innerJoin(channels, eq(channels.id, alarmRules.channelId))
        .innerJoin(assets, eq(assets.id, channels.assetId))
        .leftJoin(alarmRuleStates, eq(alarmRuleStates.ruleId, alarmRules.id))
        .where(where)
        .orderBy(channels.displayOrder)
        .limit(pageSize)
        .offset(offset),
      db.select({ total: count() }).from(alarmRules)
        .innerJoin(channels, eq(channels.id, alarmRules.channelId))
        .innerJoin(assets, eq(assets.id, channels.assetId))
        .where(where),
      db.select({
        total: count(),
        enabled: sql<number>`count(*) filter (where ${alarmRules.enabled} = true)`,
        evaluating: sql<number>`count(*) filter (where ${alarmRuleStates.lastEvaluatedAt} is not null)`,
        critical: sql<number>`count(*) filter (where ${alarmRuleStates.currentSeverity} = 'critical')`,
      }).from(alarmRules)
        .innerJoin(channels, eq(channels.id, alarmRules.channelId))
        .innerJoin(assets, eq(assets.id, channels.assetId))
        .leftJoin(alarmRuleStates, eq(alarmRuleStates.ruleId, alarmRules.id))
        .where(and(eq(assets.siteId, user.siteId), ...(allowedAssetIds.length ? [inArray(assets.id, allowedAssetIds)] : []))),
    ]);
    const total = Number(totals[0]?.total ?? 0);
    const summary = summaryRows[0];
    return Response.json({
      items: items.map((item) => ({
        ...item,
        warningThreshold: item.warningThreshold === null ? null : Number(item.warningThreshold),
        criticalThreshold: item.criticalThreshold === null ? null : Number(item.criticalThreshold),
        hysteresis: Number(item.hysteresis),
        lastValue: item.lastValue === null ? null : Number(item.lastValue),
        updatedAt: item.updatedAt.toISOString(),
        lastEvaluatedAt: item.lastEvaluatedAt?.toISOString() ?? null,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      summary: {
        total: Number(summary?.total ?? 0),
        enabled: Number(summary?.enabled ?? 0),
        evaluating: Number(summary?.evaluating ?? 0),
        critical: Number(summary?.critical ?? 0),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
