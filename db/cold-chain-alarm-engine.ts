import { and, eq, inArray } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { parseColdChainConfig } from "./cold-chain";
import { queueAlarmNotifications, type NotificationAlarmKind } from "./notification-engine";
import {
  alarmEvents,
  alarms,
  assets,
  deviceMetrics,
  devices,
  latestMetricReadings,
  metricDefinitions,
  operationalConditionStates,
} from "./schema";

type Severity = "warning" | "critical";
type AlarmKind = NotificationAlarmKind;

type ConditionInput = {
  assetId: string;
  siteId: string;
  deviceId: string | null;
  conditionKey: string;
  observed: boolean;
  severity: Severity;
  kind: AlarmKind;
  title: string;
  detail: string;
  value: number | null;
  threshold: number | null;
  delaySeconds: number;
  context: Record<string, unknown>;
  maintenance: boolean;
};

function alarmCode(conditionKey: string, now: Date) {
  const ref = conditionKey.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 18) || "COLD";
  return `CC-${ref}-${now.getTime().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

async function processCondition(db: Cam5Database, input: ConditionInput, evaluatedAt: Date) {
  const [state] = await db.select().from(operationalConditionStates).where(and(
    eq(operationalConditionStates.assetId, input.assetId),
    eq(operationalConditionStates.conditionKey, input.conditionKey),
  )).limit(1);

  if (!input.observed) {
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
          payload: { source: "cold_chain", conditionKey: input.conditionKey },
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
    return { opened: 0, resolved: state?.activeAlarmId ? 1 : 0 };
  }

  const firstObservedAt = state?.observed && state.firstObservedAt ? state.firstObservedAt : evaluatedAt;
  const elapsedSeconds = Math.max(0, Math.floor((evaluatedAt.getTime() - firstObservedAt.getTime()) / 1000));
  let activeAlarmId = state?.activeAlarmId ?? null;
  let opened = 0;

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
        code: alarmCode(input.conditionKey, evaluatedAt),
        kind: input.kind,
        severity: input.severity,
        status: "open",
        title: input.title,
        detail: input.detail,
        triggerValue: input.value === null ? null : String(input.value),
        thresholdValue: input.threshold === null ? null : String(input.threshold),
        openedAt: firstObservedAt,
        lastObservedAt: evaluatedAt,
        context: { source: "cold_chain", conditionKey: input.conditionKey, ...input.context },
      }).returning({ id: alarms.id });
      activeAlarmId = created.id;
      const [event] = await db.insert(alarmEvents).values({
        alarmId: created.id,
        eventType: "opened",
        payload: { source: "cold_chain", conditionKey: input.conditionKey, value: input.value, threshold: input.threshold },
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
        context: { source: "cold_chain", conditionKey: input.conditionKey, ...input.context },
      }).where(eq(alarms.id, existing.id));
      const [event] = await db.insert(alarmEvents).values({
        alarmId: existing.id,
        eventType: "reopened_automatically",
        payload: { source: "cold_chain", conditionKey: input.conditionKey, value: input.value, threshold: input.threshold },
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
      await db.update(alarms).set({
        severity: input.severity,
        title: input.title,
        detail: input.detail,
        triggerValue: input.value === null ? null : String(input.value),
        thresholdValue: input.threshold === null ? null : String(input.threshold),
        lastObservedAt: evaluatedAt,
        context: { source: "cold_chain", conditionKey: input.conditionKey, ...input.context },
      }).where(eq(alarms.id, existing.id));
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

  return { opened, resolved: 0 };
}

export async function evaluateColdChainAsset(db: Cam5Database, assetId: string, evaluatedAt = new Date()) {
  const [chamber] = await db.select({
    id: assets.id,
    siteId: assets.siteId,
    code: assets.code,
    name: assets.name,
    state: assets.state,
    metadata: assets.metadata,
  }).from(assets).where(and(
    eq(assets.id, assetId),
    eq(assets.assetType, "cold_room"),
    eq(assets.active, true),
  )).limit(1);
  if (!chamber) return { opened: 0, resolved: 0, evaluated: 0 };

  const config = parseColdChainConfig(chamber.metadata);
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
    .where(and(eq(devices.assetId, assetId), eq(devices.active, true)));

  const existingStates = await db.select({
    conditionKey: operationalConditionStates.conditionKey,
    observed: operationalConditionStates.observed,
  }).from(operationalConditionStates).where(eq(operationalConditionStates.assetId, assetId));
  const previousObserved = new Set(existingStates.filter((state) => state.observed).map((state) => state.conditionKey));

  const byDevice = new Map<string, {
    id: string;
    code: string;
    name: string;
    temperature: number | null;
    temperatureAt: Date | null;
    temperatureQuality: string | null;
    battery: number | null;
    batteryAt: Date | null;
  }>();

  for (const row of metricRows) {
    let device = byDevice.get(row.deviceId);
    if (!device) {
      device = { id: row.deviceId, code: row.deviceCode, name: row.deviceName, temperature: null, temperatureAt: null, temperatureQuality: null, battery: null, batteryAt: null };
      byDevice.set(row.deviceId, device);
    }
    if (row.metricKey === "environment.temperature") {
      device.temperature = row.valueNumeric === null ? null : Number(row.valueNumeric);
      device.temperatureAt = row.recordedAt;
      device.temperatureQuality = row.quality;
    } else if (row.metricKey === "sensor.battery_voltage") {
      device.battery = row.valueNumeric === null ? null : Number(row.valueNumeric);
      device.batteryAt = row.recordedAt;
    }
  }

  const conditions: ConditionInput[] = [];
  const freshTemperatures: Array<{ deviceId: string; code: string; value: number }> = [];

  for (const device of byDevice.values()) {
    const ageSeconds = device.temperatureAt
      ? Math.max(0, Math.floor((evaluatedAt.getTime() - device.temperatureAt.getTime()) / 1000))
      : Number.POSITIVE_INFINITY;
    const communicationLost = !device.temperatureAt || ageSeconds > config.staleAfterSeconds || device.temperatureQuality === "bad";
    conditions.push({
      assetId, siteId: chamber.siteId, deviceId: device.id,
      conditionKey: `sensor:${device.id}:communication`,
      observed: communicationLost,
      severity: Number.isFinite(ageSeconds) && ageSeconds >= config.staleAfterSeconds * 3 ? "critical" : "warning",
      kind: "communication",
      title: `Sin telemetría · ${device.code}`,
      detail: `${chamber.name} no recibe una lectura válida de ${device.name} dentro del tiempo configurado.`,
      value: Number.isFinite(ageSeconds) ? ageSeconds : null,
      threshold: config.staleAfterSeconds,
      delaySeconds: 0,
      context: { sensorCode: device.code, ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : null, staleAfterSeconds: config.staleAfterSeconds },
      maintenance: chamber.state === "maintenance",
    });

    const temperatureAvailable = !communicationLost && device.temperature !== null;
    if (temperatureAvailable) {
      freshTemperatures.push({ deviceId: device.id, code: device.code, value: device.temperature as number });
    }

    const highKey = `sensor:${device.id}:temperature_high`;
    const highBoundary = config.maximumC === null
      ? null
      : previousObserved.has(highKey)
        ? config.maximumC - config.temperatureHysteresisC
        : config.maximumC;
    conditions.push({
      assetId, siteId: chamber.siteId, deviceId: device.id, conditionKey: highKey,
      observed: Boolean(temperatureAvailable && highBoundary !== null && (device.temperature as number) > highBoundary),
      severity: "critical", kind: "threshold",
      title: `Temperatura alta · ${device.code}`,
      detail: config.maximumC === null || device.temperature === null
        ? `${chamber.name} no tiene una condición de alta temperatura activa.`
        : `${chamber.name} registra ${device.temperature.toFixed(1)} °C en ${device.name}; máximo configurado ${config.maximumC.toFixed(1)} °C.`,
      value: temperatureAvailable ? device.temperature : null,
      threshold: config.maximumC,
      delaySeconds: config.excursionDelaySeconds,
      context: { subtype: "temperature_high", sensorCode: device.code, hysteresisC: config.temperatureHysteresisC },
      maintenance: chamber.state === "maintenance",
    });

    const lowKey = `sensor:${device.id}:temperature_low`;
    const lowBoundary = config.minimumC === null
      ? null
      : previousObserved.has(lowKey)
        ? config.minimumC + config.temperatureHysteresisC
        : config.minimumC;
    conditions.push({
      assetId, siteId: chamber.siteId, deviceId: device.id, conditionKey: lowKey,
      observed: Boolean(temperatureAvailable && lowBoundary !== null && (device.temperature as number) < lowBoundary),
      severity: "critical", kind: "threshold",
      title: `Temperatura baja · ${device.code}`,
      detail: config.minimumC === null || device.temperature === null
        ? `${chamber.name} no tiene una condición de baja temperatura activa.`
        : `${chamber.name} registra ${device.temperature.toFixed(1)} °C en ${device.name}; mínimo configurado ${config.minimumC.toFixed(1)} °C.`,
      value: temperatureAvailable ? device.temperature : null,
      threshold: config.minimumC,
      delaySeconds: config.excursionDelaySeconds,
      context: { subtype: "temperature_low", sensorCode: device.code, hysteresisC: config.temperatureHysteresisC },
      maintenance: chamber.state === "maintenance",
    });

    conditions.push({
      assetId, siteId: chamber.siteId, deviceId: device.id,
      conditionKey: `sensor:${device.id}:battery_low`,
      observed: Boolean(config.batteryLowVoltage !== null && device.battery !== null && device.battery < config.batteryLowVoltage),
      severity: "warning", kind: "threshold",
      title: `Batería baja · ${device.code}`,
      detail: config.batteryLowVoltage === null || device.battery === null
        ? `${device.name} no tiene una condición de batería baja activa.`
        : `${device.name} reporta ${device.battery.toFixed(2)} V; umbral configurado ${config.batteryLowVoltage.toFixed(2)} V.`,
      value: device.battery,
      threshold: config.batteryLowVoltage,
      delaySeconds: config.excursionDelaySeconds,
      context: { subtype: "battery_low", sensorCode: device.code },
      maintenance: chamber.state === "maintenance",
    });
  }

  const spread = freshTemperatures.length >= 2
    ? Math.max(...freshTemperatures.map((sensor) => sensor.value)) - Math.min(...freshTemperatures.map((sensor) => sensor.value))
    : null;
  conditions.push({
    assetId, siteId: chamber.siteId, deviceId: null,
    conditionKey: "chamber:sensor_disagreement",
    observed: Boolean(config.disagreementThresholdC !== null && spread !== null && spread > config.disagreementThresholdC),
    severity: "warning", kind: "data_quality",
    title: `Discrepancia entre sensores · ${chamber.code}`,
    detail: config.disagreementThresholdC === null || spread === null
      ? `${chamber.name} no tiene una condición de discrepancia activa.`
      : `${chamber.name} presenta una diferencia de ${spread.toFixed(1)} °C entre sensores; límite configurado ${config.disagreementThresholdC.toFixed(1)} °C.`,
    value: spread,
    threshold: config.disagreementThresholdC,
    delaySeconds: config.excursionDelaySeconds,
    context: { subtype: "sensor_disagreement", sensors: freshTemperatures.map((sensor) => ({ code: sensor.code, valueC: sensor.value })) },
    maintenance: chamber.state === "maintenance",
  });

  let opened = 0;
  let resolved = 0;
  for (const condition of conditions) {
    const result = await processCondition(db, condition, evaluatedAt);
    opened += result.opened;
    resolved += result.resolved;
  }

  const active = await db.select({ severity: alarms.severity }).from(operationalConditionStates)
    .innerJoin(alarms, eq(alarms.id, operationalConditionStates.activeAlarmId))
    .where(and(
      eq(operationalConditionStates.assetId, assetId),
      inArray(alarms.status, ["open", "acknowledged"]),
    ));
  if (chamber.state !== "maintenance") {
    const nextState = active.some((alarm) => alarm.severity === "critical")
      ? "critical"
      : active.length
        ? "warning"
        : freshTemperatures.length
          ? "normal"
          : "offline";
    await db.update(assets).set({ state: nextState, updatedAt: evaluatedAt }).where(eq(assets.id, assetId));
  }

  return { opened, resolved, evaluated: conditions.length };
}

export async function evaluateColdChainSite(db: Cam5Database, siteId: string, evaluatedAt = new Date()) {
  const chambers = await db.select({ id: assets.id }).from(assets).where(and(
    eq(assets.siteId, siteId),
    eq(assets.assetType, "cold_room"),
    eq(assets.active, true),
  ));
  const results = [];
  for (const chamber of chambers) results.push(await evaluateColdChainAsset(db, chamber.id, evaluatedAt));
  return results.reduce<{ chambers: number; opened: number; resolved: number; evaluated: number }>((summary, item) => ({
    chambers: summary.chambers + 1,
    opened: summary.opened + item.opened,
    resolved: summary.resolved + item.resolved,
    evaluated: summary.evaluated + item.evaluated,
  }), { chambers: 0, opened: 0, resolved: 0, evaluated: 0 });
}
