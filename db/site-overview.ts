import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { classifyPoint, POINT_SYSTEMS, resolvePointConfig, type PointCondition, type PointSensorReading } from "./point-types";
import { alarmRules, alarms, assets, channels, devices, gateways, latestReadings, measurementQuantities, pointTypes, readingAggregates, readingProfiles, type PointSystem } from "./schema";

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
export type PointConditionSummary = {
  status: PointCondition["status"];
  value: number | null;
  unit: string | null;
  decimals: number;
  quantityName: string | null;
  decisivePosition: string | null;
  sensors: number;
  reporting: number;
  rangeMin: number | null;
  rangeMax: number | null;
  aggregation: string;
  /** Variable secundaria del punto (p. ej. la humedad de una cámara fría). */
  secondary: { name: string; value: number; unit: string; decimals: number } | null;
};
export type SitePoint = {
  id: string;
  code: string;
  name: string;
  area: string | null;
  type: string;
  typeName: string;
  system: PointSystem;
  condition: PointConditionSummary | null;
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
    area: assets.area,
    type: assets.assetType,
    config: assets.config,
    typeName: pointTypes.name,
    system: pointTypes.system,
    primaryQuantity: pointTypes.primaryQuantity,
    aggregation: pointTypes.aggregation,
    defaultConfig: pointTypes.defaultConfig,
    deviceCode: devices.code,
    deviceActive: devices.active,
    lastReadAt: devices.lastReadAt,
    staleAfterSeconds: readingProfiles.staleAfterSeconds,
  }).from(assets)
    .innerJoin(pointTypes, eq(pointTypes.key, assets.assetType))
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
  if (!pointIds.length) return { serverTime: now.toISOString(), points: [] as SitePoint[], summary: emptySummary(), systems: [] as SystemSummary[], attention: [] as AttentionItem[], health: [] as HealthIssue[] };

  const [channelRows, alarmRows, measuredRows, gatewayRows] = await Promise.all([
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
    // Todas las variables habilitadas con su rol: las de proceso definen la condición del punto y
    // las de salud (batería, señal) alimentan la sección de salud de sensores.
    db.select({
      channelId: channels.id,
      assetId: channels.assetId,
      deviceId: devices.id,
      deviceCode: devices.code,
      deviceName: devices.name,
      position: devices.position,
      deviceLastReadAt: devices.lastReadAt,
      staleAfterSeconds: readingProfiles.staleAfterSeconds,
      metric: channels.metric,
      role: channels.role,
      unit: channels.unit,
      quantityName: measurementQuantities.name,
      decimals: measurementQuantities.decimals,
      value: latestReadings.value,
      quality: latestReadings.quality,
      recordedAt: latestReadings.recordedAt,
    }).from(channels)
      .innerJoin(devices, and(eq(devices.id, channels.deviceId), eq(devices.active, true)))
      .innerJoin(measurementQuantities, eq(measurementQuantities.key, channels.metric))
      .leftJoin(readingProfiles, eq(readingProfiles.id, devices.readingProfileId))
      .leftJoin(latestReadings, eq(latestReadings.channelId, channels.id))
      .where(and(inArray(channels.assetId, pointIds), eq(channels.enabled, true))),
    db.select({ id: gateways.id, code: gateways.code, name: gateways.name, lastSeenAt: gateways.lastSeenAt })
      .from(gateways).innerJoin(devices, eq(devices.gatewayId, gateways.id)).innerJoin(assets, eq(assets.id, devices.assetId))
      .where(and(eq(gateways.siteId, siteId), eq(gateways.active, true), eq(devices.active, true), inArray(assets.id, pointIds)))
      .groupBy(gateways.id, gateways.code, gateways.name, gateways.lastSeenAt),
  ]);

  const points: SitePoint[] = pointIds.map((id) => {
    const point = byPoint.get(id)!;
    const staleAfter = point.staleAfterSeconds ?? 180;
    const groups = summarizeGroups(channelRows.filter((row) => row.assetId === id), now, staleAfter);
    const alarm = alarmRows.find((row) => row.assetId === id);
    const alarmSeverity: Severity | null = alarm ? (alarm.critical ? "critical" : alarm.warning ? "warning" : "normal") : null;
    const fresh = Boolean(point.lastReadAt && now.getTime() - point.lastReadAt.getTime() <= staleAfter * 1000);
    const condition = point.system === "condition" ? null : pointCondition(point, measuredRows.filter((row) => row.assetId === id && row.role === "process"), now);
    // Celdas CAM5: severidad por umbrales de cada grupo. Otros sistemas: fuera del rango objetivo = advertencia
    // (la alarma, con su tolerancia, la escala a crítico).
    const measured = condition ? (condition.status === "out_of_range" ? "warning" : "normal") : SITE_GROUP_KEYS.reduce<Severity>((acc, group) => worst(acc, groups[group].severity), "normal");
    const status: PointStatus = !fresh ? "offline" : worst(measured, alarmSeverity ?? "normal");
    return {
      id,
      code: point.code,
      name: point.name,
      area: point.area,
      type: point.type,
      typeName: point.typeName,
      system: point.system,
      condition,
      deviceCode: point.deviceCode,
      status,
      lastReadAt: point.lastReadAt?.toISOString() ?? null,
      openAlarms: alarm?.total ?? 0,
      alarmSeverity,
      groups,
    };
  });
  const sorted = sortPoints(points);
  return {
    serverTime: now.toISOString(),
    points: sorted,
    summary: summarize(sorted),
    systems: systemSummaries(sorted),
    attention: attentionItems(sorted),
    health: healthIssues(measuredRows, gatewayRows, sorted, now),
  };
}

