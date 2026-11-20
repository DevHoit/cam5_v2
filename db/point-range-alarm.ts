import { and, eq, inArray } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { queueAlarmNotifications } from "./notification-engine";
import { classifyPoint, resolvePointConfig, type EffectivePointConfig, type PointSensorReading } from "./point-types";
import { alarmEvents, alarms, assets, channels, devices, latestReadings, pointRangeStates, pointTypes, readingProfiles } from "./schema";

/**
 * Alarma por rango objetivo de un punto (cámaras de frío y cualquier punto con rango).
 *
 * El punto se evalúa con su regla (peor sensor vigente) contra su rango. Una salida de rango se
 * registra en point_range_states, pero la alarma solo se abre si dura más que la tolerancia del punto
 * (una puerta abierta unos minutos no alarma). Escala a crítica si la excursión dura el triple de la
 * tolerancia (mínimo 30 min) y se resuelve sola cuando el punto vuelve al rango.
 */

const CRITICAL_MULTIPLIER = 3;
const CRITICAL_MINIMUM_MINUTES = 30;

export function criticalAfterMinutes(config: Pick<EffectivePointConfig, "toleranceMinutes">) {
  return Math.max(config.toleranceMinutes * CRITICAL_MULTIPLIER, CRITICAL_MINIMUM_MINUTES);
}

