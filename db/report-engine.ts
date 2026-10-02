import { and, between, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import { parseColdChainConfig } from "./cold-chain";
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
