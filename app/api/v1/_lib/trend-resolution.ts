import { ApiError } from "./auth";

export const TREND_RESOLUTIONS = ["auto", "raw", "60", "300", "3600", "86400"] as const;
export type RequestedTrendResolution = typeof TREND_RESOLUTIONS[number];

const RESOLUTION_LABELS: Record<Exclude<RequestedTrendResolution, "auto">, string> = {
  raw: "Datos crudos",
  "60": "1 minuto",
  "300": "5 minutos",
  "3600": "1 hora",
  "86400": "1 día",
};

export function resolveTrendResolution(from: Date, to: Date, requested: RequestedTrendResolution) {
  const rangeSeconds = (to.getTime() - from.getTime()) / 1000;
  const value = requested === "auto"
    ? rangeSeconds <= 2 * 3600 ? "raw"
      : rangeSeconds <= 7 * 86400 ? "60"
        : rangeSeconds <= 90 * 86400 ? "300"
          : rangeSeconds <= 2 * 365 * 86400 ? "3600"
            : "86400"
    : requested;
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
