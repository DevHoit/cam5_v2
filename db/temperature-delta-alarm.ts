import { and, eq } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { queueAlarmNotifications } from "./notification-engine";
import { alarmEvents, alarms, assets, channels, latestReadings, pointDeltaStates, type PointConfigOverrides } from "./schema";

/**
 * Alarma por diferencia de temperatura entre sensores de un mismo punto (CAM5).
 *
 * Compara la lectura vigente más alta y la más baja de los sensores de temperatura del punto. Si la
 * diferencia supera el umbral de advertencia (35 °C) o el crítico (60 °C) durante varias lecturas
 * seguidas abre la alarma (y se notifica por correo según las políticas del sitio). Escala a crítica,
 * y se resuelve sola cuando la diferencia baja del umbral menos la histéresis.
 */
export const TEMPERATURE_DELTA_DEFAULTS = { warning: 35, critical: 60, hysteresis: 2, activationSamples: 3, recoverySamples: 3, staleAfterSeconds: 180 };

type Severity = "normal" | "warning" | "critical";
export type DeltaSensor = { channelId: string; code: string; name: string; value: number };

export function temperatureDeltaThresholds(config: PointConfigOverrides | null | undefined) {
  const pick = (value: number | null | undefined, fallback: number) => value === null ? null : typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return {
    warning: pick(config?.temperatureDeltaWarning, TEMPERATURE_DELTA_DEFAULTS.warning),
    critical: pick(config?.temperatureDeltaCritical, TEMPERATURE_DELTA_DEFAULTS.critical),
  };
}

/** Diferencia entre el sensor más caliente y el más frío, y su severidad ("mayor a" el umbral). */
export function classifyTemperatureDelta(sensors: DeltaSensor[], thresholds: { warning: number | null; critical: number | null }) {
  if (sensors.length < 2) return null;
  const sorted = [...sensors].sort((a, b) => b.value - a.value);
  const hottest = sorted[0], coldest = sorted[sorted.length - 1];
  const delta = hottest.value - coldest.value;
  const severity: Severity = thresholds.critical !== null && delta > thresholds.critical ? "critical"
    : thresholds.warning !== null && delta > thresholds.warning ? "warning" : "normal";
  return { delta, hottest, coldest, severity };
}

const rank: Record<Severity, number> = { normal: 0, warning: 1, critical: 2 };
const format = (value: number) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);

