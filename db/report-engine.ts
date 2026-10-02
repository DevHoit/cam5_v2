import { and, between, count, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { parseAtsConfig } from "./ats";
import { parseColdChainConfig } from "./cold-chain";
import { parseElectricalAlarmConfig } from "./electrical";
import type { Cam5Database } from "./index";
import {
  alarms,
  assets,
  channels,
  clients,
  deviceMetrics,
  devices,
  metricDefinitions,
  metricReadingAggregates,
  metricReadings,
  reportRuns,
  reportSchedules,
  reportTemplates,
  readings,
  sites,
  users,
} from "./schema";

export type ReportSnapshot = {
  generatedAt: string;
  generatedBy: string;
  template: { id: string; key: string; name: string; description: string | null };
  client: { code: string; name: string };
  site: { code: string; name: string; timezone: string };
  asset: { id: string; code: string; name: string; area: string | null; nominalVoltageKv: number | null; assetType?: string };
  period: { start: string; end: string };
  summary: {
    condition: "normal" | "warning" | "critical";
    channelCount: number;
    sampleCount: number;
    validSampleCount: number;
    qualityPercent: number | null;
    alarmCount: number;
    warningCount: number;
    criticalCount: number;
  };
  channels: Array<{
    code: string;
    name: string;
    zone: string | null;
    unit: string;
    sampleCount: number;
    validSampleCount: number;
    minimum: number | null;
    average: number | null;
    maximum: number | null;
    latest: number | null;
    latestAt: string | null;
  }>;
  coldChain?: {
    minimumC: number | null;
    maximumC: number | null;
    targetC: number | null;
    excursionDelaySeconds: number;
    staleAfterSeconds: number;
    excursionCount: number;
    totalOutOfRangeSeconds: number;
    dataGapCount: number;
    sensors: Array<{
      code: string;
      name: string;
      minimumC: number | null;
      averageC: number | null;
      maximumC: number | null;
      sampleCount: number;
      validSampleCount: number;
      excursionCount: number;
      dataGapCount: number;
    }>;
    excursions: Array<{
      sensorCode: string;
      sensorName: string;
      type: "low" | "high" | "data_gap";
      startedAt: string;
      endedAt: string | null;
      durationSeconds: number;
      extremeC: number | null;
      active: boolean;
    }>;
  };
  electrical?: {
    meterCount: number;
    limits: {
      staleAfterSeconds: number;
      thresholdDelaySeconds: number;
      voltageMinV: number | null;
      voltageMaxV: number | null;
      currentMaxA: number | null;
      frequencyMinHz: number | null;
      frequencyMaxHz: number | null;
      powerFactorMin: number | null;
    };
    meters: Array<{
      code: string;
      name: string;
      sampleCount: number;
      validSampleCount: number;
      qualityPercent: number | null;
      voltageMinimumV: number | null;
      voltageAverageV: number | null;
      voltageMaximumV: number | null;
      currentMaximumA: number | null;
      activePowerAverageKw: number | null;
      activePowerMaximumKw: number | null;
      apparentPowerAverageKva: number | null;
      reactivePowerAverageKvar: number | null;
      powerFactorMinimum: number | null;
      powerFactorAverage: number | null;
      frequencyMinimumHz: number | null;
      frequencyAverageHz: number | null;
      frequencyMaximumHz: number | null;
      energyImportStartKwh: number | null;
      energyImportEndKwh: number | null;
      energyImportDeltaKwh: number | null;
      energyExportStartKwh: number | null;
      energyExportEndKwh: number | null;
      energyExportDeltaKwh: number | null;
      peakDemandKw: number | null;
    }>;
  };
  ats?: {
    controllerCount: number;
    config: {
      source1Label: string;
      source2Label: string;
      staleAfterSeconds: number;
      source1Required: boolean;
      source2Required: boolean;
      expectedPosition: "source1" | "source2" | null;
    };
    controllers: Array<{
      code: string;
      name: string;
      sampleCount: number;
      validSampleCount: number;
      qualityPercent: number | null;
      source1VoltageAverageV: number | null;
      source1FrequencyAverageHz: number | null;
      source2VoltageAverageV: number | null;
      source2FrequencyAverageHz: number | null;
      loadCurrentMaximumA: number | null;
      activePowerAverageKw: number | null;
      activePowerMaximumKw: number | null;
      apparentPowerAverageKva: number | null;
      reactivePowerAverageKvar: number | null;
      powerFactorAverage: number | null;
      lastPosition: string | null;
      lastMode: string | null;
      source1Available: boolean | null;
      source2Available: boolean | null;
      commonAlarm: boolean | null;
    }>;
  };
  alarms: Array<{
    code: string;
    title: string;
    severity: string;
    status: string;
    openedAt: string;
    channelCode: string | null;
    triggerValue: number | null;
    thresholdValue: number | null;
  }>;
};

function numeric(value: string | number | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

function timestampIso(value: Date | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const timestamp = value instanceof Date ? value : new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}


type GenericMetricStats = {
  sampleCount: number;
  validSampleCount: number;
  minimum: number | null;
  average: number | null;
  maximum: number | null;
  first: number | null;
  last: number | null;
  latestAt: Date | null;
};

type StatsPiece = {
  deviceMetricId: string;
  sampleCount: number;
  invalidSampleCount: number;
  minimum: number | null;
  maximum: number | null;
  average: number | null;
  first: number | null;
  last: number | null;
  latestAt: Date | null;
};

function emptyStats(): GenericMetricStats {
  return { sampleCount: 0, validSampleCount: 0, minimum: null, average: null, maximum: null, first: null, last: null, latestAt: null };
}

function mergeStats(target: Map<string, GenericMetricStats & { weightedTotal: number }>, piece: StatsPiece) {
  let current = target.get(piece.deviceMetricId);
  if (!current) {
    current = { ...emptyStats(), weightedTotal: 0 };
    target.set(piece.deviceMetricId, current);
  }
  const valid = Math.max(0, piece.sampleCount - piece.invalidSampleCount);
  current.sampleCount += piece.sampleCount;
  current.validSampleCount += valid;
  if (piece.minimum !== null) current.minimum = current.minimum === null ? piece.minimum : Math.min(current.minimum, piece.minimum);
  if (piece.maximum !== null) current.maximum = current.maximum === null ? piece.maximum : Math.max(current.maximum, piece.maximum);
  if (piece.average !== null && valid > 0) current.weightedTotal += piece.average * valid;
  if (current.first === null && piece.first !== null) current.first = piece.first;
  if (piece.last !== null) current.last = piece.last;
  if (piece.latestAt && (!current.latestAt || piece.latestAt > current.latestAt)) current.latestAt = piece.latestAt;
}

async function rawMetricPieces(db: Cam5Database, metricIds: string[], start: Date, end: Date): Promise<StatsPiece[]> {
  if (!metricIds.length || start >= end) return [];
  const rows = await db.select({
    deviceMetricId: metricReadings.deviceMetricId,
    sampleCount: sql<number>`count(*)::integer`,
    invalidSampleCount: sql<number>`count(*) filter (where ${metricReadings.quality} <> 'good' or ${metricReadings.valueNumeric} is null)::integer`,
    minimum: sql<string | null>`min(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
    maximum: sql<string | null>`max(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
    average: sql<string | null>`avg(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
    first: sql<string | null>`(array_agg(${metricReadings.valueNumeric} order by ${metricReadings.recordedAt}) filter (where ${metricReadings.quality} = 'good' and ${metricReadings.valueNumeric} is not null))[1]`,
    last: sql<string | null>`(array_agg(${metricReadings.valueNumeric} order by ${metricReadings.recordedAt} desc) filter (where ${metricReadings.quality} = 'good' and ${metricReadings.valueNumeric} is not null))[1]`,
    latestAt: sql<Date | string | null>`max(${metricReadings.recordedAt}) filter (where ${metricReadings.quality} = 'good' and ${metricReadings.valueNumeric} is not null)`,
  }).from(metricReadings).where(and(
    inArray(metricReadings.deviceMetricId, metricIds),
    gte(metricReadings.recordedAt, start),
    lt(metricReadings.recordedAt, end),
  )).groupBy(metricReadings.deviceMetricId);
  return rows.map((row) => ({
    deviceMetricId: row.deviceMetricId,
    sampleCount: Number(row.sampleCount),
    invalidSampleCount: Number(row.invalidSampleCount),
    minimum: numeric(row.minimum),
    maximum: numeric(row.maximum),
    average: numeric(row.average),
    first: numeric(row.first),
    last: numeric(row.last),
    latestAt: row.latestAt ? new Date(row.latestAt) : null,
  }));
}

async function genericMetricStatistics(db: Cam5Database, metricIds: string[], periodStart: Date, periodEnd: Date) {
  const result = new Map<string, GenericMetricStats & { weightedTotal: number }>();
  if (!metricIds.length) return result;

  const periodMs = periodEnd.getTime() - periodStart.getTime();
  const bucketSeconds = periodMs <= 7 * 24 * 60 * 60 * 1000 ? 300 : 3600;
  const bucketMs = bucketSeconds * 1000;
  const aggregateStart = new Date(Math.ceil(periodStart.getTime() / bucketMs) * bucketMs);
  const aggregateEnd = new Date(Math.floor(periodEnd.getTime() / bucketMs) * bucketMs);

  const aggregateRows = aggregateStart < aggregateEnd
    ? await db.select({
        deviceMetricId: metricReadingAggregates.deviceMetricId,
        bucketStart: metricReadingAggregates.bucketStart,
        sampleCount: metricReadingAggregates.sampleCount,
        invalidSampleCount: metricReadingAggregates.invalidSampleCount,
        minimum: metricReadingAggregates.minimumValue,
        maximum: metricReadingAggregates.maximumValue,
        average: metricReadingAggregates.averageValue,
        first: metricReadingAggregates.firstValue,
        last: metricReadingAggregates.lastValue,
      }).from(metricReadingAggregates).where(and(
        inArray(metricReadingAggregates.deviceMetricId, metricIds),
        eq(metricReadingAggregates.bucketSeconds, bucketSeconds),
        gte(metricReadingAggregates.bucketStart, aggregateStart),
        lt(metricReadingAggregates.bucketStart, aggregateEnd),
      )).orderBy(metricReadingAggregates.bucketStart)
    : [];

  const latestAggregateEndByMetric = new Map<string, number>();
  for (const row of aggregateRows) {
    latestAggregateEndByMetric.set(
      row.deviceMetricId,
      Math.max(latestAggregateEndByMetric.get(row.deviceMetricId) ?? 0, row.bucketStart.getTime() + bucketMs),
    );
  }

  const everyMetricAggregated = metricIds.every((id) => latestAggregateEndByMetric.has(id));
  const commonAggregateEndMs = everyMetricAggregated
    ? Math.min(...metricIds.map((id) => latestAggregateEndByMetric.get(id)!))
    : periodStart.getTime();
  const commonAggregateEnd = new Date(Math.min(commonAggregateEndMs, aggregateEnd.getTime()));

  const headEnd = aggregateStart < commonAggregateEnd ? aggregateStart : periodStart;
  for (const piece of await rawMetricPieces(db, metricIds, periodStart, headEnd)) mergeStats(result, piece);

  if (aggregateStart < commonAggregateEnd) {
    for (const row of aggregateRows) {
      if (row.bucketStart < aggregateStart || row.bucketStart >= commonAggregateEnd) continue;
      mergeStats(result, {
        deviceMetricId: row.deviceMetricId,
        sampleCount: Number(row.sampleCount),
        invalidSampleCount: Number(row.invalidSampleCount),
        minimum: numeric(row.minimum),
        maximum: numeric(row.maximum),
        average: numeric(row.average),
        first: numeric(row.first),
        last: numeric(row.last),
        latestAt: new Date(row.bucketStart.getTime() + bucketMs),
      });
    }
  }

  const tailStart = commonAggregateEnd > periodStart ? commonAggregateEnd : periodStart;
  for (const piece of await rawMetricPieces(db, metricIds, tailStart, periodEnd)) mergeStats(result, piece);

  for (const stats of result.values()) {
    stats.average = stats.validSampleCount > 0 ? stats.weightedTotal / stats.validSampleCount : null;
  }
  return result;
}

export async function createReportRun(db: Cam5Database, input: {
  templateId: string;
  assetId: string;
  periodStart: Date;
  periodEnd: Date;
  requestedBy?: string | null;
  generatedBy: string;
  format?: "pdf" | "csv";
}) {
  const [context] = await db.select({
    assetId: assets.id,
    assetCode: assets.code,
    assetName: assets.name,
    area: assets.area,
    nominalVoltageKv: assets.nominalVoltageKv,
    assetType: assets.assetType,
    assetMetadata: assets.metadata,
    siteId: sites.id,
    siteCode: sites.code,
    siteName: sites.name,
    timezone: sites.timezone,
    clientCode: clients.code,
    clientName: clients.name,
  }).from(assets)
    .innerJoin(sites, eq(sites.id, assets.siteId))
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .where(and(eq(assets.id, input.assetId), eq(assets.active, true), eq(sites.active, true)))
    .limit(1);
  if (!context) throw new Error("El punto de medición no existe o está inactivo.");

  const [template] = await db.select().from(reportTemplates)
    .where(and(eq(reportTemplates.id, input.templateId), eq(reportTemplates.active, true)))
    .limit(1);
  if (!template || (template.siteId && template.siteId !== context.siteId)) throw new Error("La plantilla no está disponible para este sitio.");
  if (context.assetType === "cold_room" && template.key !== "cold-chain-summary") throw new Error("Selecciona la plantilla de cadena de frío para esta cámara.");
  if (context.assetType !== "cold_room" && template.key === "cold-chain-summary") throw new Error("La plantilla de cadena de frío sólo se puede usar con cámaras de refrigeración.");
  if (context.assetType === "electrical_point" && template.key !== "electrical-summary") throw new Error("Selecciona la plantilla de monitoreo eléctrico para este punto.");
  if (context.assetType !== "electrical_point" && template.key === "electrical-summary") throw new Error("La plantilla eléctrica sólo se puede usar con puntos eléctricos.");
  if (context.assetType === "ats" && template.key !== "ats-summary") throw new Error("Selecciona la plantilla ATS para este activo.");
  if (context.assetType !== "ats" && template.key === "ats-summary") throw new Error("La plantilla ATS sólo se puede usar con activos ATS.");

  if (context.assetType === "cold_room") {
    const config = parseColdChainConfig(context.assetMetadata);
    const sensors = await db.select({
      id: devices.id,
      code: devices.code,
      name: devices.name,
      metricId: deviceMetrics.id,
    }).from(deviceMetrics)
      .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
      .innerJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
      .where(and(
        eq(devices.assetId, input.assetId),
        eq(devices.active, true),
        eq(devices.deviceType, "temperature_sensor"),
        eq(deviceMetrics.enabled, true),
        eq(metricDefinitions.key, "environment.temperature"),
      ))
      .orderBy(devices.code);

    const coldSensorRows: NonNullable<ReportSnapshot["coldChain"]>["sensors"] = [];
    const periodMs = input.periodEnd.getTime() - input.periodStart.getTime();
    const bucketSeconds = periodMs <= 7 * 24 * 60 * 60 * 1000 ? 300 : 3600;
    let coldSamples = 0;
    let coldValidSamples = 0;

    for (const sensor of sensors) {
      const aggregateRows = await db.select({
        bucketStart: metricReadingAggregates.bucketStart,
        sampleCount: metricReadingAggregates.sampleCount,
        invalidSampleCount: metricReadingAggregates.invalidSampleCount,
        minimumValue: metricReadingAggregates.minimumValue,
        maximumValue: metricReadingAggregates.maximumValue,
        averageValue: metricReadingAggregates.averageValue,
      }).from(metricReadingAggregates)
        .where(and(
          eq(metricReadingAggregates.deviceMetricId, sensor.metricId),
          eq(metricReadingAggregates.bucketSeconds, bucketSeconds),
          gte(metricReadingAggregates.bucketStart, input.periodStart),
          lte(metricReadingAggregates.bucketStart, input.periodEnd),
        ))
        .orderBy(metricReadingAggregates.bucketStart);

      let sampleCount = 0;
      let validSampleCount = 0;
      let minimumC: number | null = null;
      let maximumC: number | null = null;
      let weightedTotal = 0;

      if (aggregateRows.length) {
        for (const row of aggregateRows) {
          const total = Number(row.sampleCount);
          const valid = Math.max(0, total - Number(row.invalidSampleCount));
          const minimum = numeric(row.minimumValue);
          const maximum = numeric(row.maximumValue);
          const average = numeric(row.averageValue);
          sampleCount += total;
          validSampleCount += valid;
          if (minimum !== null) minimumC = minimumC === null ? minimum : Math.min(minimumC, minimum);
          if (maximum !== null) maximumC = maximumC === null ? maximum : Math.max(maximumC, maximum);
          if (average !== null) weightedTotal += average * valid;
        }

        const lastBucket = aggregateRows.at(-1)!;
        const tailStart = new Date(Math.max(
          input.periodStart.getTime(),
          lastBucket.bucketStart.getTime() + bucketSeconds * 1000,
        ));
        if (tailStart < input.periodEnd) {
          const [tail] = await db.select({
            sampleCount: sql<number>`count(*)::integer`,
            validSampleCount: sql<number>`count(*) filter (where ${metricReadings.quality} = 'good' and ${metricReadings.valueNumeric} is not null)::integer`,
            minimum: sql<string | null>`min(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
            maximum: sql<string | null>`max(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
            average: sql<string | null>`avg(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
          }).from(metricReadings).where(and(
            eq(metricReadings.deviceMetricId, sensor.metricId),
            gte(metricReadings.recordedAt, tailStart),
            lte(metricReadings.recordedAt, input.periodEnd),
          ));
          const tailSamples = Number(tail.sampleCount);
          const tailValid = Number(tail.validSampleCount);
          const tailMinimum = numeric(tail.minimum);
          const tailMaximum = numeric(tail.maximum);
          const tailAverage = numeric(tail.average);
          sampleCount += tailSamples;
          validSampleCount += tailValid;
          if (tailMinimum !== null) minimumC = minimumC === null ? tailMinimum : Math.min(minimumC, tailMinimum);
          if (tailMaximum !== null) maximumC = maximumC === null ? tailMaximum : Math.max(maximumC, tailMaximum);
          if (tailAverage !== null) weightedTotal += tailAverage * tailValid;
        }
      } else {
        const [raw] = await db.select({
          sampleCount: sql<number>`count(*)::integer`,
          validSampleCount: sql<number>`count(*) filter (where ${metricReadings.quality} = 'good' and ${metricReadings.valueNumeric} is not null)::integer`,
          minimum: sql<string | null>`min(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
          maximum: sql<string | null>`max(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
          average: sql<string | null>`avg(${metricReadings.valueNumeric}) filter (where ${metricReadings.quality} = 'good')`,
        }).from(metricReadings).where(and(
          eq(metricReadings.deviceMetricId, sensor.metricId),
          between(metricReadings.recordedAt, input.periodStart, input.periodEnd),
        ));
        sampleCount = Number(raw.sampleCount);
        validSampleCount = Number(raw.validSampleCount);
        minimumC = numeric(raw.minimum);
        maximumC = numeric(raw.maximum);
        const rawAverage = numeric(raw.average);
        weightedTotal = rawAverage === null ? 0 : rawAverage * validSampleCount;
      }

      coldSamples += sampleCount;
      coldValidSamples += validSampleCount;
      coldSensorRows.push({
        code: sensor.code,
        name: sensor.name,
        minimumC,
        averageC: validSampleCount ? weightedTotal / validSampleCount : null,
        maximumC,
        sampleCount,
        validSampleCount,
        excursionCount: 0,
        dataGapCount: 0,
      });
    }

    const candidateAlarms = await db.select({
      code: alarms.code,
      title: alarms.title,
      severity: alarms.severity,
      status: alarms.status,
      openedAt: alarms.openedAt,
      resolvedAt: alarms.resolvedAt,
      closedAt: alarms.closedAt,
      triggerValue: alarms.triggerValue,
      thresholdValue: alarms.thresholdValue,
      context: alarms.context,
    }).from(alarms)
      .where(and(eq(alarms.assetId, input.assetId), lte(alarms.openedAt, input.periodEnd)))
      .orderBy(desc(alarms.openedAt))
      .limit(1000);

    const coldAlarmRows = candidateAlarms.filter((alarm) => {
      const endedAt = alarm.resolvedAt ?? alarm.closedAt;
      return !endedAt || endedAt >= input.periodStart;
    }).slice(0, 500);

    const coldExcursions: NonNullable<ReportSnapshot["coldChain"]>["excursions"] = coldAlarmRows.flatMap((alarm) => {
      const context = alarm.context ?? {};
      if (context.source !== "cold_chain" || typeof context.subtype !== "string" || typeof context.sensorCode !== "string") return [];
      const type = context.subtype === "temperature_high"
        ? "high"
        : context.subtype === "temperature_low"
          ? "low"
          : context.subtype === "communication_loss"
            ? "data_gap"
            : null;
      if (!type) return [];
      const sensor = sensors.find((item) => item.code === context.sensorCode);
      if (!sensor) return [];
      const endedAt = alarm.resolvedAt ?? alarm.closedAt;
      const start = alarm.openedAt < input.periodStart ? input.periodStart : alarm.openedAt;
      const end = endedAt && endedAt < input.periodEnd ? endedAt : input.periodEnd;
      return [{
        sensorCode: sensor.code,
        sensorName: sensor.name,
        type,
        startedAt: start.toISOString(),
        endedAt: endedAt ? end.toISOString() : null,
        durationSeconds: Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000)),
        extremeC: type === "data_gap" ? null : numeric(alarm.triggerValue),
        active: !endedAt,
      }];
    });

    for (const sensor of coldSensorRows) {
      sensor.excursionCount = coldExcursions.filter((item) => item.sensorCode === sensor.code && item.type !== "data_gap").length;
      sensor.dataGapCount = coldExcursions.filter((item) => item.sensorCode === sensor.code && item.type === "data_gap").length;
    }

    const criticalCount = coldAlarmRows.filter((alarm) => alarm.severity === "critical").length;
    const warningCount = coldAlarmRows.filter((alarm) => alarm.severity === "warning").length;
    const condition = criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "normal";
    const now = new Date();
    const thermalExcursions = coldExcursions.filter((item) => item.type !== "data_gap");
    const thermalIntervals = thermalExcursions
      .map((item) => ({
        start: new Date(item.startedAt).getTime(),
        end: item.endedAt ? new Date(item.endedAt).getTime() : input.periodEnd.getTime(),
      }))
      .sort((left, right) => left.start - right.start);
    let affectedMs = 0;
    let activeInterval: { start: number; end: number } | null = null;
    for (const interval of thermalIntervals) {
      if (!activeInterval) activeInterval = { ...interval };
      else if (interval.start <= activeInterval.end) activeInterval.end = Math.max(activeInterval.end, interval.end);
      else {
        affectedMs += activeInterval.end - activeInterval.start;
        activeInterval = { ...interval };
      }
    }
    if (activeInterval) affectedMs += activeInterval.end - activeInterval.start;

    const snapshot: ReportSnapshot = {
      generatedAt: now.toISOString(),
      generatedBy: input.generatedBy,
      template: { id: template.id, key: template.key, name: template.name, description: template.description },
      client: { code: context.clientCode, name: context.clientName },
      site: { code: context.siteCode, name: context.siteName, timezone: context.timezone },
      asset: { id: context.assetId, code: context.assetCode, name: context.assetName, area: context.area, nominalVoltageKv: null, assetType: context.assetType },
      period: { start: input.periodStart.toISOString(), end: input.periodEnd.toISOString() },
      summary: {
        condition,
        channelCount: sensors.length,
        sampleCount: coldSamples,
        validSampleCount: coldValidSamples,
        qualityPercent: coldSamples ? Math.round(coldValidSamples / coldSamples * 10_000) / 100 : null,
        alarmCount: coldAlarmRows.length,
        warningCount,
        criticalCount,
      },
      channels: coldSensorRows.map((sensor) => ({
        code: sensor.code,
        name: sensor.name,
        zone: context.area,
        unit: "°C",
        sampleCount: sensor.sampleCount,
        validSampleCount: sensor.validSampleCount,
        minimum: sensor.minimumC,
        average: sensor.averageC,
        maximum: sensor.maximumC,
        latest: null,
        latestAt: null,
      })),
      coldChain: {
        minimumC: config.minimumC,
        maximumC: config.maximumC,
        targetC: config.targetC,
        excursionDelaySeconds: config.excursionDelaySeconds,
        staleAfterSeconds: config.staleAfterSeconds,
        excursionCount: thermalExcursions.length,
        totalOutOfRangeSeconds: Math.round(affectedMs / 1000),
        dataGapCount: coldExcursions.filter((item) => item.type === "data_gap").length,
        sensors: coldSensorRows,
        excursions: coldExcursions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
      },
      alarms: coldAlarmRows.map((alarm) => ({
        ...alarm,
        channelCode: null,
        openedAt: alarm.openedAt.toISOString(),
        triggerValue: numeric(alarm.triggerValue),
        thresholdValue: numeric(alarm.thresholdValue),
      })),
    };

    const title = `${template.name} · ${context.assetCode}`;
    const [run] = await db.insert(reportRuns).values({
      templateId: template.id,
      assetId: context.assetId,
      requestedBy: input.requestedBy ?? null,
      title,
      format: input.format ?? "pdf",
      status: "completed",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      payload: snapshot,
      completedAt: now,
    }).returning();
    return { run, snapshot };
  }

  if (context.assetType === "electrical_point") {
    const config = parseElectricalAlarmConfig(context.assetMetadata);
    const metricRows = (await db.select({
      deviceId: devices.id,
      deviceCode: devices.code,
      deviceName: devices.name,
      deviceMetricId: deviceMetrics.id,
      metricCode: deviceMetrics.code,
      metricName: deviceMetrics.name,
      metricKey: metricDefinitions.key,
      unit: metricDefinitions.unit,
      dataType: metricDefinitions.dataType,
    }).from(deviceMetrics)
      .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
      .innerJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
      .where(and(
        eq(devices.assetId, input.assetId),
        eq(devices.active, true),
        eq(devices.deviceType, "power_meter"),
        eq(deviceMetrics.enabled, true),
      ))
      .orderBy(devices.code, deviceMetrics.displayOrder))
      .filter((item) => item.metricKey.startsWith("electrical.") && (item.dataType === "float" || item.dataType === "integer"));

    const stats = await genericMetricStatistics(db, metricRows.map((item) => item.deviceMetricId), input.periodStart, input.periodEnd);
    const channelRows: ReportSnapshot["channels"] = metricRows.map((item) => {
      const metricStats = stats.get(item.deviceMetricId) ?? emptyStats();
      return {
        code: `${item.deviceCode}:${item.metricCode}`,
        name: `${item.deviceName} · ${item.metricName}`,
        zone: context.area,
        unit: item.unit,
        sampleCount: metricStats.sampleCount,
        validSampleCount: metricStats.validSampleCount,
        minimum: metricStats.minimum,
        average: metricStats.average,
        maximum: metricStats.maximum,
        latest: metricStats.last,
        latestAt: metricStats.latestAt?.toISOString() ?? null,
      };
    });

    const byMeter = new Map<string, typeof metricRows>();
    for (const row of metricRows) {
      const list = byMeter.get(row.deviceId) ?? [];
      list.push(row);
      byMeter.set(row.deviceId, list);
    }
    const statFor = (rows: typeof metricRows, key: string) => {
      const metric = rows.find((item) => item.metricKey === key);
      return metric ? stats.get(metric.deviceMetricId) ?? emptyStats() : emptyStats();
    };
    const finite = (values: Array<number | null>, mode: "min" | "max" | "avg") => {
      const available = values.filter((value): value is number => value !== null && Number.isFinite(value));
      if (!available.length) return null;
      if (mode === "min") return Math.min(...available);
      if (mode === "max") return Math.max(...available);
      return available.reduce((sum, value) => sum + value, 0) / available.length;
    };

    const meterSummaries: NonNullable<ReportSnapshot["electrical"]>["meters"] = [];
    for (const rows of byMeter.values()) {
      const first = rows[0];
      const voltage = ["electrical.voltage.l1_n", "electrical.voltage.l2_n", "electrical.voltage.l3_n"].map((key) => statFor(rows, key));
      const current = ["electrical.current.l1", "electrical.current.l2", "electrical.current.l3"].map((key) => statFor(rows, key));
      const activePower = statFor(rows, "electrical.power.active.total");
      const apparentPower = statFor(rows, "electrical.power.apparent.total");
      const reactivePower = statFor(rows, "electrical.power.reactive.total");
      const powerFactor = statFor(rows, "electrical.power_factor");
      const frequency = statFor(rows, "electrical.frequency");
      const importEnergy = statFor(rows, "electrical.energy.import");
      const exportEnergy = statFor(rows, "electrical.energy.export");
      const demand = statFor(rows, "electrical.demand.active");
      const sampleCount = rows.reduce((sum, row) => sum + (stats.get(row.deviceMetricId)?.sampleCount ?? 0), 0);
      const validSampleCount = rows.reduce((sum, row) => sum + (stats.get(row.deviceMetricId)?.validSampleCount ?? 0), 0);
      meterSummaries.push({
        code: first.deviceCode,
        name: first.deviceName,
        sampleCount,
        validSampleCount,
        qualityPercent: sampleCount ? Math.round(validSampleCount / sampleCount * 10_000) / 100 : null,
        voltageMinimumV: finite(voltage.map((item) => item.minimum), "min"),
        voltageAverageV: finite(voltage.map((item) => item.average), "avg"),
        voltageMaximumV: finite(voltage.map((item) => item.maximum), "max"),
        currentMaximumA: finite(current.map((item) => item.maximum), "max"),
        activePowerAverageKw: activePower.average,
        activePowerMaximumKw: activePower.maximum,
        apparentPowerAverageKva: apparentPower.average,
        reactivePowerAverageKvar: reactivePower.average,
        powerFactorMinimum: powerFactor.minimum,
        powerFactorAverage: powerFactor.average,
        frequencyMinimumHz: frequency.minimum,
        frequencyAverageHz: frequency.average,
        frequencyMaximumHz: frequency.maximum,
        energyImportStartKwh: importEnergy.first,
        energyImportEndKwh: importEnergy.last,
        energyImportDeltaKwh: importEnergy.first !== null && importEnergy.last !== null ? Math.max(0, importEnergy.last - importEnergy.first) : null,
        energyExportStartKwh: exportEnergy.first,
        energyExportEndKwh: exportEnergy.last,
        energyExportDeltaKwh: exportEnergy.first !== null && exportEnergy.last !== null ? Math.max(0, exportEnergy.last - exportEnergy.first) : null,
        peakDemandKw: demand.maximum,
      });
    }

    const candidateAlarms = await db.select({
      code: alarms.code,
      title: alarms.title,
      severity: alarms.severity,
      status: alarms.status,
      openedAt: alarms.openedAt,
      resolvedAt: alarms.resolvedAt,
      closedAt: alarms.closedAt,
      triggerValue: alarms.triggerValue,
      thresholdValue: alarms.thresholdValue,
      context: alarms.context,
    }).from(alarms)
      .where(and(eq(alarms.assetId, input.assetId), lte(alarms.openedAt, input.periodEnd)))
      .orderBy(desc(alarms.openedAt))
      .limit(1000);

    const alarmRows = candidateAlarms.filter((alarm) => {
      const alarmContext = alarm.context ?? {};
      if (alarmContext.source !== "electrical") return false;
      const endedAt = alarm.resolvedAt ?? alarm.closedAt;
      return !endedAt || endedAt >= input.periodStart;
    }).slice(0, 500);

    const sampleCount = channelRows.reduce((total, row) => total + row.sampleCount, 0);
    const validSampleCount = channelRows.reduce((total, row) => total + row.validSampleCount, 0);
    const criticalCount = alarmRows.filter((alarm) => alarm.severity === "critical").length;
    const warningCount = alarmRows.filter((alarm) => alarm.severity === "warning").length;
    const condition = criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "normal";
    const now = new Date();
    const snapshot: ReportSnapshot = {
      generatedAt: now.toISOString(),
      generatedBy: input.generatedBy,
      template: { id: template.id, key: template.key, name: template.name, description: template.description },
      client: { code: context.clientCode, name: context.clientName },
      site: { code: context.siteCode, name: context.siteName, timezone: context.timezone },
      asset: { id: context.assetId, code: context.assetCode, name: context.assetName, area: context.area, nominalVoltageKv: numeric(context.nominalVoltageKv), assetType: context.assetType },
      period: { start: input.periodStart.toISOString(), end: input.periodEnd.toISOString() },
      summary: {
        condition,
        channelCount: channelRows.length,
        sampleCount,
        validSampleCount,
        qualityPercent: sampleCount ? Math.round(validSampleCount / sampleCount * 10_000) / 100 : null,
        alarmCount: alarmRows.length,
        warningCount,
        criticalCount,
      },
      channels: channelRows,
      electrical: {
        meterCount: meterSummaries.length,
        limits: {
          staleAfterSeconds: config.staleAfterSeconds,
          thresholdDelaySeconds: config.thresholdDelaySeconds,
          voltageMinV: config.voltageMinV,
          voltageMaxV: config.voltageMaxV,
          currentMaxA: config.currentMaxA,
          frequencyMinHz: config.frequencyMinHz,
          frequencyMaxHz: config.frequencyMaxHz,
          powerFactorMin: config.powerFactorMin,
        },
        meters: meterSummaries,
      },
      alarms: alarmRows.map((alarm) => ({
        code: alarm.code,
        title: alarm.title,
        severity: alarm.severity,
        status: alarm.status,
        openedAt: alarm.openedAt.toISOString(),
        channelCode: typeof alarm.context?.deviceCode === "string" ? alarm.context.deviceCode : null,
        triggerValue: numeric(alarm.triggerValue),
        thresholdValue: numeric(alarm.thresholdValue),
      })),
    };

    const title = `${template.name} · ${context.assetCode}`;
    const [run] = await db.insert(reportRuns).values({
      templateId: template.id,
      assetId: context.assetId,
      requestedBy: input.requestedBy ?? null,
      title,
      format: input.format ?? "pdf",
      status: "completed",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      payload: snapshot,
      completedAt: now,
    }).returning();
    return { run, snapshot };
  }

  if (context.assetType === "ats") {
    const config = parseAtsConfig(context.assetMetadata);
    const metricRows = await db.select({
      deviceId: devices.id,
      deviceCode: devices.code,
      deviceName: devices.name,
      deviceMetricId: deviceMetrics.id,
      metricCode: deviceMetrics.code,
      metricName: deviceMetrics.name,
      metricKey: metricDefinitions.key,
      unit: metricDefinitions.unit,
      dataType: metricDefinitions.dataType,
    }).from(deviceMetrics)
      .innerJoin(devices, eq(devices.id, deviceMetrics.deviceId))
      .innerJoin(metricDefinitions, eq(metricDefinitions.id, deviceMetrics.metricDefinitionId))
      .where(and(
        eq(devices.assetId, input.assetId),
        eq(devices.active, true),
        eq(devices.deviceType, "ats_controller"),
        eq(deviceMetrics.enabled, true),
      ))
      .orderBy(devices.code, deviceMetrics.displayOrder);

    const numericRows = metricRows.filter((item) =>
      (item.metricKey.startsWith("ats.") || item.metricKey.startsWith("dse."))
      && (item.dataType === "float" || item.dataType === "integer")
    );
    const stats = await genericMetricStatistics(db, numericRows.map((item) => item.deviceMetricId), input.periodStart, input.periodEnd);
    const channelRows: ReportSnapshot["channels"] = numericRows.map((item) => {
      const metricStats = stats.get(item.deviceMetricId) ?? emptyStats();
      return {
        code: `${item.deviceCode}:${item.metricCode}`,
        name: `${item.deviceName} · ${item.metricName}`,
        zone: context.area,
        unit: item.unit,
        sampleCount: metricStats.sampleCount,
        validSampleCount: metricStats.validSampleCount,
        minimum: metricStats.minimum,
        average: metricStats.average,
        maximum: metricStats.maximum,
        latest: metricStats.last,
        latestAt: metricStats.latestAt?.toISOString() ?? null,
      };
    });

    const byController = new Map<string, typeof metricRows>();
    for (const row of metricRows) {
      const list = byController.get(row.deviceId) ?? [];
      list.push(row);
      byController.set(row.deviceId, list);
    }
    const statFor = (rows: typeof metricRows, key: string) => {
      const metric = rows.find((item) => item.metricKey === key);
      return metric ? stats.get(metric.deviceMetricId) ?? emptyStats() : emptyStats();
    };
    const finite = (values: Array<number | null>, mode: "max" | "avg") => {
      const available = values.filter((value): value is number => value !== null && Number.isFinite(value));
      if (!available.length) return null;
      if (mode === "max") return Math.max(...available);
      return available.reduce((sum, value) => sum + value, 0) / available.length;
    };
    const latestDiscrete = async (rows: typeof metricRows, key: string) => {
      const metric = rows.find((item) => item.metricKey === key);
      if (!metric) return null;
      const [reading] = await db.select({
        valueBoolean: metricReadings.valueBoolean,
        valueText: metricReadings.valueText,
      }).from(metricReadings).where(and(
        eq(metricReadings.deviceMetricId, metric.deviceMetricId),
        gte(metricReadings.recordedAt, input.periodStart),
        lte(metricReadings.recordedAt, input.periodEnd),
      )).orderBy(desc(metricReadings.recordedAt)).limit(1);
      return reading ?? null;
    };

    const controllerSummaries: NonNullable<ReportSnapshot["ats"]>["controllers"] = [];
    for (const rows of byController.values()) {
      const first = rows[0];
      const source1Voltage = ["ats.source1.voltage.l1_n", "ats.source1.voltage.l2_n", "ats.source1.voltage.l3_n"].map((key) => statFor(rows, key));
      const source2Voltage = ["ats.source2.voltage.l1_n", "ats.source2.voltage.l2_n", "ats.source2.voltage.l3_n"].map((key) => statFor(rows, key));
      const loadCurrent = ["ats.load.current.l1", "ats.load.current.l2", "ats.load.current.l3"].map((key) => statFor(rows, key));
      const source1Frequency = statFor(rows, "ats.source1.frequency");
      const source2Frequency = statFor(rows, "ats.source2.frequency");
      const activePower = statFor(rows, "ats.load.power.active.total");
      const apparentPower = statFor(rows, "ats.load.power.apparent.total");
      const reactivePower = statFor(rows, "ats.load.power.reactive.total");
      const powerFactor = statFor(rows, "ats.load.power_factor");
      const position = await latestDiscrete(rows, "ats.transfer.position");
      const mode = await latestDiscrete(rows, "dse.mode");
      const source1Available = await latestDiscrete(rows, "ats.source1.available");
      const source2Available = await latestDiscrete(rows, "ats.source2.available");
      const commonAlarm = await latestDiscrete(rows, "ats.common_alarm");
      const sampleCount = numericRows.filter((item) => item.deviceId === first.deviceId)
        .reduce((sum, row) => sum + (stats.get(row.deviceMetricId)?.sampleCount ?? 0), 0);
      const validSampleCount = numericRows.filter((item) => item.deviceId === first.deviceId)
        .reduce((sum, row) => sum + (stats.get(row.deviceMetricId)?.validSampleCount ?? 0), 0);

      controllerSummaries.push({
        code: first.deviceCode,
        name: first.deviceName,
        sampleCount,
        validSampleCount,
        qualityPercent: sampleCount ? Math.round(validSampleCount / sampleCount * 10_000) / 100 : null,
        source1VoltageAverageV: finite(source1Voltage.map((item) => item.average), "avg"),
        source1FrequencyAverageHz: source1Frequency.average,
        source2VoltageAverageV: finite(source2Voltage.map((item) => item.average), "avg"),
        source2FrequencyAverageHz: source2Frequency.average,
        loadCurrentMaximumA: finite(loadCurrent.map((item) => item.maximum), "max"),
        activePowerAverageKw: activePower.average,
        activePowerMaximumKw: activePower.maximum,
        apparentPowerAverageKva: apparentPower.average,
        reactivePowerAverageKvar: reactivePower.average,
        powerFactorAverage: powerFactor.average,
        lastPosition: position?.valueText ?? null,
        lastMode: mode?.valueText ?? null,
        source1Available: source1Available?.valueBoolean ?? null,
        source2Available: source2Available?.valueBoolean ?? null,
        commonAlarm: commonAlarm?.valueBoolean ?? null,
      });
    }

    const candidateAlarms = await db.select({
      code: alarms.code,
      title: alarms.title,
      severity: alarms.severity,
      status: alarms.status,
      openedAt: alarms.openedAt,
      resolvedAt: alarms.resolvedAt,
      closedAt: alarms.closedAt,
      triggerValue: alarms.triggerValue,
      thresholdValue: alarms.thresholdValue,
      context: alarms.context,
    }).from(alarms)
      .where(and(eq(alarms.assetId, input.assetId), lte(alarms.openedAt, input.periodEnd)))
      .orderBy(desc(alarms.openedAt))
      .limit(1000);
    const alarmRows = candidateAlarms.filter((alarm) => {
      const alarmContext = alarm.context ?? {};
      if (alarmContext.source !== "ats") return false;
      const endedAt = alarm.resolvedAt ?? alarm.closedAt;
      return !endedAt || endedAt >= input.periodStart;
    }).slice(0, 500);

    const sampleCount = channelRows.reduce((total, row) => total + row.sampleCount, 0);
    const validSampleCount = channelRows.reduce((total, row) => total + row.validSampleCount, 0);
    const criticalCount = alarmRows.filter((alarm) => alarm.severity === "critical").length;
    const warningCount = alarmRows.filter((alarm) => alarm.severity === "warning").length;
    const condition = criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "normal";
    const now = new Date();
    const snapshot: ReportSnapshot = {
      generatedAt: now.toISOString(),
      generatedBy: input.generatedBy,
      template: { id: template.id, key: template.key, name: template.name, description: template.description },
      client: { code: context.clientCode, name: context.clientName },
      site: { code: context.siteCode, name: context.siteName, timezone: context.timezone },
      asset: { id: context.assetId, code: context.assetCode, name: context.assetName, area: context.area, nominalVoltageKv: null, assetType: context.assetType },
      period: { start: input.periodStart.toISOString(), end: input.periodEnd.toISOString() },
      summary: {
        condition,
        channelCount: channelRows.length,
        sampleCount,
        validSampleCount,
        qualityPercent: sampleCount ? Math.round(validSampleCount / sampleCount * 10_000) / 100 : null,
        alarmCount: alarmRows.length,
        warningCount,
        criticalCount,
      },
      channels: channelRows,
      ats: {
        controllerCount: controllerSummaries.length,
        config: {
          source1Label: config.source1Label,
          source2Label: config.source2Label,
          staleAfterSeconds: config.staleAfterSeconds,
          source1Required: config.source1Required,
          source2Required: config.source2Required,
          expectedPosition: config.expectedPosition,
        },
        controllers: controllerSummaries,
      },
      alarms: alarmRows.map((alarm) => ({
        code: alarm.code,
        title: alarm.title,
        severity: alarm.severity,
        status: alarm.status,
        openedAt: alarm.openedAt.toISOString(),
        channelCode: typeof alarm.context?.deviceCode === "string" ? alarm.context.deviceCode : null,
        triggerValue: numeric(alarm.triggerValue),
        thresholdValue: numeric(alarm.thresholdValue),
      })),
    };

    const title = `${template.name} · ${context.assetCode}`;
    const [run] = await db.insert(reportRuns).values({
      templateId: template.id,
      assetId: context.assetId,
      requestedBy: input.requestedBy ?? null,
      title,
      format: input.format ?? "pdf",
      status: "completed",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      payload: snapshot,
      completedAt: now,
    }).returning();
    return { run, snapshot };
  }

  const channelRows = await db.select({
    code: channels.code,
    name: channels.name,
    zone: channels.zone,
    unit: channels.unit,
    sampleCount: count(readings.id),
    validSampleCount: sql<number>`count(${readings.id}) filter (where ${readings.quality} = 'good')`,
    minimum: sql<string | null>`min(${readings.value})`,
    average: sql<string | null>`avg(${readings.value})`,
    maximum: sql<string | null>`max(${readings.value})`,
    latest: sql<string | null>`(array_agg(${readings.value} order by ${readings.recordedAt} desc) filter (where ${readings.id} is not null))[1]`,
    // Aggregated timestamps are returned as strings by postgres.js in the
    // production runtime, even though direct timestamp columns are Dates.
    latestAt: sql<Date | string | null>`max(${readings.recordedAt})`,
  }).from(channels)
    .leftJoin(readings, and(eq(readings.channelId, channels.id), between(readings.recordedAt, input.periodStart, input.periodEnd)))
    .where(and(eq(channels.assetId, input.assetId), eq(channels.enabled, true)))
    .groupBy(channels.id)
    .orderBy(channels.displayOrder);

  const alarmRows = await db.select({
    code: alarms.code,
    title: alarms.title,
    severity: alarms.severity,
    status: alarms.status,
    openedAt: alarms.openedAt,
    channelCode: channels.code,
    triggerValue: alarms.triggerValue,
    thresholdValue: alarms.thresholdValue,
  }).from(alarms)
    .leftJoin(channels, eq(channels.id, alarms.channelId))
    .where(and(eq(alarms.assetId, input.assetId), between(alarms.openedAt, input.periodStart, input.periodEnd)))
    .orderBy(desc(alarms.openedAt))
    .limit(500);

  const sampleCount = channelRows.reduce((total, channel) => total + Number(channel.sampleCount), 0);
  const validSampleCount = channelRows.reduce((total, channel) => total + Number(channel.validSampleCount), 0);
  const criticalCount = alarmRows.filter((alarm) => alarm.severity === "critical").length;
  const warningCount = alarmRows.filter((alarm) => alarm.severity === "warning").length;
  const condition = criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "normal";
  const now = new Date();
  const snapshot: ReportSnapshot = {
    generatedAt: now.toISOString(),
    generatedBy: input.generatedBy,
    template: { id: template.id, key: template.key, name: template.name, description: template.description },
    client: { code: context.clientCode, name: context.clientName },
    site: { code: context.siteCode, name: context.siteName, timezone: context.timezone },
    asset: { id: context.assetId, code: context.assetCode, name: context.assetName, area: context.area, nominalVoltageKv: numeric(context.nominalVoltageKv), assetType: context.assetType },
    period: { start: input.periodStart.toISOString(), end: input.periodEnd.toISOString() },
    summary: {
      condition,
      channelCount: channelRows.length,
      sampleCount,
      validSampleCount,
      qualityPercent: sampleCount ? Math.round(validSampleCount / sampleCount * 10_000) / 100 : null,
      alarmCount: alarmRows.length,
      warningCount,
      criticalCount,
    },
    channels: channelRows.map((channel) => ({
      code: channel.code,
      name: channel.name,
      zone: channel.zone,
      unit: channel.unit,
      sampleCount: Number(channel.sampleCount),
      validSampleCount: Number(channel.validSampleCount),
      minimum: numeric(channel.minimum),
      average: numeric(channel.average),
      maximum: numeric(channel.maximum),
      latest: numeric(channel.latest),
      latestAt: timestampIso(channel.latestAt),
    })),
    alarms: alarmRows.map((alarm) => ({
      ...alarm,
      openedAt: alarm.openedAt.toISOString(),
      triggerValue: numeric(alarm.triggerValue),
      thresholdValue: numeric(alarm.thresholdValue),
    })),
  };
  const title = `${template.name} · ${context.assetCode}`;
  const [run] = await db.insert(reportRuns).values({
    templateId: template.id,
    assetId: context.assetId,
    requestedBy: input.requestedBy ?? null,
    title,
    format: input.format ?? "pdf",
    status: "completed",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    payload: snapshot,
    completedAt: now,
  }).returning();
  return { run, snapshot };
}

