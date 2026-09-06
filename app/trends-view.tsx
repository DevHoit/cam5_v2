"use client";

import { useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  IconActivity as Activity,
  IconAlertTriangle as AlertTriangle,
  IconChartLine as ChartLine,
  IconChevronDown as ChevronDown,
  IconCircuitCell as CircuitBoard,
  IconDownload as Download,
  IconGauge as Gauge,
  IconRefresh as Refresh,
  IconShieldCheck as ShieldCheck,
  IconZoomReset as ZoomReset,
} from "@tabler/icons-react";

type TrendPoint = { timestamp: string; value: number | null; minimum: number | null; maximum: number | null; quality: "good" | "stale" | "bad"; validSamples: number; totalSamples: number };
type TrendSeries = {
  id: string;
  code: string;
  name: string;
  zone: string | null;
  metric: string;
  unit: string;
  warningThreshold: number | null;
  criticalThreshold: number | null;
  stats: { firstValue: number | null; lastValue: number | null; minimum: number | null; maximum: number | null; average: number | null; variation: number | null; qualityPercent: number | null; validSamples: number; totalSamples: number };
  points: TrendPoint[];
};
type TrendResponse = {
  asset: { id: string; code: string; name: string };
  from: string;
  to: string;
  resolution: { key: string; bucketSeconds: number; label: string; source: string; expectedStepSeconds: number };
  series: TrendSeries[];
};
type TrendWindow = { from: string; to: string };
type ChannelOption = { id: string; label: string; zone: string; unit: string; state: "normal" | "warning" | "critical"; enabled: boolean };

const COLORS = ["#0284c7", "#7c3aed", "#d97706", "#059669"];
const PERIODS = ["1 h", "6 h", "24 h", "7 días", "30 días", "Personalizado"] as const;
const PERIOD_MS: Record<string, number> = { "1 h": 3600_000, "6 h": 6 * 3600_000, "24 h": 24 * 3600_000, "7 días": 7 * 86400_000, "30 días": 30 * 86400_000 };

async function requestTrend(path: string) {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible consultar la tendencia.");
  }
  return response.json() as Promise<TrendResponse>;
}

