"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconChartLine,
  IconDownload,
  IconRefresh,
  IconShieldCheck,
} from "@tabler/icons-react";

type NoticeTone = "success" | "info" | "warning";
type LatestMetric = {
  id: string;
  code: string;
  name: string;
  key: string;
  category: string;
  unit: string;
  dataType: string;
  value: number | boolean | string | null;
  quality: string;
  recordedAt: string | null;
};
type LatestDevice = {
  id: string;
  code: string;
  name: string;
  state: string;
  metrics: LatestMetric[];
};
type LatestResponse = {
  serverTime: string;
  assets: Array<{ id: string; code: string; name: string; devices: LatestDevice[] }>;
};
type HistoryPoint = {
  recordedAt: string;
  value: number | boolean | string | null;
  minimum: number | null;
  maximum: number | null;
  quality: string;
  sampleCount: number;
  invalidSampleCount: number;
};
type HistoryResponse = {
  range: { from: string; to: string; source: string; bucketSeconds: number | null };
  asset: { id: string; code: string; name: string };
  device: { id: string; code: string; name: string };
  metric: { key: string; name: string; unit: string; dataType: string };
  points: HistoryPoint[];
};
type MetricOption = LatestMetric & { deviceId: string; deviceCode: string; deviceName: string; optionId: string };
type Series = { option: MetricOption; response: HistoryResponse };

const PERIODS = ["1 h", "6 h", "24 h", "7 días", "30 días"] as const;
const PERIOD_MS: Record<(typeof PERIODS)[number], number> = {
  "1 h": 3600_000,
  "6 h": 6 * 3600_000,
  "24 h": 24 * 3600_000,
  "7 días": 7 * 86400_000,
  "30 días": 30 * 86400_000,
};
const SERIES_COLORS = ["#0284c7", "#7c3aed", "#d97706", "#059669"];

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "include", cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "No fue posible consultar la tendencia.");
  }
  return response.json() as Promise<T>;
}

