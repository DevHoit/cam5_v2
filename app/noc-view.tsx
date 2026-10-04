"use client";

import { useEffect, useState } from "react";
import {
  IconAlertTriangle,
  IconBellRinging,
  IconCircleCheck,
  IconClock,
  IconRefresh,
  IconServer,
  IconTool,
  IconUsersGroup,
} from "@tabler/icons-react";

type NocResponse = {
  generatedAt: string;
  site: { id: string; code: string; name: string; clientId: string; clientName: string };
  summary: {
    activeAlarms: number;
    critical: number;
    warning: number;
    unhealthyGateways: number;
    unhealthyDevices: number;
    activeMaintenance: number;
    unresolvedOnCall: number;
  };
  alarms: Array<{
    id: string;
    code: string;
    severity: "info" | "warning" | "critical";
    status: string;
    title: string;
    openedAt: string;
    assetCode: string;
    assetName: string;
  }>;
  gateways: Array<{
    id: string;
    code: string;
    name: string;
    state: string;
    lastSeenAt: string | null;
  }>;
  devices: Array<{
    id: string;
    code: string;
    name: string;
    state: string;
    lastReadAt: string | null;
    assetCode: string;
    assetName: string;
  }>;
  maintenance: Array<{
    id: string;
    scopeType: string;
    scopeId: string;
    startsAt: string;
    endsAt: string;
    reason: string;
    status: "active" | "scheduled";
  }>;
  onCall: Array<{
    shiftId: string;
    shiftName: string;
    timezone: string;
    status: "resolved" | "inactive_shift" | "outside_schedule" | "unassigned" | "ambiguous";
    user: { id: string; displayName: string; email: string; phoneE164: string | null } | null;
    priority: number | null;
  }>;
};

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "include", headers: { "Content-Type": "application/json" } });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "No fue posible completar la solicitud.");
  }
  return response.json() as Promise<T>;
}

