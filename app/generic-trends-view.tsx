"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
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
  assets: Array<{ id: string; code: string; name: string; assetType: string; devices: LatestDevice[] }>;
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
const SERIES_COLORS = ["#0284c7", "#4f46e5", "#0891b2", "#64748b"];

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

function preferredMetricId(asset: LatestResponse["assets"][number] | undefined) {
  if (!asset) return "";
  const numeric = asset.devices.flatMap((device) => device.metrics
    .filter((metric) => metric.dataType === "float" || metric.dataType === "integer")
    .map((metric) => ({ device, metric, haystack: `${metric.key} ${metric.code} ${metric.name} ${metric.category}`.toLowerCase() })));
  if (!numeric.length) return "";
  const preferences: Record<string, string[]> = {
    cold_room: ["temperature", "temperatura"],
    room_environment: ["temperature", "temperatura"],
    hvac: ["temperature", "temperatura"],
    electrical_point: ["active_power", "potencia activa", "power", "voltage", "tensión"],
    transformer: ["temperature", "temperatura", "voltage", "tensión"],
    generator: ["active_power", "potencia activa", "frequency", "frecuencia"],
    ups: ["load", "carga", "voltage", "tensión"],
    motor: ["vibration", "vibración", "temperature", "temperatura", "current", "corriente"],
    pump: ["vibration", "vibración", "temperature", "temperatura", "current", "corriente"],
    compressor: ["temperature", "temperatura", "vibration", "vibración", "pressure", "presión"],
    fan: ["vibration", "vibración", "temperature", "temperatura"],
    conveyor: ["vibration", "vibración", "speed", "velocidad"],
    tank: ["level", "nivel", "temperature", "temperatura"],
    process_equipment: ["temperature", "temperatura", "pressure", "presión"],
  };
  for (const preferred of preferences[asset.assetType] ?? []) {
    const match = numeric.find(({ metric, haystack }) => metric.quality === "good" && metric.value !== null && haystack.includes(preferred))
      ?? numeric.find(({ haystack }) => haystack.includes(preferred));
    if (match) return `${match.device.id}::${match.metric.key}`;
  }
  const good = numeric.find(({ metric }) => metric.quality === "good" && metric.value !== null) ?? numeric[0];
  return `${good.device.id}::${good.metric.key}`;
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
        const defaultId = preferredMetricId(asset);
        const preferred = initialMetricKey
          ? asset?.devices.flatMap((device) => device.metrics.map((metric) => ({ device, metric, optionId: `${device.id}::${metric.key}` })))
              .find(({ metric, optionId }) => optionId === initialMetricKey || metric.key === initialMetricKey || metric.code === initialMetricKey)
          : null;
        setSelectedId((current) => current || (preferred ? preferred.optionId : defaultId));
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
  const primaryPoints = primarySeries?.response.points.filter((point) => typeof point.value === "number" && point.quality !== "bad") ?? [];
  const weighted = primaryPoints.reduce((acc, point) => {
    const goodSamples = Math.max(0, point.sampleCount - point.invalidSampleCount);
    return { sum: acc.sum + Number(point.value) * goodSamples, count: acc.count + goodSamples };
  }, { sum: 0, count: 0 });
  const average = weighted.count ? weighted.sum / weighted.count : null;
  const minimumValues = primaryPoints.flatMap((point) => typeof point.minimum === "number" ? [point.minimum] : [Number(point.value)]);
  const maximumValues = primaryPoints.flatMap((point) => typeof point.maximum === "number" ? [point.maximum] : [Number(point.value)]);
  const minimum = minimumValues.length ? Math.min(...minimumValues) : null;
  const maximum = maximumValues.length ? Math.max(...maximumValues) : null;
  const last = primaryPoints.length ? Number(primaryPoints[primaryPoints.length - 1].value) : null;
  const totalSamples = primarySeries?.response.points.reduce((sum, point) => sum + point.sampleCount, 0) ?? 0;
  const invalidSamples = primarySeries?.response.points.reduce((sum, point) => sum + point.invalidSampleCount, 0) ?? 0;
  const quality = totalSamples ? Math.round((totalSamples - invalidSamples) / totalSamples * 10_000) / 100 : null;
  const asset = latest?.assets.find((item) => item.id === assetId) ?? null;
  const hasHistory = primaryPoints.length > 0;

  if (!assetId) return <section className="temporal-empty-state"><span><IconChartLine size={24} /></span><div><h1>Selecciona un activo</h1><p>El análisis temporal necesita un activo para consultar métricas e historial.</p></div></section>;

  return <div className="generic-trends trends-v4">
    <section className="trend-commandbar">
      <div><h1>Tendencias</h1><span>{asset?.name ?? "Activo seleccionado"}</span></div>
      <div className="trend-command-actions">
        <span className="trend-history-state"><i /> Historial de telemetría</span>
        <button className="trend-refresh" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} aria-label="Actualizar tendencias" title="Actualizar tendencias"><IconRefresh className={loading ? "spin" : ""} size={16} /></button>
        {canExport && <button className="secondary-button" onClick={() => { downloadCsv(series); notify("Tendencia exportada con las métricas visibles.", "info"); }} disabled={!series.length}><IconDownload size={16} /> Exportar CSV</button>}
      </div>
    </section>

    <section className="generic-trend-controls panel">
      <div className="trend-primary-controls-v4">
        <label className="trend-metric-select"><span>Variable a analizar</span><select disabled={!options.length} value={selected?.optionId ?? ""} onChange={(event) => { setSelectedId(event.target.value); setComparisons([]); }}>
          {!options.length && <option value="">{loading ? "Consultando variables…" : "Sin variables configuradas"}</option>}
          {options.map((option) => <option key={option.optionId} value={option.optionId}>{option.name}{option.deviceName ? ` · ${option.deviceName}` : ""}</option>)}
        </select></label>
        <div className="trend-period-group"><span>Período</span><div className="generic-period-tabs">{PERIODS.map((item) => <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
      </div>
      <div className="trend-compare-controls-v4">
        <label><span>Comparar con</span><select value={candidate} onChange={(event) => setCandidate(event.target.value)} disabled={!compatible.length || comparisons.length >= 3}><option value="">Seleccionar otra variable</option>{compatible.map((option) => <option key={option.optionId} value={option.optionId}>{option.name}{option.deviceName ? ` · ${option.deviceName}` : ""}</option>)}</select></label>
        <button className="secondary-button" disabled={!candidate || comparisons.length >= 3} onClick={() => { setComparisons((current) => [...current, candidate]); setCandidate(""); }}>Agregar comparación</button>
        <small>Sólo se comparan variables con la misma unidad.</small>
      </div>
    </section>

    {!loading && !error && !options.length && <section className="panel core-settings-empty"><IconChartLine size={22} /><div><strong>Sin variables para analizar</strong><p>Asocia un dispositivo y configura sus métricas desde Ingeniería para consultar tendencias.</p></div></section>}

    {comparisons.length > 0 && <div className="generic-comparison-chips">{comparisons.map((id, index) => {
      const option = options.find((item) => item.optionId === id);
      return <button key={id} onClick={() => setComparisons((current) => current.filter((item) => item !== id))}><i style={{ background: SERIES_COLORS[index + 1] }} />{option?.name}{option?.deviceName ? ` · ${option.deviceName}` : ""}<b>×</b></button>;
    })}</div>}

    {error && <div className="data-error"><IconAlertTriangle size={18} /><div><strong>No se pudo cargar la tendencia</strong><p>{error}</p></div></div>}
    {!loading && !error && !options.length && <article className="panel generic-trend-empty"><IconChartLine size={24} /><div><h2>Sin métricas numéricas</h2><p>Este activo todavía no tiene métricas numéricas disponibles para graficar.</p></div></article>}

    {selected && <section className="generic-trend-kpis" aria-label="Resumen del período">
      <article><span className="trend-kpi-icon info"><IconChartLine size={19} /></span><div><small>Última lectura</small><strong>{valueLabel(last, selected.unit)}</strong><p>{selected.name}</p></div></article>
      <article><span className="trend-kpi-icon neutral"><IconShieldCheck size={19} /></span><div><small>Promedio</small><strong>{valueLabel(average, selected.unit)}</strong><p>Promedio ponderado del período</p></div></article>
      <article><span className="trend-kpi-icon low"><IconArrowDown size={19} /></span><div><small>Mínimo</small><strong>{valueLabel(minimum, selected.unit)}</strong><p>Menor valor observado</p></div></article>
      <article><span className="trend-kpi-icon high"><IconArrowUp size={19} /></span><div><small>Máximo</small><strong>{valueLabel(maximum, selected.unit)}</strong><p>Mayor valor observado</p></div></article>
    </section>}

    {selected && <article className="panel generic-trend-chart">
      <header><div><h2>{selected.name}</h2><p>{selected.deviceName}{selected.unit ? ` · ${selected.unit}` : ""} · período ${period}</p></div><span className={quality !== null && quality < 100 ? "trend-quality attention" : "trend-quality"}><IconShieldCheck size={15} /> {quality === null ? "Sin muestras" : `${quality}% datos válidos`}</span></header>
      <div className="generic-chart-layout">
        <div className="generic-y-axis">{yTicks.map((tick, index) => <span key={index}>{valueLabel(tick, selected.unit)}</span>)}</div>
        <div className="generic-svg-wrap">
          <svg viewBox="0 0 1000 310" preserveAspectRatio="none" role="img" aria-label={`Tendencia de ${selected.name}`}>
            <g className="generic-grid-lines">{[40,102.5,165,227.5,290].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} />)}</g>
            {series.map((item, index) => <path key={item.option.optionId} d={linePath(item.response.points, fromMs, toMs, yMin, yMax)} fill="none" stroke={SERIES_COLORS[index]} strokeWidth="2.4" vectorEffect="non-scaling-stroke" />)}
          </svg>
          {loading && <div className="generic-chart-loading"><IconRefresh className="spin" size={20} /> Actualizando series…</div>}
          {!loading && !hasHistory && <div className="generic-chart-no-data"><IconChartLine size={22} /><span><strong>Sin datos en este período</strong><small>Prueba un rango mayor o revisa la adquisición del activo.</small></span></div>}
        </div>
      </div>
      <div className="generic-x-axis">{xTicks.map((tick) => <span key={tick.toISOString()}>{new Intl.DateTimeFormat("es-CL", { day: period === "30 días" || period === "7 días" ? "2-digit" : undefined, hour: "2-digit", minute: "2-digit" }).format(tick)}</span>)}</div>
      <footer>{series.map((item, index) => <span key={item.option.optionId}><i style={{ background: SERIES_COLORS[index] }} />{item.option.name}{item.option.deviceName ? ` · ${item.option.deviceName}` : ""}</span>)}</footer>
    </article>}
  </div>;
}
