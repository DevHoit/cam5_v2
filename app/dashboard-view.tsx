"use client";

import { useEffect, useState } from "react";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBuildingFactory2 as BuildingFactory2,
  IconCircleCheck,
  IconActivity,
  IconClock,
  IconRefresh,
  IconServer,
  IconTopologyStar3,
} from "@tabler/icons-react";

type DashboardResponse = {
  generatedAt: string;
  client: { id: string; code: string; name: string };
  activeSiteId: string;
  summary: {
    sites: number;
    assets: number;
    healthyAssets: number;
    devices: number;
    gateways: number;
    critical: number;
    warning: number;
    unhealthyGateways: number;
    unhealthyDevices: number;
    activeMaintenance: number;
    scheduledMaintenance: number;
    onCallTotal: number;
    onCallCovered: number;
    onCallIssues: number;
  };
  sites: Array<{
    id: string;
    code: string;
    name: string;
    assets: number;
    normalAssets: number;
    criticalAlarms: number;
    warningAlarms: number;
    gatewaysOnline: number;
    gatewaysTotal: number;
    devicesOnline: number;
    devicesTotal: number;
    healthPercent: number;
  }>;
  priorityAssets: Array<{
    id: string;
    siteId: string;
    code: string;
    name: string;
    area: string | null;
    assetType: string;
    state: string;
    criticalAlarms: number;
    warningAlarms: number;
    latestAlarmAt: string | null;
  }>;
  priorityAlarms: Array<{
    id: string;
    siteId: string;
    assetId: string;
    code: string;
    severity: "normal" | "warning" | "critical";
    status: string;
    title: string;
    openedAt: string;
    assetCode: string;
    assetName: string;
  }>;
};

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "No fue posible completar la solicitud.");
  }
  return response.json() as Promise<T>;
}

