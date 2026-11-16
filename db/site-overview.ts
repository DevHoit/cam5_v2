import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { alarmRules, alarms, assets, channels, devices, latestReadings, readingAggregates, readingProfiles } from "./schema";

/**
 * Vista del sitio: cada punto de medición resumido por grupo de variables (la temperatura más alta,
 * la humedad más alta y la peor descarga UHF) y comparación de un grupo entre puntos en el tiempo.
 * Lee latest_readings y reading_aggregates: no agrega consultas al gateway ni datos nuevos.
 */

export const SITE_GROUPS = {
  temperature: { label: "Temperatura máx.", metrics: ["temperature"] },
  humidity: { label: "Humedad máx.", metrics: ["humidity"] },
  discharge: { label: "Descarga UHF máx.", metrics: ["partial_discharge", "surface_discharge"] },
} as const;
export type SiteGroup = keyof typeof SITE_GROUPS;
export const SITE_GROUP_KEYS = Object.keys(SITE_GROUPS) as SiteGroup[];
type Metric = (typeof SITE_GROUPS)[SiteGroup]["metrics"][number];
const ALL_METRICS = SITE_GROUP_KEYS.flatMap((group) => [...SITE_GROUPS[group].metrics]) as Metric[];

export type Severity = "normal" | "warning" | "critical";
export type PointStatus = Severity | "offline";
export type GroupCell = { value: number | null; unit: string | null; channelCode: string | null; channelName: string | null; severity: Severity };
export type SitePoint = {
  id: string;
  code: string;
  name: string;
  deviceCode: string | null;
  status: PointStatus;
  lastReadAt: string | null;
  openAlarms: number;
  alarmSeverity: Severity | null;
  groups: Record<SiteGroup, GroupCell>;
};

const SEVERITY_RANK: Record<Severity, number> = { normal: 0, warning: 1, critical: 2 };
const STATUS_RANK: Record<PointStatus, number> = { critical: 0, warning: 1, offline: 2, normal: 3 };

function worst(left: Severity, right: Severity): Severity {
  return SEVERITY_RANK[right] > SEVERITY_RANK[left] ? right : left;
}

export function channelSeverity(value: number, warning: number | null, critical: number | null): Severity {
  if (critical !== null && value >= critical) return "critical";
  if (warning !== null && value >= warning) return "warning";
  return "normal";
}

function groupOf(metric: string): SiteGroup | null {
  return SITE_GROUP_KEYS.find((group) => (SITE_GROUPS[group].metrics as readonly string[]).includes(metric)) ?? null;
}

type ChannelRow = {
  assetId: string;
  metric: string;
  code: string;
  name: string;
  unit: string;
  value: string | null;
  quality: string | null;
  recordedAt: Date | null;
  warningThreshold: string | null;
  criticalThreshold: string | null;
};

/** Resume los canales de un punto: valor máximo vigente por grupo y su severidad según los umbrales. */
export function summarizeGroups(rows: ChannelRow[], now: Date, staleAfterSeconds: number): Record<SiteGroup, GroupCell> {
  const cells = Object.fromEntries(SITE_GROUP_KEYS.map((group) => [group, { value: null, unit: null, channelCode: null, channelName: null, severity: "normal" }])) as Record<SiteGroup, GroupCell>;
  for (const row of rows) {
    const group = groupOf(row.metric);
    if (!group || row.value === null || row.quality !== "good" || !row.recordedAt) continue;
    if (now.getTime() - row.recordedAt.getTime() > staleAfterSeconds * 1000) continue;
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    const cell = cells[group];
    const severity = channelSeverity(value, row.warningThreshold === null ? null : Number(row.warningThreshold), row.criticalThreshold === null ? null : Number(row.criticalThreshold));
    cell.severity = worst(cell.severity, severity);
    if (cell.value === null || value > cell.value) {
      cell.value = value;
      cell.unit = row.unit;
      cell.channelCode = row.code;
      cell.channelName = row.name;
    }
  }
  return cells;
}

export function sortPoints(points: SitePoint[]): SitePoint[] {
  return [...points].sort((left, right) => STATUS_RANK[left.status] - STATUS_RANK[right.status]
    || right.openAlarms - left.openAlarms
    || (right.groups.temperature.value ?? -Infinity) - (left.groups.temperature.value ?? -Infinity)
    || left.code.localeCompare(right.code));
}

