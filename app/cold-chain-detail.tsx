"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle as AlertTriangle,
  IconClock as Clock,
  IconRefresh as Refresh,
  IconTemperature as Thermometer,
  IconX as X,
} from "@tabler/icons-react";

type RangeKey = "24h" | "7d" | "30d";

type ColdChainHistory = {
  schemaVersion: "2.0";
  serverTime: string;
  chamber: {
    id: string;
    code: string;
    name: string;
    area: string | null;
    config: {
      minimumC: number | null;
      maximumC: number | null;
      targetC: number | null;
      staleAfterSeconds: number;
      disagreementThresholdC: number | null;
      excursionDelaySeconds: number;
      batteryLowVoltage: number | null;
      temperatureHysteresisC: number;
    };
  };
  range: { from: string; to: string };
  summary: {
    minimumC: number | null;
    maximumC: number | null;
    averageC: number | null;
    excursionCount: number;
    totalOutOfRangeSeconds: number;
    dataGapCount: number;
  };
  sensors: Array<{
    id: string;
    code: string;
    name: string;
    points: Array<{ recordedAt: string; valueC: number | null; quality: string }>;
    summary: {
      minimumC: number | null;
      maximumC: number | null;
      averageC: number | null;
      samples: number;
      goodSamples: number;
    };
  }>;
  excursions: Array<{
    type: "low" | "high" | "data_gap";
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number;
    extremeC: number | null;
    thresholdC: number | null;
    active: boolean;
    sensorId: string;
    sensorCode: string;
    sensorName: string;
  }>;
};

function temp(value: number | null) {
  return value === null ? "—" : value.toFixed(1) + " °C";
}

function duration(seconds: number) {
  if (seconds < 60) return seconds + " s";
  if (seconds < 3600) return Math.round(seconds / 60) + " min";
  const hours = seconds / 3600;
  return hours < 24 ? hours.toFixed(1) + " h" : (hours / 24).toFixed(1) + " d";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function rangeStart(key: RangeKey) {
  const now = new Date();
  const ms = key === "24h" ? 24 * 60 * 60 * 1000 : key === "7d" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms);
}

function HistoryChart({ data }: { data: ColdChainHistory }) {
  const width = 860;
  const height = 280;
  const pad = { left: 48, right: 18, top: 18, bottom: 28 };
  const usableW = width - pad.left - pad.right;
  const usableH = height - pad.top - pad.bottom;
  const from = new Date(data.range.from).getTime();
  const to = new Date(data.range.to).getTime();

  const allValues = data.sensors.flatMap((sensor) => sensor.points)
    .filter((point) => point.valueC !== null && point.quality === "good")
    .map((point) => point.valueC as number);

  const thresholds = [data.chamber.config.minimumC, data.chamber.config.maximumC].filter((value): value is number => value !== null);
  const values = [...allValues, ...thresholds];
  if (!values.length) return <div className="cold-history-empty">No hay datos de temperatura para graficar en este rango.</div>;

  let minY = Math.min(...values);
  let maxY = Math.max(...values);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const margin = Math.max(0.5, (maxY - minY) * 0.12);
  minY -= margin;
  maxY += margin;

  const x = (iso: string) => pad.left + ((new Date(iso).getTime() - from) / Math.max(1, to - from)) * usableW;
  const y = (value: number) => pad.top + (1 - (value - minY) / (maxY - minY)) * usableH;

  const yTicks = Array.from({ length: 5 }, (_, index) => minY + ((maxY - minY) * index) / 4);

  return <div className="cold-history-chart-wrap">
    <svg className="cold-history-chart" viewBox={"0 0 " + width + " " + height} role="img" aria-label="Histórico de temperatura">
      {yTicks.map((tick) => <g key={tick}>
        <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="cold-chart-grid" />
        <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" className="cold-chart-label">{tick.toFixed(1)}°</text>
      </g>)}

      {data.chamber.config.minimumC !== null && <line x1={pad.left} x2={width - pad.right} y1={y(data.chamber.config.minimumC)} y2={y(data.chamber.config.minimumC)} className="cold-chart-threshold" />}
      {data.chamber.config.maximumC !== null && <line x1={pad.left} x2={width - pad.right} y1={y(data.chamber.config.maximumC)} y2={y(data.chamber.config.maximumC)} className="cold-chart-threshold" />}

      {data.sensors.map((sensor, sensorIndex) => {
        const valid = sensor.points.filter((point) => point.valueC !== null && point.quality === "good");
        const chunks: typeof valid[] = [];
        let chunk: typeof valid = [];
        for (let index = 0; index < valid.length; index += 1) {
          const point = valid[index];
          const previous = index > 0 ? valid[index - 1] : null;
          if (previous && new Date(point.recordedAt).getTime() - new Date(previous.recordedAt).getTime() > data.chamber.config.staleAfterSeconds * 1000) {
            if (chunk.length) chunks.push(chunk);
            chunk = [];
          }
          chunk.push(point);
        }
        if (chunk.length) chunks.push(chunk);

        return <g key={sensor.id} className={"cold-chart-series cold-chart-series-" + (sensorIndex % 6)}>
          {chunks.map((points, chunkIndex) => <polyline
            key={chunkIndex}
            fill="none"
            points={points.map((point) => x(point.recordedAt) + "," + y(point.valueC as number)).join(" ")}
          />)}
        </g>;
      })}

      <text x={pad.left} y={height - 7} className="cold-chart-label">{formatDate(data.range.from)}</text>
      <text x={width - pad.right} y={height - 7} textAnchor="end" className="cold-chart-label">{formatDate(data.range.to)}</text>
    </svg>
    <div className="cold-history-legend">
      {data.sensors.map((sensor, index) => <span key={sensor.id}><i className={"cold-legend-line cold-chart-series-" + (index % 6)} />{sensor.code}</span>)}
      <span><i className="cold-legend-line cold-chart-threshold" />Límites configurados</span>
    </div>
  </div>;
}

