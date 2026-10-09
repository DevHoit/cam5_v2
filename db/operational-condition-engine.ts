import { and, eq } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { queueAlarmNotifications, type NotificationAlarmKind } from "./notification-engine";
import { alarmEvents, alarms, operationalConditionStates } from "./schema";

export type OperationalConditionInput = {
  source: string;
  assetId: string;
  siteId: string;
  deviceId: string | null;
  conditionKey: string;
  observed: boolean;
  severity: "warning" | "critical";
  kind: NotificationAlarmKind;
  title: string;
  detail: string;
  value: number | null;
  threshold: number | null;
  delaySeconds: number;
  context: Record<string, unknown>;
  maintenance: boolean;
  codePrefix: string;
};

function alarmCode(prefix: string, conditionKey: string, now: Date) {
  const ref = conditionKey.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 18) || "COND";
  return `${prefix}-${ref}-${now.getTime().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

export async function processOperationalCondition(db: Cam5Database, input: OperationalConditionInput, evaluatedAt: Date) {
  const [state] = await db.select().from(operationalConditionStates).where(and(
    eq(operationalConditionStates.assetId, input.assetId),
    eq(operationalConditionStates.conditionKey, input.conditionKey),
  )).limit(1);

  if (!input.observed) {
    let resolved = 0;
    if (state?.activeAlarmId) {
      const [active] = await db.select({
        id: alarms.id,
        status: alarms.status,
        severity: alarms.severity,
      }).from(alarms).where(eq(alarms.id, state.activeAlarmId)).limit(1);
      if (active && (active.status === "open" || active.status === "acknowledged")) {
        await db.update(alarms).set({
          status: "resolved",
          resolvedAt: evaluatedAt,
          resolvedBy: null,
          lastObservedAt: evaluatedAt,
        }).where(eq(alarms.id, active.id));
        const [event] = await db.insert(alarmEvents).values({
          alarmId: active.id,
          eventType: "resolved_automatically",
          payload: { source: input.source, conditionKey: input.conditionKey },
        }).returning({ id: alarmEvents.id });
        if (!input.maintenance) {
          await queueAlarmNotifications(db, {
            siteId: input.siteId,
            alarmId: active.id,
            alarmEventId: event.id,
            severity: active.severity,
            kind: input.kind,
            eventType: "resolved_automatically",
            occurredAt: evaluatedAt,
          });
        }
        resolved = 1;
      }
    }
    if (state) {
      await db.update(operationalConditionStates).set({
        observed: false,
        firstObservedAt: null,
        lastObservedAt: evaluatedAt,
        lastValue: input.value === null ? null : String(input.value),
        severity: "normal",
        context: input.context,
        updatedAt: evaluatedAt,
      }).where(eq(operationalConditionStates.id, state.id));
    }
    return { opened: 0, resolved, escalated: 0 };
  }

  const firstObservedAt = state?.observed && state.firstObservedAt ? state.firstObservedAt : evaluatedAt;
  const elapsedSeconds = Math.max(0, Math.floor((evaluatedAt.getTime() - firstObservedAt.getTime()) / 1000));
  let activeAlarmId = state?.activeAlarmId ?? null;
  let opened = 0;
  let escalated = 0;

  if (elapsedSeconds >= input.delaySeconds) {
    const [existing] = activeAlarmId
      ? await db.select({ id: alarms.id, status: alarms.status, severity: alarms.severity }).from(alarms).where(eq(alarms.id, activeAlarmId)).limit(1)
      : [];

    if (!existing || existing.status === "closed") {
      const [created] = await db.insert(alarms).values({
        siteId: input.siteId,
        assetId: input.assetId,
        channelId: null,
        ruleId: null,
        code: alarmCode(input.codePrefix, input.conditionKey, evaluatedAt),
        kind: input.kind,
        severity: input.severity,
        status: "open",
        title: input.title,
        detail: input.detail,
        triggerValue: input.value === null ? null : String(input.value),
        thresholdValue: input.threshold === null ? null : String(input.threshold),
        openedAt: firstObservedAt,
        lastObservedAt: evaluatedAt,
        context: { source: input.source, conditionKey: input.conditionKey, ...input.context },
      }).returning({ id: alarms.id });
      activeAlarmId = created.id;
      const [event] = await db.insert(alarmEvents).values({
        alarmId: created.id,
        eventType: "opened",
        payload: { source: input.source, conditionKey: input.conditionKey, value: input.value, threshold: input.threshold },
      }).returning({ id: alarmEvents.id });
      if (!input.maintenance) {
        await queueAlarmNotifications(db, {
          siteId: input.siteId,
          alarmId: created.id,
          alarmEventId: event.id,
          severity: input.severity,
          kind: input.kind,
          eventType: "opened",
          occurredAt: evaluatedAt,
        });
      }
      opened = 1;
    } else if (existing.status === "resolved") {
      await db.update(alarms).set({
        status: "open",
        resolvedAt: null,
        resolvedBy: null,
        severity: input.severity,
        title: input.title,
        detail: input.detail,
        triggerValue: input.value === null ? null : String(input.value),
        thresholdValue: input.threshold === null ? null : String(input.threshold),
        lastObservedAt: evaluatedAt,
        context: { source: input.source, conditionKey: input.conditionKey, ...input.context },
      }).where(eq(alarms.id, existing.id));
      const [event] = await db.insert(alarmEvents).values({
        alarmId: existing.id,
        eventType: "reopened_automatically",
        payload: { source: input.source, conditionKey: input.conditionKey, value: input.value, threshold: input.threshold },
      }).returning({ id: alarmEvents.id });
      if (!input.maintenance) {
        await queueAlarmNotifications(db, {
          siteId: input.siteId,
          alarmId: existing.id,
          alarmEventId: event.id,
          severity: input.severity,
          kind: input.kind,
          eventType: "reopened_automatically",
          occurredAt: evaluatedAt,
        });
      }
      opened = 1;
    } else {
      const severityChanged = existing.severity !== input.severity;
      await db.update(alarms).set({
        severity: input.severity,
        title: input.title,
        detail: input.detail,
        triggerValue: input.value === null ? null : String(input.value),
        thresholdValue: input.threshold === null ? null : String(input.threshold),
        lastObservedAt: evaluatedAt,
        context: { source: input.source, conditionKey: input.conditionKey, ...input.context },
      }).where(eq(alarms.id, existing.id));
      if (severityChanged && input.severity === "critical") {
        const [event] = await db.insert(alarmEvents).values({
          alarmId: existing.id,
          eventType: "escalated",
          payload: { source: input.source, conditionKey: input.conditionKey, from: existing.severity, to: input.severity, value: input.value },
        }).returning({ id: alarmEvents.id });
        if (!input.maintenance) {
          await queueAlarmNotifications(db, {
            siteId: input.siteId,
            alarmId: existing.id,
            alarmEventId: event.id,
            severity: input.severity,
            kind: input.kind,
            eventType: "escalated",
            occurredAt: evaluatedAt,
          });
        }
        escalated = 1;
      }
    }
  }

  await db.insert(operationalConditionStates).values({
    assetId: input.assetId,
    deviceId: input.deviceId,
    conditionKey: input.conditionKey,
    activeAlarmId,
    observed: true,
    firstObservedAt,
    lastObservedAt: evaluatedAt,
    lastValue: input.value === null ? null : String(input.value),
    severity: input.severity,
    context: input.context,
    updatedAt: evaluatedAt,
  }).onConflictDoUpdate({
    target: [operationalConditionStates.assetId, operationalConditionStates.conditionKey],
    set: {
      deviceId: input.deviceId,
      activeAlarmId,
      observed: true,
      firstObservedAt,
      lastObservedAt: evaluatedAt,
      lastValue: input.value === null ? null : String(input.value),
      severity: input.severity,
      context: input.context,
      updatedAt: evaluatedAt,
    },
  });

  return { opened, resolved: 0, escalated };
}