const weekDays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function nextCronRun(expression: string, timezone: string, after = new Date()) {
  const [minuteText, hourText, dayText, monthText, weekDayText] = expression.trim().split(/\s+/);
  if (!minuteText || !hourText || !dayText || !monthText || !weekDayText) throw new Error("La programación no es válida.");
  const wantedMinute = Number(minuteText);
  const wantedHour = Number(hourText);
  if (!Number.isInteger(wantedMinute) || wantedMinute < 0 || wantedMinute > 59 || !Number.isInteger(wantedHour) || wantedHour < 0 || wantedHour > 23) throw new Error("La hora programada no es válida.");
  if (![dayText, monthText, weekDayText].every((value) => value === "*" || /^\d+$/.test(value))) throw new Error("La expresión de programación no es compatible.");
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short" });
  const candidate = new Date(after.getTime() + 60_000);
  candidate.setUTCSeconds(0, 0);
  const deadline = after.getTime() + 370 * 24 * 60 * 60 * 1000;
  while (candidate.getTime() <= deadline) {
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map((part) => [part.type, part.value]));
    const matches = Number(parts.minute) === wantedMinute
      && Number(parts.hour) === wantedHour
      && (dayText === "*" || Number(parts.day) === Number(dayText))
      && (monthText === "*" || Number(parts.month) === Number(monthText))
      && (weekDayText === "*" || weekDays[parts.weekday] === Number(weekDayText));
    if (matches) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error("No fue posible calcular la próxima ejecución.");
}

