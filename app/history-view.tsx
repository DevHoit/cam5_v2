"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconBellRinging,
  IconChartLine,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconClock,
  IconDownload,
  IconInfoCircle,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Pagination } from "./pagination";

type HistoryTab = "measurements" | "alarms" | "audit";
type PeriodPreset = "1h" | "24h" | "7d" | "30d" | "custom";
type Resolution = "auto" | "raw" | "300" | "3600" | "86400";
type ChannelGroup = "visible" | "all" | "temperature" | "discharge" | "environment";

type HistoryColumn = { id: string; code: string; name: string; zone: string | null; unit: string; metric: string; warning: number | null; critical: number | null; visible: boolean };
type HistoryCell = { value: number | null; raw?: number | null; quality?: "good" | "stale" | "bad"; flags?: string[]; sequence?: number | null; minimum?: number | null; maximum?: number | null; samples?: number; invalid?: number };
type HistoryRow = { key: string; recordedAt: string; receivedAt: string | null; latencyMs: number | null; success: boolean | null; cells: Record<string, HistoryCell> };
type MeasurementResult = {
  resolution: { key: Exclude<Resolution, "auto">; bucketSeconds: number; label: string };
  columns: HistoryColumn[];
  rows: HistoryRow[];
  page: number; pageSize: number; total: number; totalPages: number;
  from: string; to: string;
  retention: { rawDays: number; aggregateDays: number; rawAvailableSince: string };
};
type ListResult = { tab: HistoryTab; items: Array<Record<string, unknown>>; page: number; pageSize: number; total: number; totalPages: number };

const PERIODS: Array<{ key: PeriodPreset; label: string; hours: number }> = [
  { key: "1h", label: "1 h", hours: 1 },
  { key: "24h", label: "24 h", hours: 24 },
  { key: "7d", label: "7 días", hours: 24 * 7 },
  { key: "30d", label: "30 días", hours: 24 * 30 },
];

const RESOLUTION_OPTIONS: Array<{ key: Resolution; label: string }> = [
  { key: "auto", label: "Automática" },
  { key: "raw", label: "Por envío" },
  { key: "300", label: "Promedio 5 min" },
  { key: "3600", label: "Promedio 1 hora" },
  { key: "86400", label: "Promedio 1 día" },
];

const GROUP_OPTIONS: Array<{ key: ChannelGroup; label: string }> = [
  { key: "visible", label: "Mis canales visibles" },
  { key: "all", label: "Todos los canales" },
  { key: "temperature", label: "Temperaturas" },
  { key: "discharge", label: "Descargas (UHF)" },
  { key: "environment", label: "Ambiente" },
];

const QUALITY_LABELS = { good: "Válida", stale: "Atrasada", bad: "Inválida" } as const;

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible consultar el histórico.");
  }
  return response.json() as Promise<T>;
}

async function downloadCsv(path: string, fallbackName: string) {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible generar la exportación.");
  }
  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function presetRange(preset: Exclude<PeriodPreset, "custom">) {
  const hours = PERIODS.find((period) => period.key === preset)?.hours ?? 24;
  const to = new Date();
  return { from: new Date(to.getTime() - hours * 3_600_000).toISOString(), to: to.toISOString() };
}

/** Valor para <input type="datetime-local"> en hora local. */
function toLocalInput(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRowTime(iso: string, bucketSeconds: number) {
  const date = new Date(iso);
  if (bucketSeconds >= 86_400) return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric" }).format(date);
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: bucketSeconds ? undefined : "2-digit", hour12: false }).format(date);
}

function formatDateTime(iso: string) {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return "—";
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

function formatValue(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined) return "—";
  const decimals = unit === "idx" || Math.abs(value) >= 100 ? 0 : 1;
  return value.toFixed(decimals);
}

function cellSeverity(column: HistoryColumn, value: number | null) {
  if (value === null) return "";
  if (column.critical !== null && value >= column.critical) return "cell-critical";
  if (column.warning !== null && value >= column.warning) return "cell-warning";
  return "";
}

function formatLag(row: HistoryRow) {
  if (!row.receivedAt) return null;
  const lagMs = Math.max(0, new Date(row.receivedAt).getTime() - new Date(row.recordedAt).getTime());
  return lagMs < 1_000 ? `${lagMs} ms` : lagMs < 60_000 ? `${(lagMs / 1_000).toFixed(1)} s` : `${Math.round(lagMs / 60_000)} min`;
}

