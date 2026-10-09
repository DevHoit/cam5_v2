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
  triggerValue?: number | null;
  unit?: string | null;
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

function primaryMetricFor(assetType: string, metrics: Metric[]) {
  if (!metrics.length) return null;
  const normalized = metrics.map((metric) => ({
    metric,
    haystack: `${metric.key} ${metric.code} ${metric.name} ${metric.category}`.toLowerCase(),
  }));
  const preferences: Record<string, string[]> = {
    cold_room: ["temperature", "temperatura"],
    room_environment: ["temperature", "temperatura"],
    hvac: ["temperature", "temperatura"],
    electrical_point: ["active_power", "potencia activa", "power", "voltage", "tensión"],
    transformer: ["temperature", "temperatura", "voltage", "tensión"],
    generator: ["active_power", "potencia activa", "frequency", "frecuencia", "voltage", "tensión"],
    ups: ["load", "carga", "voltage", "tensión"],
    ats: ["transfer", "source", "fuente", "state", "estado"],
    motor: ["vibration", "vibración", "temperature", "temperatura", "current", "corriente"],
    pump: ["vibration", "vibración", "temperature", "temperatura", "current", "corriente"],
    compressor: ["temperature", "temperatura", "vibration", "vibración", "pressure", "presión"],
    fan: ["vibration", "vibración", "temperature", "temperatura"],
    conveyor: ["vibration", "vibración", "speed", "velocidad", "current", "corriente"],
    tank: ["level", "nivel", "temperature", "temperatura"],
    process_equipment: ["temperature", "temperatura", "pressure", "presión"],
  };
  const candidates = preferences[assetType] ?? [];
  for (const preferred of candidates) {
    const good = normalized.find(({ metric, haystack }) => metric.quality === "good" && metric.value !== null && haystack.includes(preferred));
    if (good) return good.metric;
  }
  const anyGood = metrics.find((metric) => metric.quality === "good" && metric.value !== null);
  return anyGood ?? metrics.find((metric) => metric.value !== null) ?? metrics[0];
}

function conditionLabel(state: "normal" | "warning" | "critical" | "offline") {
  if (state === "critical") return "Crítico";
  if (state === "warning") return "Atención";
  if (state === "offline") return "Sin datos";
  return "Normal";
}

function alarmSeverityLabel(severity: Alarm["severity"]) {
  if (severity === "critical") return "Crítica";
  if (severity === "warning") return "Advertencia";
  return "Informativa";
}

function capability(assetType: string) {
  if (assetType === "electrical_point") return { title: "Análisis eléctrico", detail: "Tensiones, corrientes, potencia, energía y calidad eléctrica.", view: "electrical", Icon: IconBolt };
  if (assetType === "ats") return { title: "Transferencia automática", detail: "Fuentes, breakers, posición de transferencia y estados.", view: "ats", Icon: IconArrowsExchange };
  if (assetType === "cold_room") return { title: "Cadena de frío", detail: "Temperaturas, sensores, batería, señal y excursiones.", view: "cold-chain", Icon: IconTemperature };
  return { title: "Vista de condición", detail: "Métricas normalizadas y estado del activo.", view: "cabinet", Icon: IconDeviceDesktopAnalytics };
}

