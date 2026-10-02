import { and, eq, inArray } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { parseElectricalAlarmConfig } from "./electrical";
import { processOperationalCondition, type OperationalConditionInput } from "./operational-condition-engine";
import {
  alarms,
  assets,
  deviceMetrics,
  devices,
  latestMetricReadings,
  metricDefinitions,
  operationalConditionStates,
} from "./schema";

type MeterMetric = {
  value: number | null;
  quality: string | null;
  recordedAt: Date | null;
};

const VOLTAGE_KEYS = [
  "electrical.voltage.l1_n",
  "electrical.voltage.l2_n",
  "electrical.voltage.l3_n",
] as const;
const CURRENT_KEYS = [
  "electrical.current.l1",
  "electrical.current.l2",
  "electrical.current.l3",
] as const;

function phaseLabel(key: string) {
  if (key.endsWith("l1_n") || key.endsWith(".l1")) return "L1";
  if (key.endsWith("l2_n") || key.endsWith(".l2")) return "L2";
  if (key.endsWith("l3_n") || key.endsWith(".l3")) return "L3";
  return key;
}

function metricValue(rows: Map<string, MeterMetric>, key: string) {
  return rows.get(key) ?? { value: null, quality: null, recordedAt: null };
}

export async function evaluateElectricalAsset(db: Cam5Database, assetId: string, evaluatedAt = new Date()) {
  const [asset] = await db.select({
    id: assets.id,
    siteId: assets.siteId,
    code: assets.code,
    name: assets.name,
    state: assets.state,
    metadata: assets.metadata,
  }).from(assets).where(and(
    eq(assets.id, assetId),
    eq(assets.assetType, "electrical_point"),
    eq(assets.active, true),
  )).limit(1);
  if (!asset) return { meters: 0, opened: 0, resolved: 0, escalated: 0, evaluated: 0 };

  const config = parseElectricalAlarmConfig(asset.metadata);
  const metricRows = await db.select({
    deviceId: devices.id,
    deviceCode: devices.code,
    deviceName: devices.name,
    metricKey: metricDefinitions.key,
    valueNumeric: latestMetricReadings.valueNumeric,
    quality: latestMetricReadings.quality,
    recordedAt: latestMetricReadings.recordedAt,
  }).from(devices)
    .leftJoin(deviceMetrics, and(eq(deviceMetrics.deviceId, devices.id), eq(deviceMetrics.enabled, true)))
    .leftJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
    .leftJoin(latestMetricReadings, eq(latestMetricReadings.deviceMetricId, deviceMetrics.id))
    .where(and(
      eq(devices.assetId, assetId),
      eq(devices.deviceType, "power_meter"),
      eq(devices.active, true),
    ));

  const previousStates = await db.select({
    conditionKey: operationalConditionStates.conditionKey,
    observed: operationalConditionStates.observed,
  }).from(operationalConditionStates).where(eq(operationalConditionStates.assetId, assetId));
  const previouslyObserved = new Set(previousStates.filter((item) => item.observed).map((item) => item.conditionKey));

  const meters = new Map<string, {
    id: string;
    code: string;
    name: string;
    metrics: Map<string, MeterMetric>;
  }>();

  for (const row of metricRows) {
    let meter = meters.get(row.deviceId);
    if (!meter) {
      meter = { id: row.deviceId, code: row.deviceCode, name: row.deviceName, metrics: new Map() };
      meters.set(row.deviceId, meter);
    }
    if (!row.metricKey) continue;
    meter.metrics.set(row.metricKey, {
      value: row.valueNumeric === null ? null : Number(row.valueNumeric),
      quality: row.quality,
      recordedAt: row.recordedAt,
    });
  }

  const conditions: OperationalConditionInput[] = [];
  let freshMeterCount = 0;

  for (const meter of meters.values()) {
    const readings = [...meter.metrics.values()].filter((item) => item.recordedAt);
    const latestAt = readings.length
      ? new Date(Math.max(...readings.map((item) => item.recordedAt!.getTime())))
      : null;
    const ageSeconds = latestAt ? Math.max(0, Math.floor((evaluatedAt.getTime() - latestAt.getTime()) / 1000)) : Number.POSITIVE_INFINITY;
    const hasGoodMetric = readings.some((item) => item.quality === "good");
    const communicationLost = !latestAt || ageSeconds > config.staleAfterSeconds || !hasGoodMetric;
    if (!communicationLost) freshMeterCount += 1;

    conditions.push({
      source: "electrical",
      codePrefix: "EL",
      assetId,
      siteId: asset.siteId,
      deviceId: meter.id,
      conditionKey: `meter:${meter.id}:communication`,
      observed: communicationLost,
      severity: Number.isFinite(ageSeconds) && ageSeconds >= config.staleAfterSeconds * 3 ? "critical" : "warning",
      kind: "communication",
      title: `Sin telemetría · ${meter.code}`,
      detail: `${asset.name} no recibe telemetría vigente desde ${meter.name}.`,
      value: Number.isFinite(ageSeconds) ? ageSeconds : null,
      threshold: config.staleAfterSeconds,
      delaySeconds: 0,
      context: { subtype: "communication_loss", deviceCode: meter.code, ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : null },
      maintenance: asset.state === "maintenance",
    });

    for (const key of VOLTAGE_KEYS) {
      const reading = metricValue(meter.metrics, key);
      const usable = !communicationLost && reading.quality === "good" && reading.value !== null;
      const lowKey = `meter:${meter.id}:${key}:low`;
      const lowBoundary = config.voltageMinV === null
        ? null
        : previouslyObserved.has(lowKey)
          ? config.voltageMinV + config.voltageHysteresisV
          : config.voltageMinV;
      conditions.push({
        source: "electrical", codePrefix: "EL", assetId, siteId: asset.siteId, deviceId: meter.id,
        conditionKey: lowKey,
        observed: Boolean(usable && lowBoundary !== null && (reading.value as number) < lowBoundary),
        severity: "critical",
        kind: "threshold",
        title: `Subtensión ${phaseLabel(key)} · ${meter.code}`,
        detail: reading.value === null || config.voltageMinV === null
          ? `${meter.name} no tiene una condición de subtensión activa.`
          : `${meter.name} registra ${reading.value.toFixed(1)} V en ${phaseLabel(key)}; mínimo configurado ${config.voltageMinV.toFixed(1)} V.`,
        value: usable ? reading.value : null,
        threshold: config.voltageMinV,
        delaySeconds: config.thresholdDelaySeconds,
        context: { subtype: "voltage_low", metricKey: key, phase: phaseLabel(key), hysteresis: config.voltageHysteresisV },
        maintenance: asset.state === "maintenance",
      });

      const highKey = `meter:${meter.id}:${key}:high`;
      const highBoundary = config.voltageMaxV === null
        ? null
        : previouslyObserved.has(highKey)
          ? config.voltageMaxV - config.voltageHysteresisV
          : config.voltageMaxV;
      conditions.push({
        source: "electrical", codePrefix: "EL", assetId, siteId: asset.siteId, deviceId: meter.id,
        conditionKey: highKey,
        observed: Boolean(usable && highBoundary !== null && (reading.value as number) > highBoundary),
        severity: "critical",
        kind: "threshold",
        title: `Sobretensión ${phaseLabel(key)} · ${meter.code}`,
        detail: reading.value === null || config.voltageMaxV === null
          ? `${meter.name} no tiene una condición de sobretensión activa.`
          : `${meter.name} registra ${reading.value.toFixed(1)} V en ${phaseLabel(key)}; máximo configurado ${config.voltageMaxV.toFixed(1)} V.`,
        value: usable ? reading.value : null,
        threshold: config.voltageMaxV,
        delaySeconds: config.thresholdDelaySeconds,
        context: { subtype: "voltage_high", metricKey: key, phase: phaseLabel(key), hysteresis: config.voltageHysteresisV },
        maintenance: asset.state === "maintenance",
      });
    }

    for (const key of CURRENT_KEYS) {
      const reading = metricValue(meter.metrics, key);
      const usable = !communicationLost && reading.quality === "good" && reading.value !== null;
      const conditionKey = `meter:${meter.id}:${key}:high`;
      const boundary = config.currentMaxA === null
        ? null
        : previouslyObserved.has(conditionKey)
          ? config.currentMaxA - config.currentHysteresisA
          : config.currentMaxA;
      conditions.push({
        source: "electrical", codePrefix: "EL", assetId, siteId: asset.siteId, deviceId: meter.id,
        conditionKey,
        observed: Boolean(usable && boundary !== null && (reading.value as number) > boundary),
        severity: "critical",
        kind: "threshold",
        title: `Sobrecorriente ${phaseLabel(key)} · ${meter.code}`,
        detail: reading.value === null || config.currentMaxA === null
          ? `${meter.name} no tiene una condición de sobrecorriente activa.`
          : `${meter.name} registra ${reading.value.toFixed(1)} A en ${phaseLabel(key)}; máximo configurado ${config.currentMaxA.toFixed(1)} A.`,
        value: usable ? reading.value : null,
        threshold: config.currentMaxA,
        delaySeconds: config.thresholdDelaySeconds,
        context: { subtype: "current_high", metricKey: key, phase: phaseLabel(key), hysteresis: config.currentHysteresisA },
        maintenance: asset.state === "maintenance",
      });
    }

    const frequency = metricValue(meter.metrics, "electrical.frequency");
    const frequencyUsable = !communicationLost && frequency.quality === "good" && frequency.value !== null;
    for (const direction of ["low", "high"] as const) {
      const threshold = direction === "low" ? config.frequencyMinHz : config.frequencyMaxHz;
      const conditionKey = `meter:${meter.id}:electrical.frequency:${direction}`;
      const boundary = threshold === null
        ? null
        : previouslyObserved.has(conditionKey)
          ? direction === "low"
            ? threshold + config.frequencyHysteresisHz
            : threshold - config.frequencyHysteresisHz
          : threshold;
      const observed = Boolean(frequencyUsable && boundary !== null && (
        direction === "low" ? (frequency.value as number) < boundary : (frequency.value as number) > boundary
      ));
      conditions.push({
        source: "electrical", codePrefix: "EL", assetId, siteId: asset.siteId, deviceId: meter.id,
        conditionKey, observed, severity: "critical", kind: "threshold",
        title: `Frecuencia ${direction === "low" ? "baja" : "alta"} · ${meter.code}`,
        detail: frequency.value === null || threshold === null
          ? `${meter.name} no tiene una condición de frecuencia ${direction === "low" ? "baja" : "alta"} activa.`
          : `${meter.name} registra ${frequency.value.toFixed(2)} Hz; umbral configurado ${threshold.toFixed(2)} Hz.`,
        value: frequencyUsable ? frequency.value : null,
        threshold,
        delaySeconds: config.thresholdDelaySeconds,
        context: { subtype: direction === "low" ? "frequency_low" : "frequency_high", metricKey: "electrical.frequency", hysteresis: config.frequencyHysteresisHz },
        maintenance: asset.state === "maintenance",
      });
    }

    const pf = metricValue(meter.metrics, "electrical.power_factor");
    const pfUsable = !communicationLost && pf.quality === "good" && pf.value !== null;
    const pfKey = `meter:${meter.id}:electrical.power_factor:low`;
    const pfBoundary = config.powerFactorMin === null
      ? null
      : previouslyObserved.has(pfKey)
        ? config.powerFactorMin + config.powerFactorHysteresis
        : config.powerFactorMin;
    conditions.push({
      source: "electrical", codePrefix: "EL", assetId, siteId: asset.siteId, deviceId: meter.id,
      conditionKey: pfKey,
      observed: Boolean(pfUsable && pfBoundary !== null && Math.abs(pf.value as number) < pfBoundary),
      severity: "warning",
      kind: "threshold",
      title: `Factor de potencia bajo · ${meter.code}`,
      detail: pf.value === null || config.powerFactorMin === null
        ? `${meter.name} no tiene una condición de factor de potencia bajo activa.`
        : `${meter.name} registra PF ${Math.abs(pf.value).toFixed(3)}; mínimo configurado ${config.powerFactorMin.toFixed(3)}.`,
      value: pfUsable ? Math.abs(pf.value as number) : null,
      threshold: config.powerFactorMin,
      delaySeconds: config.thresholdDelaySeconds,
      context: { subtype: "power_factor_low", metricKey: "electrical.power_factor", hysteresis: config.powerFactorHysteresis },
      maintenance: asset.state === "maintenance",
    });
  }

  let opened = 0;
  let resolved = 0;
  let escalated = 0;
  for (const condition of conditions) {
    const result = await processOperationalCondition(db, condition, evaluatedAt);
    opened += result.opened;
    resolved += result.resolved;
    escalated += result.escalated;
  }

  const active = await db.select({ severity: alarms.severity }).from(operationalConditionStates)
    .innerJoin(alarms, eq(alarms.id, operationalConditionStates.activeAlarmId))
    .where(and(
      eq(operationalConditionStates.assetId, assetId),
      inArray(alarms.status, ["open", "acknowledged"]),
    ));

  if (asset.state !== "maintenance") {
    const nextState = active.some((item) => item.severity === "critical")
      ? "critical"
      : active.length
        ? "warning"
        : freshMeterCount
          ? "normal"
          : "offline";
    await db.update(assets).set({ state: nextState, updatedAt: evaluatedAt }).where(eq(assets.id, assetId));
  }

  return { meters: meters.size, opened, resolved, escalated, evaluated: conditions.length };
}

export async function evaluateElectricalSite(db: Cam5Database, siteId: string, evaluatedAt = new Date()) {
  const points = await db.select({ id: assets.id }).from(assets).where(and(
    eq(assets.siteId, siteId),
    eq(assets.assetType, "electrical_point"),
    eq(assets.active, true),
  ));
  const results = [];
  for (const point of points) results.push(await evaluateElectricalAsset(db, point.id, evaluatedAt));
  return results.reduce<{ points: number; opened: number; resolved: number; escalated: number; evaluated: number }>((summary, item) => ({
    points: summary.points + 1,
    opened: summary.opened + item.opened,
    resolved: summary.resolved + item.resolved,
    escalated: summary.escalated + item.escalated,
    evaluated: summary.evaluated + item.evaluated,
  }), { points: 0, opened: 0, resolved: 0, escalated: 0, evaluated: 0 });
}
