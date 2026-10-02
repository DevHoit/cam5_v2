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
type DetailTab = "summary" | "history" | "excursions" | "alarms" | "configuration";

type AlarmItem = {
  id: string;
  code: string;
  kind: string;
  severity: "normal" | "warning" | "critical";
  status: "open" | "acknowledged" | "resolved" | "closed";
  title: string;
  detail: string | null;
  triggerValue: number | null;
  thresholdValue: number | null;
  openedAt: string;
  lastObservedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};

type AlarmResponse = {
  items: AlarmItem[];
  total: number;
  summary: {
    critical: number;
    warning: number;
    resolved: number;
    unassigned: number;
    mttaMinutes: number;
  };
};

type ColdChainHistory = {
  schemaVersion: "2.0";
  serverTime: string;
  chamber: {
    id: string;
    code: string;
    name: string;
    area: string | null;
    state: string;
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
  canAcknowledge = false,
  canWrite = false,
  onConfigure,
  onChanged,
  onClose,
}: {
  chamberId: string;
  canAcknowledge?: boolean;
  canWrite?: boolean;
  onConfigure?: () => void;
  onChanged?: () => void;
  onClose: () => void;
}) {
  const [range, setRange] = useState<RangeKey>("24h");
  const [tab, setTab] = useState<DetailTab>("summary");
  const [data, setData] = useState<ColdChainHistory | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [alarmState, setAlarmState] = useState<{ status: "idle" | "loading" | "ready" | "error"; data: AlarmResponse | null }>({ status: "idle", data: null });
  const [alarmActionId, setAlarmActionId] = useState<string | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState("");

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

  useEffect(() => {
    if (tab !== "alarms") return;
    let active = true;
    const load = async () => {
      setAlarmState((current) => ({ status: "loading", data: current.data }));
      try {
        const response = await fetch("/api/v1/alarms?assetId=" + encodeURIComponent(chamberId) + "&pageSize=50", {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) throw new Error("No fue posible cargar las alarmas.");
        const payload = await response.json() as AlarmResponse;
        if (active) setAlarmState({ status: "ready", data: payload });
      } catch {
        if (active) setAlarmState((current) => ({ status: "error", data: current.data }));
      }
    };
    void load();
    return () => { active = false; };
  }, [chamberId, tab]);

  const acknowledgeAlarm = async (alarmId: string) => {
    setAlarmActionId(alarmId);
    try {
      const response = await fetch("/api/v1/alarms/" + encodeURIComponent(alarmId), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "acknowledge" }),
      });
      if (!response.ok) throw new Error("No fue posible reconocer la alarma.");
      const refresh = await fetch("/api/v1/alarms?assetId=" + encodeURIComponent(chamberId) + "&pageSize=50", {
        credentials: "include",
        cache: "no-store",
      });
      if (refresh.ok) setAlarmState({ status: "ready", data: await refresh.json() as AlarmResponse });
    } finally {
      setAlarmActionId(null);
    }
  };

  const setMaintenance = async (enabled: boolean) => {
    setOperationBusy(true);
    setOperationError("");
    try {
      const response = await fetch("/api/v1/cold-chain/configuration", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_maintenance", chamberId, enabled }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "No fue posible cambiar el modo de mantenimiento.");
      setData((current) => current ? {
        ...current,
        chamber: { ...current.chamber, state: enabled ? "maintenance" : "offline" },
      } : current);
      onChanged?.();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "No fue posible cambiar el modo de mantenimiento.");
    } finally {
      setOperationBusy(false);
    }
  };

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

      <nav className="cold-detail-tabs">
        {([
          ["summary", "Resumen"],
          ["history", "Histórico"],
          ["excursions", "Excursiones"],
          ["alarms", "Alarmas"],
          ["configuration", "Configuración"],
        ] as Array<[DetailTab, string]>).map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}
      </nav>

      {tab !== "alarms" && tab !== "configuration" && <nav className="cold-detail-range">
        {(["24h", "7d", "30d"] as RangeKey[]).map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}
      </nav>

      {status === "loading" && <div className="cold-detail-loading"><Refresh className="spin" size={22} /> Cargando histórico…</div>}
      {status === "error" && <div className="cold-detail-loading"><AlertTriangle size={22} /> No fue posible cargar el histórico.</div>}

      {status === "ready" && data && tab !== "alarms" && tab !== "configuration" && <>
        {(tab === "summary" || tab === "history") && <section className="cold-detail-kpis">
          <article><span>Mínima</span><strong>{temp(data.summary.minimumC)}</strong></article>
          <article><span>Máxima</span><strong>{temp(data.summary.maximumC)}</strong></article>
          <article><span>Promedio</span><strong>{temp(data.summary.averageC)}</strong></article>
          <article><span>Excursiones</span><strong>{data.summary.excursionCount}</strong></article>
          <article><span>Fuera de rango</span><strong>{duration(data.summary.totalOutOfRangeSeconds)}</strong></article>
          <article><span>Gaps de datos</span><strong>{data.summary.dataGapCount}</strong></article>
        </section>}

        {(tab === "summary" || tab === "history") && <section className="cold-detail-section">
          <div className="cold-detail-heading"><Thermometer size={18} /><div><h3>Histórico de temperatura</h3><p>Los saltos sin telemetría se muestran como discontinuidades; no se interpolan.</p></div></div>
          <HistoryChart data={data} />
        </section>}

        {(tab === "summary" || tab === "excursions") && <section className="cold-detail-section">
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
        </section>}

        {(tab === "summary" || tab === "excursions") && <section className="cold-detail-section">
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
        </section>}
      </>}

      {tab === "configuration" && status === "ready" && data && <section className="cold-detail-section">
        <div className="cold-detail-heading"><Thermometer size={18} /><div><h3>Configuración operacional</h3><p>Parámetros que gobiernan estado, excursiones y alarmas de esta cámara.</p></div></div>
        <div className="cold-config-summary-grid">
          <article><span>Rango permitido</span><strong>{data.chamber.config.minimumC === null || data.chamber.config.maximumC === null ? "Sin configurar" : temp(data.chamber.config.minimumC) + " a " + temp(data.chamber.config.maximumC)}</strong></article>
          <article><span>Objetivo</span><strong>{temp(data.chamber.config.targetC)}</strong></article>
          <article><span>Persistencia alarma</span><strong>{duration(data.chamber.config.excursionDelaySeconds)}</strong></article>
          <article><span>Lectura obsoleta</span><strong>{duration(data.chamber.config.staleAfterSeconds)}</strong></article>
          <article><span>Discrepancia máxima</span><strong>{data.chamber.config.disagreementThresholdC === null ? "Desactivada" : temp(data.chamber.config.disagreementThresholdC)}</strong></article>
          <article><span>Histéresis</span><strong>{temp(data.chamber.config.temperatureHysteresisC)}</strong></article>
          <article><span>Batería baja</span><strong>{data.chamber.config.batteryLowVoltage === null ? "Desactivada" : data.chamber.config.batteryLowVoltage.toFixed(2) + " V"}</strong></article>
          <article><span>Estado operacional</span><strong>{data.chamber.state === "maintenance" ? "Mantenimiento" : data.chamber.state}</strong></article>
        </div>

        {operationError && <div className="cold-config-error"><AlertTriangle size={16} /><span>{operationError}</span></div>}

        {canWrite && <div className="cold-operation-actions">
          {onConfigure && <button className="secondary-button" onClick={onConfigure}>Editar parámetros</button>}
          <button
            className={data.chamber.state === "maintenance" ? "secondary-button" : "primary-button"}
            disabled={operationBusy}
            onClick={() => void setMaintenance(data.chamber.state !== "maintenance")}
          >
            {operationBusy ? "Actualizando…" : data.chamber.state === "maintenance" ? "Salir de mantenimiento" : "Entrar en mantenimiento"}
          </button>
        </div>}

        <div className="cold-maintenance-note">
          <strong>Modo mantenimiento</strong>
          <p>La telemetría y la trazabilidad continúan. Las notificaciones de alarmas se suprimen mientras la cámara permanezca en mantenimiento.</p>
        </div>
      </section>}

      {tab === "alarms" && <section className="cold-detail-section">
        <div className="cold-detail-heading"><AlertTriangle size={18} /><div><h3>Alarmas operacionales</h3><p>Alarmas persistentes asociadas a esta cámara, independientes del análisis histórico de excursiones.</p></div></div>
        {alarmState.status === "loading" && <div className="cold-detail-loading"><Refresh className="spin" size={20} /> Cargando alarmas…</div>}
        {alarmState.status === "error" && !alarmState.data && <div className="cold-history-empty">No fue posible consultar las alarmas de esta cámara.</div>}
        {alarmState.data && <>
          <section className="cold-alarm-kpis">
            <article><span>Críticas activas</span><strong>{alarmState.data.summary.critical}</strong></article>
            <article><span>Advertencias activas</span><strong>{alarmState.data.summary.warning}</strong></article>
            <article><span>Resueltas</span><strong>{alarmState.data.summary.resolved}</strong></article>
          </section>
          {!alarmState.data.items.length ? <div className="cold-history-empty">Esta cámara todavía no registra alarmas.</div> : <div className="cold-alarm-list">
            {alarmState.data.items.map((alarm) => <article className={"cold-alarm-card cold-alarm-" + alarm.severity} key={alarm.id}>
              <header>
                <div><span>{alarm.code}</span><h4>{alarm.title}</h4></div>
                <b>{alarm.status === "open" ? "Abierta" : alarm.status === "acknowledged" ? "Reconocida" : alarm.status === "resolved" ? "Resuelta" : "Cerrada"}</b>
              </header>
              {alarm.detail && <p>{alarm.detail}</p>}
              <div className="cold-alarm-meta">
                <span>Inicio: {formatDate(alarm.openedAt)}</span>
                <span>Última observación: {formatDate(alarm.lastObservedAt)}</span>
              </div>
              {canAcknowledge && alarm.status === "open" && <footer>
                <button className="secondary-button" disabled={alarmActionId === alarm.id} onClick={() => void acknowledgeAlarm(alarm.id)}>
                  {alarmActionId === alarm.id ? "Reconociendo…" : "Reconocer alarma"}
                </button>
              </footer>}
            </article>)}
          </div>}
        </>}
      </section>}
    </section>
  </div>;
}
