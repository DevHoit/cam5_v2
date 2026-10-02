import { and, eq, inArray } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { parseAtsConfig } from "./ats";
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

type AtsMetric = {
  numeric: number | null;
  boolean: boolean | null;
  text: string | null;
  quality: string | null;
  recordedAt: Date | null;
};

export async function evaluateAtsAsset(db: Cam5Database, assetId: string, evaluatedAt = new Date()) {
  const [asset] = await db.select({
    id: assets.id,
    siteId: assets.siteId,
    code: assets.code,
    name: assets.name,
    state: assets.state,
    metadata: assets.metadata,
  }).from(assets).where(and(
    eq(assets.id, assetId),
    eq(assets.assetType, "ats"),
    eq(assets.active, true),
  )).limit(1);
  if (!asset) return { controllers: 0, opened: 0, resolved: 0, escalated: 0, evaluated: 0 };

  const config = parseAtsConfig(asset.metadata);
  const rows = await db.select({
    deviceId: devices.id,
    deviceCode: devices.code,
    deviceName: devices.name,
    metricKey: metricDefinitions.key,
    valueNumeric: latestMetricReadings.valueNumeric,
    valueBoolean: latestMetricReadings.valueBoolean,
    valueText: latestMetricReadings.valueText,
    quality: latestMetricReadings.quality,
    recordedAt: latestMetricReadings.recordedAt,
  }).from(devices)
    .leftJoin(deviceMetrics, and(eq(deviceMetrics.deviceId, devices.id), eq(deviceMetrics.enabled, true)))
    .leftJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
    .leftJoin(latestMetricReadings, eq(latestMetricReadings.deviceMetricId, deviceMetrics.id))
    .where(and(
      eq(devices.assetId, assetId),
      eq(devices.deviceType, "ats_controller"),
      eq(devices.driver, "dse8660_mkii"),
      eq(devices.active, true),
    ));

  const controllers = new Map<string, {
    id: string;
    code: string;
    name: string;
    metrics: Map<string, AtsMetric>;
  }>();
  for (const row of rows) {
    let controller = controllers.get(row.deviceId);
    if (!controller) {
      controller = { id: row.deviceId, code: row.deviceCode, name: row.deviceName, metrics: new Map() };
      controllers.set(row.deviceId, controller);
    }
    if (!row.metricKey) continue;
    controller.metrics.set(row.metricKey, {
      numeric: row.valueNumeric === null ? null : Number(row.valueNumeric),
      boolean: row.valueBoolean,
      text: row.valueText,
      quality: row.quality,
      recordedAt: row.recordedAt,
    });
  }

  const conditions: OperationalConditionInput[] = [];
  let freshControllers = 0;

  for (const controller of controllers.values()) {
    const readings = [...controller.metrics.values()].filter((item) => item.recordedAt);
    const latestAt = readings.length ? new Date(Math.max(...readings.map((item) => item.recordedAt!.getTime()))) : null;
    const ageSeconds = latestAt ? Math.max(0, Math.floor((evaluatedAt.getTime() - latestAt.getTime()) / 1000)) : Number.POSITIVE_INFINITY;
    const hasGoodMetric = readings.some((item) => item.quality === "good");
    const communicationLost = !latestAt || ageSeconds > config.staleAfterSeconds || !hasGoodMetric;
    if (!communicationLost) freshControllers += 1;

    conditions.push({
      source: "ats",
      codePrefix: "ATS",
      assetId,
      siteId: asset.siteId,
      deviceId: controller.id,
      conditionKey: `controller:${controller.id}:communication`,
      observed: communicationLost,
      severity: Number.isFinite(ageSeconds) && ageSeconds >= config.staleAfterSeconds * 3 ? "critical" : "warning",
      kind: "communication",
      title: `Sin telemetría · ${controller.code}`,
      detail: `${asset.name} no recibe telemetría vigente desde ${controller.name}.`,
      value: Number.isFinite(ageSeconds) ? ageSeconds : null,
      threshold: config.staleAfterSeconds,
      delaySeconds: 0,
      context: { subtype: "communication_loss", deviceCode: controller.code, ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : null },
      maintenance: asset.state === "maintenance",
    });

    const source1 = controller.metrics.get("ats.source1.available");
    conditions.push({
      source: "ats",
      codePrefix: "ATS",
      assetId,
      siteId: asset.siteId,
      deviceId: controller.id,
      conditionKey: `controller:${controller.id}:source1_unavailable`,
      observed: Boolean(config.source1Required && !communicationLost && source1?.quality === "good" && source1.boolean === false),
      severity: "critical",
      kind: "threshold",
      title: `${config.source1Label} no disponible · ${controller.code}`,
      detail: `${asset.name} reporta ${config.source1Label} no disponible.`,
      value: source1?.boolean === null || source1?.boolean === undefined ? null : source1.boolean ? 1 : 0,
      threshold: 1,
      delaySeconds: config.sourceUnavailableDelaySeconds,
      context: { subtype: "source1_unavailable", deviceCode: controller.code, sourceLabel: config.source1Label },
      maintenance: asset.state === "maintenance",
    });

    const source2 = controller.metrics.get("ats.source2.available");
    conditions.push({
      source: "ats",
      codePrefix: "ATS",
      assetId,
      siteId: asset.siteId,
      deviceId: controller.id,
      conditionKey: `controller:${controller.id}:source2_unavailable`,
      observed: Boolean(config.source2Required && !communicationLost && source2?.quality === "good" && source2.boolean === false),
      severity: "critical",
      kind: "threshold",
      title: `${config.source2Label} no disponible · ${controller.code}`,
      detail: `${asset.name} reporta ${config.source2Label} no disponible.`,
      value: source2?.boolean === null || source2?.boolean === undefined ? null : source2.boolean ? 1 : 0,
      threshold: 1,
      delaySeconds: config.sourceUnavailableDelaySeconds,
      context: { subtype: "source2_unavailable", deviceCode: controller.code, sourceLabel: config.source2Label },
      maintenance: asset.state === "maintenance",
    });

    const commonAlarm = controller.metrics.get("ats.common_alarm");
    conditions.push({
      source: "ats",
      codePrefix: "ATS",
      assetId,
      siteId: asset.siteId,
      deviceId: controller.id,
      conditionKey: `controller:${controller.id}:common_alarm`,
      observed: Boolean(!communicationLost && commonAlarm?.quality === "good" && commonAlarm.boolean === true),
      severity: "critical",
      kind: "data_quality",
      title: `Alarma común ATS · ${controller.code}`,
      detail: `${controller.name} reporta una alarma activa desde el controlador DSE8660 MKII.`,
      value: commonAlarm?.boolean === true ? 1 : commonAlarm?.boolean === false ? 0 : null,
      threshold: 0,
      delaySeconds: config.commonAlarmDelaySeconds,
      context: { subtype: "common_alarm", deviceCode: controller.code },
      maintenance: asset.state === "maintenance",
    });

    const position = controller.metrics.get("ats.transfer.position");
    conditions.push({
      source: "ats",
      codePrefix: "ATS",
      assetId,
      siteId: asset.siteId,
      deviceId: controller.id,
      conditionKey: `controller:${controller.id}:unexpected_position`,
      observed: Boolean(
        config.expectedPosition
        && !communicationLost
        && position?.quality === "good"
        && position.text
        && position.text !== config.expectedPosition
      ),
      severity: "warning",
      kind: "data_quality",
      title: `Posición ATS distinta a la esperada · ${controller.code}`,
      detail: config.expectedPosition
        ? `${asset.name} está en ${position?.text ?? "posición desconocida"}; se configuró ${config.expectedPosition} como posición esperada.`
        : `${asset.name} no tiene una posición esperada configurada.`,
      value: null,
      threshold: null,
      delaySeconds: config.unexpectedPositionDelaySeconds,
      context: { subtype: "unexpected_position", deviceCode: controller.code, observedPosition: position?.text ?? null, expectedPosition: config.expectedPosition },
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
        : freshControllers
          ? "normal"
          : "offline";
    await db.update(assets).set({ state: nextState, updatedAt: evaluatedAt }).where(eq(assets.id, assetId));
  }

  return { controllers: controllers.size, opened, resolved, escalated, evaluated: conditions.length };
}

export async function evaluateAtsSite(db: Cam5Database, siteId: string, evaluatedAt = new Date()) {
  const units = await db.select({ id: assets.id }).from(assets).where(and(
    eq(assets.siteId, siteId),
    eq(assets.assetType, "ats"),
    eq(assets.active, true),
  ));
  const results = [];
  for (const unit of units) results.push(await evaluateAtsAsset(db, unit.id, evaluatedAt));
  return results.reduce<{ units: number; opened: number; resolved: number; escalated: number; evaluated: number }>((summary, item) => ({
    units: summary.units + 1,
    opened: summary.opened + item.opened,
    resolved: summary.resolved + item.resolved,
    escalated: summary.escalated + item.escalated,
    evaluated: summary.evaluated + item.evaluated,
  }), { units: 0, opened: 0, resolved: 0, escalated: 0, evaluated: 0 });
}
