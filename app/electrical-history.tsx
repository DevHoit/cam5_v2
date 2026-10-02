"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconChartLine as ChartLine,
  IconRefresh as Refresh,
  IconX as X,
} from "@tabler/icons-react";

type RangeKey = "2h" | "24h" | "7d" | "30d";

type MetricOption = {
  key: string;
  name: string;
  unit: string;
};

type HistoryResponse = {
  range: {
    from: string;
    to: string;
    source: "raw" | "stored_aggregate" | "hybrid" | "raw_grouped_fallback";
    bucketSeconds: number | null;
  };
  device: { id: string; code: string; name: string };
  metric: { key: string; name: string; unit: string; dataType: string };
  points: Array<{
    recordedAt: string;
    value: number | boolean | string | null;
    minimum: number | null;
    maximum: number | null;
    quality: string;
    sampleCount: number;
    invalidSampleCount: number;
  }>;
};

function rangeStart(range: RangeKey) {
  const hours = range === "2h" ? 2 : range === "24h" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function formatNumber(value: number | null, unit: string) {
  if (value === null || !Number.isFinite(value)) return "—";
  const digits = Math.abs(value) >= 100 ? 1 : Math.abs(value) >= 10 ? 2 : 3;
  return value.toFixed(digits) + (unit ? " " + unit : "");
}

function HistoryChart({ data }: { data: HistoryResponse }) {
  const values = data.points.filter((point): point is typeof point & { value: number } => typeof point.value === "number" && Number.isFinite(point.value));
  if (values.length < 2) return <div className="electrical-history-empty">No hay suficientes muestras para graficar este período.</div>;

  const width = 960;
  const height = 280;
  const padX = 46;
  const padY = 24;
  const from = new Date(data.range.from).getTime();
  const to = new Date(data.range.to).getTime();
  const minimums = values.map((point) => point.minimum ?? point.value);
  const maximums = values.map((point) => point.maximum ?? point.value);
  let min = Math.min(...minimums);
  let max = Math.max(...maximums);
  if (min === max) {
    min -= Math.max(1, Math.abs(min) * 0.02);
    max += Math.max(1, Math.abs(max) * 0.02);
  }
  const margin = (max - min) * 0.08;
  min -= margin;
  max += margin;
  const x = (iso: string) => padX + ((new Date(iso).getTime() - from) / Math.max(1, to - from)) * (width - padX * 2);
  const y = (value: number) => height - padY - ((value - min) / Math.max(0.000001, max - min)) * (height - padY * 2);
  const gapThresholdMs = Math.max(
    (data.range.bucketSeconds ?? 0) * 1.75 * 1000,
    data.range.bucketSeconds ? 0 : 60_000,
  );

  const segments: string[] = [];
  let current = "";
  let previousAt: number | null = null;
  for (const point of values) {
    const at = new Date(point.recordedAt).getTime();
    if (previousAt !== null && at - previousAt > gapThresholdMs) {
      if (current) segments.push(current);
      current = "";
    }
    current += (current ? " L " : "M ") + x(point.recordedAt).toFixed(2) + " " + y(point.value).toFixed(2);
    previousAt = at;
  }
  if (current) segments.push(current);

  return <div className="electrical-history-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Histórico de ${data.metric.name}`}>
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const yy = padY + ratio * (height - padY * 2);
        const label = max - ratio * (max - min);
        return <g key={ratio}>
          <line x1={padX} x2={width - padX} y1={yy} y2={yy} className="electrical-grid-line" />
          <text x={padX - 8} y={yy + 4} textAnchor="end" className="electrical-axis-label">{label.toFixed(1)}</text>
        </g>;
      })}
      {segments.map((path, index) => <path key={index} d={path} className="electrical-history-line" />)}
    </svg>
  </div>;
}