export function ColdChainDetail({
  chamberId,
  onClose,
}: {
  chamberId: string;
  onClose: () => void;
}) {
  const [range, setRange] = useState<RangeKey>("24h");
  const [data, setData] = useState<ColdChainHistory | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    const from = rangeStart(range);
    const to = new Date();
    setStatus("loading");
    fetch("/api/v1/cold-chain/history?chamberId=" + encodeURIComponent(chamberId) + "&from=" + encodeURIComponent(from.toISOString()) + "&to=" + encodeURIComponent(to.toISOString()), {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("No fue posible cargar el histórico.");
        return response.json() as Promise<ColdChainHistory>;
      })
      .then((payload) => { if (active) { setData(payload); setStatus("ready"); } })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [chamberId, range]);

  const thermalExcursions = useMemo(() => data?.excursions.filter((item) => item.type !== "data_gap") ?? [], [data]);

  return <div className="cold-detail-backdrop" onMouseDown={onClose}>
    <section className="cold-detail-panel" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div>
          <span className="eyebrow">Detalle de cámara</span>
          <h2>{data?.chamber.code ?? "Cámara"} · {data?.chamber.name ?? "Histórico"}</h2>
          <p>{data?.chamber.area || "Sitio activo"}</p>
        </div>
        <button onClick={onClose} aria-label="Cerrar"><X size={19} /></button>
      </header>

      <nav className="cold-detail-range">
        {(["24h", "7d", "30d"] as RangeKey[]).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}
      </nav>

      {status === "loading" && <div className="cold-detail-loading"><Refresh className="spin" size={22} /> Cargando histórico…</div>}
      {status === "error" && <div className="cold-detail-loading"><AlertTriangle size={22} /> No fue posible cargar el histórico.</div>}

      {status === "ready" && data && <>
        <section className="cold-detail-kpis">
          <article><span>Mínima</span><strong>{temp(data.summary.minimumC)}</strong></article>
          <article><span>Máxima</span><strong>{temp(data.summary.maximumC)}</strong></article>
          <article><span>Promedio</span><strong>{temp(data.summary.averageC)}</strong></article>
          <article><span>Excursiones</span><strong>{data.summary.excursionCount}</strong></article>
          <article><span>Fuera de rango</span><strong>{duration(data.summary.totalOutOfRangeSeconds)}</strong></article>
          <article><span>Gaps de datos</span><strong>{data.summary.dataGapCount}</strong></article>
        </section>

        <section className="cold-detail-section">
          <div className="cold-detail-heading"><Thermometer size={18} /><div><h3>Histórico de temperatura</h3><p>Los saltos sin telemetría se muestran como discontinuidades; no se interpolan.</p></div></div>
          <HistoryChart data={data} />
        </section>

        <section className="cold-detail-section">
          <div className="cold-detail-heading"><AlertTriangle size={18} /><div><h3>Excursiones térmicas</h3><p>Se consideran sólo después del tiempo de persistencia configurado.</p></div></div>
          {!thermalExcursions.length ? <div className="cold-history-empty">No se detectaron excursiones térmicas en este rango.</div> : <div className="cold-excursion-table">
            <div className="cold-excursion-head"><span>Sensor</span><span>Tipo</span><span>Inicio</span><span>Duración</span><span>Extremo</span><span>Estado</span></div>
            {thermalExcursions.map((item, index) => <div className="cold-excursion-row" key={item.sensorId + item.startedAt + index}>
              <span><strong>{item.sensorCode}</strong><small>{item.sensorName}</small></span>
              <span>{item.type === "high" ? "Alta temperatura" : "Baja temperatura"}</span>
              <span>{formatDate(item.startedAt)}</span>
              <span>{duration(item.durationSeconds)}</span>
              <span>{temp(item.extremeC)}</span>
              <span>{item.active ? "Activa" : "Finalizada"}</span>
            </div>)}
          </div>}
        </section>

        <section className="cold-detail-section">
          <div className="cold-detail-heading"><Clock size={18} /><div><h3>Disponibilidad de datos</h3><p>Los periodos sin lectura suficiente se separan de las excursiones térmicas.</p></div></div>
          {data.excursions.filter((item) => item.type === "data_gap").length === 0 ? <div className="cold-history-empty">Sin gaps de datos detectados.</div> :
            <div className="cold-excursion-table">
              {data.excursions.filter((item) => item.type === "data_gap").map((item, index) => <div className="cold-excursion-row cold-gap-row" key={item.sensorId + item.startedAt + index}>
                <span><strong>{item.sensorCode}</strong><small>{item.sensorName}</small></span>
                <span>Sin telemetría</span>
                <span>{formatDate(item.startedAt)}</span>
                <span>{duration(item.durationSeconds)}</span>
                <span>—</span>
                <span>{item.active ? "Activo" : "Finalizado"}</span>
              </div>)}
            </div>}
        </section>
      </>}
    </section>
  </div>;
}