export async function processScheduledReports(db: Cam5Database, now = new Date()) {
  const due = await db.select({
    id: reportSchedules.id,
    templateId: reportSchedules.templateId,
    assetId: reportSchedules.assetId,
    cronExpression: reportSchedules.cronExpression,
    timezone: reportSchedules.timezone,
    creatorName: users.displayName,
  }).from(reportSchedules)
    .leftJoin(users, eq(users.id, reportSchedules.createdBy))
    .where(and(eq(reportSchedules.active, true), lte(reportSchedules.nextRunAt, now)))
    .limit(25);
  let completed = 0;
  let failed = 0;
  for (const schedule of due) {
    if (!schedule.assetId) {
      failed += 1;
      await db.update(reportSchedules).set({ active: false, updatedAt: now }).where(eq(reportSchedules.id, schedule.id));
      continue;
    }
    try {
      const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      await createReportRun(db, { templateId: schedule.templateId, assetId: schedule.assetId, periodStart, periodEnd: now, generatedBy: schedule.creatorName ?? "Sistema", format: "pdf" });
      await db.update(reportSchedules).set({ nextRunAt: nextCronRun(schedule.cronExpression, schedule.timezone, now), updatedAt: now }).where(eq(reportSchedules.id, schedule.id));
      completed += 1;
    } catch (error) {
      console.error("No fue posible generar el reporte programado", schedule.id, error);
      failed += 1;
    }
  }
  return { due: due.length, completed, failed };
}