export function ElectricalHistoryDialog({
  device,
  metrics,
  onClose,
}: {
  device: { id: string; code: string; name: string };
  metrics: MetricOption[];
  onClose: () => void;
}) {
  const defaultMetric = metrics.find((item) => item.key === "electrical.power.active.total")?.key ?? metrics[0]?.key ?? "";
  const [range, setRange] = useState<RangeKey>("24h");
  const [metricKey, setMetricKey] = useState(defaultMetric);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!metricKey) return;
    let active = true;
    const load = async () => {
      const to = new Date();
      const from = rangeStart(range);
      try {
        const params = new URLSearchParams({
          deviceId: device.id,
          metric: metricKey,
          from: from.toISOString(),
          to: to.toISOString(),
        });
        const response = await fetch("/api/v1/telemetry/metrics/history?" + params, { credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error("No fue posible cargar el histórico.");
        const payload = await response.json() as HistoryResponse;
        if (active) {
          setData(payload);
          setStatus("ready");
        }
      } catch {
        if (active) setStatus("error");
      }
    };
    void load();
    return () => { active = false; };
  }, [device.id, metricKey, range]);

  const numericValues = useMemo(() => data?.points
    .flatMap((point) => typeof point.value === "number" && Number.isFinite(point.value) ? [point.value] : []) ?? [], [data]);
  const minimums = useMemo(() => data?.points.flatMap((point) => point.minimum === null ? [] : [point.minimum]) ?? [], [data]);
  const maximums = useMemo(() => data?.points.flatMap((point) => point.maximum === null ? [] : [point.maximum]) ?? [], [data]);
  const average = numericValues.length ? numericValues.reduce((sum, item) => sum + item, 0) / numericValues.length : null;
  const minimum = minimums.length ? Math.min(...minimums) : null;
  const maximum = maximums.length ? Math.max(...maximums) : null;

  return <div className="cold-config-backdrop" role="presentation">
    <section className="cold-config-dialog electrical-history-dialog" role="dialog" aria-modal="true">
      <header>
        <div><span><ChartLine size={16} /></span><div><strong>Histórico eléctrico · {device.code}</strong><small>{device.name}</small></div></div>
        <button onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
      </header>
      <div className="electrical-history-controls">
        <label><span>Variable</span><select value={metricKey} onChange={(event) => { setStatus("loading"); setMetricKey(event.target.value); }}>{metrics.map((item) => <option key={item.key} value={item.key}>{item.name}{item.unit ? " (" + item.unit + ")" : ""}</option>)}</select></label>
        <nav>{(["2h", "24h", "7d", "30d"] as RangeKey[]).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => { setStatus("loading"); setRange(item); }}>{item}</button>)}</nav>
      </div>

      {status === "loading" && <div className="electrical-history-empty"><Refresh className="spin" size={18} /> Cargando histórico…</div>}
      {status === "error" && <div className="electrical-history-empty">No fue posible cargar el histórico.</div>}
      {status === "ready" && data && <>
        <div className="electrical-history-meta">
          <span>{data.range.bucketSeconds ? `Resolución ${data.range.bucketSeconds >= 3600 ? data.range.bucketSeconds / 3600 + " h" : data.range.bucketSeconds / 60 + " min"}` : "Resolución cruda"}</span>
          <span>{data.points.reduce((sum, point) => sum + point.sampleCount, 0)} muestras representadas</span>
          <span>{data.range.source === "hybrid" ? "Agregado + telemetría reciente" : data.range.source === "stored_aggregate" ? "Agregado almacenado" : data.range.source === "raw_grouped_fallback" ? "Agrupación dinámica" : "Telemetría cruda"}</span>
        </div>
        <div className="electrical-history-kpis">
          <article><span>Mínimo</span><strong>{formatNumber(minimum, data.metric.unit)}</strong></article>
          <article><span>Promedio visual</span><strong>{formatNumber(average, data.metric.unit)}</strong></article>
          <article><span>Máximo</span><strong>{formatNumber(maximum, data.metric.unit)}</strong></article>
        </div>
        <HistoryChart data={data} />
        <p className="electrical-history-note">Los períodos sin telemetría se representan como discontinuidades; el portal no interpola lecturas faltantes.</p>
      </>}
    </section>
  </div>;
}
