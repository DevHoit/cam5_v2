"use client";

import { useEffect, useMemo, useState } from "react";
import { IconChartLine as ChartLine, IconRefresh as Refresh, IconX as X } from "@tabler/icons-react";

type RangeKey = "2h" | "24h" | "7d" | "30d";

type MetricOption = { key: string; name: string; unit: string; dataType: string };

type HistoryResponse = {
  range: { from: string; to: string; source: string; bucketSeconds: number | null };
  metric: { key: string; name: string; unit: string };
  points: Array<{ recordedAt: string; value: number | string | boolean | null; minimum: number | null; maximum: number | null; sampleCount: number }>;
};

type EventsResponse = {
  range: { from: string; to: string; truncated?: boolean };
  events: Array<{
    recordedAt: string;
    deviceCode: string;
    metricKey: string;
    metricName: string;
    previousValue: string | null;
    value: string | null;
    initialObservation: boolean;
  }>;
};

function rangeStart(range: RangeKey) {
  const hours = range === "2h" ? 2 : range === "24h" ? 24 : range === "7d" ? 168 : 720;
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function labelValue(metricKey: string, value: string | null) {
  if (value === null) return "Sin dato";
  if (metricKey.includes("available")) return value === "true" ? "Disponible" : value === "false" ? "No disponible" : value;
  if (metricKey.includes("breaker")) return value === "true" ? "Cerrado" : value === "false" ? "Abierto" : value;
  if (metricKey === "ats.common_alarm") return value === "true" ? "Alarma activa" : value === "false" ? "Sin alarma" : value;
  return value;
}

function HistoryChart({ data }: { data: HistoryResponse }) {
  const values = data.points.filter((point): point is typeof point & { value: number } => typeof point.value === "number" && Number.isFinite(point.value));
  if (values.length < 2) return <div className="electrical-history-empty">No hay suficientes muestras para graficar este período.</div>;
  const width = 960;
  const height = 250;
  const padX = 46;
  const padY = 24;
  const from = new Date(data.range.from).getTime();
  const to = new Date(data.range.to).getTime();
  let min = Math.min(...values.map((point) => point.minimum ?? point.value));
  let max = Math.max(...values.map((point) => point.maximum ?? point.value));
  if (min === max) { min -= 1; max += 1; }
  const margin = (max - min) * 0.08;
  min -= margin; max += margin;
  const x = (iso: string) => padX + ((new Date(iso).getTime() - from) / Math.max(1, to - from)) * (width - padX * 2);
  const y = (value: number) => height - padY - ((value - min) / Math.max(0.000001, max - min)) * (height - padY * 2);
  const path = values.map((point, index) => `${index ? "L" : "M"} ${x(point.recordedAt).toFixed(2)} ${y(point.value).toFixed(2)}`).join(" ");
  return <div className="electrical-history-chart"><svg viewBox={`0 0 ${width} ${height}`}>
    {[0, .25, .5, .75, 1].map((ratio) => {
      const yy = padY + ratio * (height - padY * 2);
      const label = max - ratio * (max - min);
      return <g key={ratio}><line x1={padX} x2={width - padX} y1={yy} y2={yy} className="electrical-grid-line" /><text x={padX - 8} y={yy + 4} textAnchor="end" className="electrical-axis-label">{label.toFixed(1)}</text></g>;
    })}
    <path d={path} className="electrical-history-line" />
  </svg></div>;
}

export function AtsHistoryDialog({
  assetId,
  controller,
  metrics,
  onClose,
}: {
  assetId: string;
  controller: { id: string; code: string; name: string };
  metrics: MetricOption[];
  onClose: () => void;
}) {
  const numericMetrics = useMemo(() => metrics.filter((item) => item.dataType === "float" || item.dataType === "integer"), [metrics]);
  const [range, setRange] = useState<RangeKey>("24h");
  const [metricKey, setMetricKey] = useState(numericMetrics.find((item) => item.key === "ats.load.power.active.total")?.key ?? numericMetrics[0]?.key ?? "");
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [events, setEvents] = useState<EventsResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    const load = async () => {
      setStatus("loading");
      const to = new Date();
      const from = rangeStart(range);
      try {
        const eventParams = new URLSearchParams({ assetId, from: from.toISOString(), to: to.toISOString() });
        const eventPromise = fetch("/api/v1/ats/events?" + eventParams, { credentials: "include", cache: "no-store" });
        const historyPromise = metricKey
          ? fetch("/api/v1/telemetry/metrics/history?" + new URLSearchParams({ deviceId: controller.id, metric: metricKey, from: from.toISOString(), to: to.toISOString() }), { credentials: "include", cache: "no-store" })
          : Promise.resolve(null);
        const [eventResponse, historyResponse] = await Promise.all([eventPromise, historyPromise]);
        if (!eventResponse.ok || (historyResponse && !historyResponse.ok)) throw new Error("No fue posible cargar el histórico ATS.");
        const eventPayload = await eventResponse.json() as EventsResponse;
        const historyPayload = historyResponse ? await historyResponse.json() as HistoryResponse : null;
        if (!active) return;
        setEvents(eventPayload);
        setHistory(historyPayload);
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    };
    void load();
    return () => { active = false; };
  }, [assetId, controller.id, metricKey, range]);

  return <div className="cold-config-backdrop" role="presentation">
    <section className="cold-config-dialog ats-history-dialog" role="dialog" aria-modal="true">
      <header>
        <div><span><ChartLine size={16} /></span><div><strong>Histórico ATS · {controller.code}</strong><small>{controller.name}</small></div></div>
        <button onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
      </header>
      <div className="electrical-history-controls">
        <label><span>Variable continua</span><select value={metricKey} onChange={(event) => setMetricKey(event.target.value)}>{numericMetrics.map((item) => <option key={item.key} value={item.key}>{item.name}{item.unit ? " (" + item.unit + ")" : ""}</option>)}</select></label>
        <nav>{(["2h","24h","7d","30d"] as RangeKey[]).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}</nav>
      </div>
      {status === "loading" && <div className="electrical-history-empty"><Refresh className="spin" size={18} /> Cargando histórico ATS…</div>}
      {status === "error" && <div className="electrical-history-empty">No fue posible cargar el histórico ATS.</div>}
      {status === "ready" && <>
        {history && <>
          <div className="electrical-history-meta">
            <span>{history.range.bucketSeconds ? `Resolución ${history.range.bucketSeconds >= 3600 ? history.range.bucketSeconds / 3600 + " h" : history.range.bucketSeconds / 60 + " min"}` : "Resolución cruda"}</span>
            <span>{history.points.reduce((sum, point) => sum + point.sampleCount, 0)} muestras representadas</span>
          </div>
          <HistoryChart data={history} />
        </>}
        <section className="ats-event-history">
          <h3>Eventos de estado y transferencia</h3>
          {!events?.events.length && <p>No se registraron cambios de estado en el período.</p>}
          <div>{events?.events.slice().reverse().map((event, index) => <article key={event.recordedAt + event.metricKey + index}>
            <time>{new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "medium" }).format(new Date(event.recordedAt))}</time>
            <span><strong>{event.metricName}</strong><small>{event.deviceCode}</small></span>
            <b>{event.initialObservation ? labelValue(event.metricKey, event.value) : `${labelValue(event.metricKey, event.previousValue)} → ${labelValue(event.metricKey, event.value)}`}</b>
          </article>)}</div>
          {events?.range.truncated && <p>La lista alcanzó el límite de 1.000 transiciones. Reduce el rango para ver el detalle completo.</p>}
        </section>
      </>}
    </section>
  </div>;
}
