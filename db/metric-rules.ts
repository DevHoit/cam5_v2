import { and, eq, inArray } from "drizzle-orm";
import type { Cam5Database } from "./index";
import * as s from "./schema";
import { cancelEscalationJobsForAlarm } from "./escalation-engine";
import { metricRuleBehavior, type MetricRuleMetric } from "./metric-rule-contract";

export class MetricRuleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type MetricRuleActor = { id: string; siteId: string; permissions: string[] };
function check(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new MetricRuleError(status, message);
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
async function assetScope(db: Cam5Database, actor: MetricRuleActor, assetId: string, write = false) {
  check(actor.permissions.includes(write ? "settings.write" : "alarms.read"), "No tienes permisos para configurar estas reglas.", 403);
  check(uuid(assetId), "Selecciona un activo válido.");
  const [asset] = await db.select({ asset: s.assets, clientId: s.sites.clientId }).from(s.assets)
    .innerJoin(s.sites, eq(s.sites.id, s.assets.siteId))
    .where(and(eq(s.assets.id, assetId), eq(s.assets.siteId, actor.siteId), eq(s.assets.active, true), eq(s.sites.active, true)));
  check(asset, "El activo no está disponible en este sitio.", 404);
  const scopes = await db.select().from(s.userAssetScopes).where(eq(s.userAssetScopes.userId, actor.id));
  check(!scopes.length || scopes.some((scope) => scope.assetId === assetId), "No tienes acceso a este activo.", 403);
  return asset;
}

export async function listMetricRules(db: Cam5Database, actor: MetricRuleActor, assetId: string): Promise<{ metrics: MetricRuleMetric[] }> {
  const { clientId } = await assetScope(db, actor, assetId);
  const rows = await db.select({ metric: s.deviceMetrics, definition: s.metricDefinitions, device: s.devices, latest: s.latestMetricReadings, profile: s.readingProfiles })
    .from(s.deviceMetrics).innerJoin(s.devices, eq(s.devices.id, s.deviceMetrics.deviceId))
    .innerJoin(s.metricDefinitions, eq(s.metricDefinitions.id, s.deviceMetrics.metricDefinitionId))
    .leftJoin(s.latestMetricReadings, eq(s.latestMetricReadings.deviceMetricId, s.deviceMetrics.id))
    .leftJoin(s.readingProfiles, eq(s.readingProfiles.id, s.devices.readingProfileId))
    .where(eq(s.devices.assetId, assetId)).orderBy(s.devices.code, s.deviceMetrics.displayOrder, s.deviceMetrics.code);
  if (!rows.length) return { metrics: [] };
  const ruleRows = await db.select({ rule: s.rules, state: s.ruleEvaluationStates }).from(s.rules)
    .leftJoin(s.ruleEvaluationStates, and(eq(s.ruleEvaluationStates.ruleId, s.rules.id), eq(s.ruleEvaluationStates.scopeId, s.rules.scopeId)))
    .where(and(eq(s.rules.clientId, clientId), eq(s.rules.siteId, actor.siteId), eq(s.rules.scopeType, "device"), inArray(s.rules.scopeId, [...new Set(rows.map((r) => r.device.id))])));
  return { metrics: rows.map(({ metric, definition, device, latest, profile }) => ({
    id: metric.id, deviceId: device.id, deviceCode: device.code, deviceName: device.name,
    code: metric.code, name: metric.name, key: definition.key, unit: definition.unit, dataType: definition.dataType,
    enabled: device.active && metric.enabled,
    value: latest?.valueNumeric !== null && latest?.valueNumeric !== undefined ? Number(latest.valueNumeric) : latest?.valueBoolean ?? latest?.valueText ?? null,
    recordedAt: latest?.recordedAt.toISOString() ?? null, quality: latest?.quality ?? null,
    staleAfterSeconds: profile?.staleAfterSeconds ?? 180,
    rules: ruleRows.filter(({ rule }) => rule.scopeId === device.id && rule.expression.metric === definition.key).map(({ rule, state }) => {
      const behavior = metricRuleBehavior(rule.hysteresis);
      return { id: rule.id, name: rule.name, enabled: rule.enabled, severity: rule.severity,
        op: String(rule.expression.op), value: rule.expression.value as number | boolean | string,
        durationSeconds: rule.durationSeconds, recoveryThreshold: behavior?.recoveryThreshold ?? null,
        recoverySeconds: behavior?.recoverySeconds ?? 0, staleAfterSeconds: behavior?.staleAfterSeconds ?? profile?.staleAfterSeconds ?? 180,
        editable: !!behavior && behavior.deviceMetricId === metric.id && rule.scheduleId === null && !rule.name.startsWith("LAB-MAIL-"),
        updatedAt: rule.updatedAt.toISOString(), state: !rule.enabled ? "disabled" : state?.lastValue?.unavailable ? "unavailable" : state?.currentState ?? "unevaluated",
        lastEvaluatedAt: state?.updatedAt.toISOString() ?? null, lastValue: state?.lastValue ?? null };
    }),
  })) };
}

function integer(value: unknown, name: string, min = 0) {
  check(typeof value === "number" && Number.isInteger(value) && value >= min && value <= 86400, `${name} debe ser un entero entre ${min} y 86400.`);
  return value;
}
export async function saveMetricRule(db: Cam5Database, actor: MetricRuleActor, body: Record<string, unknown>, id?: string) {
  check(typeof body.assetId === "string", "Selecciona un activo.");
  const { clientId } = await assetScope(db, actor, body.assetId, true);
  check(uuid(body.deviceMetricId), "Selecciona una métrica válida.");
  check(!id || uuid(id), "Identificador de regla inválido.");
  const [target] = await db.select({ metric: s.deviceMetrics, definition: s.metricDefinitions, device: s.devices }).from(s.deviceMetrics)
    .innerJoin(s.devices, eq(s.devices.id, s.deviceMetrics.deviceId))
    .innerJoin(s.metricDefinitions, eq(s.metricDefinitions.id, s.deviceMetrics.metricDefinitionId))
    .where(and(eq(s.deviceMetrics.id, body.deviceMetricId), eq(s.devices.assetId, body.assetId)));
  check(target, "La métrica no pertenece al activo seleccionado.", 404);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  check(name.length >= 3 && name.length <= 180 && !name.startsWith("LAB-MAIL-"), "El nombre debe tener entre 3 y 180 caracteres y no usar el prefijo reservado.");
  check(typeof body.enabled === "boolean", "Indica si la regla está habilitada.");
  check(!body.enabled || (target.device.active && target.metric.enabled), "Habilita primero el dispositivo y la métrica.");
  check(body.severity === "info" || body.severity === "warning" || body.severity === "critical", "Severidad inválida.");
  const numeric = ["float", "integer"].includes(target.definition.dataType);
  check(typeof body.op === "string" && (numeric ? ["gt", "gte", "lt", "lte", "eq", "neq"] : ["eq", "neq"]).includes(body.op), "Operador incompatible con el tipo de métrica.");
  const value = body.value;
  check(numeric ? typeof value === "number" && Number.isFinite(value) : target.definition.dataType === "boolean" ? typeof value === "boolean" : typeof value === "string" && value.length > 0 && value.length <= 200, "El límite no corresponde al tipo de métrica.");
  const recoveryThreshold = body.recoveryThreshold ?? null;
  check(recoveryThreshold === null || (numeric && ["gt", "gte", "lt", "lte"].includes(body.op) && typeof recoveryThreshold === "number" && Number.isFinite(recoveryThreshold)), "Límite de recuperación inválido.");
  if (typeof recoveryThreshold === "number") {
    check(body.op.startsWith("g") ? recoveryThreshold < Number(value) : recoveryThreshold > Number(value), "La recuperación debe quedar por debajo del límite alto o por encima del límite bajo.");
  }
  const durationSeconds = integer(body.durationSeconds, "La persistencia");
  const recoverySeconds = integer(body.recoverySeconds, "La recuperación");
  const staleAfterSeconds = integer(body.staleAfterSeconds, "La vigencia del dato", 1);
  return db.transaction(async (tx) => {
    let previous: typeof s.rules.$inferSelect | undefined;
    if (id) {
      [previous] = await tx.select().from(s.rules).where(and(eq(s.rules.id, id), eq(s.rules.clientId, clientId), eq(s.rules.siteId, actor.siteId), eq(s.rules.scopeType, "device"), eq(s.rules.scopeId, target.device.id))).for("update");
      check(previous, "La regla no pertenece a este dispositivo.", 404);
      check(!previous.name.startsWith("LAB-MAIL-") && metricRuleBehavior(previous.hysteresis)?.deviceMetricId === target.metric.id && previous.scheduleId === null, "Esta regla se administra desde su módulo de origen.", 409);
      check(body.updatedAt === previous.updatedAt.toISOString(), "La regla cambió. Actualiza antes de guardar.", 409);
    }
    const now = new Date();
    const values = { name, enabled: body.enabled as boolean, severity: body.severity as "info" | "warning" | "critical",
      expression: { op: body.op, metric: target.definition.key, value }, durationSeconds,
      hysteresis: { kind: "device_metric", version: 1, deviceMetricId: target.metric.id, recoveryThreshold, recoverySeconds, staleAfterSeconds }, updatedAt: now };
    // Configuration changes start a new evaluation period; retire any current occurrence
    // and its pending deliveries without invoking the global dispatcher.
    if (previous) {
      const active = await tx.select().from(s.alarms).where(and(eq(s.alarms.genericRuleId, previous.id), inArray(s.alarms.status, ["open", "acknowledged"])));
      for (const alarm of active) {
        await tx.update(s.alarms).set({ status: "resolved", resolvedAt: now, resolvedBy: actor.id }).where(eq(s.alarms.id, alarm.id));
        await cancelEscalationJobsForAlarm(tx as unknown as Cam5Database, alarm.id, now);
        await tx.update(s.notificationDeliveries).set({ status: "suppressed", errorMessage: "Regla modificada por configuración." }).where(and(eq(s.notificationDeliveries.alarmId, alarm.id), inArray(s.notificationDeliveries.status, ["queued", "failed"])));
        await tx.insert(s.alarmEvents).values({ alarmId: alarm.id, actorUserId: actor.id, eventType: "resolved_rule_disabled", payload: { reason: "rule_configuration_changed" } });
      }
      await tx.delete(s.ruleEvaluationStates).where(eq(s.ruleEvaluationStates.ruleId, previous.id));
    }
    const [saved] = previous
      ? await tx.update(s.rules).set(values).where(eq(s.rules.id, previous.id)).returning()
      : await tx.insert(s.rules).values({ ...values, clientId, siteId: actor.siteId, scopeType: "device", scopeId: target.device.id, createdBy: actor.id, escalationPolicyId: null }).returning();
    await tx.insert(s.auditLogs).values({ siteId: actor.siteId, actorUserId: actor.id, action: previous ? "metric_rule.update" : "metric_rule.create", resourceType: "rule", resourceId: saved.id, before: previous ?? null, after: saved });
    return { id: saved.id, updatedAt: saved.updatedAt.toISOString() };
  });
}