function relativeTime(value: string, reference: string) {
  const seconds = Math.max(0, Math.round((new Date(reference).getTime() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `Hace ${seconds} s`;
  if (seconds < 3600) return `Hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `Hace ${Math.round(seconds / 3600)} h`;
  return `Hace ${Math.round(seconds / 86400)} d`;
}

function assetTypeLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function DashboardView({
  onSwitchSite,
  onSelectAsset,
  onOpenAlerts,
  onOpenOperations,
}: {
  onSwitchSite: (siteId: string) => void;
  onSelectAsset: (siteId: string, assetId: string) => void;
  onOpenAlerts: () => void;
  onOpenOperations: () => void;
}) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void requestJson<DashboardResponse>("/api/v1/dashboard")
      .then((result) => { if (alive) setData(result); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "No fue posible cargar el Dashboard."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reload]);

  const refresh = () => {
    setLoading(true);
    setError("");
    setReload((current) => current + 1);
  };

  if (loading && !data) return <article className="panel dashboard-state"><IconRefresh className="spin" size={22} /><div><strong>Cargando operación</strong><p>Consolidando sitios, activos, alertas y adquisición.</p></div></article>;
  if (error && !data) return <article className="panel dashboard-state dashboard-state-error"><IconAlertTriangle size={22} /><div><strong>No fue posible cargar el Dashboard</strong><p>{error}</p></div><button className="secondary-button" onClick={refresh}>Reintentar</button></article>;
  if (!data) return null;

  const assetHealthPercent = data.summary.assets
    ? Math.round(data.summary.healthyAssets / data.summary.assets * 100)
    : null;
  const monitoredEndpoints = data.summary.gateways + data.summary.devices;
  const acquisitionIssues = data.summary.unhealthyGateways + data.summary.unhealthyDevices;
  const onlineEndpoints = Math.max(0, monitoredEndpoints - acquisitionIssues);
  const connectivityPercent = monitoredEndpoints ? Math.round(onlineEndpoints / monitoredEndpoints * 100) : null;
  const activeAlerts = data.summary.critical + data.summary.warning;

  return <div className="portfolio-dashboard dashboard-v3">
    <section className="dashboard-commandbar">
      <div>
        <h1>Estado de la operación</h1>
        <span className="dashboard-client-context">{data.client.name}</span>
      </div>
      <div className="dashboard-commandbar-actions">
        <span className="dashboard-live-status"><i /> En línea</span>
        <span><IconClock size={14} /> Actualizado {new Intl.DateTimeFormat("es-CL", { timeStyle: "short" }).format(new Date(data.generatedAt))}</span>
        <button className="dashboard-refresh" onClick={refresh} disabled={loading} aria-label="Actualizar Dashboard"><IconRefresh className={loading ? "spin" : ""} size={16} /></button>
      </div>
    </section>

    {error && <div className="data-error"><IconAlertTriangle size={18} /><div><strong>Actualización parcial</strong><p>{error}</p></div></div>}

    <section className="dashboard-status-strip">
      <button onClick={onOpenAlerts}>
        <span className={activeAlerts ? "status-icon critical" : "status-icon neutral"}><IconAlertTriangle size={18} /></span>
        <div><small>Alertas activas</small><strong>{activeAlerts}</strong><p>{data.summary.critical} críticas · {data.summary.warning} advertencias</p></div>
        <IconArrowRight size={15} />
      </button>
      <article>
        <span className="status-icon neutral"><IconTopologyStar3 size={18} /></span>
        <div><small>Activos saludables</small><strong>{assetHealthPercent === null ? "—" : `${assetHealthPercent}%`}</strong><p>{data.summary.assets ? `${data.summary.healthyAssets} de ${data.summary.assets} en condición normal` : "Sin activos monitoreados"}</p></div>
      </article>
      <article>
        <span className={acquisitionIssues ? "status-icon warning" : "status-icon neutral"}><IconServer size={18} /></span>
        <div><small>Conectividad</small><strong>{connectivityPercent === null ? "—" : `${connectivityPercent}%`}</strong><p>{monitoredEndpoints ? `${onlineEndpoints}/${monitoredEndpoints} gateways y dispositivos disponibles` : "Sin equipos conectados"}</p></div>
      </article>
      <article>
        <span className="status-icon neutral"><BuildingFactory2 size={18} /></span>
        <div><small>Sitios monitoreados</small><strong>{data.summary.sites}</strong><p>{data.summary.assets} activos · {data.summary.devices} dispositivos</p></div>
      </article>
    </section>

    <section className="dashboard-layout">
      <article className="panel dashboard-sites">
        <header className="dashboard-section-head">
          <div><h2>Operación por sitio</h2><p>Estado, cobertura y conectividad de la operación.</p></div>
        </header>
        <div className="dashboard-site-list">
          {data.sites.map((site) => {
            const attention = site.criticalAlarms + site.warningAlarms;
            const hasMonitoring = site.assets > 0 || site.gatewaysTotal > 0 || site.devicesTotal > 0;
            const stateLabel = !hasMonitoring ? "Sin monitoreo" : site.criticalAlarms ? "Crítico" : site.warningAlarms ? "Atención" : "Operación normal";
            const stateClass = !hasMonitoring ? "unmonitored" : site.criticalAlarms ? "critical" : site.warningAlarms ? "warning" : "normal";
            return <button key={site.id} className={`dashboard-site-row ${site.id === data.activeSiteId ? "active" : ""}`} onClick={() => onSwitchSite(site.id)}>
              <span className="dashboard-site-icon"><BuildingFactory2 size={18} /></span>
              <span className="dashboard-site-name"><strong>{site.name}</strong><small>{site.code}</small></span>
              <span className={`dashboard-site-state ${stateClass}`}><b>{stateLabel}</b><small>{hasMonitoring ? `${site.assets} activos · ${site.devicesTotal} dispositivos` : "Sin activos ni dispositivos asociados"}</small></span>
              <span className="dashboard-site-connectivity"><strong>{site.gatewaysOnline}/{site.gatewaysTotal}</strong><small>gateways</small></span>
              <span className="dashboard-site-connectivity"><strong>{site.devicesOnline}/{site.devicesTotal}</strong><small>dispositivos</small></span>
              <span className={`dashboard-site-alerts ${site.criticalAlarms ? "critical" : attention ? "warning" : hasMonitoring ? "normal" : "unmonitored"}`}>{site.criticalAlarms ? `${site.criticalAlarms} críticas` : attention ? `${attention} alertas` : hasMonitoring ? "Sin alertas" : "Configurar"}</span>
              <span className="dashboard-site-action">{hasMonitoring ? "Ver sitio" : "Configurar"} <IconArrowRight size={14} /></span>
            </button>;
          })}
          {!data.sites.length && <div className="table-empty-state"><BuildingFactory2 size={21} /><div><strong>Sin sitios activos</strong><p>La organización aún no tiene sitios disponibles para este usuario.</p></div></div>}
        </div>
      </article>

      <aside className="dashboard-priority-column">
        <article className="panel dashboard-priority dashboard-attention">
          <header className="dashboard-section-head compact"><div><h2>Atención operacional</h2><p>{data.priorityAssets.length ? `${data.priorityAssets.length} activos requieren revisión` : "Incidencias que requieren una acción"}</p></div></header>
          <div className="dashboard-priority-list">
            {data.priorityAssets.map((asset) => <button key={asset.id} onClick={() => onSelectAsset(asset.siteId, asset.id)}>
              <span className={`priority-state ${asset.criticalAlarms ? "critical" : asset.warningAlarms ? "warning" : "offline"}`} />
              <span><strong>{asset.code} · {asset.name}</strong><small>{asset.area || assetTypeLabel(asset.assetType)}{asset.latestAlarmAt ? ` · ${relativeTime(asset.latestAlarmAt, data.generatedAt)}` : ""}</small></span>
              <span className="priority-count">{asset.criticalAlarms ? `${asset.criticalAlarms} crítica${asset.criticalAlarms === 1 ? "" : "s"}` : asset.warningAlarms ? `${asset.warningAlarms} advertencia${asset.warningAlarms === 1 ? "" : "s"}` : asset.state}</span>
              <IconArrowRight size={15} />
            </button>)}
            {!data.priorityAssets.length && <div className="dashboard-all-clear compact"><IconCircleCheck size={21} /><div><strong>Sin incidencias que requieran atención</strong><p>La operación no registra activos en condición crítica o de advertencia.</p></div></div>}
          </div>
        </article>

        <article className="panel dashboard-activity">
          <header className="dashboard-section-head compact"><div><h2>Actividad reciente</h2><p>Eventos operacionales que explican el estado actual.</p></div><button className="text-inline-button" onClick={onOpenAlerts}>Ver todas</button></header>
          <div className="dashboard-alarm-list">
            {data.priorityAlarms.slice(0, 5).map((alarm) => <button key={alarm.id} onClick={() => onSelectAsset(alarm.siteId, alarm.assetId)}>
              <i className={`priority-state ${alarm.severity === "critical" ? "critical" : "warning"}`} />
              <span><strong>{alarm.title}</strong><small>{alarm.assetCode} · {relativeTime(alarm.openedAt, data.generatedAt)}</small></span>
              <IconArrowRight size={15} />
            </button>)}
            {!data.priorityAlarms.length && <div className="dashboard-empty-activity"><IconActivity size={20} /><div><strong>Sin actividad reciente</strong><p>Los eventos aparecerán aquí a medida que la operación genere información relevante.</p></div></div>}
          </div>
        </article>
      </aside>
    </section>

    <section className="panel dashboard-timeline">
      <header className="dashboard-section-head">
        <div><h2>Actividad de las últimas 24 horas</h2><p>Vista temporal de eventos y alertas disponibles en la operación.</p></div>
        <span className="dashboard-timeline-total">{data.priorityAlarms.length} eventos visibles</span>
      </header>
      <div className="dashboard-timeline-track">
        {Array.from({ length: 12 }).map((_, index) => {
          const now = new Date(data.generatedAt).getTime();
          const from = now - (12 - index) * 2 * 60 * 60 * 1000;
          const to = from + 2 * 60 * 60 * 1000;
          const count = data.priorityAlarms.filter((alarm) => {
            const time = new Date(alarm.openedAt).getTime();
            return time >= from && time < to;
          }).length;
          const max = Math.max(1, ...Array.from({ length: 12 }).map((__, slot) => {
            const slotFrom = now - (12 - slot) * 2 * 60 * 60 * 1000;
            const slotTo = slotFrom + 2 * 60 * 60 * 1000;
            return data.priorityAlarms.filter((alarm) => {
              const time = new Date(alarm.openedAt).getTime();
              return time >= slotFrom && time < slotTo;
            }).length;
          }));
          return <span key={index} title={`${count} eventos`}><i style={{ height: count ? `${Math.max(18, Math.round(count / max * 100))}%` : "4px" }} /></span>;
        })}
      </div>
      <div className="dashboard-timeline-axis"><span>24 h</span><span>18 h</span><span>12 h</span><span>6 h</span><span>Ahora</span></div>
    </section>
  </div>
}
