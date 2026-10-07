import { and, desc, eq, inArray } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { cancelEscalationJobsForAlarm, enqueueEscalationJob } from "./escalation-engine";
import { queueAlarmNotifications } from "./notification-engine";
import {
  alarmEvents,
  alarms,
  assets,
  deviceMetrics,
  devices,
  escalationLevels,
  latestMetricReadings,
  metricDefinitions,
  ruleEvaluationStates,
  rules,
  sites,
} from "./schema";

type Scalar = number | boolean | string;
type RuleSeverity = "info" | "warning" | "critical";
type RuleScopeType = "tenant" | "site" | "area" | "asset" | "device";
type ComparisonOp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq";

export type RuleExpression =
  | { op: ComparisonOp; metric: string; value: Scalar }
  | { op: "and" | "or"; conditions: RuleExpression[] }
  | { op: "not"; condition: RuleExpression };

type RuleRow = {
  id: string;
  clientId: string;
  siteId: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  scopeType: RuleScopeType;
  scopeId: string;
  severity: RuleSeverity;
  expression: Record<string, unknown>;
  durationSeconds: number;
  hysteresis: Record<string, unknown> | null;
  scheduleId: string | null;
  escalationPolicyId: string | null;
};

type RuleTarget = {
  stateScopeId: string;
  siteId: string;
  assetId: string;
  deviceId: string | null;
  deviceIds: string[];
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} debe ser un objeto.`);
  return value as Record<string, unknown>;
}

function scalar(value: unknown, label: string): Scalar {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean" || typeof value === "string") return value;
  throw new Error(`${label} debe ser number, boolean o string.`);
}

function parseExpression(value: unknown, depth: number, counter: { count: number }): RuleExpression {
  if (depth > 12) throw new Error("La expresión excede la profundidad máxima de 12 niveles.");
  counter.count += 1;
  if (counter.count > 128) throw new Error("La expresión excede el máximo de 128 nodos.");

  const node = object(value, "La expresión");
  const op = typeof node.op === "string" ? node.op : "";
  if (["gt", "gte", "lt", "lte", "eq", "neq"].includes(op)) {
    if (typeof node.metric !== "string" || !node.metric.trim() || node.metric.length > 160) {
      throw new Error("Toda comparación debe indicar una métrica válida.");
    }
    return { op: op as ComparisonOp, metric: node.metric.trim(), value: scalar(node.value, `El valor de ${node.metric}`) };
  }
  if (op === "and" || op === "or") {
    if (!Array.isArray(node.conditions) || node.conditions.length < 2 || node.conditions.length > 32) {
      throw new Error(`${op} requiere entre 2 y 32 condiciones.`);
    }
    return { op, conditions: node.conditions.map((condition) => parseExpression(condition, depth + 1, counter)) };
  }
  if (op === "not") return { op: "not", condition: parseExpression(node.condition, depth + 1, counter) };
  throw new Error(`Operador de regla no soportado: ${op || "(vacío)"}.`);
}

export function validateRuleExpression(value: unknown) {
  return parseExpression(value, 0, { count: 0 });
}

export function ruleMetricKeys(expression: RuleExpression): string[] {
  if ("metric" in expression) return [expression.metric];
  if (expression.op === "not") return ruleMetricKeys(expression.condition);
  return [...new Set(expression.conditions.flatMap(ruleMetricKeys))];
}

function compare(actual: Scalar, expected: Scalar, op: ComparisonOp) {
  if (op === "eq") return actual === expected;
  if (op === "neq") return actual !== expected;
  if (typeof actual !== "number" || typeof expected !== "number") return false;
  if (op === "gt") return actual > expected;
  if (op === "gte") return actual >= expected;
  if (op === "lt") return actual < expected;
  return actual <= expected;
}

export function evaluateRuleExpression(expression: RuleExpression, values: ReadonlyMap<string, Scalar>): boolean {
  if ("metric" in expression) {
    const actual = values.get(expression.metric);
    return actual === undefined ? false : compare(actual, expression.value, expression.op);
  }
  if (expression.op === "not") return !evaluateRuleExpression(expression.condition, values);
  if (expression.op === "and") return expression.conditions.every((condition) => evaluateRuleExpression(condition, values));
  return expression.conditions.some((condition) => evaluateRuleExpression(condition, values));
}

async function resolveTargets(db: Cam5Database, rule: RuleRow): Promise<RuleTarget[]> {
  if (rule.scopeType === "device") {
    const [device] = await db.select({
      deviceId: devices.id,
      assetId: assets.id,
      siteId: assets.siteId,
      clientId: sites.clientId,
    }).from(devices)
      .innerJoin(assets, eq(assets.id, devices.assetId))
      .innerJoin(sites, eq(sites.id, assets.siteId))
      .where(and(eq(devices.id, rule.scopeId), eq(devices.active, true), eq(assets.active, true), eq(sites.active, true)))
      .limit(1);
    if (!device || device.clientId !== rule.clientId) return [];
    return [{
      stateScopeId: device.deviceId,
      siteId: device.siteId,
      assetId: device.assetId,
      deviceId: device.deviceId,
      deviceIds: [device.deviceId],
    }];
  }

  const assetRows = await db.select({
    assetId: assets.id,
    areaId: assets.areaId,
    siteId: assets.siteId,
    clientId: sites.clientId,
  }).from(assets)
    .innerJoin(sites, eq(sites.id, assets.siteId))
    .where(and(eq(assets.active, true), eq(sites.active, true)));

  const scoped = assetRows.filter((asset) => {
    if (asset.clientId !== rule.clientId) return false;
    if (rule.scopeType === "tenant") return rule.scopeId === rule.clientId;
    if (rule.scopeType === "site") return asset.siteId === rule.scopeId;
    if (rule.scopeType === "area") return asset.areaId === rule.scopeId;
    return asset.assetId === rule.scopeId;
  });
  if (!scoped.length) return [];

  const deviceRows = await db.select({ id: devices.id, assetId: devices.assetId })
    .from(devices)
    .where(and(inArray(devices.assetId, scoped.map((asset) => asset.assetId)), eq(devices.active, true)));
  const byAsset = new Map<string, string[]>();
  for (const device of deviceRows) {
    const ids = byAsset.get(device.assetId) ?? [];
    ids.push(device.id);
    byAsset.set(device.assetId, ids);
  }

  return scoped.map((asset) => ({
    stateScopeId: asset.assetId,
    siteId: asset.siteId,
    assetId: asset.assetId,
    deviceId: null,
    deviceIds: byAsset.get(asset.assetId) ?? [],
  }));
}

async function metricValues(db: Cam5Database, target: RuleTarget, requiredKeys: string[]) {
  if (!target.deviceIds.length) return { values: null as Map<string, Scalar> | null, reason: "target_without_devices" };
  const rows = await db.select({
    metricKey: metricDefinitions.key,
    recordedAt: latestMetricReadings.recordedAt,
    quality: latestMetricReadings.quality,
    valueNumeric: latestMetricReadings.valueNumeric,
    valueBoolean: latestMetricReadings.valueBoolean,
    valueText: latestMetricReadings.valueText,
  }).from(latestMetricReadings)
    .innerJoin(deviceMetrics, eq(deviceMetrics.id, latestMetricReadings.deviceMetricId))
    .innerJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
    .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
    .where(and(
      inArray(devices.id, target.deviceIds),
      inArray(metricDefinitions.key, requiredKeys),
      eq(deviceMetrics.enabled, true),
      eq(devices.active, true),
    ));

  const values = new Map<string, Scalar>();
  for (const key of requiredKeys) {
    const matches = rows.filter((row) => row.metricKey === key);
    if (!matches.length) return { values: null, reason: `missing_metric:${key}` };
    if (matches.length > 1) return { values: null, reason: `ambiguous_metric:${key}` };
    const row = matches[0];
    if (row.quality !== "good") return { values: null, reason: `non_good_quality:${key}:${row.quality}` };
    if (row.valueNumeric !== null) values.set(key, Number(row.valueNumeric));
    else if (row.valueBoolean !== null) values.set(key, row.valueBoolean);
    else if (row.valueText !== null) values.set(key, row.valueText);
    else return { values: null, reason: `missing_value:${key}` };
  }
  return { values, reason: null };
}

function alarmCode(ruleId: string, now: Date) {
  return `RULE-${ruleId.replaceAll("-", "").slice(0, 8).toUpperCase()}-${now.getTime().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

async function currentRuleAlarm(db: Cam5Database, ruleId: string, target: RuleTarget) {
  const rows = await db.select().from(alarms)
    .where(and(eq(alarms.genericRuleId, ruleId), eq(alarms.assetId, target.assetId)))
    .orderBy(desc(alarms.openedAt))
    .limit(10);
  return rows.find((alarm) => (
    (target.deviceId ? alarm.deviceId === target.deviceId : alarm.deviceId === null)
    && alarm.status !== "closed"
    && alarm.status !== "suppressed"
  )) ?? null;
}

async function enqueueEscalations(db: Cam5Database, alarmId: string, policyId: string | null, openedAt: Date) {
  if (!policyId) return;
  const levels = await db.select().from(escalationLevels)
    .where(eq(escalationLevels.policyId, policyId))
    .orderBy(escalationLevels.levelNumber);
  let cumulativeDelay = 0;
  for (const level of levels) {
    cumulativeDelay += level.delaySeconds;
    await enqueueEscalationJob(db, {
      alarmId,
      policyId,
      levelId: level.id,
      dueAt: new Date(openedAt.getTime() + cumulativeDelay * 1000),
    });
  }
}

async function openOrReopen(db: Cam5Database, rule: RuleRow, target: RuleTarget, values: Map<string, Scalar>, now: Date) {
  const existing = await currentRuleAlarm(db, rule.id, target);
  const metricKeys = [...values.keys()];
  const context = {
    source: "generic_rule", genericRuleId: rule.id, stateScopeId: target.stateScopeId,
    metrics: Object.fromEntries(values), metricKeys,
    ...(metricKeys.length === 1 ? { metricKey: metricKeys[0] } : {}),
  };

  if (existing && (existing.status === "open" || existing.status === "acknowledged")) {
    await db.update(alarms).set({ severity: rule.severity, lastObservedAt: now, title: rule.name, detail: rule.description, context })
      .where(eq(alarms.id, existing.id));
    return { opened: 0, reopened: 0 };
  }

  if (existing?.status === "resolved") {
    await db.update(alarms).set({
      status: "open",
      severity: rule.severity,
      resolvedAt: null,
      resolvedBy: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      occurrenceCount: existing.occurrenceCount + 1,
      lastObservedAt: now,
      title: rule.name,
      detail: rule.description,
      context,
    }).where(eq(alarms.id, existing.id));
    const [event] = await db.insert(alarmEvents).values({
      alarmId: existing.id,
      eventType: "reopened_automatically",
      payload: { source: "generic_rule", genericRuleId: rule.id },
    }).returning({ id: alarmEvents.id });
    await queueAlarmNotifications(db, {
      siteId: target.siteId,
      alarmId: existing.id,
      alarmEventId: event.id,
      severity: rule.severity,
      kind: "threshold",
      eventType: "reopened_automatically",
      occurredAt: now,
    });
    await enqueueEscalations(db, existing.id, rule.escalationPolicyId, now);
    return { opened: 0, reopened: 1 };
  }

  const [created] = await db.insert(alarms).values({
    siteId: target.siteId,
    assetId: target.assetId,
    deviceId: target.deviceId,
    genericRuleId: rule.id,
    code: alarmCode(rule.id, now),
    kind: "threshold",
    severity: rule.severity,
    status: "open",
    title: rule.name,
    detail: rule.description,
    openedAt: now,
    lastObservedAt: now,
    context,
  }).returning();
  const [event] = await db.insert(alarmEvents).values({
    alarmId: created.id,
    eventType: "opened",
    payload: { source: "generic_rule", genericRuleId: rule.id },
  }).returning({ id: alarmEvents.id });
  await queueAlarmNotifications(db, {
    siteId: target.siteId,
    alarmId: created.id,
    alarmEventId: event.id,
    severity: rule.severity,
    kind: "threshold",
    eventType: "opened",
    occurredAt: now,
  });
  await enqueueEscalations(db, created.id, rule.escalationPolicyId, now);
  return { opened: 1, reopened: 0 };
}

async function resolve(db: Cam5Database, rule: RuleRow, target: RuleTarget, now: Date) {
  const existing = await currentRuleAlarm(db, rule.id, target);
  if (!existing || (existing.status !== "open" && existing.status !== "acknowledged")) return 0;
  await db.update(alarms).set({ status: "resolved", resolvedAt: now, resolvedBy: null, lastObservedAt: now })
    .where(eq(alarms.id, existing.id));
  await cancelEscalationJobsForAlarm(db, existing.id, now);
  const [event] = await db.insert(alarmEvents).values({
    alarmId: existing.id,
    eventType: "resolved_automatically",
    payload: { source: "generic_rule", genericRuleId: rule.id },
  }).returning({ id: alarmEvents.id });
  await queueAlarmNotifications(db, {
    siteId: target.siteId,
    alarmId: existing.id,
    alarmEventId: event.id,
    severity: existing.severity,
    kind: "threshold",
    eventType: "resolved_automatically",
    occurredAt: now,
  });
  return 1;
}

async function saveState(db: Cam5Database, input: {
  ruleId: string;
  scopeId: string;
  conditionStartedAt: Date | null;
  lastTrueAt: Date | null;
  lastFalseAt: Date | null;
  currentState: "false" | "pending" | "firing" | "recovering";
  lastValue: Record<string, unknown> | null;
  updatedAt: Date;
}) {
  await db.insert(ruleEvaluationStates).values(input).onConflictDoUpdate({
    target: [ruleEvaluationStates.ruleId, ruleEvaluationStates.scopeId],
    set: {
      conditionStartedAt: input.conditionStartedAt,
      lastTrueAt: input.lastTrueAt,
      lastFalseAt: input.lastFalseAt,
      currentState: input.currentState,
      lastValue: input.lastValue,
      updatedAt: input.updatedAt,
    },
  });
}

async function evaluateGenericRuleTargets(
  db: Cam5Database,
  rule: RuleRow,
  targets: RuleTarget[],
  now: Date,
) {
  const totals = { evaluated: 0, opened: 0, reopened: 0, resolved: 0, pending: 0, firing: 0, skipped: 0, unsupported: 0 };
  if (!rule.enabled) return totals;

  // HOIT_SPEC v0.4 defines these fields but does not yet define their JSON/schedule semantics.
  // Fail closed instead of silently inventing a contract.
  if (rule.hysteresis !== null || rule.scheduleId !== null) {
    totals.unsupported = 1;
    return totals;
  }

  const expression = validateRuleExpression(rule.expression);
  const keys = ruleMetricKeys(expression);

  for (const target of targets) {
    const snapshot = await metricValues(db, target, keys);
    if (!snapshot.values) {
      totals.skipped += 1;
      await saveState(db, {
        ruleId: rule.id,
        scopeId: target.stateScopeId,
        conditionStartedAt: null,
        lastTrueAt: null,
        lastFalseAt: null,
        currentState: "false",
        lastValue: { unavailable: true, reason: snapshot.reason },
        updatedAt: now,
      });
      continue;
    }

    totals.evaluated += 1;
    const observed = evaluateRuleExpression(expression, snapshot.values);
    const [state] = await db.select().from(ruleEvaluationStates)
      .where(and(eq(ruleEvaluationStates.ruleId, rule.id), eq(ruleEvaluationStates.scopeId, target.stateScopeId)))
      .limit(1);

    if (!observed) {
      totals.resolved += await resolve(db, rule, target, now);
      await saveState(db, {
        ruleId: rule.id,
        scopeId: target.stateScopeId,
        conditionStartedAt: null,
        lastTrueAt: state?.lastTrueAt ?? null,
        lastFalseAt: now,
        currentState: "false",
        lastValue: Object.fromEntries(snapshot.values),
        updatedAt: now,
      });
      continue;
    }

    const startedAt = state?.currentState === "pending" || state?.currentState === "firing"
      ? state.conditionStartedAt ?? now
      : now;
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
    if (elapsedSeconds < rule.durationSeconds) {
      totals.pending += 1;
      await saveState(db, {
        ruleId: rule.id,
        scopeId: target.stateScopeId,
        conditionStartedAt: startedAt,
        lastTrueAt: now,
        lastFalseAt: state?.lastFalseAt ?? null,
        currentState: "pending",
        lastValue: Object.fromEntries(snapshot.values),
        updatedAt: now,
      });
      continue;
    }

    const alarmResult = await openOrReopen(db, rule, target, snapshot.values, now);
    totals.opened += alarmResult.opened;
    totals.reopened += alarmResult.reopened;
    totals.firing += 1;
    await saveState(db, {
      ruleId: rule.id,
      scopeId: target.stateScopeId,
      conditionStartedAt: startedAt,
      lastTrueAt: now,
      lastFalseAt: state?.lastFalseAt ?? null,
      currentState: "firing",
      lastValue: Object.fromEntries(snapshot.values),
      updatedAt: now,
    });
  }

  return totals;
}

export async function evaluateGenericRule(db: Cam5Database, rule: RuleRow, now = new Date()) {
  const targets = await resolveTargets(db, rule);
  return evaluateGenericRuleTargets(db, rule, targets, now);
}

export async function evaluateGenericRulesForTelemetry(
  db: Cam5Database,
  input: { siteId: string; assetId: string; deviceId: string },
  now = new Date(),
) {
  const totals = {
    evaluatedRules: 0,
    evaluatedTargets: 0,
    opened: 0,
    reopened: 0,
    resolved: 0,
    pending: 0,
    firing: 0,
    skipped: 0,
    unsupported: 0,
  };

  const [context] = await db.select({
    clientId: sites.clientId,
    areaId: assets.areaId,
  }).from(assets)
    .innerJoin(sites, eq(sites.id, assets.siteId))
    .where(and(
      eq(assets.id, input.assetId),
      eq(assets.siteId, input.siteId),
      eq(assets.active, true),
      eq(sites.active, true),
    ))
    .limit(1);
  if (!context) return totals;

  const deviceRows = await db.select({ id: devices.id }).from(devices)
    .where(and(eq(devices.assetId, input.assetId), eq(devices.active, true)));
  const deviceIds = deviceRows.map((device) => device.id);
  if (!deviceIds.includes(input.deviceId)) return totals;

  const enabledRules = await db.select().from(rules)
    .where(and(eq(rules.clientId, context.clientId), eq(rules.enabled, true)));

  const matchingRules = enabledRules.filter((rule) => {
    if (rule.siteId !== null && rule.siteId !== input.siteId) return false;
    if (rule.scopeType === "tenant") return rule.scopeId === context.clientId;
    if (rule.scopeType === "site") return rule.scopeId === input.siteId;
    if (rule.scopeType === "area") return context.areaId !== null && rule.scopeId === context.areaId;
    if (rule.scopeType === "asset") return rule.scopeId === input.assetId;
    return rule.scopeType === "device" && rule.scopeId === input.deviceId;
  });

  totals.evaluatedRules = matchingRules.length;
  for (const rule of matchingRules) {
    const deviceScoped = rule.scopeType === "device";
    const target: RuleTarget = {
      stateScopeId: deviceScoped ? input.deviceId : input.assetId,
      siteId: input.siteId,
      assetId: input.assetId,
      deviceId: deviceScoped ? input.deviceId : null,
      deviceIds: deviceScoped ? [input.deviceId] : deviceIds,
    };
    const result = await evaluateGenericRuleTargets(db, rule as RuleRow, [target], now);
    totals.evaluatedTargets += result.evaluated;
    totals.opened += result.opened;
    totals.reopened += result.reopened;
    totals.resolved += result.resolved;
    totals.pending += result.pending;
    totals.firing += result.firing;
    totals.skipped += result.skipped;
    totals.unsupported += result.unsupported;
  }

  return totals;
}

export async function evaluateGenericRules(db: Cam5Database, now = new Date()) {
  const rows = await db.select().from(rules).where(eq(rules.enabled, true));
  const totals = {
    evaluatedRules: rows.length,
    evaluatedTargets: 0,
    opened: 0,
    reopened: 0,
    resolved: 0,
    pending: 0,
    firing: 0,
    skipped: 0,
    unsupported: 0,
  };
  for (const rule of rows) {
    const result = await evaluateGenericRule(db, rule as RuleRow, now);
    totals.evaluatedTargets += result.evaluated;
    totals.opened += result.opened;
    totals.reopened += result.reopened;
    totals.resolved += result.resolved;
    totals.pending += result.pending;
    totals.firing += result.firing;
    totals.skipped += result.skipped;
    totals.unsupported += result.unsupported;
  }
  return totals;
}