function valueLabel(value: number | null, unit: string) {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

function linePath(points: HistoryPoint[], fromMs: number, toMs: number, yMin: number, yMax: number) {
  let path = "";
  let drawing = false;
  for (const point of points) {
    if (typeof point.value !== "number" || point.quality === "bad") {
      drawing = false;
      continue;
    }
    const t = new Date(point.recordedAt).getTime();
    const x = (t - fromMs) / Math.max(1, toMs - fromMs) * 1000;
    const y = 290 - (point.value - yMin) / Math.max(.0001, yMax - yMin) * 250;
    path += `${drawing ? " L" : " M"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    drawing = true;
  }
  return path.trim();
}

function downloadCsv(series: Series[]) {
  const rows = [["timestamp_utc", "dispositivo", "metrica", "valor", "unidad", "calidad"]];
  for (const item of series) {
    for (const point of item.response.points) {
      rows.push([
        point.recordedAt,
        item.option.deviceCode,
        item.option.key,
        point.value === null ? "" : String(point.value),
        item.option.unit,
        point.quality,
      ]);
    }
  }
  const csv = rows.map((row) => row.map((value) => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "hoitlive-tendencias-metricas.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function GenericTrendsView({
  assetId,
  initialMetricKey,
  canExport,
  notify,
}: {
  assetId: string;
  initialMetricKey?: string;
  canExport: boolean;
  notify: (message: string, tone?: NoticeTone) => void;
}) {
  const [latest, setLatest] = useState<LatestResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [comparisons, setComparisons] = useState<string[]>([]);
  const [candidate, setCandidate] = useState("");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("24 h");
  const [now, setNow] = useState(() => Date.now());
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    void requestJson<LatestResponse>(`/api/v1/telemetry/metrics/latest?assetId=${encodeURIComponent(assetId)}`)
      .then((result) => {
        if (!alive) return;
        setLatest(result);
        const asset = result.assets.find((item) => item.id === assetId);
        const first = asset?.devices.flatMap((device) => device.metrics
          .filter((metric) => metric.dataType === "float" || metric.dataType === "integer")
          .map((metric) => `${device.id}::${metric.key}`))[0] ?? "";
        const preferred = initialMetricKey
          ? asset?.devices.flatMap((device) => device.metrics.map((metric) => ({ device, metric })))
              .find(({ metric }) => metric.key === initialMetricKey || metric.code === initialMetricKey)
          : null;
        setSelectedId((current) => current || (preferred ? `${preferred.device.id}::${preferred.metric.key}` : first));
      })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "No fue posible consultar las métricas."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [assetId, initialMetricKey, refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const options = useMemo<MetricOption[]>(() => {
    const asset = latest?.assets.find((item) => item.id === assetId);
    return asset?.devices.flatMap((device) => device.metrics
      .filter((metric) => metric.dataType === "float" || metric.dataType === "integer")
      .map((metric) => ({
        ...metric,
        deviceId: device.id,
        deviceCode: device.code,
        deviceName: device.name,
        optionId: `${device.id}::${metric.key}`,
      }))) ?? [];
  }, [assetId, latest]);

  const selected = options.find((option) => option.optionId === selectedId) ?? options[0] ?? null;
  const compatible = selected
    ? options.filter((option) => option.optionId !== selected.optionId && !comparisons.includes(option.optionId) && option.unit === selected.unit)
    : [];
  const selectedOptions = selected
    ? [selected, ...comparisons.map((id) => options.find((option) => option.optionId === id)).filter((item): item is MetricOption => Boolean(item))]
    : [];
  const from = new Date(now - PERIOD_MS[period]).toISOString();
  const to = new Date(now).toISOString();
  const selectionKey = selectedOptions.map((option) => option.optionId).join(",");

  useEffect(() => {
    if (!selectedOptions.length) return;
    let alive = true;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void Promise.all(selectedOptions.map(async (option) => {
        const params = new URLSearchParams({ deviceId: option.deviceId, metric: option.key, from, to });
        const response = await requestJson<HistoryResponse>(`/api/v1/telemetry/metrics/history?${params}`);
        return { option, response };
      }))
        .then((result) => { if (alive) setSeries(result); })
        .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "No fue posible consultar las series."); })
        .finally(() => { if (alive) setLoading(false); });
    }, 120);
    return () => { alive = false; window.clearTimeout(timeout); };
    // selectionKey serializa la selección visible y evita depender de objetos recreados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, selectionKey]);

  const values = series.flatMap((item) => item.response.points.flatMap((point) => typeof point.value === "number" ? [point.minimum ?? point.value, point.maximum ?? point.value] : []));
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const padding = Math.max((rawMax - rawMin) * .12, rawMax === rawMin ? Math.max(Math.abs(rawMax) * .05, 1) : .1);
  const yMin = rawMin - padding;
  const yMax = rawMax + padding;
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const yTicks = [0, .25, .5, .75, 1].map((ratio) => yMax - (yMax - yMin) * ratio);
  const xTicks = [0, .25, .5, .75, 1].map((ratio) => new Date(fromMs + (toMs - fromMs) * ratio));

  const primarySeries = series[0] ?? null;
  const primaryValues = primarySeries?.response.points.filter((point) => typeof point.value === "number" && point.quality !== "bad").map((point) => Number(point.value)) ?? [];
  const average = primaryValues.length ? primaryValues.reduce((sum, value) => sum + value, 0) / primaryValues.length : null;
  const minimum = primaryValues.length ? Math.min(...primaryValues) : null;
  const maximum = primaryValues.length ? Math.max(...primaryValues) : null;
  const last = primaryValues.at(-1) ?? null;
  const totalSamples = primarySeries?.response.points.reduce((sum, point) => sum + point.sampleCount, 0) ?? 0;
  const invalidSamples = primarySeries?.response.points.reduce((sum, point) => sum + point.invalidSampleCount, 0) ?? 0;
  const quality = totalSamples ? Math.round((totalSamples - invalidSamples) / totalSamples * 10_000) / 100 : null;

  if (!assetId) return <article className="panel generic-trend-empty"><IconChartLine size={24} /><div><h2>Selecciona un activo</h2><p>Las tendencias se muestran dentro del contexto operacional seleccionado.</p></div></article>;

  return <div className="generic-trends">
    <section className="generic-trend-controls panel">
      <div>
        <label><span>Métrica principal</span><select value={selected?.optionId ?? ""} onChange={(event) => { setSelectedId(event.target.value); setComparisons([]); }}>
          {options.map((option) => <option key={option.optionId} value={option.optionId}>{option.deviceCode} · {option.name}</option>)}
        </select></label>
        <div className="generic-period-tabs">{PERIODS.map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div>
      </div>
      <div>
        <label><span>Comparar con</span><select value={candidate} onChange={(event) => setCandidate(event.target.value)} disabled={!compatible.length || comparisons.length >= 3}><option value="">Seleccionar métrica</option>{compatible.map((option) => <option key={option.optionId} value={option.optionId}>{option.deviceCode} · {option.name}</option>)}</select></label>
        <button className="secondary-button" disabled={!candidate || comparisons.length >= 3} onClick={() => { setComparisons((current) => [...current, candidate]); setCandidate(""); }}>Agregar</button>
        <button className="secondary-button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}><IconRefresh className={loading ? "spin" : ""} size={15} /> Actualizar</button>
        {canExport && <button className="primary-button" onClick={() => { downloadCsv(series); notify("Tendencia exportada con las métricas visibles.", "info"); }} disabled={!series.length}><IconDownload size={15} /> Exportar CSV</button>}
      </div>
    </section>

    {comparisons.length > 0 && <div className="generic-comparison-chips">{comparisons.map((id, index) => {
      const option = options.find((item) => item.optionId === id);
      return <button key={id} onClick={() => setComparisons((current) => current.filter((item) => item !== id))}><i style={{ background: SERIES_COLORS[index + 1] }} />{option?.deviceCode} · {option?.name}<b>×</b></button>;
    })}</div>}

    {error && <div className="data-error"><IconAlertTriangle size={18} /><div><strong>No se pudo cargar la tendencia</strong><p>{error}</p></div></div>}
    {!loading && !error && !options.length && <article className="panel generic-trend-empty"><IconChartLine size={24} /><div><h2>Sin métricas numéricas</h2><p>Este activo no tiene variables numéricas habilitadas para graficar.</p></div></article>}

    {selected && <section className="generic-trend-kpis">
      <article><small>Última lectura</small><strong>{valueLabel(last, selected.unit)}</strong><span>{selected.deviceCode} · {selected.name}</span></article>
      <article><small>Promedio</small><strong>{valueLabel(average, selected.unit)}</strong><span>En el período visible</span></article>
      <article><small>Rango</small><strong>{valueLabel(minimum, selected.unit)}</strong><span>máx. {valueLabel(maximum, selected.unit)}</span></article>
      <article><small>Calidad</small><strong>{quality === null ? "—" : `${quality}%`}</strong><span>{totalSamples.toLocaleString("es-CL")} muestras</span></article>
    </section>}

    {selected && <article className="panel generic-trend-chart">
      <header><div><span className="eyebrow">Tendencia normalizada</span><h2>{selected.name}</h2><p>{selected.deviceCode} · {selected.unit || "sin unidad"} · {period}</p></div><span><IconShieldCheck size={14} /> Histórico verificado</span></header>
      <div className="generic-chart-layout">
        <div className="generic-y-axis">{yTicks.map((tick, index) => <span key={index}>{valueLabel(tick, selected.unit)}</span>)}</div>
        <div className="generic-svg-wrap">
          <svg viewBox="0 0 1000 310" preserveAspectRatio="none" role="img" aria-label={`Tendencia de ${selected.name}`}>
            <g className="generic-grid-lines">{[40,102.5,165,227.5,290].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} />)}</g>
            {series.map((item, index) => <path key={item.option.optionId} d={linePath(item.response.points, fromMs, toMs, yMin, yMax)} fill="none" stroke={SERIES_COLORS[index]} strokeWidth="2.4" vectorEffect="non-scaling-stroke" />)}
          </svg>
          {loading && <div className="generic-chart-loading"><IconRefresh className="spin" size={20} /> Actualizando series…</div>}
        </div>
      </div>
      <div className="generic-x-axis">{xTicks.map((tick) => <span key={tick.toISOString()}>{new Intl.DateTimeFormat("es-CL", { day: period === "30 días" || period === "7 días" ? "2-digit" : undefined, hour: "2-digit", minute: "2-digit" }).format(tick)}</span>)}</div>
      <footer>{series.map((item, index) => <span key={item.option.optionId}><i style={{ background: SERIES_COLORS[index] }} />{item.option.deviceCode} · {item.option.name}</span>)}</footer>
    </article>}
  </div>;
}
