import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { queueAlarmNotifications } from "./notification-engine";
import {
  alarmEvents,
  alarmRules,
  alarmRuleStates,
  alarms,
  assets,
  channels,
  devices,
  gateways,
  readingProfiles,
} from "./schema";

export type AlarmSeverity = "normal" | "warning" | "critical";
export type AlarmKind = "threshold" | "communication" | "data_quality";
type ReadingQuality = "good" | "stale" | "bad" | "disabled";

export type AlarmEvaluationReading = {
  channelId: string;
  value: number | null;
  quality: ReadingQuality;
  qualityFlags: string[];
};

const ACTIVE_STATUSES = ["open", "acknowledged", "resolved"] as const;
const severityRank: Record<AlarmSeverity, number> = { normal: 0, warning: 1, critical: 2 };

function alarmCode(prefix: string, reference: string, now: Date) {
  const compactReference = reference.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 14) || "EVENT";
  return `${prefix}-${compactReference}-${now.getTime().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

export function classifyAlarmCondition(
  value: number | null,
  quality: ReadingQuality,
  flags: string[],
  warningThreshold: string | null,
  criticalThreshold: string | null,
): { severity: AlarmSeverity; kind: AlarmKind; threshold: number | null } {
  if (quality === "bad" || flags.includes("communication_lost")) {
    return { severity: "critical", kind: flags.includes("communication_lost") ? "communication" : "data_quality", threshold: null };
  }
  if (quality === "stale") return { severity: "warning", kind: "communication", threshold: null };
  if (quality !== "good" || value === null || !Number.isFinite(value)) return { severity: "normal", kind: "threshold", threshold: null };
  const warning = warningThreshold === null ? null : Number(warningThreshold);
  const critical = criticalThreshold === null ? null : Number(criticalThreshold);
  if (critical !== null && value >= critical) return { severity: "critical", kind: "threshold", threshold: critical };
  if (warning !== null && value >= warning) return { severity: "warning", kind: "threshold", threshold: warning };
  return { severity: "normal", kind: "threshold", threshold: warning };
}

export function remainsInsideAlarmHysteresis(
  value: number | null,
  quality: ReadingQuality,
  previousSeverity: AlarmSeverity | null,
  previousKind: AlarmKind | null,
  warningThreshold: string | null,
  criticalThreshold: string | null,
  hysteresis: string,
) {
  if (quality !== "good" || value === null || !previousSeverity || previousSeverity === "normal" || previousKind !== "threshold") return false;
  const previousThreshold = Number(previousSeverity === "critical" ? criticalThreshold : warningThreshold);
  const recoveryBoundary = previousThreshold - Number(hysteresis);
  return Number.isFinite(previousThreshold) && value > recoveryBoundary;
}

function alarmCopy(input: {
  kind: AlarmKind;
  severity: AlarmSeverity;
  channelCode: string;
  channelName: string;
  zone: string | null;
  value: number | null;
  unit: string;
  threshold: number | null;
}) {
  if (input.kind === "communication") {
    return {
      title: `Pérdida de comunicación · ${input.channelCode}`,
      detail: `${input.channelName} · ${input.zone || "Sin zona"}. La lectura no llegó con calidad válida.`,
    };
  }
  if (input.kind === "data_quality") {
    return {
      title: `Calidad de datos inválida · ${input.channelCode}`,
      detail: `${input.channelName} · ${input.zone || "Sin zona"}. El CAM5 reportó una muestra inválida.`,
    };
  }
  const level = input.severity === "critical" ? "Umbral crítico" : "Umbral de advertencia";
  return {
    title: `${level} superado · ${input.channelCode}`,
    detail: `${input.channelName} · ${input.zone || "Sin zona"}. Valor ${input.value ?? "—"} ${input.unit}; umbral ${input.threshold ?? "—"} ${input.unit}.`,
  };
}

export async function evaluateAlarmReadings(
  db: Cam5Database,
  assetId: string,
  currentReadings: AlarmEvaluationReading[],
  evaluatedAt = new Date(),
) {
  const readingByChannel = new Map(currentReadings.map((reading) => [reading.channelId, reading]));
  const channelIds = [...readingByChannel.keys()];
  if (!channelIds.length) return { opened: 0, updated: 0, resolved: 0 };

  const rows = await db.select({
    ruleId: alarmRules.id,
    channelId: channels.id,
    channelCode: channels.code,
    channelName: channels.name,
    zone: channels.zone,
    unit: channels.unit,
    siteId: assets.siteId,
    warningThreshold: alarmRules.warningThreshold,
    criticalThreshold: alarmRules.criticalThreshold,
    hysteresis: alarmRules.hysteresis,
    activationSamples: alarmRules.activationSamples,
    recoverySamples: alarmRules.recoverySamples,
    stateSeverity: alarmRuleStates.currentSeverity,
    stateKind: alarmRuleStates.currentKind,
    breachCount: alarmRuleStates.breachCount,
    recoveryCount: alarmRuleStates.recoveryCount,
    activeAlarmId: alarmRuleStates.activeAlarmId,
  }).from(alarmRules)
    .innerJoin(channels, eq(channels.id, alarmRules.channelId))
    .innerJoin(assets, eq(assets.id, channels.assetId))
    .leftJoin(alarmRuleStates, eq(alarmRuleStates.ruleId, alarmRules.id))
    .where(and(
      inArray(channels.id, channelIds),
      eq(channels.assetId, assetId),
      eq(channels.enabled, true),
      eq(alarmRules.enabled, true),
    ));

  let opened = 0;
  let updated = 0;
  let resolved = 0;
  for (const row of rows) {
    const reading = readingByChannel.get(row.channelId);
    if (!reading) continue;
    let observed = classifyAlarmCondition(reading.value, reading.quality, reading.qualityFlags, row.warningThreshold, row.criticalThreshold);
    if (observed.severity === "normal" && remainsInsideAlarmHysteresis(reading.value, reading.quality, row.stateSeverity, row.stateKind as AlarmKind | null, row.warningThreshold, row.criticalThreshold, row.hysteresis)) {
      const previousThreshold = Number(row.stateSeverity === "critical" ? row.criticalThreshold : row.warningThreshold);
      observed = { severity: row.stateSeverity!, kind: "threshold", threshold: previousThreshold };
    }
    const sameCondition = row.stateSeverity === observed.severity && row.stateKind === observed.kind;
    let breachCount = observed.severity === "normal" ? 0 : sameCondition ? (row.breachCount ?? 0) + 1 : 1;
    let recoveryCount = observed.severity === "normal" && row.stateSeverity !== "normal" ? (row.recoveryCount ?? 0) + 1 : 0;
    let activeAlarmId = row.activeAlarmId;

    if (observed.severity === "normal" && activeAlarmId && recoveryCount >= row.recoverySamples) {
      const [activeAlarm] = await db.select({ id: alarms.id, status: alarms.status, severity: alarms.severity, kind: alarms.kind, siteId: alarms.siteId }).from(alarms).where(eq(alarms.id, activeAlarmId)).limit(1);
      if (activeAlarm && activeAlarm.status !== "closed" && activeAlarm.status !== "resolved") {
        await db.update(alarms).set({ status: "resolved", resolvedAt: evaluatedAt, resolvedBy: null, lastObservedAt: evaluatedAt }).where(eq(alarms.id, activeAlarm.id));
        const [alarmEvent] = await db.insert(alarmEvents).values({ alarmId: activeAlarm.id, eventType: "resolved_automatically", payload: { reason: "recovery_samples", recoverySamples: row.recoverySamples } }).returning({ id: alarmEvents.id });
        await queueAlarmNotifications(db, { siteId: activeAlarm.siteId, alarmId: activeAlarm.id, alarmEventId: alarmEvent.id, severity: activeAlarm.severity, kind: activeAlarm.kind as AlarmKind, eventType: "resolved_automatically", occurredAt: evaluatedAt });
        resolved += 1;
      }
      recoveryCount = 0;
    }

    if (observed.severity !== "normal" && breachCount >= row.activationSamples) {
      const copy = alarmCopy({
        kind: observed.kind,
        severity: observed.severity,
        channelCode: row.channelCode,
        channelName: row.channelName,
        zone: row.zone,
        value: reading.value,
        unit: row.unit,
        threshold: observed.threshold,
      });
      const [activeAlarm] = activeAlarmId
        ? await db.select({ id: alarms.id, status: alarms.status, severity: alarms.severity, kind: alarms.kind }).from(alarms).where(eq(alarms.id, activeAlarmId)).limit(1)
        : [];
      if (!activeAlarm || activeAlarm.status === "closed") {
        const [created] = await db.insert(alarms).values({
          siteId: row.siteId,
          assetId,
          channelId: row.channelId,
          ruleId: row.ruleId,
          code: alarmCode("AL", row.channelCode, evaluatedAt),
          kind: observed.kind,
          severity: observed.severity,
          status: "open",
          title: copy.title,
          detail: copy.detail,
          triggerValue: reading.value === null ? null : String(reading.value),
          thresholdValue: observed.threshold === null ? null : String(observed.threshold),
          openedAt: evaluatedAt,
          lastObservedAt: evaluatedAt,
          context: { quality: reading.quality, qualityFlags: reading.qualityFlags },
        }).returning({ id: alarms.id });
        activeAlarmId = created.id;
        const [alarmEvent] = await db.insert(alarmEvents).values({ alarmId: created.id, eventType: "opened", payload: { severity: observed.severity, kind: observed.kind, value: reading.value, threshold: observed.threshold } }).returning({ id: alarmEvents.id });
        await queueAlarmNotifications(db, { siteId: row.siteId, alarmId: created.id, alarmEventId: alarmEvent.id, severity: observed.severity, kind: observed.kind, eventType: "opened", occurredAt: evaluatedAt });
        opened += 1;
      } else {
        const escalated = severityRank[observed.severity] > severityRank[activeAlarm.severity];
        const reopened = activeAlarm.status === "resolved";
        const nextSeverity = escalated ? observed.severity : activeAlarm.severity;
        await db.update(alarms).set({
          status: reopened ? "open" : activeAlarm.status,
          kind: observed.kind,
          severity: nextSeverity,
          title: copy.title,
          detail: copy.detail,
          triggerValue: reading.value === null ? null : String(reading.value),
          thresholdValue: observed.threshold === null ? null : String(observed.threshold),
          lastObservedAt: evaluatedAt,
          resolvedAt: reopened ? null : undefined,
          resolvedBy: reopened ? null : undefined,
          occurrenceCount: sql`${alarms.occurrenceCount} + 1`,
          context: { quality: reading.quality, qualityFlags: reading.qualityFlags },
        }).where(eq(alarms.id, activeAlarm.id));
        if (reopened || escalated || activeAlarm.kind !== observed.kind) {
          const eventType = reopened ? "reopened_automatically" : escalated ? "escalated" : "source_changed";
          const [alarmEvent] = await db.insert(alarmEvents).values({ alarmId: activeAlarm.id, eventType, payload: { severity: observed.severity, kind: observed.kind, value: reading.value, threshold: observed.threshold } }).returning({ id: alarmEvents.id });
          await queueAlarmNotifications(db, { siteId: row.siteId, alarmId: activeAlarm.id, alarmEventId: alarmEvent.id, severity: observed.severity, kind: observed.kind, eventType, occurredAt: evaluatedAt });
        }
        updated += 1;
      }
      breachCount = row.activationSamples;
    }

    await db.insert(alarmRuleStates).values({
      ruleId: row.ruleId,
      activeAlarmId,
      currentSeverity: observed.severity,
      currentKind: observed.kind,
      breachCount,
      recoveryCount,
      lastValue: reading.value === null ? null : String(reading.value),
      lastQuality: reading.quality,
      lastEvaluatedAt: evaluatedAt,
      updatedAt: evaluatedAt,
    }).onConflictDoUpdate({
      target: alarmRuleStates.ruleId,
      set: {
        activeAlarmId,
        currentSeverity: observed.severity,
        currentKind: observed.kind,
        breachCount,
        recoveryCount,
        lastValue: reading.value === null ? null : String(reading.value),
        lastQuality: reading.quality,
        lastEvaluatedAt: evaluatedAt,
        updatedAt: evaluatedAt,
      },
    });
  }
  return { opened, updated, resolved };
}

export async function evaluateStaleCommunications(db: Cam5Database, siteId: string, evaluatedAt = new Date()) {
  const monitored = await db.select({
    assetId: assets.id,
    assetCode: assets.code,
    assetName: assets.name,
    deviceCode: devices.code,
    deviceUpdatedAt: devices.updatedAt,
    lastReadAt: devices.lastReadAt,
    gatewayLastSeenAt: gateways.lastSeenAt,
    staleAfterSeconds: readingProfiles.staleAfterSeconds,
  }).from(devices)
    .innerJoin(assets, eq(assets.id, devices.assetId))
    .innerJoin(gateways, eq(gateways.id, devices.gatewayId))
    .leftJoin(readingProfiles, eq(readingProfiles.id, devices.readingProfileId))
    .where(and(eq(assets.siteId, siteId), eq(assets.active, true), eq(devices.active, true), eq(gateways.active, true)));

  for (const device of monitored) {
    const staleAfterSeconds = device.staleAfterSeconds ?? 30;
    const lastContact = device.lastReadAt ?? device.gatewayLastSeenAt ?? device.deviceUpdatedAt;
    const ageSeconds = Math.max(0, Math.floor((evaluatedAt.getTime() - lastContact.getTime()) / 1000));
    const stale = ageSeconds > staleAfterSeconds;
    const [active] = await db.select({ id: alarms.id, status: alarms.status, severity: alarms.severity }).from(alarms).where(and(
      eq(alarms.assetId, device.assetId),
      eq(alarms.kind, "communication"),
      isNull(alarms.channelId),
      inArray(alarms.status, ACTIVE_STATUSES),
    )).orderBy(alarms.openedAt).limit(1);

    if (stale) {
      const severity: AlarmSeverity = ageSeconds >= staleAfterSeconds * 3 ? "critical" : "warning";
      if (!active) {
        const [created] = await db.insert(alarms).values({
          siteId,
          assetId: device.assetId,
          code: alarmCode("COM", device.assetCode, evaluatedAt),
          kind: "communication",
          severity,
          status: "open",
          title: `Sin comunicación con ${device.deviceCode}`,
          detail: `${device.assetName} no recibe telemetría desde hace ${ageSeconds} segundos.`,
          triggerValue: String(ageSeconds),
          thresholdValue: String(staleAfterSeconds),
          openedAt: evaluatedAt,
          lastObservedAt: evaluatedAt,
          context: { deviceCode: device.deviceCode, ageSeconds, staleAfterSeconds },
        }).returning({ id: alarms.id });
        const [alarmEvent] = await db.insert(alarmEvents).values({ alarmId: created.id, eventType: "opened", payload: { kind: "communication", ageSeconds, staleAfterSeconds } }).returning({ id: alarmEvents.id });
        await queueAlarmNotifications(db, { siteId, alarmId: created.id, alarmEventId: alarmEvent.id, severity, kind: "communication", eventType: "opened", occurredAt: evaluatedAt });
      } else {
        const escalated = severityRank[severity] > severityRank[active.severity];
        await db.update(alarms).set({
          status: active.status === "resolved" ? "open" : active.status,
          severity: escalated ? severity : active.severity,
          detail: `${device.assetName} no recibe telemetría desde hace ${ageSeconds} segundos.`,
          triggerValue: String(ageSeconds),
          thresholdValue: String(staleAfterSeconds),
          lastObservedAt: evaluatedAt,
          resolvedAt: active.status === "resolved" ? null : undefined,
          resolvedBy: active.status === "resolved" ? null : undefined,
          context: { deviceCode: device.deviceCode, ageSeconds, staleAfterSeconds },
        }).where(eq(alarms.id, active.id));
        if (active.status === "resolved" || escalated) {
          const eventType = active.status === "resolved" ? "reopened_automatically" : "escalated";
          const [alarmEvent] = await db.insert(alarmEvents).values({ alarmId: active.id, eventType, payload: { severity, ageSeconds, staleAfterSeconds } }).returning({ id: alarmEvents.id });
          await queueAlarmNotifications(db, { siteId, alarmId: active.id, alarmEventId: alarmEvent.id, severity, kind: "communication", eventType, occurredAt: evaluatedAt });
        }
      }
    } else if (active && active.status !== "resolved") {
      await db.update(alarms).set({ status: "resolved", resolvedAt: evaluatedAt, resolvedBy: null, lastObservedAt: evaluatedAt }).where(eq(alarms.id, active.id));
      const [alarmEvent] = await db.insert(alarmEvents).values({ alarmId: active.id, eventType: "resolved_automatically", payload: { reason: "communication_recovered", ageSeconds } }).returning({ id: alarmEvents.id });
      await queueAlarmNotifications(db, { siteId, alarmId: active.id, alarmEventId: alarmEvent.id, severity: active.severity, kind: "communication", eventType: "resolved_automatically", occurredAt: evaluatedAt });
    }
  }
}