function code(reference: string, now: Date) {
  const compact = reference.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 14) || "PUNTO";
  return `DT-${compact}-${now.getTime().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

export async function evaluateTemperatureDelta(db: Cam5Database, assetId: string, evaluatedAt = new Date()) {
  const result = { opened: 0, escalated: 0, resolved: 0 };
  const [point] = await db.select({ id: assets.id, code: assets.code, name: assets.name, siteId: assets.siteId, config: assets.config })
    .from(assets).where(and(eq(assets.id, assetId), eq(assets.active, true))).limit(1);
  if (!point) return result;
  const thresholds = temperatureDeltaThresholds(point.config);
  if (thresholds.warning === null && thresholds.critical === null) return result;

  const rows = await db.select({ channelId: channels.id, code: channels.code, name: channels.name, value: latestReadings.value, quality: latestReadings.quality, recordedAt: latestReadings.recordedAt })
    .from(channels).innerJoin(latestReadings, eq(latestReadings.channelId, channels.id))
    .where(and(eq(channels.assetId, point.id), eq(channels.enabled, true), eq(channels.role, "process"), eq(channels.metric, "temperature")));
  const sensors: DeltaSensor[] = rows
    .filter((row) => row.quality === "good" && row.value !== null && evaluatedAt.getTime() - row.recordedAt.getTime() <= TEMPERATURE_DELTA_DEFAULTS.staleAfterSeconds * 1000)
    .map((row) => ({ channelId: row.channelId, code: row.code, name: row.name, value: Number(row.value) }));
  const condition = classifyTemperatureDelta(sensors, thresholds);
  // Con menos de dos sensores vigentes no hay comparación; la falta de datos la cubre la alarma de comunicación.
  if (!condition) return result;

  const [state] = await db.select().from(pointDeltaStates).where(eq(pointDeltaStates.assetId, point.id)).limit(1);
  const [active] = state?.activeAlarmId
    ? await db.select({ id: alarms.id, status: alarms.status, severity: alarms.severity }).from(alarms).where(eq(alarms.id, state.activeAlarmId)).limit(1)
    : [];
  const openAlarm = active && (active.status === "open" || active.status === "acknowledged") ? active : null;

  let severity = condition.severity;
  // Histéresis: con una alarma abierta, la diferencia debe bajar del umbral menos 2 °C para contar como normal.
  if (openAlarm && rank[severity] < rank[openAlarm.severity as Severity]) {
    const limit = openAlarm.severity === "critical" ? thresholds.critical : thresholds.warning;
    if (limit !== null && condition.delta > limit - TEMPERATURE_DELTA_DEFAULTS.hysteresis) severity = openAlarm.severity as Severity;
  }
  const previous = (state?.currentSeverity ?? "normal") as Severity;
  const breachCount = severity === "normal" ? 0 : previous === severity ? (state?.breachCount ?? 0) + 1 : 1;
  let recoveryCount = severity === "normal" && openAlarm ? (state?.recoveryCount ?? 0) + 1 : 0;
  let activeAlarmId = openAlarm?.id ?? null;

  const threshold = severity === "critical" ? thresholds.critical : thresholds.warning;
  const detail = `${condition.hottest.name} (${condition.hottest.code}) ${format(condition.hottest.value)} °C y ${condition.coldest.name} (${condition.coldest.code}) ${format(condition.coldest.value)} °C: diferencia de ${format(condition.delta)} °C`
    + (threshold === null ? "." : ` (umbral ${format(threshold)} °C).`);
  const context = { source: "temperature_delta", delta: condition.delta, hottest: condition.hottest, coldest: condition.coldest, thresholds };

  if (severity !== "normal" && breachCount >= TEMPERATURE_DELTA_DEFAULTS.activationSamples) {
    if (!openAlarm) {
      const [created] = await db.insert(alarms).values({
        siteId: point.siteId, assetId: point.id, channelId: condition.hottest.channelId, code: code(point.code, evaluatedAt),
        kind: "threshold", severity, status: "open",
        title: `Diferencia de temperatura entre sensores · ${point.name}`, detail,
        triggerValue: String(condition.delta), thresholdValue: threshold === null ? null : String(threshold),
        openedAt: evaluatedAt, lastObservedAt: evaluatedAt, context,
      }).returning({ id: alarms.id });
      const [event] = await db.insert(alarmEvents).values({ alarmId: created.id, eventType: "opened", payload: { source: "temperature_delta", severity, delta: condition.delta, threshold } }).returning({ id: alarmEvents.id });
      await queueAlarmNotifications(db, { siteId: point.siteId, alarmId: created.id, alarmEventId: event.id, severity, kind: "threshold", eventType: "opened", occurredAt: evaluatedAt });
      activeAlarmId = created.id;
      result.opened += 1;
    } else {
      const escalate = rank[severity] > rank[openAlarm.severity as Severity];
      await db.update(alarms).set({
        severity: escalate ? severity : openAlarm.severity, detail, channelId: condition.hottest.channelId,
        triggerValue: String(condition.delta), thresholdValue: threshold === null ? undefined : String(threshold), lastObservedAt: evaluatedAt, context,
      }).where(eq(alarms.id, openAlarm.id));
      if (escalate) {
        const [event] = await db.insert(alarmEvents).values({ alarmId: openAlarm.id, eventType: "escalated", payload: { source: "temperature_delta", severity, delta: condition.delta, threshold } }).returning({ id: alarmEvents.id });
        await queueAlarmNotifications(db, { siteId: point.siteId, alarmId: openAlarm.id, alarmEventId: event.id, severity, kind: "threshold", eventType: "escalated", occurredAt: evaluatedAt });
        result.escalated += 1;
      }
    }
  } else if (openAlarm && severity !== "normal") {
    await db.update(alarms).set({ detail, triggerValue: String(condition.delta), lastObservedAt: evaluatedAt, context }).where(eq(alarms.id, openAlarm.id));
  }

  if (severity === "normal" && openAlarm && recoveryCount >= TEMPERATURE_DELTA_DEFAULTS.recoverySamples) {
    await db.update(alarms).set({ status: "resolved", resolvedAt: evaluatedAt, resolvedBy: null, lastObservedAt: evaluatedAt, detail, triggerValue: String(condition.delta) }).where(eq(alarms.id, openAlarm.id));
    const [event] = await db.insert(alarmEvents).values({ alarmId: openAlarm.id, eventType: "resolved_automatically", payload: { source: "temperature_delta", delta: condition.delta } }).returning({ id: alarmEvents.id });
    await queueAlarmNotifications(db, { siteId: point.siteId, alarmId: openAlarm.id, alarmEventId: event.id, severity: openAlarm.severity, kind: "threshold", eventType: "resolved_automatically", occurredAt: evaluatedAt });
    activeAlarmId = null;
    recoveryCount = 0;
    result.resolved += 1;
  }

  const values = { currentSeverity: severity, breachCount, recoveryCount, lastDelta: String(condition.delta), activeAlarmId, lastEvaluatedAt: evaluatedAt };
  await db.insert(pointDeltaStates).values({ assetId: point.id, ...values }).onConflictDoUpdate({ target: pointDeltaStates.assetId, set: values });
  return result;
}