function assetTypeLabel(assetType: string) {
  const labels: Record<string, string> = {
    general_asset: "Activo general",
    room_environment: "Sala / ambiente",
    cold_room: "Cámara de frío",
    hvac: "Climatización / HVAC",
    electrical_point: "Punto o sistema eléctrico",
    switchgear_cabinet: "Celda / tablero eléctrico",
    transformer: "Transformador",
    ats: "ATS / transferencia automática",
    generator: "Generador",
    ups: "UPS",
    motor: "Motor",
    pump: "Bomba",
    compressor: "Compresor",
    fan: "Ventilador",
    conveyor: "Correa transportadora",
    tank: "Estanque / depósito",
    process_equipment: "Equipo de proceso",
  };
  return labels[assetType] ?? assetType.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function deviceTypeLabel(deviceType: string) {
  if (deviceType === "power_meter") return "Medidor eléctrico";
  if (deviceType === "ats_controller") return "Controlador ATS";
  if (deviceType === "temperature_sensor") return "Sensor de temperatura";
  if (deviceType === "condition_monitor") return "Monitor de condición";
  return deviceType.replaceAll("_", " ");
}

function deviceStateLabel(state: string) {
  if (["active", "online", "normal"].includes(state)) return "Operativo";
  if (state === "commissioning" || state === "pending" || state === "draft") return "En puesta en marcha";
  if (state === "degraded" || state === "warning") return "Atención";
  if (state === "maintenance") return "Mantenimiento";
  if (state === "critical") return "Crítico";
  return "Sin conexión";
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
  const latestMetricAt = metrics.map((metric) => metric.recordedAt).filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
  const feature = capability(asset.type);
  const FeatureIcon = feature.Icon;
  const activeAlarmCount = alarmSummary.critical + alarmSummary.warning;
  const primaryMetric = primaryMetricFor(asset.type, metrics);
  const degradedData = staleMetrics.length > 0 || badMetrics.length > 0 || (devices.length > 0 && activeDevices < devices.length);
  const overall: "normal" | "warning" | "critical" | "offline" = alarmSummary.critical ? "critical"
    : alarmSummary.warning ? "warning"
      : !devices.length || !metrics.length || !validMetrics.length ? "offline"
        : degradedData ? "warning"
          : "normal";

  if (loading && !data) return <div className="universal-asset-overview asset-overview-v3" aria-live="polite" aria-busy="true">
    <section className="asset-overview-header">
      <div className="asset-overview-identity"><h1>{asset.name}</h1><p>{asset.area || "Estado operacional"}</p></div>
      <span className="asset-overview-loading"><IconRefresh className="spin" size={14} /> Actualizando datos</span>
    </section>
    <section className="asset-loading-grid" aria-hidden="true"><i /><i /><i /><i /></section>
    <section className="asset-loading-panel"><span>Consultando métricas y eventos del activo…</span></section>
  </div>;

  return <div className="universal-asset-overview universal-asset-overview-v6">
    <section className={`asset-overview-header asset-overview-header-v6 state-${overall}`}>
      <div className="asset-overview-identity"><h1>{asset.name}</h1><p>{assetTypeLabel(asset.type)} · {asset.area || "Ubicación sin definir"}{devices.length ? ` · ${devices.length} dispositivo${devices.length === 1 ? "" : "s"}` : ""}</p></div>
      <div className="asset-overview-header-actions-v6">
        <span className={`status-pill status-${overall}`}>{overall === "critical" ? "Condición crítica" : overall === "warning" ? "Atención requerida" : overall === "offline" ? devices.length ? "Sin telemetría" : "Sin monitoreo" : "Operativo"}</span>
        {activeAlarmCount > 0 && <button className="asset-alert-action-v6" onClick={() => onNavigate("alarms")}><IconAlertTriangle size={15} /> {activeAlarmCount} alerta{activeAlarmCount === 1 ? "" : "s"}</button>}
        <button className="asset-refresh-action-v6" aria-label="Actualizar activo" title="Actualizar datos" onClick={() => { setLoading(true); setError(""); setReload((value) => value + 1); }}><IconRefresh className={loading ? "spin" : ""} size={16} /></button>
      </div>
    </section>

    {error && <div className="data-error"><IconAlertTriangle size={18} /><div><strong>No se pudo actualizar el activo</strong><p>{error}</p></div></div>}

    {!devices.length ? <section className="asset-monitoring-empty-v6">
      <span className="asset-monitoring-empty-icon-v6"><IconServer size={20} /></span>
      <div>
        <small>Monitoreo no configurado</small>
        <strong>Este activo todavía no tiene una fuente de datos asociada</strong>
        <p>Asocia un sensor, medidor o controlador para comenzar a recibir telemetría, evaluar condición y generar alertas.</p>
      </div>
      <div className="asset-monitoring-empty-meta-v6">
        <span><b>0</b><small>Dispositivos</small></span>
        <span><b>0</b><small>Métricas</small></span>
        <span><b>{activeAlarmCount}</b><small>Alertas activas</small></span>
      </div>
      <button onClick={() => onNavigate("engineering")}><IconDeviceDesktopAnalytics size={16} /> Configurar monitoreo <IconArrowRight size={15} /></button>
    </section> : <section className="universal-asset-kpis universal-asset-kpis-v6" aria-label="Estado principal del activo">
      <article><span className={overall}>{overall === "normal" ? <IconCircleCheck size={20} /> : <IconAlertTriangle size={20} />}</span><div><small>Condición</small><strong className="asset-kpi-text">{conditionLabel(overall)}</strong><p>{overall === "normal" ? "Operación sin eventos ni datos degradados" : overall === "critical" ? "Existe una condición crítica activa" : overall === "warning" ? "Requiere revisión operacional" : "No hay datos vigentes para evaluar"}</p></div></article>
      <article><span className={primaryMetric?.quality === "good" ? "info" : "warning"}><FeatureIcon size={20} /></span><div><small>Variable principal</small><strong>{primaryMetric ? formatValue(primaryMetric) : "—"}</strong><p>{primaryMetric ? primaryMetric.name : "Sin una variable disponible"}</p></div></article>
      <article><span className={activeAlarmCount ? "critical" : "normal"}><IconAlertTriangle size={20} /></span><div><small>Alertas activas</small><strong>{activeAlarmCount}</strong><p>{alarmSummary.critical} críticas · {alarmSummary.warning} advertencias</p></div></article>
      <article><span className={latestMetricAt ? "info" : "warning"}><IconClock size={20} /></span><div><small>Última actualización</small><strong className="asset-kpi-time">{data && latestMetricAt ? formatAge(latestMetricAt, data.serverTime) : "Sin datos"}</strong><p>{latestMetricAt ? new Intl.DateTimeFormat("es-CL", { timeStyle: "medium" }).format(new Date(latestMetricAt)) : "Esperando telemetría"}</p></div></article>
    </section>}

    {devices.length > 0 && <section className="universal-asset-layout">
      <article className="panel universal-metrics-panel">
        <header><div><h2>Variables monitoreadas</h2><p>Lecturas actuales de los sensores, medidores o controladores asociados a <strong>{asset.name}</strong>.</p></div><button className="secondary-button" onClick={() => onNavigate(feature.view as "electrical" | "ats" | "cold-chain" | "cabinet")}><FeatureIcon size={16} /> Abrir {feature.title.toLowerCase()}</button></header>
        <div className="universal-device-list">
          {devices.map((device) => <section key={device.id} className="universal-device-block">
            <div className="universal-device-head"><span><IconServer size={16} /></span><div><strong>{device.name}</strong><small>{deviceTypeLabel(device.deviceType)} · Comunicación {formatAge(device.lastReadAt, data?.serverTime ?? new Date().toISOString()).toLowerCase()}</small></div><i className={`status-pill status-${["active", "online", "normal"].includes(device.state) ? "normal" : device.state === "critical" ? "critical" : "offline"}`}>{deviceStateLabel(device.state)}</i></div>
            <div className="universal-metric-grid">{device.metrics.slice(0, 12).map((metric) => <article key={metric.id} className={`metric-quality-${metric.quality}`}>
              <small>{metric.category}</small><strong>{formatValue(metric)}</strong><span>{metric.name}</span><em>{metric.quality === "good" ? "Vigente" : metric.quality === "stale" ? "Atrasada" : "Revisar"}</em>
            </article>)}</div>
          </section>)}
          {!devices.length && !loading && <div className="table-empty-state"><IconServer size={21} /><div><strong>Sin dispositivos con métricas</strong><p>Asocia al activo un sensor, medidor o controlador desde Activos o Ingeniería.</p></div></div>}
        </div>
      </article>

      <aside className="universal-asset-side">
        <article className="panel universal-alarm-card">
          <header><div><h2>Alertas activas</h2><p>{activeAlarmCount ? "Eventos que requieren atención en este activo." : "No existen eventos abiertos para este activo."}</p></div><span className={activeAlarmCount ? "alarm-count active" : "alarm-count"}>{activeAlarmCount}</span></header>
          <div>{alarms.slice(0, 4).map((alarm) => <div key={alarm.id}><i className={`priority-state ${alarm.severity === "critical" ? "critical" : "warning"}`} /><span><strong>{alarm.title}</strong><small>{alarmSeverityLabel(alarm.severity)} · {formatAge(alarm.openedAt, data?.serverTime ?? new Date().toISOString())}{alarm.triggerValue !== null && alarm.triggerValue !== undefined ? ` · ${alarm.triggerValue}${alarm.unit ? ` ${alarm.unit}` : ""}` : ""}</small></span></div>)}
          {!alarms.length && <div className="universal-all-clear"><IconCircleCheck size={20} /><span><strong>Sin alertas activas</strong><small>El activo no registra eventos pendientes.</small></span></div>}</div>
          <button className="text-action" onClick={() => onNavigate("alarms")}>Ver centro de alertas <IconArrowRight size={15} /></button>
        </article>

        <article className="panel universal-monitoring-card">
          <header><h2>Monitoreo</h2><p>Estado de las fuentes de datos asociadas al activo.</p></header>
          <dl>
            <div><dt>Dispositivos operativos</dt><dd>{activeDevices} / {devices.length}</dd></div>
            <div><dt>Métricas vigentes</dt><dd>{validMetrics.length} / {metrics.length}</dd></div>
            <div><dt>Datos atrasados</dt><dd className={staleMetrics.length ? "attention" : ""}>{staleMetrics.length}</dd></div>
            <div><dt>Datos inválidos</dt><dd className={badMetrics.length ? "attention" : ""}>{badMetrics.length}</dd></div>
          </dl>
        </article>

        <button className="panel universal-engineering-link" onClick={() => onNavigate("engineering")}><IconDeviceDesktopAnalytics size={20} /><span><strong>Ingeniería del activo</strong><small>Configuración técnica, dispositivos y diagnóstico</small></span><IconArrowRight size={16} /></button>
      </aside>
    </section>}
  </div>;
}
