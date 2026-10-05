"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconArrowsExchange,
  IconBolt,
  IconCircleCheck,
  IconClock,
  IconDeviceDesktopAnalytics,
  IconRefresh,
  IconServer,
  IconTemperature,
} from "@tabler/icons-react";

type Asset = {
  id: string;
  code: string;
  name: string;
  area: string | null;
  type: string;
  state: string;
};

type Alarm = {
  id: string;
  severity: "normal" | "warning" | "critical";
  title: string;
  code: string;
  openedAt: string;
};

type Metric = {
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

type Device = {
  id: string;
  code: string;
  name: string;
  deviceType: string;
  driver: string;
  state: string;
  lastReadAt: string | null;
  staleAfterSeconds: number;
  metrics: Metric[];
};

type ResponseData = {
  schemaVersion: "2.0";
  serverTime: string;
  assets: Array<{
    id: string;
    code: string;
    name: string;
    assetType: string;
    state: string;
    devices: Device[];
  }>;
};

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "include", cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "No fue posible consultar las métricas del activo.");
  }
  return response.json() as Promise<T>;
}

function formatValue(metric: Metric) {
  if (metric.value === null || metric.value === undefined) return "—";
  if (typeof metric.value === "boolean") return metric.value ? "Sí" : "No";
  if (typeof metric.value === "number") {
    const formatted = Number.isInteger(metric.value) ? String(metric.value) : metric.value.toFixed(2).replace(/0+$/, "").replace(/.$/, "");
    return metric.unit ? `${formatted} ${metric.unit}` : formatted;
  }
  return metric.unit ? `${metric.value} ${metric.unit}` : String(metric.value);
}