export async function loadSiteOverview(db: Cam5Database, siteId: string, allowedAssetIds: string[], now = new Date()) {
  const scope = allowedAssetIds.length ? inArray(assets.id, allowedAssetIds) : undefined;
  const pointRows = await db.select({
    id: assets.id,
    code: assets.code,
    name: assets.name,
    deviceCode: devices.code,
    deviceActive: devices.active,
    lastReadAt: devices.lastReadAt,
    staleAfterSeconds: readingProfiles.staleAfterSeconds,
  }).from(assets)
    .leftJoin(devices, and(eq(devices.assetId, assets.id), eq(devices.active, true)))
    .leftJoin(readingProfiles, eq(readingProfiles.id, devices.readingProfileId))
    .where(and(eq(assets.siteId, siteId), eq(assets.active, true), scope))
    .orderBy(asc(assets.code), asc(devices.code));
  // Un punto puede tener varios controladores: se toma el de lectura más reciente.
  const byPoint = new Map<string, (typeof pointRows)[number]>();
  for (const row of pointRows) {
    const current = byPoint.get(row.id);
    if (!current || (row.lastReadAt && (!current.lastReadAt || row.lastReadAt > current.lastReadAt))) byPoint.set(row.id, row);
  }
  const pointIds = [...byPoint.keys()];
  if (!pointIds.length) return { serverTime: now.toISOString(), points: [] as SitePoint[], summary: emptySummary() };

  const [channelRows, alarmRows] = await Promise.all([
    db.select({
      assetId: channels.assetId,
      metric: channels.metric,
      code: channels.code,
      name: channels.name,
      unit: channels.unit,
      value: latestReadings.value,
      quality: latestReadings.quality,
      recordedAt: latestReadings.recordedAt,
      warningThreshold: alarmRules.warningThreshold,
      criticalThreshold: alarmRules.criticalThreshold,
    }).from(channels)
      .leftJoin(latestReadings, eq(latestReadings.channelId, channels.id))
      .leftJoin(alarmRules, and(eq(alarmRules.channelId, channels.id), eq(alarmRules.enabled, true)))
      .where(and(inArray(channels.assetId, pointIds), eq(channels.enabled, true), inArray(channels.metric, ALL_METRICS))),
    db.select({
      assetId: alarms.assetId,
      total: sql<number>`count(*)::int`,
      critical: sql<number>`count(*) filter (where ${alarms.severity} = 'critical')::int`,
      warning: sql<number>`count(*) filter (where ${alarms.severity} = 'warning')::int`,
    }).from(alarms)
      .where(and(inArray(alarms.assetId, pointIds), inArray(alarms.status, ["open", "acknowledged"])))
      .groupBy(alarms.assetId),
  ]);

  const points: SitePoint[] = pointIds.map((id) => {
    const point = byPoint.get(id)!;
    const staleAfter = point.staleAfterSeconds ?? 180;
    const groups = summarizeGroups(channelRows.filter((row) => row.assetId === id), now, staleAfter);
    const alarm = alarmRows.find((row) => row.assetId === id);
    const alarmSeverity: Severity | null = alarm ? (alarm.critical ? "critical" : alarm.warning ? "warning" : "normal") : null;
    const fresh = Boolean(point.lastReadAt && now.getTime() - point.lastReadAt.getTime() <= staleAfter * 1000);
    const measured = SITE_GROUP_KEYS.reduce<Severity>((acc, group) => worst(acc, groups[group].severity), "normal");
    const status: PointStatus = !fresh ? "offline" : worst(measured, alarmSeverity ?? "normal");
    return {
      id,
      code: point.code,
      name: point.name,
      deviceCode: point.deviceCode,
      status,
      lastReadAt: point.lastReadAt?.toISOString() ?? null,
      openAlarms: alarm?.total ?? 0,
      alarmSeverity,
      groups,
    };
  });
  const sorted = sortPoints(points);
  return { serverTime: now.toISOString(), points: sorted, summary: summarize(sorted) };
}