function MeasurementsTable({ data, expanded, onToggle, onOpenTrend }: { data: MeasurementResult; expanded: string | null; onToggle: (key: string) => void; onOpenTrend: (code: string) => void }) {
  const raw = data.resolution.key === "raw";
  const columnCount = data.columns.length + (raw ? 2 : 1);
  return <div className="history-grid-wrap" role="region" aria-label="Mediciones" tabIndex={0}>
    <table className="history-grid">
      <thead>
        <tr>
          <th scope="col" className="history-time-col">{raw ? "Envío" : "Intervalo"}</th>
          {data.columns.map((column) => <th scope="col" key={column.id}>
            <button type="button" className="history-col-head" onClick={() => onOpenTrend(column.code)} title={`${column.name}${column.zone ? ` · ${column.zone}` : ""}. Ver tendencia`}>
              <b>{column.code}</b><small>{column.unit}</small>
            </button>
          </th>)}
          {raw && <th scope="col" className="history-meta-col">Calidad</th>}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row) => {
          const isOpen = expanded === row.key;
          const issues = raw ? data.columns.filter((column) => { const quality = row.cells[column.id]?.quality; return quality && quality !== "good"; }).length : 0;
          return <Fragment key={row.key}>
            <tr className={isOpen ? "is-open" : ""}>
              <th scope="row" className="history-time-col">
                {raw
                  ? <button type="button" className="history-row-toggle" aria-expanded={isOpen} onClick={() => onToggle(row.key)}>{isOpen ? <IconChevronDown size={14} aria-hidden="true" /> : <IconChevronRight size={14} aria-hidden="true" />}<span>{formatRowTime(row.recordedAt, 0)}</span></button>
                  : <span className="history-row-time">{formatRowTime(row.recordedAt, data.resolution.bucketSeconds)}</span>}
              </th>
              {data.columns.map((column) => {
                const cell = row.cells[column.id];
                if (!cell) return <td key={column.id} className="cell-empty">—</td>;
                // Un promedio ya excluye las muestras no válidas: solo se marca si faltan datos confiables.
                const invalid = raw ? cell.quality !== undefined && cell.quality !== "good" : cell.value === null || (cell.invalid ?? 0) * 2 >= Math.max(1, cell.samples ?? 0);
                const title = raw
                  ? `${column.code} · ${column.name}: ${formatValue(cell.value, column.unit)} ${column.unit} · ${QUALITY_LABELS[cell.quality ?? "good"]}`
                  : `${column.code} · promedio ${formatValue(cell.value, column.unit)} ${column.unit} · mín ${formatValue(cell.minimum, column.unit)} · máx ${formatValue(cell.maximum, column.unit)} · ${cell.samples ?? 0} muestras${cell.invalid ? ` (${cell.invalid} no válidas)` : ""}`;
                return <td key={column.id} className={`${invalid ? "cell-invalid" : cellSeverity(column, cell.value)}`} title={title}>
                  <span className="history-cell-value">{invalid && <IconAlertTriangle size={11} aria-label="No válida" />}{formatValue(cell.value, column.unit)}</span>
                </td>;
              })}
              {raw && <td className="history-meta-col">{issues ? <span className="history-issues"><IconAlertTriangle size={12} aria-hidden="true" />{issues} no válida{issues === 1 ? "" : "s"}</span> : <span className="history-ok"><IconCircleCheck size={12} aria-hidden="true" />Completa</span>}</td>}
            </tr>
            {raw && isOpen && <tr className="history-detail-row">
              <td colSpan={columnCount}>
                <div className="history-detail">
                  <dl className="history-detail-batch">
                    <div><dt>Medido</dt><dd>{formatDateTime(row.recordedAt)} · {new Date(row.recordedAt).toISOString().slice(11, 19)} UTC</dd></div>
                    <div><dt>Recibido en Core</dt><dd>{row.receivedAt ? `${formatLag(row)} después` : "—"}</dd></div>
                    <div><dt>Lectura Modbus</dt><dd>{row.latencyMs === null ? "—" : `${row.latencyMs} ms`}</dd></div>
                    <div><dt>Envío</dt><dd>{row.success === false ? "Incompleto" : "Completo"}</dd></div>
                  </dl>
                  <ul className="history-detail-cells">
                    {data.columns.map((column) => {
                      const cell = row.cells[column.id];
                      return <li key={column.id} className={cell?.quality && cell.quality !== "good" ? "is-invalid" : ""}>
                        <b>{column.code}</b>
                        <span>{cell ? `${formatValue(cell.value, column.unit)} ${column.unit}` : "Sin dato"}</span>
                        <small>{cell ? `crudo ${cell.raw ?? "—"} · ${QUALITY_LABELS[cell.quality ?? "good"].toLowerCase()}${cell.flags?.length ? ` · ${cell.flags.join(", ")}` : ""}` : "no incluido en este envío"}</small>
                      </li>;
                    })}
                  </ul>
                </div>
              </td>
            </tr>}
          </Fragment>;
        })}
      </tbody>
    </table>
  </div>;
}

