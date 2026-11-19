import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import type { Cam5Executor } from "./cam5-provisioning";
import { alarmRules, alarms, assets, channels, clients, devices, readingAggregates, sites } from "./schema";

/**
 * Informes de condición de una subestación (semanal y mensual).
 *
 * Calcula, con los resúmenes horarios de las lecturas, los indicadores que usa quien administra una
 * subestación: desbalance entre fases, temperatura sobre el ambiente, horas sobre umbral, descarga parcial,
 * humedad, gestión de alarmas y disponibilidad del monitoreo. Con reglas explicables asigna un estado a cada
 * punto y propone acciones concretas. El resultado se guarda como "payload" del informe y es la fuente del
 * PDF, del correo y de la vista en línea.
 */
export type SiteReportKind = "weekly" | "monthly";
export type PointHealth = "good" | "watch" | "action";
export type ActionPriority = "now" | "next" | "watch";

/** Criterio habitual de termografía para la diferencia entre fases con la misma carga. */
export const IMBALANCE_WATCH_C = 10;
export const IMBALANCE_ACT_C = 25;
/** Subida semanal del desbalance que, sumada al criterio de observación, pide actuar. */
export const IMBALANCE_RISING_C_PER_WEEK = 2;
export const HUMIDITY_LIMIT = 80;
const BUCKET_SECONDS = 3600;
const HOUR_MS = 3_600_000;

export type SiteReportPoint = {
  id: string;
  name: string;
  device: string | null;
  health: PointHealth;
  reasons: string[];
  tempMax: number | null;
  tempMaxChannel: string | null;
  hoursOverWarning: number;
  imbalance: number | null;
  imbalanceGroup: string | null;
  hotPhase: string | null;
  imbalanceTrendPerWeek: number | null;
  riseOverAmbient: number | null;
  uhfMax: number | null;
  pdEvents: number;
  sdEvents: number;
  humidityHours: number;
  alarms: number;
  criticalAlarms: number;
  availabilityPercent: number | null;
  longestGap: { start: string; hours: number } | null;
};

export type SiteReport = {
  version: 1;
  kind: SiteReportKind;
  generatedAt: string;
  period: { start: string; end: string; label: string };
  timezone: string;
  client: { name: string };
  site: { id: string; code: string; name: string };
  conclusion: { tone: "normal" | "warning" | "critical"; title: string; detail: string };
  kpis: { healthyPoints: number; totalPoints: number; alarms: number; criticalAlarms: number; warningAlarms: number; mttaMinutes: number | null; previousMttaMinutes: number | null; availabilityPercent: number | null };
  actions: Array<{ priority: ActionPriority; pointName: string; title: string; why: string }>;
  points: SiteReportPoint[];
  imbalanceChart: { pointName: string; group: string; days: string[]; series: Array<{ phase: string; values: Array<number | null> }> } | null;
  alarmsSummary: { total: number; critical: number; warning: number; mttaMinutes: number | null; unresolved: number; recurrent: Array<{ pointName: string; channel: string; count: number }> };
  availability: { percent: number | null; gaps: Array<{ pointName: string; start: string; hours: number }> };
  criteria: { imbalanceWatch: number; imbalanceAct: number; humidityLimit: number };
};

export type ReportChannel = { id: string; assetId: string; code: string; name: string; metric: string; warning: number | null; critical: number | null };
export type ReportBucket = { channelId: string; start: number; max: number | null; samples: number };
export type ReportAlarm = { assetId: string; channelId: string | null; severity: string; status: string; openedAt: number; acknowledgedAt: number | null };
export type ReportPointInput = { id: string; name: string; device: string | null };

const decimal = (value: number, digits = 1) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const round1 = (value: number) => Math.round(value * 10) / 10;

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** "Barra fase L2" → { group: "Barra fase", phase: "L2" }; sin fase reconocible, null. */
export function phaseOf(name: string): { group: string; phase: string } | null {
  const match = name.match(/\b(?:fase\s*)?L\s?([123])\b/i);
  if (!match) return null;
  const group = name.replace(match[0], "").replace(/\s+/g, " ").trim() || "Fases";
  return { group, phase: `L${match[1]}` };
}