function emptySummary() {
  return { total: 0, online: 0, withAlarms: 0, highest: Object.fromEntries(SITE_GROUP_KEYS.map((group) => [group, null])) as Record<SiteGroup, null | { value: number; unit: string | null; pointCode: string; channelCode: string | null }> };
}

function summarize(points: SitePoint[]) {
  const summary = emptySummary();
  summary.total = points.length;
  summary.online = points.filter((point) => point.status !== "offline").length;
  summary.withAlarms = points.filter((point) => point.openAlarms > 0).length;
  for (const group of SITE_GROUP_KEYS) {
    for (const point of points) {
      const cell = point.groups[group];
      if (cell.value === null) continue;
      const best = summary.highest[group];
      if (!best || cell.value > best.value) summary.highest[group] = { value: cell.value, unit: cell.unit, pointCode: point.code, channelCode: cell.channelCode };
    }
  }
  return summary;
}

/** Periodos de la comparación y el agregado que usa cada uno (≤ 288 puntos por línea). */
export const SITE_TREND_PERIODS = { 24: 300, 168: 3600, 720: 3600 } as const;
export type SiteTrendHours = keyof typeof SITE_TREND_PERIODS;

export async function loadSiteTrend(db: Cam5Database, siteId: string, allowedAssetIds: string[], group: SiteGroup, hours: SiteTrendHours, now = new Date()) {
  const bucketSeconds = SITE_TREND_PERIODS[hours];
  const from = new Date(Math.floor((now.getTime() - hours * 3600_000) / (bucketSeconds * 1000)) * bucketSeconds * 1000);
  const scope = allowedAssetIds.length ? inArray(assets.id, allowedAssetIds) : undefined;
  const metrics = [...SITE_GROUPS[group].metrics] as Metric[];
  const points = await db.select({ id: assets.id, code: assets.code, name: assets.name }).from(assets)
    .where(and(eq(assets.siteId, siteId), eq(assets.active, true), scope)).orderBy(asc(assets.code));
  const pointIds = points.map((point) => point.id);
  if (!pointIds.length) return { group, hours, bucketSeconds, from: from.toISOString(), to: now.toISOString(), unit: null, warningThreshold: null, criticalThreshold: null, points: [] };

  const [rows, thresholds] = await Promise.all([
    db.select({
      assetId: channels.assetId,
      bucketStart: readingAggregates.bucketStart,
      value: sql<string | null>`max(${readingAggregates.maximumValue})`,
    }).from(readingAggregates)
      .innerJoin(channels, eq(channels.id, readingAggregates.channelId))
      .where(and(
        inArray(channels.assetId, pointIds),
        eq(channels.enabled, true),
        inArray(channels.metric, metrics),
        eq(readingAggregates.bucketSeconds, bucketSeconds),
        gte(readingAggregates.bucketStart, from),
      ))
      .groupBy(channels.assetId, readingAggregates.bucketStart)
      .orderBy(asc(readingAggregates.bucketStart)),
    db.select({
      unit: channels.unit,
      warning: sql<string | null>`min(${alarmRules.warningThreshold})`,
      critical: sql<string | null>`min(${alarmRules.criticalThreshold})`,
    }).from(channels)
      .leftJoin(alarmRules, and(eq(alarmRules.channelId, channels.id), eq(alarmRules.enabled, true)))
      .where(and(inArray(channels.assetId, pointIds), eq(channels.enabled, true), inArray(channels.metric, metrics)))
      .groupBy(channels.unit),
  ]);
  // La referencia es el umbral más bajo del sitio para el grupo: el más conservador.
  const unit = thresholds[0]?.unit ?? null;
  const warnings = thresholds.map((row) => row.warning).filter((value): value is string => value !== null).map(Number);
  const criticals = thresholds.map((row) => row.critical).filter((value): value is string => value !== null).map(Number);
  return {
    group,
    hours,
    bucketSeconds,
    from: from.toISOString(),
    to: now.toISOString(),
    unit,
    warningThreshold: warnings.length ? Math.min(...warnings) : null,
    criticalThreshold: criticals.length ? Math.min(...criticals) : null,
    points: points.map((point) => ({
      ...point,
      series: rows.filter((row) => row.assetId === point.id && row.value !== null)
        .map((row) => [row.bucketStart.toISOString(), Math.round(Number(row.value) * 10) / 10] as [string, number]),
    })),
  };
}