function formatDate(value: string | null) {
  if (!value) return "Sin registro";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function onCallStatus(status: NocResponse["onCall"][number]["status"]) {
  if (status === "resolved") return "Cubierto";
  if (status === "outside_schedule") return "Fuera de horario";
  if (status === "unassigned") return "Sin asignación";
  if (status === "ambiguous") return "Ambiguo";
  return "Inactivo";
}

export function NocView() {
  const [data, setData] = useState<NocResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void requestJson<NocResponse>("/api/v1/noc")
      .then((result) => { if (alive) setData(result); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "No fue posible consultar el NOC."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reload]);

  const refresh = () => {
    setLoading(true);
    setError("");
    setReload((value) => value + 1);
  };

  if (loading && !data) return <article className="panel module-panel"><div className="data-loading"><IconRefresh className="spin" size={18} /> Cargando estado operacional…</div></article>;
  if (error && !data) return <article className="panel module-panel"><div className="data-error"><IconAlertTriangle size={18} /><div><strong>No se pudo cargar el NOC</strong><p>{error}</p></div><button className="ghost-button" onClick={refresh}>Reintentar</button></div></article>;
  if (!data) return null;

  const unhealthyGateways = data.gateways.filter((item) => item.state !== "online");
  const unhealthyDevices = data.devices.filter((item) => !["online", "normal"].includes(item.state));

  return <>
    <section className="module-summary-grid">
      <article><span className={`module-summary-icon ${data.summary.critical ? "amber" : "green"}`}><IconBellRinging size={19} /></span><div><small>Alarmas activas</small><strong>{data.summary.activeAlarms}</strong><span>{data.summary.critical} críticas · {data.summary.warning} advertencias</span></div></article>
      <article><span className={`module-summary-icon ${data.summary.unhealthyGateways || data.summary.unhealthyDevices ? "amber" : "green"}`}><IconServer size={19} /></span><div><small>Salud adquisición</small><strong>{data.summary.unhealthyGateways + data.summary.unhealthyDevices}</strong><span>{data.summary.unhealthyGateways} gateways · {data.summary.unhealthyDevices} dispositivos con atención</span></div></article>
      <article><span className={`module-summary-icon ${data.summary.unresolvedOnCall ? "amber" : "blue"}`}><IconUsersGroup size={19} /></span><div><small>Cobertura on-call</small><strong>{data.onCall.length - data.summary.unresolvedOnCall}/{data.onCall.length}</strong><span>{data.summary.unresolvedOnCall ? "Requiere revisión" : "Cobertura resuelta"}</span></div></article>
      <article><span className="module-summary-icon blue"><IconTool size={19} /></span><div><small>Mantenimiento activo</small><strong>{data.summary.activeMaintenance}</strong><span>{data.maintenance.filter((item) => item.status === "scheduled").length} programados</span></div></article>
    </section>

    <article className="panel module-panel">
      <div className="module-toolbar">
        <div><span className="eyebrow">NOC</span><h2>{data.site.code} · {data.site.name}</h2><p>Vista consolidada del sitio activo. Última actualización: {formatDate(data.generatedAt)}.</p></div>
        <button className="secondary-button" onClick={refresh} disabled={loading}><IconRefresh className={loading ? "spin" : ""} size={16} /> Actualizar</button>
      </div>

      {error && <div className="data-error"><IconAlertTriangle size={18} /><div><strong>Actualización parcial</strong><p>{error}</p></div></div>}

      <div className="module-table-wrap"><div className="module-table">
        <div className="module-table-head"><span>Severidad</span><span>Alarma</span><span>Activo</span><span>Estado</span><span>Desde</span></div>
        {data.alarms.slice(0, 12).map((alarm) => <div className="module-table-row" key={alarm.id}>
          <span><i className={`status-pill status-${alarm.severity === "critical" ? "critical" : alarm.severity === "warning" ? "warning" : "normal"}`}>{alarm.severity === "critical" ? "Crítica" : alarm.severity === "warning" ? "Advertencia" : "Info"}</i></span>
          <span><strong>{alarm.title}</strong><small>{alarm.code}</small></span>
          <span>{alarm.assetCode} · {alarm.assetName}</span>
          <span>{alarm.status === "acknowledged" ? "Reconocida" : "Abierta"}</span>
          <span>{formatDate(alarm.openedAt)}</span>
        </div>)}
        {!data.alarms.length && <div className="table-empty-state"><IconCircleCheck size={21} /><div><strong>Sin alarmas activas</strong><p>El sitio no tiene eventos abiertos o reconocidos.</p></div></div>}
      </div></div>
    </article>

    <article className="panel module-panel">
      <div className="module-toolbar"><div><span className="eyebrow">Continuidad</span><h2>Adquisición y guardia</h2></div></div>
      <div className="module-table-wrap"><div className="module-table">
        <div className="module-table-head"><span>Tipo</span><span>Elemento</span><span>Estado</span><span>Última actividad</span><span>Detalle</span></div>
        {unhealthyGateways.map((gateway) => <div className="module-table-row" key={`gw-${gateway.id}`}>
          <span>Gateway</span><span><strong>{gateway.code}</strong><small>{gateway.name}</small></span><span><i className="status-pill status-warning">{gateway.state}</i></span><span>{formatDate(gateway.lastSeenAt)}</span><span>Revisar conectividad</span>
        </div>)}
        {unhealthyDevices.map((device) => <div className="module-table-row" key={`dev-${device.id}`}>
          <span>Dispositivo</span><span><strong>{device.code}</strong><small>{device.name}</small></span><span><i className="status-pill status-warning">{device.state}</i></span><span>{formatDate(device.lastReadAt)}</span><span>{device.assetCode} · {device.assetName}</span>
        </div>)}
        {data.onCall.map((item) => <div className="module-table-row" key={`shift-${item.shiftId}`}>
          <span>On-call</span><span><strong>{item.shiftName}</strong><small>{item.timezone}</small></span><span><i className={`status-pill status-${item.status === "resolved" ? "normal" : "warning"}`}>{onCallStatus(item.status)}</i></span><span>{item.user?.displayName ?? "Sin responsable"}</span><span>{item.user ? `${item.user.email} · prioridad ${item.priority}` : "Revisar turno/asignación"}</span>
        </div>)}
        {!unhealthyGateways.length && !unhealthyDevices.length && !data.onCall.length && <div className="table-empty-state"><IconCircleCheck size={21} /><div><strong>Sin incidencias de continuidad</strong><p>No hay elementos que requieran atención.</p></div></div>}
      </div></div>
    </article>

    <article className="panel module-panel">
      <div className="module-toolbar"><div><span className="eyebrow">Mantenimiento</span><h2>Ventanas vigentes y próximas</h2></div></div>
      <div className="module-table-wrap"><div className="module-table">
        <div className="module-table-head"><span>Estado</span><span>Alcance</span><span>Inicio</span><span>Término</span><span>Motivo</span></div>
        {data.maintenance.map((item) => <div className="module-table-row" key={item.id}>
          <span><i className={`status-pill status-${item.status === "active" ? "warning" : "normal"}`}>{item.status === "active" ? "Activo" : "Programado"}</i></span>
          <span>{item.scopeType}</span>
          <span>{formatDate(item.startsAt)}</span>
          <span>{formatDate(item.endsAt)}</span>
          <span>{item.reason}</span>
        </div>)}
        {!data.maintenance.length && <div className="table-empty-state"><IconClock size={21} /><div><strong>Sin mantenimiento vigente</strong><p>No hay ventanas activas o programadas para el sitio.</p></div></div>}
      </div></div>
    </article>
  </>;
}