function code(reference: string, now: Date) {
  const compact = reference.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 14) || "PUNTO";
  return `RNG-${compact}-${now.getTime().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

function format(value: number, decimals: number) {
  return new Intl.NumberFormat("es-CL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

function minutesLabel(minutes: number) {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = Math.floor(minutes / 60), rest = Math.round(minutes % 60);
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export async function evaluatePointRanges(db: Cam5Database, assetIds: string[], evaluatedAt = new Date()) {
  const result = { opened: 0, escalated: 0, resolved: 0 };
  if (!assetIds.length) return result;
  const points = await db.select({
    id: assets.id,
    code: assets.code,
    name: assets.name,
    siteId: assets.siteId,
    config: assets.config,
    primaryQuantity: pointTypes.primaryQuantity,
    aggregation: pointTypes.aggregation,
    defaultConfig: pointTypes.defaultConfig,
  }).from(assets).innerJoin(pointTypes, eq(pointTypes.key, assets.assetType))
    .where(and(inArray(assets.id, assetIds), eq(assets.active, true)));

  for (const point of points) {
    const config = resolvePointConfig({ aggregation: point.aggregation, defaultConfig: point.defaultConfig }, point.config);
    if (!point.primaryQuantity || (config.rangeMin === null && config.rangeMax === null)) continue;
    const rows = await db.select({
      channelId: channels.id,
      deviceId: devices.id,
      position: devices.position,
      unit: channels.unit,
      value: latestReadings.value,
      quality: latestReadings.quality,
      recordedAt: latestReadings.recordedAt,
      staleAfterSeconds: readingProfiles.staleAfterSeconds,
    }).from(channels)
      .innerJoin(devices, and(eq(devices.id, channels.deviceId), eq(devices.active, true)))
      .leftJoin(readingProfiles, eq(readingProfiles.id, devices.readingProfileId))
      .leftJoin(latestReadings, eq(latestReadings.channelId, channels.id))
      .where(and(eq(channels.assetId, point.id), eq(channels.enabled, true), eq(channels.role, "process"), eq(channels.metric, point.primaryQuantity)));
    const readings: PointSensorReading[] = rows.map((row) => {
      const fresh = Boolean(row.recordedAt && evaluatedAt.getTime() - row.recordedAt.getTime() <= (row.staleAfterSeconds ?? 180) * 1000);
      return { channelId: row.channelId, deviceId: row.deviceId, position: row.position, value: row.value === null ? null : Number(row.value), quality: row.quality === "good" && !fresh ? "stale" : (row.quality ?? "stale") as PointSensorReading["quality"], recordedAt: row.recordedAt };
    });
    const condition = classifyPoint(readings, config);
    // Sin datos vigentes no se decide nada: de eso se encarga la alarma de comunicación.
    if (condition.status === "no_data") continue;

    const [state] = await db.select().from(pointRangeStates).where(eq(pointRangeStates.assetId, point.id)).limit(1);
    const [active] = state?.activeAlarmId
      ? await db.select({ id: alarms.id, status: alarms.status, severity: alarms.severity }).from(alarms).where(eq(alarms.id, state.activeAlarmId)).limit(1)
      : [];
    const openAlarm = active && (active.status === "open" || active.status === "acknowledged") ? active : null;
    const unit = rows[0]?.unit ?? "";
    const decimals = unit === "°C" ? 1 : 2;

    if (condition.status !== "out_of_range" || condition.value === null || condition.deviation === null) {
      if (openAlarm) {
        await db.update(alarms).set({ status: "resolved", resolvedAt: evaluatedAt, resolvedBy: null, lastObservedAt: evaluatedAt }).where(eq(alarms.id, openAlarm.id));
        const [event] = await db.insert(alarmEvents).values({ alarmId: openAlarm.id, eventType: "resolved_automatically", payload: { reason: "back_in_range", value: condition.value } }).returning({ id: alarmEvents.id });
        await queueAlarmNotifications(db, { siteId: point.siteId, alarmId: openAlarm.id, alarmEventId: event.id, severity: openAlarm.severity, kind: "threshold", eventType: "resolved_automatically", occurredAt: evaluatedAt });
        result.resolved += 1;
      }
      await db.update(assets).set({ state: "normal", updatedAt: evaluatedAt }).where(and(eq(assets.id, point.id), inArray(assets.state, ["warning", "critical"])));
      await db.insert(pointRangeStates).values({ assetId: point.id, outSince: null, peakDeviation: null, activeAlarmId: null, lastEvaluatedAt: evaluatedAt })
        .onConflictDoUpdate({ target: pointRangeStates.assetId, set: { outSince: null, peakDeviation: null, activeAlarmId: null, lastEvaluatedAt: evaluatedAt } });
      continue;
    }

    // La excursión empieza con la primera lectura fuera de rango que vio el portal.
    const outSince = state?.outSince ?? condition.decisive?.recordedAt ?? evaluatedAt;
    const minutesOut = Math.max(0, (evaluatedAt.getTime() - outSince.getTime()) / 60_000);
    const peak = Math.max(Math.abs(condition.deviation), Math.abs(Number(state?.peakDeviation ?? 0)));
    const limit = condition.deviation > 0 ? config.rangeMax! : config.rangeMin!;
    const severity = minutesOut >= criticalAfterMinutes(config) ? "critical" : "warning";
    const where = condition.decisive?.position ? `${condition.decisive.position}: ` : "";
    const detail = `${where}${format(condition.value, decimals)} ${unit} (${condition.deviation > 0 ? "máx." : "mín."} ${format(limit, decimals)} ${unit}) desde hace ${minutesLabel(minutesOut)}.`;
    let activeAlarmId = openAlarm?.id ?? null;

    if (minutesOut >= config.toleranceMinutes) {
      if (!openAlarm) {
        const [created] = await db.insert(alarms).values({
          siteId: point.siteId,
          assetId: point.id,
          channelId: condition.decisive?.channelId ?? null,
          code: code(point.code, evaluatedAt),
          kind: "threshold",
          severity,
          status: "open",
          title: `${point.name} fuera de rango`,
          detail,
          triggerValue: String(condition.value),
          thresholdValue: String(limit),
          openedAt: evaluatedAt,
          lastObservedAt: evaluatedAt,
          context: { source: "point_range", outSince: outSince.toISOString(), toleranceMinutes: config.toleranceMinutes, rangeMin: config.rangeMin, rangeMax: config.rangeMax, position: condition.decisive?.position ?? null },
        }).returning({ id: alarms.id });
        const [event] = await db.insert(alarmEvents).values({ alarmId: created.id, eventType: "opened", payload: { source: "point_range", value: condition.value, limit, minutesOut: Math.round(minutesOut) } }).returning({ id: alarmEvents.id });
        await queueAlarmNotifications(db, { siteId: point.siteId, alarmId: created.id, alarmEventId: event.id, severity, kind: "threshold", eventType: "opened", occurredAt: evaluatedAt });
        activeAlarmId = created.id;
        result.opened += 1;
      } else {
        const escalate = severity === "critical" && openAlarm.severity !== "critical";
        await db.update(alarms).set({
          severity: escalate ? "critical" : openAlarm.severity,
          detail,
          triggerValue: String(condition.value),
          lastObservedAt: evaluatedAt,
          channelId: condition.decisive?.channelId ?? undefined,
        }).where(eq(alarms.id, openAlarm.id));
        if (escalate) {
          const [event] = await db.insert(alarmEvents).values({ alarmId: openAlarm.id, eventType: "escalated", payload: { source: "point_range", minutesOut: Math.round(minutesOut) } }).returning({ id: alarmEvents.id });
          await queueAlarmNotifications(db, { siteId: point.siteId, alarmId: openAlarm.id, alarmEventId: event.id, severity: "critical", kind: "threshold", eventType: "escalated", occurredAt: evaluatedAt });
          result.escalated += 1;
        }
      }
    }
    // El estado del punto acompaña a la alarma: advertencia mientras se tolera y crítica si escala.
    await db.update(assets).set({ state: activeAlarmId && severity === "critical" ? "critical" : "warning", updatedAt: evaluatedAt }).where(eq(assets.id, point.id));
    await db.insert(pointRangeStates).values({ assetId: point.id, outSince, peakDeviation: String(peak), activeAlarmId, lastEvaluatedAt: evaluatedAt })
      .onConflictDoUpdate({ target: pointRangeStates.assetId, set: { outSince, peakDeviation: String(peak), activeAlarmId, lastEvaluatedAt: evaluatedAt } });
  }
  return result;
}