function formatAge(value: string | null, reference: string) {
  if (!value) return "Sin lectura";
  const seconds = Math.max(0, Math.round((new Date(reference).getTime() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `Hace ${seconds} s`;
  if (seconds < 3600) return `Hace ${Math.round(seconds / 60)} min`;
  return `Hace ${Math.round(seconds / 3600)} h`;
}

function capability(assetType: string) {
  if (assetType === "electrical_point") return { title: "Análisis eléctrico", detail: "Tensiones, corrientes, potencia, energía y calidad eléctrica.", view: "electrical", Icon: IconBolt };
  if (assetType === "ats") return { title: "Transferencia automática", detail: "Fuentes, breakers, posición de transferencia y estados.", view: "ats", Icon: IconArrowsExchange };
  if (assetType === "cold_room") return { title: "Cadena de frío", detail: "Temperaturas, sensores, batería, señal y excursiones.", view: "cold-chain", Icon: IconTemperature };
  return { title: "Vista de condición", detail: "Métricas normalizadas y estado del activo.", view: "cabinet", Icon: IconDeviceDesktopAnalytics };
}

export function UniversalAssetOverview({
  asset,
  alarms,
  alarmSummary,
  onNavigate,
}: {
  asset: Asset;
  alarms: Alarm[];
  alarmSummary: { critical: number; warning: number };
  onNavigate: (view: "electrical" | "ats" | "cold-chain" | "cabinet" | "alarms" | "engineering") => void;
}) {
  const [data, setData] = useState<ResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void requestJson<ResponseData>(`/api/v1/telemetry/metrics/latest?assetId=${encodeURIComponent(asset.id)}`)
      .then((result) => { if (alive) setData(result); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "No fue posible consultar el activo."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [asset.id, reload]);

  const current = data?.assets.find((item) => item.id === asset.id) ?? null;
  const devices = useMemo(() => current?.devices ?? [], [current]);
  const metrics = useMemo(() => devices.flatMap((device) => device.metrics), [devices]);
  const validMetrics = metrics.filter((metric) => metric.quality === "good" && metric.value !== null);
  const staleMetrics = metrics.filter((metric) => metric.quality === "stale");
  const badMetrics = metrics.filter((metric) => metric.quality === "bad");
  const activeDevices = devices.filter((device) => ["active", "online", "normal"].includes(device.state)).length;
  const latestAt = devices.map((device) => device.lastReadAt).filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
  const feature = capability(asset.type);
  const FeatureIcon = feature.Icon;
  const activeAlarmCount = alarmSummary.critical + alarmSummary.warning;
  const overall = alarmSummary.critical ? "critical"
    : alarmSummary.warning ? "warning"
      : devices.length && activeDevices < devices.length ? "warning"
        : metrics.length && !validMetrics.length ? "offline"
          : "normal";

  if (loading && !data) return <div className="universal-asset-overview asset-overview-v3" aria-live="polite" aria-busy="true">
    <section className="asset-overview-header">
      <div className="asset-overview-identity"><span className="asset-overview-code">{asset.code}</span><h1>{asset.name}</h1><p>{asset.area || "Estado operacional"}</p></div>
      <span className="asset-overview-loading"><IconRefresh className="spin" size={14} /> Actualizando datos</span>
    </section>
    <section className="asset-loading-grid" aria-hidden="true"><i /><i /><i /><i /></section>
    <section className="asset-loading-panel"><span>Consultando métricas y eventos del activo…</span></section>
  </div>;

  return <div className="universal-asset-overview">
    <section className={`asset-overview-header state-${overall}`}>
      <div className="asset-overview-identity"><span className="asset-overview-code">{asset.code}</span><h1>{asset.name}</h1><p>{asset.area || feature.title}</p></div>
      <div className="asset-overview-health"><span className={`status-pill status-${overall}`}>{overall === "critical" ? "Condición crítica" : overall === "warning" ? "Atención requerida" : overall === "offline" ? "Datos no disponibles" : "Operativo"}</span><span>{data && latestAt ? `Última telemetría ${formatAge(latestAt, data.serverTime).toLowerCase()}` : "Sin telemetría disponible"}</span></div>
      <div className="asset-overview-actions"><button onClick={() => onNavigate(feature.view as "electrical" | "ats" | "cold-chain" | "cabinet")}><FeatureIcon size={15} /> {feature.title}</button><button onClick={() => onNavigate("alarms")}><IconAlertTriangle size={15} /> Alertas {activeAlarmCount ? `· ${activeAlarmCount}` : ""}</button><button aria-label="Actualizar activo" onClick={() => { setLoading(true); setError(""); setReload((value) => value + 1); }}><IconRefresh className={loading ? "spin" : ""} size={15} /></button></div>
    </section>

    {error && <div className="data-error"><IconAlertTriangle size={18} /><div><strong>No se pudo actualizar el activo</strong><p>{error}</p></div></div>}

    <section className="universal-asset-kpis">
      <article><span className={activeAlarmCount ? "critical" : "normal"}><IconAlertTriangle size={19} /></span><div><small>Alertas activas</small><strong>{activeAlarmCount}</strong><p>{alarmSummary.critical} críticas · {alarmSummary.warning} advertencias</p></div></article>
      <article><span className={devices.length && activeDevices === devices.length ? "normal" : "warning"}><IconServer size={19} /></span><div><small>Dispositivos</small><strong>{activeDevices}/{devices.length}</strong><p>{devices.length ? "Con estado operativo" : "Sin dispositivos registrados"}</p></div></article>
      <article><span className={!staleMetrics.length && !badMetrics.length ? "normal" : "warning"}><IconCircleCheck size={19} /></span><div><small>Calidad de métricas</small><strong>{validMetrics.length}/{metrics.length}</strong><p>{staleMetrics.length} atrasadas · {badMetrics.length} inválidas</p></div></article>
      <article><span className={latestAt ? "info" : "warning"}><IconClock size={19} /></span><div><small>Última lectura</small><strong>{data && latestAt ? formatAge(latestAt, data.serverTime) : "Sin datos"}</strong><p>{latestAt ? new Intl.DateTimeFormat("es-CL", { timeStyle: "medium" }).format(new Date(latestAt)) : "Esperando telemetría"}</p></div></article>
    </section>

    <section className="universal-asset-layout">
      <article className="panel universal-metrics-panel">
        <header><div><h2>Métricas del activo</h2><p>Variables vigentes reportadas por los dispositivos asociados.</p></div><button className="secondary-button" onClick={() => onNavigate(feature.view as "electrical" | "ats" | "cold-chain" | "cabinet")}><FeatureIcon size={15} /> {feature.title}</button></header>
        <div className="universal-device-list">
          {devices.map((device) => <section key={device.id} className="universal-device-block">
            <div className="universal-device-head"><span><IconServer size={16} /></span><div><strong>{device.code} · {device.name}</strong><small>{device.deviceType.replaceAll("_", " ")} · {formatAge(device.lastReadAt, data?.serverTime ?? new Date().toISOString())}</small></div><i className={`status-pill status-${["active", "online", "normal"].includes(device.state) ? "normal" : "offline"}`}>{device.state}</i></div>
            <div className="universal-metric-grid">{device.metrics.slice(0, 12).map((metric) => <article key={metric.id} className={`metric-quality-${metric.quality}`}>
              <small>{metric.category}</small><strong>{formatValue(metric)}</strong><span>{metric.name}</span><em>{metric.quality === "good" ? "Vigente" : metric.quality === "stale" ? "Atrasada" : "Revisar"}</em>
            </article>)}</div>
          </section>)}
          {!devices.length && !loading && <div className="table-empty-state"><IconServer size={21} /><div><strong>Sin dispositivos con métricas</strong><p>Asocia un dispositivo al activo desde Organización o Ingeniería.</p></div></div>}
        </div>
      </article>

      <aside className="universal-asset-side">
        <article className="panel universal-capability-card">
          <span><FeatureIcon size={22} /></span>
          <div><h2>{feature.title}</h2><p>{feature.detail}</p></div>
          <button onClick={() => onNavigate(feature.view as "electrical" | "ats" | "cold-chain" | "cabinet")}>Abrir capacidad <IconArrowRight size={15} /></button>
        </article>
        <article className="panel universal-alarm-card">
          <header><h2>Actividad y alertas</h2></header>
          <div>{alarms.slice(0, 4).map((alarm) => <div key={alarm.id}><i className={`priority-state ${alarm.severity === "critical" ? "critical" : "warning"}`} /><span><strong>{alarm.title}</strong><small>{alarm.code}</small></span></div>)}
          {!alarms.length && <div className="universal-all-clear"><IconCircleCheck size={20} /><span>Sin alertas activas</span></div>}</div>
          <button className="text-action" onClick={() => onNavigate("alarms")}>Gestionar alertas <IconArrowRight size={15} /></button>
        </article>
        <button className="panel universal-engineering-link" onClick={() => onNavigate("engineering")}><IconDeviceDesktopAnalytics size={20} /><span><strong>Ingeniería del activo</strong><small>Dispositivos, configuración y puesta en marcha</small></span><IconArrowRight size={16} /></button>
      </aside>
    </section>
  </div>;
}
