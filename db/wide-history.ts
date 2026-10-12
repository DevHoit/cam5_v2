import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Cam5Database } from "./index";
import * as s from "./schema";
import { sensorCatalog, SensorError, type SensorActor } from "./sensor-installation";
import { sensorInstalled, sensorName, type HistoryCell, type WideHistory } from "./sensor-contract";

export async function wideHistory(db: Cam5Database, actor: SensorActor, params: URLSearchParams, exporting = false): Promise<WideHistory> {
  if (!actor.permissions.includes("history.read") || (exporting && !actor.permissions.includes("history.export"))) throw new SensorError(403, "No tienes permiso para consultar o exportar el histórico.");
  const from = new Date(params.get("from") ?? ""), to = new Date(params.get("to") ?? "");
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to || +to - +from > 31 * 86400000) throw new SensorError(400, "Selecciona un rango válido de hasta 31 días.");
  const mode = params.get("mode") ?? "raw";
  const seconds = ({ raw: 0, minute: 60, hour: 3600, day: 86400 } as Record<string, number>)[mode];
  const aggregation = params.get("aggregation") ?? "avg";
  if (seconds === undefined || !["avg", "min", "max", "last"].includes(aggregation)) throw new SensorError(400, "Agrupación inválida.");
  const page = Number(params.get("page") ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new SensorError(400, "Página inválida.");
  const catalog = await sensorCatalog(db, actor, params.get("assetId") ?? "");
  const deviceId = params.get("deviceId");
  const requested = params.has("columns") ? params.get("columns")!.split(",").filter(Boolean) : null;
  const eligible = catalog.filter(({ metric, device }) => metric.enabled && sensorInstalled(metric.metadata, device.metadata) && (!deviceId || device.id === deviceId));
  if (requested && (new Set(requested).size !== requested.length || requested.some((id) => !eligible.some((r) => r.metric.id === id)))) throw new SensorError(400, "Las columnas cambiaron. Actualiza la consulta.");
  const selected = requested ? requested.map((id) => eligible.find((r) => r.metric.id === id)!) : eligible;
  const columns = selected.map(({ metric, device, definition }) => ({ id: metric.id, name: sensorName(metric.name, metric.metadata), code: metric.code, unit: definition.unit, deviceId: device.id, deviceName: device.name }));
  if (!columns.length) return { columns, rows: [], hasMore: false, page, mode, aggregation };
  const conditions = and(inArray(s.metricReadings.deviceMetricId, columns.map((c) => c.id)), gte(s.metricReadings.recordedAt, from), lte(s.metricReadings.recordedAt, to));
  const time = seconds ? sql<Date>`date_bin(make_interval(secs => ${sql.raw(String(seconds))}), ${s.metricReadings.recordedAt}, '1970-01-01 00:00:00+00'::timestamptz)` : s.metricReadings.recordedAt;
  const batch = seconds ? sql<string>`'bucket'` : s.metricReadings.batchId;
  const value = sql`coalesce(to_jsonb(${s.metricReadings.valueNumeric}::double precision), to_jsonb(${s.metricReadings.valueBoolean}), to_jsonb(${s.metricReadings.valueText}), 'null'::jsonb)`;
  // Aggregate each metric first, then pivot complete equipment/time rows before pagination.
  const aggregate = aggregation === "last"
    ? sql`(array_agg(${value} order by ${s.metricReadings.recordedAt} desc, ${s.metricReadings.id} desc) filter (where ${s.metricReadings.quality} = 'good'))[1]`
    : sql`coalesce(to_jsonb(${sql.raw(aggregation)}(${s.metricReadings.valueNumeric}) filter (where ${s.metricReadings.quality} = 'good')), (array_agg(${value} order by ${s.metricReadings.recordedAt} desc, ${s.metricReadings.id} desc) filter (where ${s.metricReadings.quality} = 'good'))[1])`;
  const cells = db.select({
    deviceId: s.deviceMetrics.deviceId,
    metricId: s.metricReadings.deviceMetricId,
    at: sql<Date>`${time}`.as("at"), batch: sql<string>`${batch}`.as("batch"),
    cell: seconds
      ? sql<HistoryCell>`jsonb_build_object('value', ${aggregate}, 'quality', case when bool_and(${s.metricReadings.quality} = 'good') then 'good' else 'partial' end, 'count', count(*))`.as("cell")
      : sql<HistoryCell>`jsonb_build_object('value', ${value}, 'quality', ${s.metricReadings.quality}, 'count', 1)`.as("cell"),
  }).from(s.metricReadings).innerJoin(s.deviceMetrics, eq(s.deviceMetrics.id, s.metricReadings.deviceMetricId))
    .where(conditions)
    .groupBy(s.deviceMetrics.deviceId, s.metricReadings.deviceMetricId, time, ...(seconds ? [] : [s.metricReadings.batchId, s.metricReadings.id])).as("cells");
  const size = exporting ? 10000 : 100;
  const rows = await db.select({ deviceId: cells.deviceId, at: cells.at, batch: cells.batch, cells: sql<Record<string, HistoryCell>>`jsonb_object_agg(${cells.metricId}, ${cells.cell})` })
    .from(cells).groupBy(cells.deviceId, cells.at, cells.batch).orderBy(desc(cells.at), cells.deviceId, cells.batch).limit(size + 1).offset(exporting ? 0 : (page - 1) * size);
  if (exporting && rows.length > size) throw new SensorError(413, "La exportación supera 10.000 filas. Reduce el rango o agrupa por minuto, hora o día.");
  return { columns, rows: rows.slice(0, size).map((r) => ({ id: `${r.deviceId}:${new Date(r.at).toISOString()}:${r.batch}`, recordedAt: new Date(r.at).toISOString(), deviceId: r.deviceId, deviceName: columns.find((c) => c.deviceId === r.deviceId)!.deviceName, cells: r.cells })), hasMore: rows.length > size, page, mode, aggregation };
}