type MeasuredRow = {
  channelId: string;
  assetId: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  position: string | null;
  deviceLastReadAt: Date | null;
  staleAfterSeconds: number | null;
  metric: string;
  role: string;
  unit: string;
  quantityName: string;
  decimals: number;
  value: string | null;
  quality: string | null;
  recordedAt: Date | null;
};

/** Una lectura cuenta como válida solo si es buena y está vigente según el perfil del equipo. */
function sensorReading(row: MeasuredRow, now: Date): PointSensorReading {
  const staleMs = (row.staleAfterSeconds ?? 180) * 1000;
  const fresh = Boolean(row.recordedAt && now.getTime() - row.recordedAt.getTime() <= staleMs);
  const quality = row.quality === "good" && !fresh ? "stale" : (row.quality ?? "stale") as PointSensorReading["quality"];
  return { channelId: row.channelId, deviceId: row.deviceId, position: row.position, value: row.value === null ? null : Number(row.value), quality, recordedAt: row.recordedAt };
}

function pointCondition(
  point: { primaryQuantity: string | null; aggregation: string; defaultConfig: Parameters<typeof resolvePointConfig>[0]["defaultConfig"]; config: Parameters<typeof resolvePointConfig>[1]; system: PointSystem },
  rows: MeasuredRow[],
  now: Date,
): PointConditionSummary | null {
  const config = resolvePointConfig({ aggregation: point.aggregation as Parameters<typeof resolvePointConfig>[0]["aggregation"], defaultConfig: point.defaultConfig }, point.config);
  const primary = rows.filter((row) => row.metric === point.primaryQuantity);
  if (!point.primaryQuantity || !primary.length) {
    return { status: "no_data", value: null, unit: null, decimals: 1, quantityName: null, decisivePosition: null, sensors: 0, reporting: 0, rangeMin: config.rangeMin, rangeMax: config.rangeMax, aggregation: config.aggregation, secondary: null };
  }
  const result = classifyPoint(primary.map((row) => sensorReading(row, now)), config);
  // Secundaria de una cámara: la humedad más alta vigente entre sus sensores.
  const humidity = point.system === "cold" ? rows.filter((row) => row.metric === "humidity").map((row) => sensorReading(row, now)).filter((reading) => reading.quality === "good" && reading.value !== null) : [];
  const humidityRow = rows.find((row) => row.metric === "humidity");
  return {
    status: result.status,
    value: result.value,
    unit: primary[0].unit,
    decimals: primary[0].decimals,
    quantityName: primary[0].quantityName,
    decisivePosition: result.decisive?.position ?? null,
    sensors: new Set(primary.map((row) => row.deviceId)).size,
    reporting: new Set(primary.map((row) => sensorReading(row, now)).filter((reading) => reading.quality === "good").map((reading) => reading.deviceId)).size,
    rangeMin: config.rangeMin,
    rangeMax: config.rangeMax,
    aggregation: config.aggregation,
    secondary: humidity.length && humidityRow ? { name: "Humedad", value: Math.max(...humidity.map((reading) => reading.value!)), unit: humidityRow.unit, decimals: 0 } : null,
  };
}