export function HistoryView({ assetId, canExport, notify, onOpenTrend }: { assetId: string; canExport: boolean; notify: (message: string, tone?: "success" | "info" | "warning") => void; onOpenTrend: (channelCode: string, from: string, to: string) => void }) {
  const [tab, setTab] = useState<HistoryTab>("measurements");
  const [preset, setPreset] = useState<PeriodPreset>("24h");
  const [range, setRange] = useState(() => presetRange("24h"));
  const [resolution, setResolution] = useState<Resolution>("auto");
  const [group, setGroup] = useState<ChannelGroup>("visible");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<MeasurementResult | null>(null);
  const [list, setList] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const params = useMemo(() => {
    const search = new URLSearchParams({ tab, from: range.from, to: range.to, page: String(page) });
    if (assetId) search.set("assetId", assetId);
    if (tab === "measurements") { search.set("resolution", resolution); search.set("group", group); search.set("pageSize", "50"); }
    else { search.set("pageSize", "20"); if (query.trim()) search.set("q", query.trim()); }
    return search;
  }, [assetId, tab, range, page, resolution, group, query]);

  useEffect(() => {
    if (tab === "measurements" && !assetId) return;
    let active = true;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        if (tab === "measurements") {
          const data = await requestJson<MeasurementResult>(`/api/v1/history?${params}`);
          if (active) setMeasurements(data);
        } else {
          const data = await requestJson<Omit<ListResult, "tab">>(`/api/v1/history?${params}`);
          if (active) setList({ ...data, tab });
        }
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : "No fue posible consultar el histórico.");
      } finally {
        if (active) setLoading(false);
      }
    }, 200);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [params, tab, assetId, refreshKey]);

  const choosePreset = (next: Exclude<PeriodPreset, "custom">) => { setPreset(next); setRange(presetRange(next)); setPage(1); setExpanded(null); };
  const setCustom = (field: "from" | "to", value: string) => {
    if (!value) return;
    const iso = new Date(value).toISOString();
    setPreset("custom");
    setRange((current) => ({ ...current, [field]: iso }));
    setPage(1);
  };
  const refresh = () => { if (preset !== "custom") setRange(presetRange(preset)); setRefreshKey((current) => current + 1); };
  const changeTab = (next: HistoryTab) => { setTab(next); setPage(1); setError(""); };

  const exportCsv = async () => {
    try {
      const search = new URLSearchParams(params);
      search.set("format", "csv");
      search.delete("page");
      await downloadCsv(`/api/v1/history?${search}`, `hoitlive-historico-${tab}.csv`);
      notify(tab === "measurements" ? "CSV exportado: una fila por envío y una columna por canal." : "Histórico exportado con los filtros visibles.", "info");
    } catch (exportError) {
      notify(exportError instanceof Error ? exportError.message : "No fue posible exportar el histórico.", "warning");
    }
  };

  const openTrend = (code: string) => onOpenTrend(code, range.from, new Date(Math.min(Date.now(), new Date(range.to).getTime())).toISOString());
  const rawBeforeRetention = measurements?.resolution.key === "raw" && new Date(range.from) < new Date(measurements.retention.rawAvailableSince);
  const total = tab === "measurements" ? measurements?.total ?? 0 : list?.tab === tab ? list.total : 0;

  return <article className="panel module-panel history-module">
    <div className="module-toolbar">
      <div className="module-tabs" role="tablist" aria-label="Tipo de histórico">
        <button role="tab" aria-selected={tab === "measurements"} className={tab === "measurements" ? "active" : ""} onClick={() => changeTab("measurements")}><IconChartLine size={16} aria-hidden="true" /> Mediciones</button>
        <button role="tab" aria-selected={tab === "alarms"} className={tab === "alarms" ? "active" : ""} onClick={() => changeTab("alarms")}><IconBellRinging size={16} aria-hidden="true" /> Alarmas</button>
        <button role="tab" aria-selected={tab === "audit"} className={tab === "audit" ? "active" : ""} onClick={() => changeTab("audit")}><IconShieldCheck size={16} aria-hidden="true" /> Auditoría</button>
      </div>
      {canExport && <button className="primary-button history-export-button" onClick={() => void exportCsv()} disabled={loading || !total}><IconDownload size={16} aria-hidden="true" /> Exportar CSV</button>}
    </div>

    <div className="history-filters">
      <div className="history-periods" role="group" aria-label="Periodo">
        {PERIODS.map((period) => <button key={period.key} type="button" className={preset === period.key ? "active" : ""} aria-pressed={preset === period.key} onClick={() => choosePreset(period.key as Exclude<PeriodPreset, "custom">)}>{period.label}</button>)}
        <button type="button" className="history-refresh" onClick={refresh} aria-label="Actualizar" title="Actualizar"><IconRefresh size={15} aria-hidden="true" /></button>
      </div>
      <label className="history-field"><span>Desde</span><input type="datetime-local" value={toLocalInput(range.from)} max={toLocalInput(range.to)} onChange={(event) => setCustom("from", event.target.value)} /></label>
      <label className="history-field"><span>Hasta</span><input type="datetime-local" value={toLocalInput(range.to)} min={toLocalInput(range.from)} onChange={(event) => setCustom("to", event.target.value)} /></label>
      {tab === "measurements"
        ? <>
          <label className="history-field"><span>Canales</span><select value={group} onChange={(event) => { setGroup(event.target.value as ChannelGroup); setPage(1); }}>{GROUP_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
          <label className="history-field"><span>Resolución</span><select value={resolution} onChange={(event) => { setResolution(event.target.value as Resolution); setPage(1); setExpanded(null); }}>{RESOLUTION_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        </>
        : <label className="history-field history-search"><span>Buscar</span><span className="history-search-input"><IconSearch size={15} aria-hidden="true" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={tab === "audit" ? "Acción o recurso" : "Canal, código o evento"} /></span></label>}
    </div>

    {tab === "measurements" && !assetId && <div className="history-message"><IconInfoCircle size={18} aria-hidden="true" /><p>Selecciona un punto de medición para ver su histórico.</p></div>}
    {error && <div className="history-message is-error" role="alert"><IconAlertTriangle size={18} aria-hidden="true" /><p><strong>No se pudo cargar el histórico.</strong> {error}</p></div>}

    {tab === "measurements" && measurements && !error && assetId && <>
      <div className="history-summary" aria-live="polite">
        <span><strong>{measurements.total.toLocaleString("es-CL")}</strong> {measurements.resolution.key === "raw" ? (measurements.total === 1 ? "envío" : "envíos") : (measurements.total === 1 ? "intervalo" : "intervalos")}</span>
        <span><strong>{measurements.columns.length}</strong> canales</span>
        <span>{resolution === "auto" ? `Resolución automática: ${measurements.resolution.label.toLowerCase()}` : measurements.resolution.label}</span>
        {loading && <span className="history-loading"><IconRefresh size={14} className="spin" aria-hidden="true" /> Actualizando…</span>}
      </div>
      {rawBeforeRetention && <div className="history-message"><IconClock size={18} aria-hidden="true" /><p>Las lecturas por envío se conservan {measurements.retention.rawDays} días. Para fechas anteriores elige una resolución de promedio.</p></div>}
      {measurements.columns.length === 0
        ? <div className="history-message"><IconInfoCircle size={18} aria-hidden="true" /><p>No hay canales en este grupo. Elige otro grupo o «Todos los canales».</p></div>
        : measurements.rows.length === 0
          ? <div className="history-message"><IconInfoCircle size={18} aria-hidden="true" /><p>No hay mediciones en este periodo. Amplía el rango o cambia la resolución.</p></div>
          : <>
            <MeasurementsTable data={measurements} expanded={expanded} onToggle={(key) => setExpanded((current) => current === key ? null : key)} onOpenTrend={openTrend} />
            <div className="history-legend"><span><i className="legend-warning" />Advertencia</span><span><i className="legend-critical" />Crítico</span><span><IconAlertTriangle size={12} aria-hidden="true" />Lectura no válida</span><small>{measurements.resolution.key === "raw" ? "Toca una fila para ver el detalle del envío · toca un canal para ver su tendencia" : "Pasa el cursor sobre un valor para ver mínimo, máximo y muestras · toca un canal para ver su tendencia"}</small></div>
          </>}
      <Pagination page={measurements.page} totalPages={measurements.totalPages} total={measurements.total} pageSize={measurements.pageSize} onPageChange={(next) => { setPage(next); setExpanded(null); }} itemLabel={measurements.resolution.key === "raw" ? "envíos" : "intervalos"} />
      <div className="module-footer"><span><IconClock size={14} aria-hidden="true" /> Lecturas por envío: {measurements.retention.rawDays} días · Promedios: {Math.round(measurements.retention.aggregateDays / 365)} años</span><small>Horas en tu zona horaria local.</small></div>
    </>}

    {tab === "measurements" && !measurements && loading && !error && assetId && <div className="history-message"><IconRefresh size={18} className="spin" aria-hidden="true" /><p>Consultando mediciones…</p></div>}

    {tab !== "measurements" && !error && <>
      {loading && list?.tab !== tab && <div className="history-message"><IconRefresh size={18} className="spin" aria-hidden="true" /><p>Consultando…</p></div>}
      {list?.tab === "alarms" && tab === "alarms" && <div className="module-table-wrap" role="region" aria-label="Alarmas" tabIndex={0}><div className="history-table alarm-history"><div className="module-table-head"><span>Fecha</span><span>Severidad</span><span>Evento</span><span>Valor</span><span>Estado</span><span>Acción</span></div>{list.items.map((raw) => {
        const item = raw as { id: string; code: string; openedAt: string; severity: "critical" | "warning" | "normal"; status: string; title: string; detail?: string; triggerValue?: string; channelCode?: string; unit?: string };
        const done = item.status === "closed" || item.status === "resolved";
        return <div className="module-table-row" key={item.id}><span>{formatDateTime(item.openedAt)}</span><span><span className={`status-pill status-${item.severity}`}><span className="status-dot" />{item.severity === "critical" ? "Crítica" : item.severity === "warning" ? "Advertencia" : "Normal"}</span></span><span className="event-cell"><strong>{item.title}</strong><small>{item.detail || item.code}</small></span><span className="mono-cell">{item.triggerValue ? `${Number(item.triggerValue).toFixed(1)} ${item.unit || ""}` : "—"}</span><span className={done ? "quality-ok" : "unack-state"}>{done ? <><IconCircleCheck size={14} aria-hidden="true" /> {item.status === "closed" ? "Cerrada" : "Atendida"}</> : <><IconClock size={14} aria-hidden="true" /> {item.status === "acknowledged" ? "Reconocida" : "Abierta"}</>}</span><span>{item.channelCode ? <button className="ghost-button" onClick={() => onOpenTrend(item.channelCode!, new Date(new Date(item.openedAt).getTime() - 12 * 3_600_000).toISOString(), new Date(Math.min(Date.now(), new Date(item.openedAt).getTime() + 12 * 3_600_000)).toISOString())}><IconChartLine size={15} aria-hidden="true" /> Tendencia</button> : "—"}</span></div>;
      })}{list.items.length === 0 && <div className="history-message"><IconInfoCircle size={18} aria-hidden="true" /><p>No hay alarmas en este periodo.</p></div>}</div></div>}
      {list?.tab === "audit" && tab === "audit" && <div className="module-table-wrap" role="region" aria-label="Auditoría" tabIndex={0}><div className="history-table audit-history"><div className="module-table-head"><span>Fecha</span><span>Usuario</span><span>Acción</span><span>Recurso</span><span>Resultado</span></div>{list.items.map((raw) => {
        const item = raw as { id: number; createdAt: string; actor: string; action: string; resourceType: string; resourceId?: string; outcome: string };
        return <div className="module-table-row" key={item.id}><span>{formatDateTime(item.createdAt)}</span><span><strong>{item.actor}</strong></span><span>{item.action}</span><span className="mono-cell">{item.resourceType}{item.resourceId ? ` · ${item.resourceId}` : ""}</span><span className={item.outcome === "success" ? "quality-ok" : "unack-state"}>{item.outcome === "success" ? "Correcto" : item.outcome === "denied" ? "Denegado" : item.outcome === "failed" ? "Fallido" : item.outcome}</span></div>;
      })}{list.items.length === 0 && <div className="history-message"><IconInfoCircle size={18} aria-hidden="true" /><p>No hay acciones registradas en este periodo.</p></div>}</div></div>}
      {list?.tab === tab && <Pagination page={list.page} totalPages={list.totalPages} total={list.total} pageSize={list.pageSize} onPageChange={setPage} itemLabel={tab === "alarms" ? "eventos" : "acciones"} />}
    </>}
  </article>;
}
