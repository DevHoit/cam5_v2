import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { Cam5Database } from "./index";
import type { EffectivePointConfig } from "./point-types";
import { channels, readingAggregates } from "./schema";

/**
 * Historia de 24 h de un punto para la vista del sitio: la curva de su magnitud principal (con la
 * misma regla que define el punto, p. ej. el peor sensor), cuánto tiempo estuvo fuera del rango
 * objetivo y si el valor sube o baja. Para tableros, además, la demanda máxima y la energía del día.
 * Lee los agregados de 5 min que ya calcula el cron de tendencias.
 */

export const HISTORY_BUCKET_SECONDS = 300;
export const HISTORY_HOURS = 24;
const TREND_BUCKETS = 3;

export type PointHistory = {
  bucketSeconds: number;
  from: string;
  values: Array<number | null>;
  min: number | null;
  max: number | null;
  /** Porcentaje del tiempo con datos en que el punto estuvo dentro del rango (null si no tiene rango). */
  inRangePct: number | null;
  excursions: number;
  outMinutes: number;
  /** Inicio de la excursión en curso, si el punto está fuera de rango ahora. */
  outSince: string | null;
  /** Cambio del valor en los últimos 15 min. */
  trend: number | null;
};

export type EnergyToday = { kwh: number | null; peakKw: number | null; peakAt: string | null };

type Bucket = { channelId: string; start: Date; avg: number | null; min: number | null; max: number | null; first: number | null; last: number | null };