export type SystemSummary = { system: PointSystem; name: string; points: number; attention: number; offline: number };
const SYSTEM_ORDER: PointSystem[] = ["cold", "energy", "backup", "condition", "other"];

function systemSummaries(points: SitePoint[]): SystemSummary[] {
  return SYSTEM_ORDER.filter((system) => points.some((point) => point.system === system)).map((system) => {
    const own = points.filter((point) => point.system === system);
    return { system, name: POINT_SYSTEMS[system], points: own.length, attention: own.filter((point) => point.status === "warning" || point.status === "critical").length, offline: own.filter((point) => point.status === "offline").length };
  });
}

export type AttentionItem = { pointId: string; pointName: string; system: PointSystem; severity: Severity | "offline"; reason: "out_of_range" | "alarm" | "offline"; detail: string };

function formatNumber(value: number, decimals: number) {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value);
}

/** Lo que el equipo de mantenimiento debe mirar primero: puntos fuera de rango, con alarma o sin datos. */
export function attentionItems(points: SitePoint[]): AttentionItem[] {
  return points.flatMap<AttentionItem>((point) => {
    if (point.status === "offline") return [{ pointId: point.id, pointName: point.name, system: point.system, severity: "offline", reason: "offline", detail: point.lastReadAt ? "Sin datos recientes" : "Aún no reporta" }];
    const condition = point.condition;
    if (condition?.status === "out_of_range" && condition.value !== null) {
      const limit = condition.rangeMax !== null && condition.value > condition.rangeMax ? `máx. ${formatNumber(condition.rangeMax, condition.decimals)}` : `mín. ${formatNumber(condition.rangeMin ?? 0, condition.decimals)}`;
      return [{ pointId: point.id, pointName: point.name, system: point.system, severity: point.status === "critical" ? "critical" : "warning", reason: "out_of_range", detail: `${formatNumber(condition.value, condition.decimals)} ${condition.unit ?? ""} (${limit})${condition.decisivePosition ? ` · ${condition.decisivePosition}` : ""}`.replace(/ +/g, " ") }];
    }
    if (point.openAlarms > 0 && (point.status === "warning" || point.status === "critical")) {
      return [{ pointId: point.id, pointName: point.name, system: point.system, severity: point.status, reason: "alarm", detail: `${point.openAlarms} ${point.openAlarms === 1 ? "alarma abierta" : "alarmas abiertas"}` }];
    }
    return [];
  });
}

export type HealthIssue = { kind: "sensor_stale" | "battery_low" | "weak_signal" | "gateway_offline"; severity: "warning" | "critical"; pointId: string | null; pointName: string | null; deviceName: string; position: string | null; detail: string };

/** Batería bajo este porcentaje (o voltaje) y señal BLE bajo estos dBm se informan como mantenimiento. */
export const HEALTH_LIMITS = { batteryPercent: 20, batteryVolts: 2.5, signalDbm: -90, gatewayOfflineMinutes: 10 } as const;

