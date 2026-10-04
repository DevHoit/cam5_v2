"use client";

import { useEffect, useState } from "react";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBuildingFactory2 as BuildingFactory2,
  IconCircleCheck,
  IconClock,
  IconRefresh,
  IconServer,
  IconTool,
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
    : 100;
  const acquisitionIssues = data.summary.unhealthyGateways + data.summary.unhealthyDevices;
  const activeAlerts = data.summary.critical + data.summary.warning;

  return <div className="portfolio-dashboard">
    <section className="dashboard-hero panel">
      <div>
        <span className="eyebrow">Vista cliente</span>
        <h2>{data.client.name}</h2>
        <p>Condición consolidada de la operación, independiente del fabricante o protocolo de cada dispositivo.</p>
      </div>
      <div className="dashboard-hero-actions">
        <span><IconClock size={14} /> Actualizado {new Intl.DateTimeFormat("es-CL", { timeStyle: "short" }).format(new Date(data.generatedAt))}</span>
        <button className="secondary-button" onClick={refresh} disabled={loading}><IconRefresh className={loading ? "spin" : ""} size={15} /> Actualizar</button>
      </div>
    </section>

    {error && <div className="data-error"><IconAlertTriangle size={18} /><div><strong>Actualización parcial</strong><p>{error}</p></div></div>}

    <section className="dashboard-kpi-grid">
      <button className={`dashboard-kpi ${activeAlerts ? "attention" : "healthy"}`} onClick={onOpenAlerts}>
        <span><IconAlertTriangle size={20} /></span>
        <div><small>Alertas activas</small><strong>{activeAlerts}</strong><p><b>{data.summary.critical} críticas</b> · {data.summary.warning} advertencias</p></div>
        <IconArrowRight size={16} />
      </button>
      <article className="dashboard-kpi healthy">
        <span><IconTopologyStar3 size={20} /></span>
        <div><small>Condición de activos</small><strong>{assetHealthPercent}%</strong><p>{data.summary.healthyAssets} de {data.summary.assets} en condición normal</p></div>
      </article>
      <article className={`dashboard-kpi ${acquisitionIssues ? "attention" : "healthy"}`}>
        <span><IconServer size={20} /></span>
        <div><small>Adquisición</small><strong>{acquisitionIssues ? acquisitionIssues : "OK"}</strong><p>{data.summary.unhealthyGateways} gateways · {data.summary.unhealthyDevices} dispositivos con atención</p></div>
      </article>
      <button className={`dashboard-kpi ${data.summary.onCallIssues || data.summary.activeMaintenance ? "info" : "healthy"}`} onClick={onOpenOperations}>
        <span><IconTool size={20} /></span>
        <div><small>Continuidad operacional</small><strong>{data.summary.onCallCovered}/{data.summary.onCallTotal}</strong><p>{data.summary.onCallIssues ? `${data.summary.onCallIssues} guardias requieren revisión` : "Guardias cubiertas"} · {data.summary.activeMaintenance} mantenimientos activos</p></div>
        <IconArrowRight size={16} />
      </button>
    </section>

    <section className="dashboard-layout">
      <article className="panel dashboard-sites">
        <header className="dashboard-section-head">
          <div><span className="eyebrow">Cobertura operacional</span><h2>Condición por sitio</h2><p>{data.summary.sites} sitios · {data.summary.assets} activos · {data.summary.devices} dispositivos.</p></div>
        </header>
        <div className="dashboard-site-list">
          {data.sites.map((site) => {
            const attention = site.criticalAlarms + site.warningAlarms;
            return <button key={site.id} className={`dashboard-site-row ${site.id === data.activeSiteId ? "active" : ""}`} onClick={() => onSwitchSite(site.id)}>
              <span className="dashboard-site-icon"><BuildingFactory2 size={18} /></span>
              <span className="dashboard-site-name"><strong>{site.name}</strong><small>{site.code} · {site.assets} activos</small></span>
              <span className="dashboard-health"><span><i style={{ width: `${site.healthPercent}%` }} /></span><strong>{site.healthPercent}%</strong></span>
              <span className="dashboard-site-stat"><strong>{site.gatewaysOnline}/{site.gatewaysTotal}</strong><small>gateways</small></span>
              <span className="dashboard-site-stat"><strong>{site.devicesOnline}/{site.devicesTotal}</strong><small>dispositivos</small></span>
              <span className={`dashboard-site-alerts ${site.criticalAlarms ? "critical" : attention ? "warning" : "normal"}`}>{site.criticalAlarms ? `${site.criticalAlarms} críticas` : attention ? `${attention} alertas` : "Sin alertas"}</span>
              <IconArrowRight size={16} />
            </button>;
          })}
          {!data.sites.length && <div className="table-empty-state"><BuildingFactory2 size={21} /><div><strong>Sin sitios activos</strong><p>La organización aún no tiene sitios disponibles para este usuario.</p></div></div>}
        </div>
      </article>

      <aside className="dashboard-priority-column">
        <article className="panel dashboard-priority">
          <header className="dashboard-section-head compact"><div><span className="eyebrow">Atención prioritaria</span><h2>Activos que requieren revisión</h2></div></header>
          <div className="dashboard-priority-list">
            {data.priorityAssets.map((asset) => <button key={asset.id} onClick={() => onSelectAsset(asset.siteId, asset.id)}>
              <span className={`priority-state ${asset.criticalAlarms ? "critical" : asset.warningAlarms ? "warning" : "offline"}`} />
              <span><strong>{asset.code} · {asset.name}</strong><small>{asset.area || assetTypeLabel(asset.assetType)}</small></span>
              <span className="priority-count">{asset.criticalAlarms ? `${asset.criticalAlarms} crítica${asset.criticalAlarms === 1 ? "" : "s"}` : asset.warningAlarms ? `${asset.warningAlarms} advertencia${asset.warningAlarms === 1 ? "" : "s"}` : asset.state}</span>
              <IconArrowRight size={15} />
            </button>)}
            {!data.priorityAssets.length && <div className="dashboard-all-clear"><IconCircleCheck size={22} /><div><strong>Sin activos prioritarios</strong><p>No hay alertas activas ni estados de activo que requieran atención.</p></div></div>}
          </div>
        </article>

        <article className="panel dashboard-priority">
          <header className="dashboard-section-head compact"><div><span className="eyebrow">Últimos eventos</span><h2>Alertas relevantes</h2></div><button className="text-inline-button" onClick={onOpenAlerts}>Ver todas</button></header>
          <div className="dashboard-alarm-list">
            {data.priorityAlarms.slice(0, 5).map((alarm) => <button key={alarm.id} onClick={() => onSelectAsset(alarm.siteId, alarm.assetId)}>
              <i className={`priority-state ${alarm.severity === "critical" ? "critical" : "warning"}`} />
              <span><strong>{alarm.title}</strong><small>{alarm.assetCode} · {relativeTime(alarm.openedAt, data.generatedAt)}</small></span>
              <IconArrowRight size={15} />
            </button>)}
            {!data.priorityAlarms.length && <div className="dashboard-all-clear"><IconCircleCheck size={22} /><div><strong>Sin eventos activos</strong><p>La operación no registra alertas abiertas o reconocidas.</p></div></div>}
          </div>
        </article>
      </aside>
    </section>
  </div>;
}
