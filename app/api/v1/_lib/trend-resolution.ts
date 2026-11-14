import { ApiError } from "./auth";
import { DEFAULT_AGGREGATE_RETENTION_DAYS, DEFAULT_RAW_RETENTION_DAYS, resolutionCovers, type RetentionDays } from "../../../../db/aggregate-retention";

const AUTO_ORDER = ["raw", "60", "300", "3600", "86400"] as const;

export const TREND_RESOLUTIONS = ["auto", "raw", "60", "300", "3600", "86400"] as const;
export type RequestedTrendResolution = typeof TREND_RESOLUTIONS[number];

const RESOLUTION_LABELS: Record<Exclude<RequestedTrendResolution, "auto">, string> = {
  raw: "Datos crudos",
  "60": "1 minuto",
  "300": "5 minutos",
  "3600": "1 hora",
  "86400": "1 día",
};

export function resolveTrendResolution(
  from: Date,
  to: Date,
  requested: RequestedTrendResolution,
  retention: RetentionDays = { rawDays: DEFAULT_RAW_RETENTION_DAYS, aggregateDays: DEFAULT_AGGREGATE_RETENTION_DAYS },
  now = new Date(),
) {
  const rangeSeconds = (to.getTime() - from.getTime()) / 1000;
  let value: Exclude<RequestedTrendResolution, "auto"> = requested === "auto"
    ? rangeSeconds <= 2 * 3600 ? "raw"
      : rangeSeconds <= 7 * 86400 ? "60"
        : rangeSeconds <= 90 * 86400 ? "300"
          : rangeSeconds <= 2 * 365 * 86400 ? "3600"
            : "86400"
    : requested;
  // En automático, si el detalle elegido ya se borró por retención, se sube a una resolución mayor.
  if (requested === "auto") {
    for (let index = AUTO_ORDER.indexOf(value); index < AUTO_ORDER.length - 1; index++) {
      if (resolutionCovers(value === "raw" ? 0 : Number(value), from, retention, now)) break;
      value = AUTO_ORDER[index + 1];
    }
  }
  const maximumRange: Record<Exclude<RequestedTrendResolution, "auto">, number> = {
    raw: 2 * 3600,
    "60": 7 * 86400,
    "300": 90 * 86400,
    "3600": 2 * 365 * 86400,
    "86400": 5 * 365 * 86400,
  };
  if (rangeSeconds > maximumRange[value]) throw new ApiError(400, `La resolución ${RESOLUTION_LABELS[value].toLowerCase()} no admite un periodo tan extenso.`);
  return { key: value, bucketSeconds: value === "raw" ? 0 : Number(value), label: RESOLUTION_LABELS[value] };
}

/**
 * Solo la ventana más reciente se calcula desde lecturas crudas; lo anterior sale de
 * reading_aggregates. Debe ser menor que la retención cruda más corta (raw_retention_days),
 * o el tramo intermedio quedaría sin datos.
 */
export const RAW_TREND_WINDOW_MS = 24 * 3600 * 1000;

/** Corte entre agregados y lecturas crudas, alineado al bucket para no duplicar el punto del borde. */
export function trendRawCutoff(now: Date, bucketSeconds: number) {
  const bucketMs = Math.max(1, bucketSeconds) * 1000;
  return new Date(Math.floor((now.getTime() - RAW_TREND_WINDOW_MS) / bucketMs) * bucketMs);
}

export function inferTrendStepSeconds(
  series: Array<{ points: Array<{ timestamp: string }> }>,
  bucketSeconds: number,
  fallbackSeconds = 300,
) {
  if (bucketSeconds > 0) return bucketSeconds;
  const deltas = series.flatMap(({ points }) => points.slice(1).map((point, index) =>
    new Date(point.timestamp).getTime() - new Date(points[index].timestamp).getTime(),
  )).filter((delta) => Number.isFinite(delta) && delta > 0).sort((a, b) => a - b);
  if (!deltas.length) return fallbackSeconds;
  const middle = Math.floor(deltas.length / 2);
  const medianMs = deltas.length % 2 ? deltas[middle] : (deltas[middle - 1] + deltas[middle]) / 2;
  return Math.max(1, Math.round(medianMs / 1000));
}