/** Periodo cerrado anterior a `now` en la zona horaria del sitio: la semana lunes–domingo o el mes calendario. */
export function previousPeriod(kind: SiteReportKind, now: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hourCycle: "h23" })
    .formatToParts(now).map((part) => [part.type, part.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);
  // Medianoche local como instante: se corrige por la diferencia horaria del sitio en esa fecha.
  const localMidnight = (y: number, m: number, d: number) => {
    const guess = Date.UTC(y, m - 1, d);
    const shown = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day), Number(shown.hour), Number(shown.minute));
    return new Date(guess - (asUtc - guess));
  };
  if (kind === "weekly") {
    const end = localMidnight(year, month, day - weekday);
    const start = localMidnight(year, month, day - weekday - 7);
    return { start, end };
  }
  return { start: localMidnight(year, month - 1, 1), end: localMidnight(year, month, 1) };
}

export function periodLabel(kind: SiteReportKind, start: Date, end: Date, timezone: string) {
  if (kind === "monthly") {
    const text = new Intl.DateTimeFormat("es-CL", { timeZone: timezone, month: "long", year: "numeric" }).format(new Date(start.getTime() + 12 * HOUR_MS));
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const fmt = new Intl.DateTimeFormat("es-CL", { timeZone: timezone, day: "numeric", month: "short" });
  return `Semana del ${fmt.format(start)} al ${fmt.format(new Date(end.getTime() - 1))}`;
}

/** Calcula el informe con los datos ya cargados (sin base de datos: así se prueba). */
export function analyzeSiteReport(input: {
  kind: SiteReportKind;
  now: Date;
  periodStart: Date;
  periodEnd: Date;
  timezone: string;
  clientName: string;
  site: { id: string; code: string; name: string };
  points: ReportPointInput[];
  channels: ReportChannel[];
  buckets: ReportBucket[];
  alarms: ReportAlarm[];
  previousAlarms: ReportAlarm[];
}): SiteReport {
  const start = input.periodStart.getTime();
  const end = Math.min(input.periodEnd.getTime(), input.now.getTime());
  const hoursInPeriod = Math.max(1, Math.round((end - start) / HOUR_MS));
  const lastWeekStart = end - 7 * 24 * HOUR_MS;
  const previousWeekStart = lastWeekStart - 7 * 24 * HOUR_MS;
  const channelById = new Map(input.channels.map((channel) => [channel.id, channel]));
  const bucketsByChannel = new Map<string, ReportBucket[]>();
  for (const bucket of input.buckets) {
    const list = bucketsByChannel.get(bucket.channelId) ?? [];
    list.push(bucket);
    bucketsByChannel.set(bucket.channelId, list);
  }
  const inPeriod = (bucket: ReportBucket) => bucket.start >= start && bucket.start < end;
  // Se guarda en un objeto: TypeScript no sigue asignaciones a una variable hechas dentro del map().
  const chart: { best: { pointName: string; group: string; spread: number; phases: Map<string, ReportChannel> } | null } = { best: null };

  const points: SiteReportPoint[] = input.points.map((point) => {
    const own = input.channels.filter((channel) => channel.assetId === point.id);
    const temps = own.filter((channel) => channel.metric === "temperature");
    const ambient = own.filter((channel) => channel.metric === "ambient_temperature");
    const valuesOf = (channel: ReportChannel) => (bucketsByChannel.get(channel.id) ?? []).filter((bucket) => inPeriod(bucket) && bucket.max !== null);

    let tempMax: number | null = null, tempMaxChannel: string | null = null, hoursOverWarning = 0;
    for (const channel of temps) {
      for (const bucket of valuesOf(channel)) {
        if (tempMax === null || bucket.max! > tempMax) { tempMax = bucket.max; tempMaxChannel = `${channel.code} ${channel.name}`; }
        if (channel.warning !== null && bucket.max! >= channel.warning) hoursOverWarning += BUCKET_SECONDS / 3600;
      }
    }

    // Desbalance: en cada hora, diferencia entre la fase más caliente y la más fría del mismo grupo.
    const groups = new Map<string, Map<string, ReportChannel>>();
    for (const channel of temps) {
      const phase = phaseOf(channel.name);
      if (!phase) continue;
      const group = groups.get(phase.group) ?? new Map<string, ReportChannel>();
      group.set(phase.phase, channel);
      groups.set(phase.group, group);
    }
    let imbalance: number | null = null, imbalanceGroup: string | null = null, hotPhase: string | null = null, imbalanceTrendPerWeek: number | null = null;
    for (const [groupName, phases] of groups) {
      if (phases.size < 2) continue;
      const byHour = new Map<number, Array<[string, number]>>();
      for (const [phase, channel] of phases) {
        for (const bucket of bucketsByChannel.get(channel.id) ?? []) {
          if (bucket.max === null || bucket.start < previousWeekStart || bucket.start >= end) continue;
          const list = byHour.get(bucket.start) ?? [];
          list.push([phase, bucket.max]);
          byHour.set(bucket.start, list);
        }
      }
      const spreads: Array<{ at: number; spread: number; hot: string }> = [];
      for (const [at, readings] of byHour) {
        if (readings.length < 2) continue;
        const sorted = [...readings].sort((a, b) => b[1] - a[1]);
        spreads.push({ at, spread: sorted[0][1] - sorted[sorted.length - 1][1], hot: sorted[0][0] });
      }
      const current = spreads.filter((item) => item.at >= start);
      const p95 = percentile(current.map((item) => item.spread), 0.95);
      if (p95 === null || (imbalance !== null && p95 <= imbalance)) continue;
      imbalance = round1(p95);
      imbalanceGroup = groupName;
      const hotCounts = new Map<string, number>();
      for (const item of current) hotCounts.set(item.hot, (hotCounts.get(item.hot) ?? 0) + 1);
      hotPhase = [...hotCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const lastWeek = average(spreads.filter((item) => item.at >= lastWeekStart).map((item) => item.spread));
      const weekBefore = average(spreads.filter((item) => item.at >= previousWeekStart && item.at < lastWeekStart).map((item) => item.spread));
      imbalanceTrendPerWeek = lastWeek !== null && weekBefore !== null ? round1(lastWeek - weekBefore) : null;
      if (!chart.best || p95 > chart.best.spread) chart.best = { pointName: point.name, group: groupName, spread: p95, phases };
    }

    // Temperatura sobre el ambiente: la más caliente de la celda menos el ambiente de la misma hora.
    let riseOverAmbient: number | null = null;
    if (ambient.length) {
      const ambientByHour = new Map<number, number>();
      for (const channel of ambient) for (const bucket of valuesOf(channel)) ambientByHour.set(bucket.start, Math.max(ambientByHour.get(bucket.start) ?? -Infinity, bucket.max!));
      const hottestByHour = new Map<number, number>();
      for (const channel of temps) for (const bucket of valuesOf(channel)) hottestByHour.set(bucket.start, Math.max(hottestByHour.get(bucket.start) ?? -Infinity, bucket.max!));
      for (const [at, hot] of hottestByHour) {
        const amb = ambientByHour.get(at);
        if (amb === undefined) continue;
        if (riseOverAmbient === null || hot - amb > riseOverAmbient) riseOverAmbient = round1(hot - amb);
      }
    }

    const eventsOver = (metric: string) => own.filter((channel) => channel.metric === metric && channel.warning !== null)
      .reduce((sum, channel) => sum + valuesOf(channel).filter((bucket) => bucket.max! >= channel.warning!).length, 0);
    const uhfValues = own.filter((channel) => channel.metric === "partial_discharge" || channel.metric === "surface_discharge").flatMap((channel) => valuesOf(channel).map((bucket) => bucket.max!));
    const humidityHours = own.filter((channel) => channel.metric === "humidity").reduce((max, channel) => Math.max(max, valuesOf(channel).filter((bucket) => bucket.max! >= HUMIDITY_LIMIT).length), 0);

    // Disponibilidad: horas con al menos una lectura de cualquier canal del punto.
    const covered = new Set<number>();
    for (const channel of own) for (const bucket of bucketsByChannel.get(channel.id) ?? []) if (inPeriod(bucket) && bucket.samples > 0) covered.add(bucket.start);
    const firstHour = Math.ceil(start / HOUR_MS) * HOUR_MS;
    let longestGap: { start: string; hours: number } | null = null, runStart: number | null = null;
    for (let at = firstHour; at < end; at += HOUR_MS) {
      if (!covered.has(at)) { runStart ??= at; continue; }
      if (runStart !== null) {
        const hours = (at - runStart) / HOUR_MS;
        if (!longestGap || hours > longestGap.hours) longestGap = { start: new Date(runStart).toISOString(), hours };
        runStart = null;
      }
    }
    if (!own.length) longestGap = null; // sin canales no hay "corte": se informa como punto sin configurar
    else if (runStart !== null) {
      const hours = Math.round((end - runStart) / HOUR_MS);
      if (!longestGap || hours > longestGap.hours) longestGap = { start: new Date(runStart).toISOString(), hours };
    }
    const availabilityPercent = own.length ? round1(Math.min(100, covered.size / hoursInPeriod * 100)) : null;

    const pointAlarms = input.alarms.filter((alarm) => alarm.assetId === point.id);
    const criticalAlarms = pointAlarms.filter((alarm) => alarm.severity === "critical").length;

    // Estado del punto con reglas explicables.
    const reasons: string[] = [];
    let health: PointHealth = "good";
    const escalate = (level: PointHealth, reason: string) => {
      reasons.push(reason);
      if (level === "action" || (level === "watch" && health === "good")) health = level;
    };
    if (imbalance !== null && imbalance >= IMBALANCE_ACT_C) escalate("action", `Desbalance entre fases de ${decimal(imbalance)} °C`);
    else if (imbalance !== null && imbalance >= IMBALANCE_WATCH_C && (imbalanceTrendPerWeek ?? 0) >= IMBALANCE_RISING_C_PER_WEEK) escalate("action", `Desbalance de ${decimal(imbalance)} °C en aumento`);
    else if (imbalance !== null && imbalance >= IMBALANCE_WATCH_C) escalate("watch", `Desbalance entre fases de ${decimal(imbalance)} °C`);
    if (criticalAlarms) escalate("action", `${criticalAlarms} ${criticalAlarms === 1 ? "alarma crítica" : "alarmas críticas"}`);
    if (hoursOverWarning > 0) escalate("watch", `${hoursOverWarning} h sobre el umbral de advertencia`);
    const sdEvents = eventsOver("surface_discharge"), pdEvents = eventsOver("partial_discharge");
    if (pdEvents + sdEvents > 0) escalate("watch", `${pdEvents + sdEvents} h con descarga sobre umbral`);
    if (humidityHours >= 24) escalate("watch", `${humidityHours} h con humedad sobre ${HUMIDITY_LIMIT} %`);
    if (!own.length) escalate("watch", "Sin canales configurados");
    else if (availabilityPercent === 0) escalate("watch", "Sin datos en el periodo");
    else if (availabilityPercent !== null && availabilityPercent < 95) escalate("watch", `Datos disponibles ${decimal(availabilityPercent)} %`);

    return {
      id: point.id, name: point.name, device: point.device, health, reasons,
      tempMax: tempMax === null ? null : round1(tempMax), tempMaxChannel, hoursOverWarning,
      imbalance, imbalanceGroup, hotPhase, imbalanceTrendPerWeek, riseOverAmbient,
      uhfMax: uhfValues.length ? round1(Math.max(...uhfValues)) : null,
      pdEvents, sdEvents, humidityHours,
      alarms: pointAlarms.length, criticalAlarms, availabilityPercent, longestGap,
    };
  });

  // Acciones: primero lo que pide actuar, luego lo que conviene revisar en la próxima visita.
  const actions: SiteReport["actions"] = [];
  for (const point of points) {
    if (point.imbalance !== null && point.imbalance >= IMBALANCE_WATCH_C) {
      const rising = (point.imbalanceTrendPerWeek ?? 0) >= IMBALANCE_RISING_C_PER_WEEK;
      const act = point.imbalance >= IMBALANCE_ACT_C || rising;
      actions.push({
        priority: act ? "now" : "watch",
        pointName: point.name,
        title: act ? `Inspeccionar y reapretar la conexión${point.hotPhase ? ` de la fase ${point.hotPhase}` : ""}` : `Observar el desbalance entre fases${point.hotPhase ? ` (fase ${point.hotPhase} más caliente)` : ""}`,
        why: `${point.hotPhase ? `La fase ${point.hotPhase}` : "Una fase"} está ${decimal(point.imbalance)} °C sobre las otras${point.imbalanceGroup ? ` en ${point.imbalanceGroup.toLowerCase()}` : ""}${point.imbalanceTrendPerWeek !== null ? ` y ${point.imbalanceTrendPerWeek >= 0 ? "subió" : "bajó"} ${decimal(Math.abs(point.imbalanceTrendPerWeek))} °C respecto de la semana anterior` : ""}. ${act ? "Programar termografía y reapriete en la próxima ventana de mantenimiento." : "Con la misma carga suele indicar una conexión que empieza a soltarse."}`,
      });
    }
    if (point.criticalAlarms && !(point.imbalance !== null && point.imbalance >= IMBALANCE_WATCH_C)) {
      actions.push({ priority: "now", pointName: point.name, title: "Revisar las alarmas críticas del periodo", why: `${point.criticalAlarms} ${point.criticalAlarms === 1 ? "alarma crítica" : "alarmas críticas"}. Ver el detalle y las notas de cierre en el centro de alertas.` });
    }
    if (point.sdEvents > 0 && point.humidityHours > 0) {
      actions.push({ priority: "next", pointName: point.name, title: "Revisar la limpieza del aislamiento y la calefacción de la cabina", why: `${point.sdEvents} h con descarga superficial sobre umbral y ${point.humidityHours} h con humedad sobre ${HUMIDITY_LIMIT} %: sugiere contaminación del aislamiento más que una falla interna.` });
    } else if (point.pdEvents > 0) {
      actions.push({ priority: "next", pointName: point.name, title: "Evaluar la descarga parcial", why: `${point.pdEvents} h con descarga parcial sobre umbral. Comparar con la próxima medición y, si persiste, coordinar un ensayo de descargas parciales.` });
    } else if (point.humidityHours >= 24) {
      actions.push({ priority: "next", pointName: point.name, title: "Verificar la calefacción anticondensación", why: `${point.humidityHours} h con humedad sobre ${HUMIDITY_LIMIT} % en la cabina.` });
    }
    if (point.availabilityPercent === 0) {
      actions.push({ priority: "watch", pointName: point.name, title: "Revisar por qué el punto no envía datos", why: "No se recibieron lecturas en todo el periodo. Revisar la conexión del controlador y su configuración en la puesta en marcha." });
    } else if (point.availabilityPercent !== null && point.availabilityPercent < 95 && point.longestGap) {
      actions.push({ priority: "watch", pointName: point.name, title: "Revisar la comunicación con el controlador", why: `Datos disponibles ${decimal(point.availabilityPercent)} %; el corte más largo fue de ${point.longestGap.hours} h. Revisar cable, conectores y alimentación del CAM-5.` });
    }
  }
  const order: Record<ActionPriority, number> = { now: 0, next: 1, watch: 2 };
  actions.sort((a, b) => order[a.priority] - order[b.priority]);

  // Gráfico de las fases del punto con mayor desbalance: máximo diario por fase.
  let imbalanceChart: SiteReport["imbalanceChart"] = null;
  const chartCandidate = chart.best;
  if (chartCandidate) {
    const dayMs = 24 * HOUR_MS;
    const days: number[] = [];
    for (let at = start; at < end; at += dayMs) days.push(at);
    imbalanceChart = {
      pointName: chartCandidate.pointName,
      group: chartCandidate.group,
      days: days.map((day) => new Date(day).toISOString()),
      series: [...chartCandidate.phases.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([phase, channel]) => ({
        phase,
        values: days.map((day) => {
          const values = (bucketsByChannel.get(channel.id) ?? []).filter((bucket) => bucket.max !== null && bucket.start >= day && bucket.start < day + dayMs).map((bucket) => bucket.max!);
          return values.length ? round1(Math.max(...values)) : null;
        }),
      })),
    };
  }

  const mtta = (list: ReportAlarm[]) => {
    const waits = list.filter((alarm) => alarm.acknowledgedAt !== null).map((alarm) => (alarm.acknowledgedAt! - alarm.openedAt) / 60_000);
    return waits.length ? Math.round(average(waits)!) : null;
  };
  const recurrentCounts = new Map<string, { pointName: string; channel: string; count: number }>();
  for (const alarm of input.alarms) {
    if (!alarm.channelId) continue;
    const channel = channelById.get(alarm.channelId);
    const point = points.find((item) => item.id === alarm.assetId);
    if (!channel || !point) continue;
    const key = alarm.channelId;
    const entry = recurrentCounts.get(key) ?? { pointName: point.name, channel: `${channel.code} ${channel.name}`, count: 0 };
    entry.count += 1;
    recurrentCounts.set(key, entry);
  }
  const alarmsSummary = {
    total: input.alarms.length,
    critical: input.alarms.filter((alarm) => alarm.severity === "critical").length,
    warning: input.alarms.filter((alarm) => alarm.severity === "warning").length,
    mttaMinutes: mtta(input.alarms),
    unresolved: input.alarms.filter((alarm) => alarm.status === "open" || alarm.status === "acknowledged").length,
    recurrent: [...recurrentCounts.values()].filter((item) => item.count >= 3).sort((a, b) => b.count - a.count),
  };

  const measured = points.filter((point) => point.availabilityPercent !== null);
  const availabilityPercent = measured.length ? round1(average(measured.map((point) => point.availabilityPercent!))!) : null;
  const gaps = points.filter((point) => point.longestGap && point.longestGap.hours >= 1).map((point) => ({ pointName: point.name, ...point.longestGap! })).sort((a, b) => b.hours - a.hours);

  const needAction = points.filter((point) => point.health === "action");
  const watch = points.filter((point) => point.health === "watch");
  const healthy = points.filter((point) => point.health === "good").length;
  const conclusion: SiteReport["conclusion"] = needAction.length
    ? { tone: "critical", title: needAction.length === 1 ? `1 equipo requiere acción: ${needAction[0].name}.` : `${needAction.length} equipos requieren acción.`, detail: `${actions[0]?.title ?? "Revisar los hallazgos"}. ${healthy} de ${points.length} puntos operaron dentro de sus umbrales.` }
    : watch.length
      ? { tone: "warning", title: watch.length === 1 ? `1 punto en observación: ${watch[0].name}.` : `${watch.length} puntos en observación.`, detail: `Sin acciones urgentes. ${healthy} de ${points.length} puntos operaron dentro de sus umbrales.` }
      : { tone: "normal", title: points.length ? "Todos los puntos operaron con normalidad." : "El sitio no tiene puntos de medición activos.", detail: availabilityPercent !== null ? `El monitoreo estuvo disponible el ${decimal(availabilityPercent)} % del tiempo.` : "Sin datos de disponibilidad en el periodo." };

  return {
    version: 1,
    kind: input.kind,
    generatedAt: input.now.toISOString(),
    period: { start: input.periodStart.toISOString(), end: input.periodEnd.toISOString(), label: periodLabel(input.kind, input.periodStart, input.periodEnd, input.timezone) },
    timezone: input.timezone,
    client: { name: input.clientName },
    site: input.site,
    conclusion,
    kpis: { healthyPoints: healthy, totalPoints: points.length, alarms: alarmsSummary.total, criticalAlarms: alarmsSummary.critical, warningAlarms: alarmsSummary.warning, mttaMinutes: alarmsSummary.mttaMinutes, previousMttaMinutes: mtta(input.previousAlarms), availabilityPercent },
    actions,
    points: [...points].sort((a, b) => ({ action: 0, watch: 1, good: 2 }[a.health] - { action: 0, watch: 1, good: 2 }[b.health]) || a.name.localeCompare(b.name)),
    imbalanceChart,
    alarmsSummary,
    availability: { percent: availabilityPercent, gaps },
    criteria: { imbalanceWatch: IMBALANCE_WATCH_C, imbalanceAct: IMBALANCE_ACT_C, humidityLimit: HUMIDITY_LIMIT },
  };
}

const num = (value: string | null) => value === null ? null : Number(value);

/** Carga los datos del sitio y calcula el informe del periodo. */
export async function buildSiteReport(db: Cam5Executor, input: { siteId: string; kind: SiteReportKind; periodStart: Date; periodEnd: Date; now?: Date; allowedAssetIds?: string[] }): Promise<SiteReport> {
  const now = input.now ?? new Date();
  const [site] = await db.select({ id: sites.id, code: sites.code, name: sites.name, timezone: sites.timezone, clientName: clients.name })
    .from(sites).innerJoin(clients, eq(clients.id, sites.clientId)).where(eq(sites.id, input.siteId)).limit(1);
  if (!site) throw new Error("El sitio no existe.");
  const scope = input.allowedAssetIds?.length ? inArray(assets.id, input.allowedAssetIds) : undefined;
  const pointRows = await db.select({ id: assets.id, name: assets.name, device: devices.code })
    .from(assets).leftJoin(devices, and(eq(devices.assetId, assets.id), eq(devices.active, true)))
    .where(and(eq(assets.siteId, site.id), eq(assets.active, true), scope)).orderBy(asc(assets.name));
  const points = [...new Map(pointRows.map((row) => [row.id, row])).values()];
  const pointIds = points.map((point) => point.id);
  const loadFrom = new Date(input.periodStart.getTime() - 7 * 24 * HOUR_MS);
  const previousStart = new Date(input.periodStart.getTime() - (input.periodEnd.getTime() - input.periodStart.getTime()));
  const [channelRows, bucketRows, alarmRows, previousAlarmRows] = pointIds.length ? await Promise.all([
    db.select({ id: channels.id, assetId: channels.assetId, code: channels.code, name: channels.name, metric: channels.metric, warning: alarmRules.warningThreshold, critical: alarmRules.criticalThreshold })
      .from(channels).leftJoin(alarmRules, and(eq(alarmRules.channelId, channels.id), eq(alarmRules.enabled, true)))
      .where(and(inArray(channels.assetId, pointIds), eq(channels.enabled, true))),
    db.select({ channelId: readingAggregates.channelId, start: readingAggregates.bucketStart, max: readingAggregates.maximumValue, samples: readingAggregates.sampleCount })
      .from(readingAggregates).innerJoin(channels, eq(channels.id, readingAggregates.channelId))
      .where(and(inArray(channels.assetId, pointIds), eq(channels.enabled, true), eq(readingAggregates.bucketSeconds, BUCKET_SECONDS), gte(readingAggregates.bucketStart, loadFrom), lt(readingAggregates.bucketStart, input.periodEnd))),
    db.select({ assetId: alarms.assetId, channelId: alarms.channelId, severity: alarms.severity, status: alarms.status, openedAt: alarms.openedAt, acknowledgedAt: alarms.acknowledgedAt })
      .from(alarms).where(and(eq(alarms.siteId, site.id), inArray(alarms.assetId, pointIds), gte(alarms.openedAt, input.periodStart), lt(alarms.openedAt, input.periodEnd))),
    db.select({ assetId: alarms.assetId, channelId: alarms.channelId, severity: alarms.severity, status: alarms.status, openedAt: alarms.openedAt, acknowledgedAt: alarms.acknowledgedAt })
      .from(alarms).where(and(eq(alarms.siteId, site.id), inArray(alarms.assetId, pointIds), gte(alarms.openedAt, previousStart), lt(alarms.openedAt, input.periodStart))),
  ]) : [[], [], [], []];
  const toAlarm = (row: (typeof alarmRows)[number]): ReportAlarm => ({ assetId: row.assetId, channelId: row.channelId, severity: row.severity, status: row.status, openedAt: row.openedAt.getTime(), acknowledgedAt: row.acknowledgedAt?.getTime() ?? null });
  return analyzeSiteReport({
    kind: input.kind, now, periodStart: input.periodStart, periodEnd: input.periodEnd, timezone: site.timezone, clientName: site.clientName,
    site: { id: site.id, code: site.code, name: site.name },
    points: points.map((point) => ({ id: point.id, name: point.name, device: point.device })),
    channels: [...new Map(channelRows.map((row) => [row.id, { ...row, warning: num(row.warning), critical: num(row.critical) }])).values()],
    buckets: bucketRows.map((row) => ({ channelId: row.channelId, start: row.start.getTime(), max: num(row.max), samples: row.samples })),
    alarms: alarmRows.map(toAlarm),
    previousAlarms: previousAlarmRows.map(toAlarm),
  });
}