function numberOrNull(value: string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function loadBuckets(db: Cam5Database, channelIds: string[], from: Date, bucketSeconds = HISTORY_BUCKET_SECONDS) {
  if (!channelIds.length) return [] as Bucket[];
  const rows = await db.select({
    channelId: readingAggregates.channelId,
    start: readingAggregates.bucketStart,
    avg: readingAggregates.averageValue,
    min: readingAggregates.minimumValue,
    max: readingAggregates.maximumValue,
    first: readingAggregates.firstValue,
    last: readingAggregates.lastValue,
  }).from(readingAggregates)
    .innerJoin(channels, eq(channels.id, readingAggregates.channelId))
    .where(and(inArray(readingAggregates.channelId, channelIds), eq(readingAggregates.bucketSeconds, bucketSeconds), gte(readingAggregates.bucketStart, from)))
    .orderBy(asc(readingAggregates.bucketStart));
  return rows.map((row) => ({ channelId: row.channelId, start: row.start, avg: numberOrNull(row.avg), min: numberOrNull(row.min), max: numberOrNull(row.max), first: numberOrNull(row.first), last: numberOrNull(row.last) }));
}

export function historyStart(now: Date, hours = HISTORY_HOURS, bucketSeconds = HISTORY_BUCKET_SECONDS) {
  const span = hours * 3600_000;
  return new Date(Math.floor((now.getTime() - span) / (bucketSeconds * 1000)) * bucketSeconds * 1000);
}

/** Valor de un intervalo según la regla del punto: peor sensor (máx/mín), promedio o suma de equipos. */
function combine(buckets: Bucket[], aggregation: EffectivePointConfig["aggregation"], config?: EffectivePointConfig) {
  if (!buckets.length) return null;
  // Con rango, el intervalo toma el extremo más alejado del rango (arriba o abajo), igual que el punto.
  if (config && (aggregation === "max" || aggregation === "min") && (config.rangeMin !== null || config.rangeMax !== null)) {
    const high = Math.max(...buckets.map((bucket) => bucket.max ?? bucket.avg ?? -Infinity));
    const low = Math.min(...buckets.map((bucket) => bucket.min ?? bucket.avg ?? Infinity));
    const above = config.rangeMax !== null && high > config.rangeMax ? high - config.rangeMax : 0;
    const below = config.rangeMin !== null && low < config.rangeMin ? config.rangeMin - low : 0;
    if (above || below) return above >= below ? high : low;
    return aggregation === "max" ? high : low;
  }
  if (aggregation === "max") return Math.max(...buckets.map((bucket) => bucket.max ?? bucket.avg ?? -Infinity));
  if (aggregation === "min") return Math.min(...buckets.map((bucket) => bucket.min ?? bucket.avg ?? Infinity));
  const averages = buckets.map((bucket) => bucket.avg).filter((value): value is number => value !== null);
  if (!averages.length) return null;
  if (aggregation === "sum") return averages.reduce((total, value) => total + value, 0);
  if (aggregation === "avg") return averages.reduce((total, value) => total + value, 0) / averages.length;
  return buckets.at(-1)!.last ?? buckets.at(-1)!.avg;
}

const outside = (value: number, config: EffectivePointConfig) => (config.rangeMax !== null && value > config.rangeMax) || (config.rangeMin !== null && value < config.rangeMin);

export function buildHistory(buckets: Bucket[], config: EffectivePointConfig, from: Date, now: Date, bucketSeconds = HISTORY_BUCKET_SECONDS): PointHistory {
  const size = Math.ceil((now.getTime() - from.getTime()) / (bucketSeconds * 1000));
  const grouped = new Map<number, Bucket[]>();
  for (const bucket of buckets) {
    const index = Math.floor((bucket.start.getTime() - from.getTime()) / (bucketSeconds * 1000));
    if (index < 0 || index >= size) continue;
    grouped.set(index, [...(grouped.get(index) ?? []), bucket]);
  }
  const values = Array.from({ length: size }, (_, index) => {
    const value = combine(grouped.get(index) ?? [], config.aggregation, config);
    return value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;
  });
  const present = values.filter((value): value is number => value !== null);
  const hasRange = config.rangeMin !== null || config.rangeMax !== null;
  // Un intervalo sin datos no corta ni abre una excursión: solo cuentan los intervalos medidos.
  let excursions = 0, outBuckets = 0, inside = true;
  for (const value of values) {
    if (value === null || !hasRange) continue;
    if (outside(value, config)) {
      outBuckets += 1;
      if (inside) excursions += 1;
      inside = false;
    } else inside = true;
  }
  const lastIndex = values.findLastIndex((value) => value !== null);
  let outSince: string | null = null;
  // Excursión en curso: el último intervalo medido (de los últimos intervalos) está fuera de rango.
  if (hasRange && lastIndex >= values.length - TREND_BUCKETS && outside(values[lastIndex]!, config)) {
    let start = lastIndex;
    for (let index = lastIndex - 1; index >= 0; index -= 1) {
      const value = values[index];
      if (value === null) continue;
      if (outside(value, config)) start = index; else break;
    }
    outSince = new Date(from.getTime() + start * bucketSeconds * 1000).toISOString();
  }
  const reference = lastIndex >= TREND_BUCKETS ? values.slice(0, lastIndex - TREND_BUCKETS + 1).findLast((value) => value !== null) : undefined;
  return {
    bucketSeconds,
    from: from.toISOString(),
    values,
    min: present.length ? Math.min(...present) : null,
    max: present.length ? Math.max(...present) : null,
    inRangePct: hasRange && present.length ? Math.round(((present.length - outBuckets) / present.length) * 1000) / 10 : null,
    excursions,
    outMinutes: outBuckets * bucketSeconds / 60,
    outSince,
    trend: lastIndex >= 0 && reference !== undefined && reference !== null ? Math.round((values[lastIndex]! - reference) * 100) / 100 : null,
  };
}

/** Medianoche del día en curso en la zona horaria del sitio. */
export function localMidnight(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const elapsed = ((get("hour") % 24) * 3600 + get("minute") * 60 + get("second")) * 1000;
  return new Date(now.getTime() - elapsed - now.getMilliseconds());
}

/** Energía consumida hoy (diferencia del contador) y demanda máxima de 5 min, sumando los equipos del punto. */
export function energyToday(powerBuckets: Bucket[], energyBuckets: Bucket[], midnight: Date): EnergyToday {
  const sincePower = powerBuckets.filter((bucket) => bucket.start >= midnight);
  const byStart = new Map<number, number>();
  for (const bucket of sincePower) if (bucket.avg !== null) byStart.set(bucket.start.getTime(), (byStart.get(bucket.start.getTime()) ?? 0) + bucket.avg);
  let peakKw: number | null = null, peakAt: string | null = null;
  for (const [start, value] of byStart) if (peakKw === null || value > peakKw) { peakKw = value; peakAt = new Date(start).toISOString(); }
  const perChannel = new Map<string, { first: number | null; last: number | null }>();
  for (const bucket of energyBuckets.filter((item) => item.start >= midnight)) {
    const entry = perChannel.get(bucket.channelId) ?? { first: null, last: null };
    if (entry.first === null) entry.first = bucket.first ?? bucket.min;
    entry.last = bucket.last ?? bucket.max ?? entry.last;
    perChannel.set(bucket.channelId, entry);
  }
  // Un contador que se reinicia (lectura menor) no resta consumo.
  const kwhValues = [...perChannel.values()].map((entry) => entry.first !== null && entry.last !== null ? Math.max(0, entry.last - entry.first) : null).filter((value): value is number => value !== null);
  return {
    kwh: kwhValues.length ? Math.round(kwhValues.reduce((total, value) => total + value, 0) * 10) / 10 : null,
    peakKw: peakKw === null ? null : Math.round(peakKw * 100) / 100,
    peakAt,
  };
}

export type Excursion = { start: string; end: string | null; minutes: number; peak: number; position: string | null };

/**
 * Excursiones fuera de rango en la curva del punto, con su duración, el valor más alejado y el sensor
 * que lo marcó. Un intervalo sin datos no corta la excursión. La última queda abierta si sigue fuera.
 */
export function findExcursions(values: Array<number | null>, sensors: Array<{ position: string | null; values: Array<number | null> }>, config: EffectivePointConfig, from: Date, bucketSeconds: number): Excursion[] {
  const deviation = (value: number) => config.rangeMax !== null && value > config.rangeMax ? value - config.rangeMax : config.rangeMin !== null && value < config.rangeMin ? value - config.rangeMin : 0;
  const lastIndex = values.findLastIndex((value) => value !== null);
  const runs: Array<{ start: number; end: number }> = [];
  let open: { start: number; end: number } | null = null;
  values.forEach((value, index) => {
    if (value === null) return;
    if (deviation(value) !== 0) {
      if (!open) { open = { start: index, end: index }; runs.push(open); } else open.end = index;
    } else open = null;
  });
  const time = (index: number) => new Date(from.getTime() + index * bucketSeconds * 1000).toISOString();
  return runs.map((run) => {
    let peak = 0, position: string | null = null;
    for (let index = run.start; index <= run.end; index += 1) {
      for (const sensor of sensors) {
        const value = sensor.values[index];
        if (value === null || value === undefined) continue;
        if (Math.abs(deviation(value)) > Math.abs(peak ? deviation(peak) : 0) || (!peak && deviation(value) !== 0)) { peak = value; position = sensor.position; }
      }
    }
    if (!peak) peak = values.slice(run.start, run.end + 1).filter((value): value is number => value !== null).sort((a, b) => Math.abs(deviation(b)) - Math.abs(deviation(a)))[0];
    const ongoing = run.end === lastIndex && lastIndex >= values.length - TREND_BUCKETS;
    return { start: time(run.start), end: ongoing ? null : time(run.end + 1), minutes: (run.end - run.start + 1) * bucketSeconds / 60, peak, position };
  }).reverse();
}
