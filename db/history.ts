import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { alarmRules, channels, devices, readingProfiles, userChannelPreferences } from "./schema";

/** Resoluciones del histórico de mediciones: por envío del gateway o promedios guardados. */
export const HISTORY_RESOLUTIONS = ["auto", "raw", "300", "3600", "86400"] as const;
export type HistoryResolutionRequest = typeof HISTORY_RESOLUTIONS[number];
export type HistoryResolution = { key: Exclude<HistoryResolutionRequest, "auto">; bucketSeconds: number; label: string };

export const HISTORY_CHANNEL_GROUPS = ["visible", "all", "temperature", "discharge", "environment"] as const;
export type HistoryChannelGroup = typeof HISTORY_CHANNEL_GROUPS[number];

const RESOLUTION_LABELS: Record<HistoryResolution["key"], string> = {
  raw: "Por envío",
  "300": "Promedio 5 min",
  "3600": "Promedio 1 hora",
  "86400": "Promedio 1 día",
};

/** Rango máximo por resolución, para que una consulta no recorra millones de lecturas. */
export const HISTORY_MAX_RANGE_DAYS: Record<HistoryResolution["key"], number> = { raw: 31, "300": 92, "3600": 731, "86400": 1830 };

const GROUP_METRICS: Record<Exclude<HistoryChannelGroup, "visible" | "all">, string[]> = {
  temperature: ["temperature", "ambient_temperature"],
  discharge: ["partial_discharge", "surface_discharge", "noise", "event_count", "alpha", "beta", "phi"],
  environment: ["ambient_temperature", "humidity"],
};

export function resolveHistoryResolution(from: Date, to: Date, requested: HistoryResolutionRequest, rawRetentionDays: number, now = new Date()): HistoryResolution {
  const rangeDays = (to.getTime() - from.getTime()) / 86_400_000;
  const rawAvailableSince = now.getTime() - rawRetentionDays * 86_400_000;
  const key: HistoryResolution["key"] = requested !== "auto"
    ? requested
    : from.getTime() >= rawAvailableSince && rangeDays <= 7 ? "raw"
      : rangeDays <= 7 ? "300"
        : rangeDays <= 92 ? "3600"
          : "86400";
  if (rangeDays > HISTORY_MAX_RANGE_DAYS[key]) {
    throw new HistoryRangeError(`${RESOLUTION_LABELS[key]} admite como máximo ${HISTORY_MAX_RANGE_DAYS[key]} días. Elige un periodo más corto o una resolución mayor.`);
  }
  return { key, bucketSeconds: key === "raw" ? 0 : Number(key), label: RESOLUTION_LABELS[key] };
}

export class HistoryRangeError extends Error {}

export type HistoryColumn = {
  id: string;
  code: string;
  name: string;
  zone: string | null;
  unit: string;
  metric: string;
  warning: number | null;
  critical: number | null;
  visible: boolean;
};

export async function listHistoryColumns(db: Cam5Database, assetId: string, userId: string, group: HistoryChannelGroup): Promise<HistoryColumn[]> {
  const rows = await db.select({
    id: channels.id,
    code: channels.code,
    name: channels.name,
    zone: channels.zone,
    unit: channels.unit,
    metric: channels.metric,
    warning: alarmRules.warningThreshold,
    critical: alarmRules.criticalThreshold,
    visible: userChannelPreferences.visible,
  }).from(channels)
    .leftJoin(alarmRules, eq(alarmRules.channelId, channels.id))
    .leftJoin(userChannelPreferences, and(eq(userChannelPreferences.channelId, channels.id), eq(userChannelPreferences.userId, userId)))
    .where(and(eq(channels.assetId, assetId), eq(channels.enabled, true)))
    .orderBy(asc(channels.displayOrder), asc(channels.code));
  const columns = rows.map((row) => ({
    ...row,
    metric: String(row.metric),
    warning: row.warning === null ? null : Number(row.warning),
    critical: row.critical === null ? null : Number(row.critical),
    visible: row.visible ?? true,
  }));
  if (group === "all") return columns;
  if (group === "visible") return columns.filter((column) => column.visible);
  return columns.filter((column) => GROUP_METRICS[group].includes(column.metric));
}

export async function historyRetention(db: Cam5Database, assetId: string) {
  const [profile] = await db.select({ rawDays: readingProfiles.rawRetentionDays, aggregateDays: readingProfiles.aggregateRetentionDays })
    .from(devices)
    .innerJoin(readingProfiles, eq(readingProfiles.id, devices.readingProfileId))
    .where(and(eq(devices.assetId, assetId), eq(devices.active, true)))
    .limit(1);
  return { rawDays: profile?.rawDays ?? 7, aggregateDays: profile?.aggregateDays ?? 1825 };
}

export type HistoryCell = {
  value: number | null;
  raw?: number | null;
  quality?: "good" | "stale" | "bad";
  flags?: string[];
  sequence?: number | null;
  minimum?: number | null;
  maximum?: number | null;
  samples?: number;
  invalid?: number;
};

export type HistoryRow = {
  key: string;
  recordedAt: string;
  receivedAt: string | null;
  latencyMs: number | null;
  success: boolean | null;
  cells: Record<string, HistoryCell>;
};

type QueryRows = Array<Record<string, unknown>>;

