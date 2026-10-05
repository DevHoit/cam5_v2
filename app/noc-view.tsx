"use client";

import { useEffect, useMemo, useState } from "react";
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
    severity: "normal" | "warning" | "critical";
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
    scopeName?: string | null;
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
  const response = await fetch(path, { credentials: "include", headers: { "Content-Type": "application/json" }, cache: "no-store" });
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

function formatAge(value: string | null, reference: string) {
  if (!value) return "Sin registro";
  const seconds = Math.max(0, Math.round((new Date(reference).getTime() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `Hace ${seconds} s`;
  if (seconds < 3600) return `Hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `Hace ${Math.round(seconds / 3600)} h`;
  return `Hace ${Math.round(seconds / 86400)} d`;
}

function onCallStatus(status: NocResponse["onCall"][number]["status"]) {
  if (status === "resolved") return "Cubierto";
  if (status === "outside_schedule") return "Fuera de horario";
  if (status === "unassigned") return "Sin asignación";
  if (status === "ambiguous") return "Asignación ambigua";
  return "Turno inactivo";
}

function stateLabel(state: string) {
  if (["online", "normal", "active"].includes(state)) return "Operativo";
  if (["warning", "degraded"].includes(state)) return "Atención";
  if (state === "maintenance") return "Mantenimiento";
  if (state === "critical") return "Crítico";
  return "Sin conexión";
}

function maintenanceScope(item: NocResponse["maintenance"][number]) {
  if (item.scopeName) return item.scopeName;
  if (item.scopeType === "tenant") return "Cliente";
  if (item.scopeType === "site") return "Sitio";
  if (item.scopeType === "asset") return "Activo";
  if (item.scopeType === "device") return "Dispositivo";
  if (item.scopeType === "area") return "Área";
  return item.scopeType;
}

export function NocView() {
  const [data, setData] = useState<NocResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void requestJson<NocResponse>("/api/v1/noc")
      .then((result) => { if (alive) { setData(result); setError(""); } })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "No fue posible consultar el NOC."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reload]);

  useEffect(() => {
    const timer = window.setInterval(() => setReload((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = () => {
    setLoading(true);
    setError("");
    setReload((value) => value + 1);
  };

  const rankedAlarms = useMemo(() => {
    if (!data) return [];
    const rank = { critical: 3, warning: 2, normal: 1 } as const;
    return [...data.alarms].sort((left, right) =>
      rank[right.severity] - rank[left.severity] ||
      new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime()
    );
  }, [data]);

  if (loading && !data) return <article className="panel module-panel"><div className="data-loading"><IconRefresh className="spin" size={18} /> Cargando estado operacional…</div></article>;
  if (error && !data) return <article className="panel module-panel"><div className="data-error"><IconAlertTriangle size={18} /><div><strong>No se pudo cargar el NOC</strong><p>{error}</p></div><button className="ghost-button" onClick={refresh}>Reintentar</button></div></article>;
  if (!data) return null;

  const unhealthyGateways = data.gateways.filter((item) => item.state !== "online");
  const unhealthyDevices = data.devices.filter((item) => !["online", "normal"].includes(item.state));
  const connectivityTotal = data.gateways.length + data.devices.length;
  const connectivityIssues = unhealthyGateways.length + unhealthyDevices.length;
  const connectivityHealthy = Math.max(0, connectivityTotal - connectivityIssues);
  const resolvedOnCall = data.onCall.filter((item) => item.status === "resolved").length;
  const noOnCallConfigured = data.onCall.length === 0;
  const coverageIssue = noOnCallConfigured || data.summary.unresolvedOnCall > 0;
  const siteState: "normal" | "warning" | "critical" | "unmonitored" =
    data.summary.critical > 0 ? "critical"
      : data.summary.warning > 0 || connectivityIssues > 0 || coverageIssue ? "warning"
        : connectivityTotal === 0 ? "unmonitored"
          : "normal";
  const siteStateLabel = siteState === "critical" ? "Crítico"
    : siteState === "warning" ? "Atención"
      : siteState === "unmonitored" ? "Sin monitoreo"
        : "Operativo";
  const attentionCount = rankedAlarms.length + connectivityIssues + (coverageIssue ? 1 : 0);
  const activeMaintenance = data.maintenance.filter((item) => item.status === "active");
  const scheduledMaintenance = data.maintenance.filter((item) => item.status === "scheduled");

  return <div className="noc-v4">
    <section className="noc-status-strip" aria-label="Estado de continuidad del sitio">
      <article className={siteState}>
        <span>{siteState === "normal" ? <IconCircleCheck size={20} /> : <IconAlertTriangle size={20} />}</span>
        <div><small>Estado del sitio</small><strong className="noc-state-text">{siteStateLabel}</strong><p>{siteState === "normal" ? "Sin condiciones que requieran atención" : siteState === "unmonitored" ? "No hay infraestructura de monitoreo activa" : `${attentionCount} condición${attentionCount === 1 ? "" : "es"} por revisar`}</p></div>
      </article>
      <article className={data.summary.critical ? "critical" : data.summary.warning ? "warning" : "normal"}>
        <span><IconBellRinging size={20} /></span>
        <div><small>Alertas activas</small><strong>{data.summary.activeAlarms}</strong><p>{data.summary.critical} críticas · {data.summary.warning} advertencias</p></div>
      </article>
      <article className={connectivityIssues ? "warning" : connectivityTotal ? "normal" : "unmonitored"}>
        <span><IconServer size={20} /></span>
        <div><small>Conectividad</small><strong>{connectivityTotal ? `${connectivityHealthy}/${connectivityTotal}` : "—"}</strong><p>{connectivityTotal ? connectivityIssues ? `${connectivityIssues} elemento${connectivityIssues === 1 ? "" : "s"} con atención` : "Infraestructura disponible" : "Sin infraestructura registrada"}</p></div>
      </article>
      <article className={coverageIssue ? "warning" : "normal"}>
        <span><IconUsersGroup size={20} /></span>
        <div><small>Guardia actual</small><strong>{data.onCall.length ? `${resolvedOnCall}/${data.onCall.length}` : "—"}</strong><p>{noOnCallConfigured ? "Sin turnos configurados" : data.summary.unresolvedOnCall ? `${data.summary.unresolvedOnCall} turno${data.summary.unresolvedOnCall === 1 ? "" : "s"} sin cobertura` : "Cobertura resuelta"}</p></div>
      </article>
    </section>

    <section className="noc-workspace-v4">
      <article className="panel noc-attention-panel-v4">
        <header className="noc-panel-head-v4">
          <div><h2>Atención inmediata</h2><p>Eventos y fallas de continuidad ordenados por prioridad operacional.</p></div>
          <div className="noc-panel-actions-v4"><span>Actualizado {formatAge(data.generatedAt, new Date().toISOString()).toLowerCase()}</span><button onClick={refresh} disabled={loading} aria-label="Actualizar NOC"><IconRefresh className={loading ? "spin" : ""} size={16} /></button></div>
        </header>

        {error && <div className="data-error"><IconAlertTriangle size={18} /><div><strong>Actualización parcial</strong><p>{error}</p></div></div>}

        <div className="noc-attention-list-v4">
          {rankedAlarms.slice(0, 10).map((alarm) => <article className="noc-attention-row-v4" key={alarm.id}>
            <span className={`noc-row-icon severity-${alarm.severity}`}><IconBellRinging size={17} /></span>
            <div className="noc-row-copy-v4"><strong>{alarm.title}</strong><small>{alarm.assetName} · {formatAge(alarm.openedAt, data.generatedAt)}</small></div>
            <span className={`status-pill status-${alarm.severity === "normal" ? "normal" : alarm.severity}`}>{alarm.severity === "critical" ? "Crítica" : alarm.severity === "warning" ? "Advertencia" : "Informativa"}</span>
            <span className="noc-row-meta-v4">{alarm.status === "acknowledged" ? "Reconocida" : "Abierta"}</span>
          </article>)}

          {unhealthyGateways.map((gateway) => <article className="noc-attention-row-v4" key={`gw-${gateway.id}`}>
            <span className="noc-row-icon severity-warning"><IconServer size={17} /></span>
            <div className="noc-row-copy-v4"><strong>{gateway.name}</strong><small>Gateway · última actividad {formatAge(gateway.lastSeenAt, data.generatedAt).toLowerCase()}</small></div>
            <span className="status-pill status-warning">{stateLabel(gateway.state)}</span>
            <span className="noc-row-meta-v4">Conectividad</span>
          </article>)}

          {unhealthyDevices.map((device) => <article className="noc-attention-row-v4" key={`dev-${device.id}`}>
            <span className="noc-row-icon severity-warning"><IconServer size={17} /></span>
            <div className="noc-row-copy-v4"><strong>{device.name}</strong><small>{device.assetName} · última lectura {formatAge(device.lastReadAt, data.generatedAt).toLowerCase()}</small></div>
            <span className="status-pill status-warning">{stateLabel(device.state)}</span>
            <span className="noc-row-meta-v4">Dispositivo</span>
          </article>)}

          {!rankedAlarms.length && !connectivityIssues && !coverageIssue && <div className="noc-all-clear-v4"><IconCircleCheck size={24} /><div><strong>Sin incidencias de continuidad</strong><p>El sitio no presenta alarmas activas, fallas de conectividad ni brechas de guardia.</p></div></div>}
        </div>
      </article>

      <aside className="noc-side-v4">
        <article className="panel noc-side-card-v4">
          <header><div><h2>Guardia actual</h2><p>Responsables disponibles para atención y escalamiento.</p></div><IconUsersGroup size={19} /></header>
          <div className="noc-guard-list-v4">
            {data.onCall.map((item) => <div key={item.shiftId}>
              <span className={`noc-guard-state ${item.status === "resolved" ? "normal" : "warning"}`} />
              <div><strong>{item.shiftName}</strong><small>{item.user?.displayName ?? onCallStatus(item.status)}</small>{item.user && <em>{item.user.phoneE164 || item.user.email}</em>}</div>
              <i className={`status-pill status-${item.status === "resolved" ? "normal" : "warning"}`}>{onCallStatus(item.status)}</i>
            </div>)}
            {!data.onCall.length && <div className="noc-side-empty-v4 warning"><IconAlertTriangle size={19} /><span><strong>Sin guardias configuradas</strong><small>Define al menos un turno on-call para asegurar continuidad de atención.</small></span></div>}
          </div>
        </article>

        <article className="panel noc-side-card-v4">
          <header><div><h2>Mantenimiento</h2><p>Ventanas que pueden modificar el comportamiento de las notificaciones.</p></div><IconTool size={19} /></header>
          <div className="noc-maintenance-list-v4">
            {activeMaintenance.map((item) => <div key={item.id}><span className="maintenance-state active">Activo</span><div><strong>{item.reason}</strong><small>{maintenanceScope(item)} · hasta {formatDate(item.endsAt)}</small></div></div>)}
            {scheduledMaintenance.slice(0, 3).map((item) => <div key={item.id}><span className="maintenance-state scheduled">Programado</span><div><strong>{item.reason}</strong><small>{maintenanceScope(item)} · inicia {formatDate(item.startsAt)}</small></div></div>)}
            {!data.maintenance.length && <div className="noc-side-empty-v4"><IconClock size={19} /><span><strong>Sin mantenimiento vigente</strong><small>No hay ventanas activas o próximas para el sitio.</small></span></div>}
          </div>
        </article>
      </aside>
    </section>
  </div>;
}
