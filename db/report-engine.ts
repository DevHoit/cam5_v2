import { and, between, count, desc, eq, lte, sql } from "drizzle-orm";
import type { Cam5Database } from "./index";
import {
  alarms,
  assets,
  channels,
  clients,
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
  asset: { id: string; code: string; name: string; area: string | null; nominalVoltageKv: number | null };
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
    latestAt: sql<Date | null>`max(${readings.recordedAt})`,
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
    asset: { id: context.assetId, code: context.assetCode, name: context.assetName, area: context.area, nominalVoltageKv: numeric(context.nominalVoltageKv) },
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
      latestAt: channel.latestAt?.toISOString() ?? null,
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