async function run(db: Cam5Database, query: SQL): Promise<QueryRows> {
  const result = await db.execute(query) as unknown;
  if (Array.isArray(result)) return result as QueryRows;
  return ((result as { rows?: QueryRows }).rows ?? []);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let date: Date;
  if (value instanceof Date) date = value;
  else {
    // Postgres puede entregar "2026-11-11 10:01:00.123+00": se normaliza a ISO 8601.
    let text = String(value).trim().replace(" ", "T");
    if (/[+-]\d{2}$/.test(text)) text += ":00";
    else if (!/(Z|[+-]\d{2}:?\d{2})$/.test(text)) text += "Z";
    date = new Date(text);
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cellsJson(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  if (typeof value === "string") return JSON.parse(value) as Array<Record<string, unknown>>;
  return [];
}

/**
 * Filas del histórico: una por envío del gateway (lecturas del mismo lote) o una por intervalo
 * de agregación. Las lecturas antiguas sin lote se agrupan por su instante de medición.
 */
export async function listHistoryRows(
  db: Cam5Database,
  options: { channelIds: string[]; from: Date; to: Date; resolution: HistoryResolution; limit: number; offset: number },
): Promise<{ rows: HistoryRow[]; total: number }> {
  const { channelIds, from, to, resolution, limit, offset } = options;
  if (!channelIds.length) return { rows: [], total: 0 };
  const ids = sql.join(channelIds.map((id) => sql`${id}::uuid`), sql`, `);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  if (resolution.key === "raw") {
    const rowKey = sql`coalesce(r.batch_id::text, 'ts:' || to_char(r.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS'))`;
    const where = sql`r.channel_id in (${ids}) and r.recorded_at >= ${fromIso}::timestamptz and r.recorded_at <= ${toIso}::timestamptz`;
    const [rows, totals] = await Promise.all([
      run(db, sql`
        select ${rowKey} as row_key,
               min(r.recorded_at) as recorded_at,
               max(r.received_at) as received_at,
               max(b.latency_ms) as latency_ms,
               bool_and(coalesce(b.success, true)) as success,
               json_agg(json_build_object('channelId', r.channel_id, 'value', r.value, 'raw', r.raw_value, 'quality', r.quality, 'flags', r.quality_flags, 'sequence', r.sequence)) as cells
        from readings r
        left join ingestion_batches b on b.id = r.batch_id
        where ${where}
        group by 1
        order by min(r.recorded_at) desc, 1 desc
        limit ${limit} offset ${offset}`),
      run(db, sql`select count(*)::int as total from (select 1 from readings r where ${where} group by ${rowKey}) grouped`),
    ]);
    return {
      total: Number(totals[0]?.total ?? 0),
      rows: rows.map((row) => ({
        key: String(row.row_key),
        recordedAt: iso(row.recorded_at) ?? "",
        receivedAt: iso(row.received_at),
        latencyMs: numberOrNull(row.latency_ms),
        success: row.success === null || row.success === undefined ? null : Boolean(row.success),
        cells: Object.fromEntries(cellsJson(row.cells).map((cell) => [String(cell.channelId), {
          value: numberOrNull(cell.value),
          raw: numberOrNull(cell.raw),
          quality: cell.quality as HistoryCell["quality"],
          flags: Array.isArray(cell.flags) ? cell.flags as string[] : [],
          sequence: numberOrNull(cell.sequence),
        }])),
      })),
    };
  }

  const where = sql`a.channel_id in (${ids}) and a.bucket_seconds = ${resolution.bucketSeconds} and a.bucket_start >= ${fromIso}::timestamptz and a.bucket_start <= ${toIso}::timestamptz`;
  const [rows, totals] = await Promise.all([
    run(db, sql`
      select a.bucket_start as recorded_at,
             json_agg(json_build_object('channelId', a.channel_id, 'value', a.average_value, 'minimum', a.minimum_value, 'maximum', a.maximum_value, 'samples', a.sample_count, 'invalid', a.invalid_sample_count)) as cells
      from reading_aggregates a
      where ${where}
      group by a.bucket_start
      order by a.bucket_start desc
      limit ${limit} offset ${offset}`),
    run(db, sql`select count(distinct a.bucket_start)::int as total from reading_aggregates a where ${where}`),
  ]);
  return {
    total: Number(totals[0]?.total ?? 0),
    rows: rows.map((row) => {
      const recordedAt = iso(row.recorded_at) ?? "";
      return {
        key: `bucket:${recordedAt}`,
        recordedAt,
        receivedAt: null,
        latencyMs: null,
        success: null,
        cells: Object.fromEntries(cellsJson(row.cells).map((cell) => [String(cell.channelId), {
          value: numberOrNull(cell.value),
          minimum: numberOrNull(cell.minimum),
          maximum: numberOrNull(cell.maximum),
          samples: numberOrNull(cell.samples) ?? 0,
          invalid: numberOrNull(cell.invalid) ?? 0,
        }])),
      };
    }),
  };
}

const QUALITY_LABELS: Record<NonNullable<HistoryCell["quality"]>, string> = { good: "válida", stale: "atrasada", bad: "inválida" };

/** CSV ancho: una fila por envío (o intervalo) y una columna por canal. */
export function historyCsvRows(columns: HistoryColumn[], rows: HistoryRow[], resolution: HistoryResolution): unknown[][] {
  const valueHeaders = columns.map((column) => `${column.code} ${resolution.key === "raw" ? "" : "promedio "}(${column.unit})`.replace("  ", " "));
  const header = ["fecha_utc", ...valueHeaders, resolution.key === "raw" ? "observaciones_calidad" : "muestras_invalidas"];
  return [header, ...rows.map((row) => {
    const notes = resolution.key === "raw"
      ? columns.flatMap((column) => { const cell = row.cells[column.id]; return cell?.quality && cell.quality !== "good" ? [`${column.code}: ${QUALITY_LABELS[cell.quality]}`] : []; }).join("; ")
      : columns.reduce((sum, column) => sum + (row.cells[column.id]?.invalid ?? 0), 0);
    return [row.recordedAt, ...columns.map((column) => row.cells[column.id]?.value ?? ""), notes];
  })];
}
