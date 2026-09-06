import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  alarmEvents,
  alarmRules,
  alarmRuleStates,
  alarms,
  assets,
  auditLogs,
  channels,
  userAssetScopes,
} from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

function finiteNumber(value: unknown, label: string, minimum?: number, maximum?: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || (minimum !== undefined && parsed < minimum) || (maximum !== undefined && parsed > maximum)) {
    throw new ApiError(400, `${label} no es válido.`);
  }
  return parsed;
}

function positiveInteger(value: unknown, label: string, maximum: number) {
  const parsed = finiteNumber(value, label, 1, maximum);
  if (!Number.isInteger(parsed)) throw new ApiError(400, `${label} debe ser un número entero.`);
  return parsed;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "settings.write");
    const { id } = await context.params;
    const [target] = await db.select({
      id: alarmRules.id,
      enabled: alarmRules.enabled,
      warningThreshold: alarmRules.warningThreshold,
      criticalThreshold: alarmRules.criticalThreshold,
      hysteresis: alarmRules.hysteresis,
      activationSamples: alarmRules.activationSamples,
      recoverySamples: alarmRules.recoverySamples,
      staleAfterSeconds: alarmRules.staleAfterSeconds,
      channelId: channels.id,
      channelCode: channels.code,
      assetId: assets.id,
      siteId: assets.siteId,
    }).from(alarmRules)
      .innerJoin(channels, eq(channels.id, alarmRules.channelId))
      .innerJoin(assets, eq(assets.id, channels.assetId))
      .where(and(eq(alarmRules.id, id), eq(assets.siteId, user.siteId)))
      .limit(1);
    if (!target) throw new ApiError(404, "La regla no existe.");
    const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id));
    if (scopes.length && !scopes.some((scope) => scope.assetId === target.assetId)) throw new ApiError(403, "No tienes acceso al punto de medición de esta regla.");

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron cambios.");
    const enabled = typeof body.enabled === "boolean" ? body.enabled : target.enabled;
    const warningThreshold = finiteNumber(body.warningThreshold ?? target.warningThreshold, "El umbral de advertencia");
    const criticalThreshold = finiteNumber(body.criticalThreshold ?? target.criticalThreshold, "El umbral crítico");
    const hysteresis = finiteNumber(body.hysteresis ?? target.hysteresis, "La histéresis", 0);
    const activationSamples = positiveInteger(body.activationSamples ?? target.activationSamples, "Las muestras de activación", 100);
    const recoverySamples = positiveInteger(body.recoverySamples ?? target.recoverySamples, "Las muestras de recuperación", 100);
    const staleAfterSeconds = positiveInteger(body.staleAfterSeconds ?? target.staleAfterSeconds, "El tiempo de dato atrasado", 86_400);
    if (warningThreshold >= criticalThreshold) throw new ApiError(400, "El umbral de advertencia debe ser menor que el umbral crítico.");
    const metadata = requestMetadata(request);

    const updated = await db.transaction(async (tx) => {
      const [record] = await tx.update(alarmRules).set({
        enabled,
        warningThreshold: String(warningThreshold),
        criticalThreshold: String(criticalThreshold),
        hysteresis: String(hysteresis),
        activationSamples,
        recoverySamples,
        staleAfterSeconds,
        updatedBy: user.id,
        updatedAt: new Date(),
      }).where(eq(alarmRules.id, id)).returning();

      if (!enabled) {
        const [state] = await tx.select({ activeAlarmId: alarmRuleStates.activeAlarmId }).from(alarmRuleStates).where(eq(alarmRuleStates.ruleId, id)).limit(1);
        if (state?.activeAlarmId) {
          const [activeAlarm] = await tx.select({ status: alarms.status }).from(alarms).where(eq(alarms.id, state.activeAlarmId)).limit(1);
          if (activeAlarm && activeAlarm.status !== "closed" && activeAlarm.status !== "resolved") {
            await tx.update(alarms).set({ status: "resolved", resolvedAt: new Date(), resolvedBy: user.id }).where(eq(alarms.id, state.activeAlarmId));
            await tx.insert(alarmEvents).values({ alarmId: state.activeAlarmId, eventType: "resolved_rule_disabled", actorUserId: user.id, note: "Regla desactivada por configuración." });
          }
        }
        await tx.insert(alarmRuleStates).values({ ruleId: id, activeAlarmId: null, currentSeverity: "normal", breachCount: 0, recoveryCount: 0, updatedAt: new Date() })
          .onConflictDoUpdate({ target: alarmRuleStates.ruleId, set: { activeAlarmId: null, currentSeverity: "normal", breachCount: 0, recoveryCount: 0, updatedAt: new Date() } });
      }

      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "alarm_rules.update",
        resourceType: "alarm_rule",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: target,
        after: { enabled, warningThreshold, criticalThreshold, hysteresis, activationSamples, recoverySamples, staleAfterSeconds },
      });
      return record;
    });

    return Response.json({
      item: {
        ...updated,
        warningThreshold: updated.warningThreshold === null ? null : Number(updated.warningThreshold),
        criticalThreshold: updated.criticalThreshold === null ? null : Number(updated.criticalThreshold),
        hysteresis: Number(updated.hysteresis),
        updatedAt: updated.updatedAt.toISOString(),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