async function downloadCsv(path: string) {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible exportar la tendencia.");
  }
  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "hoitlive-tendencias.csv";
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function valueLabel(value: number | null, unit: string, digits = 1) {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)} ${unit}`.trim();
}

function localInputValue(iso: string) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function pathSegments(series: TrendSeries, fromMs: number, toMs: number, yMin: number, yMax: number, expectedStepMs: number) {
  const segments: string[] = [];
  let current: string[] = [];
  let previousTime: number | null = null;
  for (const point of series.points) {
    const time = new Date(point.timestamp).getTime();
    const isGap = point.value === null || point.quality === "bad" || (previousTime !== null && time - previousTime > expectedStepMs * 2.5);
    if (isGap) {
      if (current.length) segments.push(current.join(" "));
      current = [];
      previousTime = time;
      continue;
    }
    const x = Math.max(0, Math.min(1000, (time - fromMs) / Math.max(1, toMs - fromMs) * 1000));
    const y = 300 - (point.value! - yMin) / Math.max(.0001, yMax - yMin) * 270;
    current.push(`${current.length ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`);
    previousTime = time;
  }
  if (current.length) segments.push(current.join(" "));
  return segments;
}

export function TrendsView({
  assetId,
  channels,
  period,
  setPeriod,
  selectedId,
  onSelectChannel,
  onBackToMap,
  rangeWindow,
  setRangeWindow,
  canExport,
  notify,
}: {
  assetId: string;
  channels: ChannelOption[];
  period: string;
  setPeriod: (period: string) => void;
  selectedId: string;
  onSelectChannel: (id: string) => void;
  onBackToMap: () => void;
  rangeWindow: TrendWindow | null;
  setRangeWindow: (value: TrendWindow | null) => void;
  canExport: boolean;
  notify: (message: string, tone?: "success" | "info" | "warning") => void;
}) {
  const activeChannels = channels.filter((channel) => channel.enabled);
  const primaryOption = activeChannels.find((channel) => channel.id === selectedId) ?? activeChannels[0];
  const [comparisons, setComparisons] = useState<string[]>([]);
  const [comparisonCandidate, setComparisonCandidate] = useState("");
  const [resolution, setResolution] = useState("auto");
  const [result, setResult] = useState<TrendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);
  const channelCodes = [primaryOption?.id, ...comparisons].filter(Boolean) as string[];
  const channelKey = channelCodes.join(",");

  const activeRange = useMemo(() => {
    if (period === "Personalizado" && rangeWindow) return rangeWindow;
    const to = new Date(now);
    return { from: new Date(to.getTime() - (PERIOD_MS[period] || PERIOD_MS["24 h"])).toISOString(), to: to.toISOString() };
  }, [now, period, rangeWindow]);
  const rangeSeconds = (new Date(activeRange.to).getTime() - new Date(activeRange.from).getTime()) / 1000;
  const maximumResolutionRange: Record<string, number> = { raw: 2 * 3600, "60": 7 * 86400, "300": 90 * 86400, "3600": 2 * 365 * 86400, "86400": 5 * 365 * 86400 };
  const effectiveResolution = resolution !== "auto" && rangeSeconds > maximumResolutionRange[resolution] ? "auto" : resolution;
  const compareOptions = activeChannels.filter((channel) => channel.id !== primaryOption?.id && !comparisons.includes(channel.id) && channel.unit === primaryOption?.unit);

  useEffect(() => {
    if (period === "Personalizado") return;
    const polling = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(polling);
  }, [period]);

  useEffect(() => {
    if (!assetId || !channelKey) return;
    let active = true;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ assetId, channels: channelKey, from: activeRange.from, to: activeRange.to, resolution: effectiveResolution });
        const data = await requestTrend(`/api/v1/trends?${params}`);
        if (active) setResult(data);
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : "No fue posible consultar la tendencia.");
      } finally {
        if (active) setLoading(false);
      }
    }, 120);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [activeRange.from, activeRange.to, assetId, channelKey, effectiveResolution, refreshKey]);

  const primary = result?.series[0] ?? null;
  const validValues = result?.series.flatMap((series) => series.points.flatMap((point) => point.value === null ? [] : [point.minimum ?? point.value, point.maximum ?? point.value])) ?? [];
  const thresholds = primary ? [primary.warningThreshold, primary.criticalThreshold].filter((value): value is number => value !== null) : [];
  const rawMin = validValues.length ? Math.min(...validValues, ...thresholds) : 0;
  const rawMax = validValues.length ? Math.max(...validValues, ...thresholds) : 100;
  const padding = Math.max(1, (rawMax - rawMin) * .12);
  const yMin = Math.floor((rawMin - padding) * 10) / 10;
  const yMax = Math.ceil((rawMax + padding) * 10) / 10;
  const fromMs = new Date(result?.from ?? activeRange.from).getTime();
  const toMs = new Date(result?.to ?? activeRange.to).getTime();
  const expectedStepMs = (result?.resolution.expectedStepSeconds ?? 2) * 1000;
  const yTicks = [0, .25, .5, .75, 1].map((ratio) => ({ ratio, value: yMax - (yMax - yMin) * ratio, y: 30 + ratio * 270 }));
  const xTicks = [0, .25, .5, .75, 1].map((ratio) => new Date(fromMs + (toMs - fromMs) * ratio));
  const cursorTime = hoverX === null ? null : fromMs + (toMs - fromMs) * hoverX / 1000;
  const cursorItems = cursorTime === null ? [] : (result?.series.map((series, index) => {
    const point = series.points.reduce<TrendPoint | null>((nearest, candidate) => !nearest || Math.abs(new Date(candidate.timestamp).getTime() - cursorTime) < Math.abs(new Date(nearest.timestamp).getTime() - cursorTime) ? candidate : nearest, null);
    return point ? { series, point, color: COLORS[index] } : null;
  }).filter(Boolean) as Array<{ series: TrendSeries; point: TrendPoint; color: string }> || []);

  const addComparison = () => {
    if (!comparisonCandidate || comparisons.length >= 3) return;
    setComparisons((current) => [...current, comparisonCandidate]);
    setComparisonCandidate("");
  };
  const changePeriod = (next: string) => {
    if (next === "Personalizado" && !rangeWindow) setRangeWindow({ from: new Date(now - 24 * 3600_000).toISOString(), to: new Date(now).toISOString() });
    if (next !== "Personalizado") setRangeWindow(null);
    setPeriod(next);
  };
  const updateCustomRange = (key: keyof TrendWindow, value: string) => {
    const next = new Date(value);
    if (!Number.isFinite(next.getTime())) return;
    setRangeWindow({ from: rangeWindow?.from ?? activeRange.from, to: rangeWindow?.to ?? activeRange.to, [key]: next.toISOString() });
  };
  const exportCurrent = async () => {
    try {
      const params = new URLSearchParams({ assetId, channels: channelKey, from: activeRange.from, to: activeRange.to, resolution: effectiveResolution, format: "csv" });
      await downloadCsv(`/api/v1/trends?${params}`);
      notify("Tendencia exportada con el rango y canales seleccionados.", "info");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "No fue posible exportar la tendencia.", "warning");
    }
  };
  const pointerX = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rectangle = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1000, (event.clientX - rectangle.left) / rectangle.width * 1000));
  };
  const finishZoom = () => {
    if (dragStart === null || dragCurrent === null || Math.abs(dragCurrent - dragStart) < 25) { setDragStart(null); setDragCurrent(null); return; }
    const start = Math.min(dragStart, dragCurrent) / 1000;
    const end = Math.max(dragStart, dragCurrent) / 1000;
    const nextFrom = new Date(fromMs + (toMs - fromMs) * start);
    const nextTo = new Date(fromMs + (toMs - fromMs) * end);
    if (nextTo.getTime() - nextFrom.getTime() >= 60_000) {
      setRangeWindow({ from: nextFrom.toISOString(), to: nextTo.toISOString() });
      setPeriod("Personalizado");
    }
    setDragStart(null);
    setDragCurrent(null);
  };

  if (!assetId || !primaryOption) return <article className="panel trend-empty"><ChartLine size={25} /><h2>Selecciona un punto con canales activos</h2><p>La tendencia necesita un canal configurado dentro del contexto operacional.</p></article>;
  return <>
    <section className="trend-control-panel">
      <div className="trend-primary-controls"><label className="channel-select"><Activity size={17} /><span><small>Canal principal</small><select value={primaryOption.id} onChange={(event) => { setComparisons([]); onSelectChannel(event.target.value); }} aria-label="Canal principal">{activeChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.id} · {channel.label}</option>)}</select></span><ChevronDown size={14} /></label><div className="trend-range-tabs" aria-label="Rango temporal">{PERIODS.map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => changePeriod(item)}>{item}</button>)}</div></div>
      <div className="trend-secondary-controls"><label><span>Comparar con</span><select value={comparisonCandidate} onChange={(event) => setComparisonCandidate(event.target.value)} disabled={!compareOptions.length || comparisons.length >= 3}><option value="">Seleccionar canal</option>{compareOptions.map((channel) => <option key={channel.id} value={channel.id}>{channel.id} · {channel.label}</option>)}</select><ChevronDown size={13} /></label><button className="secondary-button" disabled={!comparisonCandidate || comparisons.length >= 3} onClick={addComparison}>Agregar comparación</button><label><span>Resolución</span><select value={effectiveResolution} onChange={(event) => setResolution(event.target.value)}><option value="auto">Automática</option><option value="raw" disabled={rangeSeconds > 2 * 3600}>Cruda · máx. 2 h</option><option value="60" disabled={rangeSeconds > 7 * 86400}>1 minuto</option><option value="300" disabled={rangeSeconds > 90 * 86400}>5 minutos</option><option value="3600" disabled={rangeSeconds > 2 * 365 * 86400}>1 hora</option><option value="86400">1 día</option></select><ChevronDown size={13} /></label>{canExport && <button className="primary-button" onClick={() => void exportCurrent()} disabled={loading}><Download size={16} /> Exportar CSV</button>}</div>
      {period === "Personalizado" && rangeWindow && <div className="trend-custom-range"><label><span>Desde</span><input type="datetime-local" value={localInputValue(rangeWindow.from)} max={localInputValue(rangeWindow.to)} onChange={(event) => updateCustomRange("from", event.target.value)} /></label><label><span>Hasta</span><input type="datetime-local" value={localInputValue(rangeWindow.to)} min={localInputValue(rangeWindow.from)} max={localInputValue(new Date().toISOString())} onChange={(event) => updateCustomRange("to", event.target.value)} /></label><button onClick={() => changePeriod("24 h")}><ZoomReset size={15} /> Restablecer 24 h</button></div>}
      {comparisons.length > 0 && <div className="trend-comparison-chips"><span>Comparación:</span>{comparisons.map((code, index) => <button key={code} onClick={() => setComparisons((current) => current.filter((item) => item !== code))}><i style={{ background: COLORS[index + 1] }} />{code}<b>×</b></button>)}</div>}
    </section>

    {error && <div className="data-error"><AlertTriangle size={18} /><div><strong>No se pudo cargar la tendencia</strong><p>{error}</p></div><button onClick={() => setRefreshKey((value) => value + 1)}>Reintentar</button></div>}
    <section className="trend-metric-grid">
      <article><span><Gauge size={19} /></span><div><small>Última lectura</small><strong>{valueLabel(primary?.stats.lastValue ?? null, primary?.unit ?? primaryOption.unit)}</strong><p>{primary?.code ?? primaryOption.id} · {result?.resolution.label ?? "Consultando"}</p></div></article>
      <article><span><ChartLine size={19} /></span><div><small>Promedio del periodo</small><strong>{valueLabel(primary?.stats.average ?? null, primary?.unit ?? primaryOption.unit)}</strong><p>{valueLabel(primary?.stats.minimum ?? null, primary?.unit ?? primaryOption.unit)} mín. · {valueLabel(primary?.stats.maximum ?? null, primary?.unit ?? primaryOption.unit)} máx.</p></div></article>
      <article><span><Activity size={19} /></span><div><small>Variación</small><strong>{primary?.stats.variation === null || primary?.stats.variation === undefined ? "—" : `${primary.stats.variation >= 0 ? "+" : ""}${primary.stats.variation.toFixed(1)} ${primary.unit}`}</strong><p>Primera lectura respecto de la última</p></div></article>
      <article><span><ShieldCheck size={19} /></span><div><small>Calidad de datos</small><strong>{primary?.stats.qualityPercent === null || primary?.stats.qualityPercent === undefined ? "—" : `${primary.stats.qualityPercent}%`}</strong><p>{primary?.stats.validSamples.toLocaleString("es-CL") ?? 0} de {primary?.stats.totalSamples.toLocaleString("es-CL") ?? 0} muestras válidas</p></div></article>
    </section>

    <article className="panel trend-chart-panel">
      <header><div><span className="eyebrow">{result?.asset.code ?? "Punto activo"} · {result?.resolution.label ?? "Resolución automática"}</span><h2>{primary?.name ?? primaryOption.label}</h2><p>{primary?.zone ?? primaryOption.zone} · {new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(activeRange.from))} → {new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(activeRange.to))}</p></div><span className="trend-source-pill">{loading ? <><Refresh className="spin" size={14} /> Consultando</> : <><ShieldCheck size={14} /> PostgreSQL</>}</span></header>
      <div className="trend-chart-body">
        <div className="trend-y-axis">{yTicks.map((tick) => <span key={tick.ratio} style={{ top: `${tick.ratio * 100}%` }}>{tick.value.toFixed(1)}</span>)}</div>
        <div className={`trend-svg-wrap ${dragStart !== null ? "selecting" : ""}`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const x = pointerX(event); setDragStart(x); setDragCurrent(x); }} onPointerMove={(event) => { const x = pointerX(event); setHoverX(x); if (dragStart !== null) setDragCurrent(x); }} onPointerUp={finishZoom} onPointerCancel={finishZoom} onPointerLeave={() => { if (dragStart === null) setHoverX(null); }}>
          <svg viewBox="0 0 1000 320" preserveAspectRatio="none" role="img" aria-label="Gráfico de tendencias por canal">
            <g className="trend-grid-lines">{yTicks.map((tick) => <line key={tick.ratio} x1="0" x2="1000" y1={tick.y} y2={tick.y} />)}</g>
            {primary?.warningThreshold !== null && primary?.warningThreshold !== undefined && <g className="trend-threshold warning"><line x1="0" x2="1000" y1={300 - (primary.warningThreshold - yMin) / Math.max(.0001, yMax - yMin) * 270} y2={300 - (primary.warningThreshold - yMin) / Math.max(.0001, yMax - yMin) * 270} /><text x="990" y={294 - (primary.warningThreshold - yMin) / Math.max(.0001, yMax - yMin) * 270}>Advertencia {primary.warningThreshold}</text></g>}
            {primary?.criticalThreshold !== null && primary?.criticalThreshold !== undefined && <g className="trend-threshold critical"><line x1="0" x2="1000" y1={300 - (primary.criticalThreshold - yMin) / Math.max(.0001, yMax - yMin) * 270} y2={300 - (primary.criticalThreshold - yMin) / Math.max(.0001, yMax - yMin) * 270} /><text x="990" y={294 - (primary.criticalThreshold - yMin) / Math.max(.0001, yMax - yMin) * 270}>Crítico {primary.criticalThreshold}</text></g>}
            {result?.series[0]?.points.filter((point) => point.quality !== "good").map((point) => { const x = (new Date(point.timestamp).getTime() - fromMs) / Math.max(1, toMs - fromMs) * 1000; return <rect key={point.timestamp} className={`quality-band ${point.quality}`} x={x - 2} y="30" width="4" height="270" />; })}
            {result?.series.map((series, index) => pathSegments(series, fromMs, toMs, yMin, yMax, expectedStepMs).map((path, segment) => <path key={`${series.id}-${segment}`} className="trend-series-path" d={path} style={{ stroke: COLORS[index] }} />))}
            {hoverX !== null && <line className="trend-cursor-line" x1={hoverX} x2={hoverX} y1="30" y2="300" />}
            {cursorItems.map((item) => item.point.value === null ? null : <circle key={item.series.id} className="trend-cursor-point" cx={(new Date(item.point.timestamp).getTime() - fromMs) / Math.max(1, toMs - fromMs) * 1000} cy={300 - (item.point.value - yMin) / Math.max(.0001, yMax - yMin) * 270} r="5" style={{ fill: item.color }} />)}
            {dragStart !== null && dragCurrent !== null && <rect className="trend-selection" x={Math.min(dragStart, dragCurrent)} y="30" width={Math.abs(dragCurrent - dragStart)} height="270" />}
          </svg>
          {!loading && !error && !validValues.length && <div className="trend-chart-empty"><ChartLine size={25} /><strong>Sin muestras para este periodo</strong><span>La línea aparecerá cuando el gateway envíe datos del canal.</span></div>}
          {cursorItems.length > 0 && hoverX !== null && <div className={`trend-tooltip ${hoverX > 720 ? "align-right" : ""}`} style={{ left: `${hoverX / 10}%` }}><strong>{new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "medium" }).format(new Date(cursorItems[0].point.timestamp))}</strong>{cursorItems.map((item) => <span key={item.series.id}><i style={{ background: item.color }} /><b>{item.series.code}</b>{valueLabel(item.point.value, item.series.unit)}<small>{item.point.quality === "good" ? "Válida" : item.point.quality === "stale" ? "Parcial" : "Inválida"}</small></span>)}</div>}
        </div>
        <div className="trend-x-axis">{xTicks.map((date, index) => <span key={index}>{new Intl.DateTimeFormat("es-CL", rangeSeconds > 7 * 86400 ? { day: "2-digit", month: "short" } : { hour: "2-digit", minute: "2-digit" }).format(date)}</span>)}</div>
      </div>
      <footer><div className="trend-legend">{result?.series.map((series, index) => <span key={series.id}><i style={{ background: COLORS[index] }} />{series.code} · {series.unit}</span>)}<span className="quality-legend"><i />Dato incompleto</span></div><p>Arrastra horizontalmente sobre el gráfico para ampliar un intervalo.</p></footer>
    </article>
    <article className="panel trend-insight"><span><ChartLine size={20} /></span><div><strong>Lectura del periodo</strong><p>{primary?.stats.totalSamples ? `${primary.code} registra ${primary.stats.totalSamples.toLocaleString("es-CL")} muestras, con ${primary.stats.qualityPercent ?? 0}% de calidad. ${primary.stats.maximum !== null && primary.criticalThreshold !== null && primary.stats.maximum >= primary.criticalThreshold ? "El máximo superó el umbral crítico configurado." : primary.stats.maximum !== null && primary.warningThreshold !== null && primary.stats.maximum >= primary.warningThreshold ? "El máximo superó el umbral de advertencia." : "Los valores válidos permanecen bajo los umbrales configurados."}` : "No existen muestras suficientes para interpretar este periodo."}</p></div><button onClick={onBackToMap}><CircuitBoard size={15} /> Volver al mapa</button></article>
  </>;
}