export function healthIssues(rows: MeasuredRow[], gatewayRows: Array<{ code: string; name: string; lastSeenAt: Date | null }>, points: SitePoint[], now: Date): HealthIssue[] {
  const pointName = new Map(points.map((point) => [point.id, point.name]));
  const issues: HealthIssue[] = [];
  for (const gateway of gatewayRows) {
    const minutes = gateway.lastSeenAt ? (now.getTime() - gateway.lastSeenAt.getTime()) / 60_000 : Infinity;
    if (minutes > HEALTH_LIMITS.gatewayOfflineMinutes) issues.push({ kind: "gateway_offline", severity: "critical", pointId: null, pointName: null, deviceName: gateway.name, position: gateway.code, detail: gateway.lastSeenAt ? `Gateway sin conexión hace ${Math.round(minutes)} min` : "Gateway nunca se ha conectado" });
  }
  const devicesSeen = new Map<string, MeasuredRow>();
  for (const row of rows) if (!devicesSeen.has(row.deviceId)) devicesSeen.set(row.deviceId, row);
  for (const row of devicesSeen.values()) {
    const staleMs = (row.staleAfterSeconds ?? 180) * 1000;
    if (!row.deviceLastReadAt || now.getTime() - row.deviceLastReadAt.getTime() > staleMs) {
      issues.push({ kind: "sensor_stale", severity: "warning", pointId: row.assetId, pointName: pointName.get(row.assetId) ?? null, deviceName: row.deviceName, position: row.position, detail: row.deviceLastReadAt ? "Sensor sin reportar" : "Sensor aún no reporta" });
    }
  }
  for (const row of rows) {
    if (row.role !== "health" || row.value === null || row.quality !== "good") continue;
    const value = Number(row.value);
    const base = { pointId: row.assetId, pointName: pointName.get(row.assetId) ?? null, deviceName: row.deviceName, position: row.position };
    if (row.metric === "battery" && value < HEALTH_LIMITS.batteryPercent) issues.push({ ...base, kind: "battery_low", severity: "warning", detail: `Batería ${Math.round(value)} %` });
    if (row.metric === "battery_voltage" && value < HEALTH_LIMITS.batteryVolts) issues.push({ ...base, kind: "battery_low", severity: "warning", detail: `Batería ${formatNumber(value, 2)} V` });
    if (row.metric === "signal_strength" && value < HEALTH_LIMITS.signalDbm) issues.push({ ...base, kind: "weak_signal", severity: "warning", detail: `Señal débil ${Math.round(value)} dBm` });
  }
  // Un mismo sensor con batería en % y en V se informa una vez.
  return issues.filter((issue, index) => issue.kind !== "battery_low" || issues.findIndex((other) => other.kind === "battery_low" && other.deviceName === issue.deviceName && other.pointId === issue.pointId) === index);
}

function emptySummary() {
  return { total: 0, online: 0, withAlarms: 0, highest: Object.fromEntries(SITE_GROUP_KEYS.map((group) => [group, null])) as Record<SiteGroup, null | { value: number; unit: string | null; pointCode: string; channelCode: string | null }> };
}

function summarize(points: SitePoint[]) {
  const summary = emptySummary();
  summary.total = points.length;
  summary.online = points.filter((point) => point.status !== "offline").length;
  summary.withAlarms = points.filter((point) => point.openAlarms > 0).length;
  // Los máximos por grupo describen las celdas CAM5 (temperatura, humedad y UHF de los gabinetes).
  for (const group of SITE_GROUP_KEYS) {
    for (const point of points.filter((item) => item.system === "condition")) {
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
  // La comparación por grupo (temperatura, humedad, UHF de gabinetes) es del sistema de monitoreo de condición.
  const points = await db.select({ id: assets.id, code: assets.code, name: assets.name }).from(assets)
    .innerJoin(pointTypes, eq(pointTypes.key, assets.assetType))
    .where(and(eq(assets.siteId, siteId), eq(assets.active, true), eq(pointTypes.system, "condition"), scope)).orderBy(asc(assets.code));
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
