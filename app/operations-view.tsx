"use client";

import { useEffect, useState } from "react";
import { ShiftsView } from "./shifts-view";
import { NocView } from "./noc-view";
import { EscalationPoliciesView } from "./escalation-policies-view";
import {
  IconAlertTriangle,
  IconBan,
  IconCalendarTime,
  IconCircleCheck,
  IconClock,
  IconRefresh,
  IconTool,
} from "@tabler/icons-react";

const INITIAL_MAINTENANCE_START = new Date(Date.now() + 30 * 60_000);
const INITIAL_MAINTENANCE_END = new Date(Date.now() + 2 * 60 * 60_000);

type NoticeTone = "success" | "info" | "warning";
type ConfirmRequest = { title: string; detail: string; confirmLabel: string; tone?: "default" | "danger"; onConfirm: () => void };

type MaintenanceWindow = {
  id: string;
  clientId: string;
  scopeType: "tenant" | "site" | "area" | "asset" | "device";
  scopeId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  cancelledAt: string | null;
  createdAt: string;
  status: "scheduled" | "active" | "completed" | "cancelled";
};

type MaintenanceResponse = {
  siteId: string;
  clientId: string;
  windows: MaintenanceWindow[];
};

type AssetOption = { id: string; code: string; name: string };

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "No fue posible completar la solicitud.");
  }
  return response.json() as Promise<T>;
}

function localDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(status: MaintenanceWindow["status"]) {
  if (status === "active") return "Activo";
  if (status === "scheduled") return "Programado";
  if (status === "completed") return "Finalizado";
  return "Cancelado";
}

export function OperationsView({
  assets,
  activeAssetId,
  canWrite,
  canManageClient,
  notify,
  confirm,
}: {
  assets: AssetOption[];
  activeAssetId: string;
  canWrite: boolean;
  canManageClient: boolean;
  notify: (message: string, tone?: NoticeTone) => void;
  confirm: (request: ConfirmRequest) => void;
}) {
  const [tab, setTab] = useState<"noc" | "maintenance" | "shifts" | "escalation">("noc");
  const [data, setData] = useState<MaintenanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [form, setForm] = useState({
    scopeType: "site" as "tenant" | "site" | "asset",
    scopeId: activeAssetId,
    startsAt: localDateTimeValue(INITIAL_MAINTENANCE_START),
    endsAt: localDateTimeValue(INITIAL_MAINTENANCE_END),
    reason: "",
  });

  useEffect(() => {
    let alive = true;
    void requestJson<MaintenanceResponse>("/api/v1/maintenance-windows")
      .then((result) => { if (alive) setData(result); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "No fue posible consultar mantenimiento."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reload]);

  const createWindow = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canWrite) return;
    setSaving(true);
    try {
      const payload = {
        scopeType: form.scopeType,
        ...(form.scopeType === "asset" ? { scopeId: form.scopeId || activeAssetId } : {}),
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        reason: form.reason,
      };
      await requestJson("/api/v1/maintenance-windows", { method: "POST", body: JSON.stringify(payload) });
      notify("Ventana de mantenimiento programada.");
      setForm((current) => ({ ...current, reason: "" }));
      setReload((value) => value + 1);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "No fue posible programar mantenimiento.", "warning");
    } finally {
      setSaving(false);
    }
  };

  const cancelWindow = (window: MaintenanceWindow) => confirm({
    title: "Cancelar ventana de mantenimiento",
    detail: `Se cancelará la ventana “${window.reason}”. La cancelación quedará registrada en auditoría y no se eliminará el histórico.`,
    confirmLabel: "Cancelar ventana",
    tone: "danger",
    onConfirm: async () => {
      try {
        await requestJson("/api/v1/maintenance-windows", {
          method: "PATCH",
          body: JSON.stringify({ id: window.id, cancel: true }),
        });
        notify("Ventana de mantenimiento cancelada.");
        setReload((value) => value + 1);
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : "No fue posible cancelar la ventana.", "warning");
      }
    },
  });

  const active = data?.windows.filter((item) => item.status === "active").length ?? 0;
  const scheduled = data?.windows.filter((item) => item.status === "scheduled").length ?? 0;

  const tabs = <section className="operations-commandbar operations-commandbar-v4">
    <div><h1>NOC y continuidad</h1><p>Estado del sitio, incidentes, cobertura de guardia y mantenimiento operacional.</p></div>
    <div className="operations-tabs" role="tablist" aria-label="Operación">
      <button className={tab === "noc" ? "active" : ""} onClick={() => setTab("noc")}>NOC</button>
      <button className={tab === "maintenance" ? "active" : ""} onClick={() => setTab("maintenance")}>Mantenimiento</button>
      <button className={tab === "shifts" ? "active" : ""} onClick={() => setTab("shifts")}>Guardias</button>
      <button className={tab === "escalation" ? "active" : ""} onClick={() => setTab("escalation")}>Escalamiento</button>
    </div>
  </section>;

  if (tab === "noc") return <div className="operations-v4">{tabs}<NocView /></div>;
  if (tab === "shifts") return <div className="operations-v4">{tabs}<ShiftsView canManageClient={canManageClient} notify={notify} /></div>;
  if (tab === "escalation") return <div className="operations-v4">{tabs}<EscalationPoliciesView canWrite={canWrite} notify={notify} /></div>;

  return <div className="operations-v4">
    {tabs}
    <section className="operations-status-strip">
      <article className={active ? "warning" : ""}><span><IconTool size={17} /></span><div><small>Mantenimiento activo</small><strong>{active}</strong><span>Ventanas en curso</span></div></article>
      <article><span><IconCalendarTime size={17} /></span><div><small>Programado</small><strong>{scheduled}</strong><span>Próximas ventanas</span></div></article>
      <article className="healthy"><span><IconCircleCheck size={17} /></span><div><small>Histórico</small><strong>{data?.windows.length ?? 0}</strong><span>Con trazabilidad</span></div></article>
    </section>

    <article className="panel module-panel operations-panel-v3">
      <div className="operations-panel-head">
        <div>
          <h2>Ventanas de mantenimiento</h2>
          <p>La telemetría continúa; las notificaciones se suprimen únicamente dentro del alcance y período definidos.</p>
        </div>
        <button className="secondary-button" onClick={() => { setLoading(true); setError(""); setReload((value) => value + 1); }} disabled={loading}><IconRefresh className={loading ? "spin" : ""} size={16} /> Actualizar</button>
      </div>

      {canWrite && <form className="hierarchy-create-form" onSubmit={createWindow}>
        <div className="hierarchy-form-heading"><h3>Programar mantenimiento</h3><p>Define alcance y periodo de supresión operacional.</p></div>
        <label><span>Alcance</span><select value={form.scopeType} onChange={(event) => setForm({ ...form, scopeType: event.target.value as typeof form.scopeType })}>
          <option value="site">Sitio activo</option>
          <option value="asset">Activo</option>
          {canManageClient && <option value="tenant">Cliente completo</option>}
        </select></label>
        {form.scopeType === "asset" && <label><span>Activo</span><select required value={form.scopeId || activeAssetId} onChange={(event) => setForm({ ...form, scopeId: event.target.value })}>
          <option value="">Seleccionar…</option>
          {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select></label>}
        <label><span>Inicio</span><input type="datetime-local" required value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label>
        <label><span>Término</span><input type="datetime-local" required value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label>
        <label><span>Motivo</span><input required minLength={3} maxLength={1000} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Trabajo programado, inspección, pruebas…" /></label>
        <button className="primary-button" type="submit" disabled={saving || !form.reason.trim() || (form.scopeType === "asset" && !(form.scopeId || activeAssetId))}>{saving ? "Guardando…" : "Programar"}</button>
      </form>}

      {error && <div className="data-error"><IconAlertTriangle size={18} /><div><strong>No se pudo consultar mantenimiento</strong><p>{error}</p></div></div>}
      {loading && <div className="data-loading"><IconRefresh className="spin" size={18} /> Consultando ventanas…</div>}

      {!loading && !error && <div className="module-table-wrap"><div className="module-table">
        <div className="module-table-head"><span>Estado</span><span>Alcance</span><span>Período</span><span>Motivo</span><span>Acción</span></div>
        {(data?.windows ?? []).map((window) => <div className="module-table-row" key={window.id}>
          <span><i className={`status-pill status-${window.status === "active" ? "warning" : window.status === "cancelled" ? "offline" : "normal"}`}>{statusLabel(window.status)}</i></span>
          <span>{window.scopeType === "tenant" ? "Cliente" : window.scopeType === "site" ? "Sitio" : window.scopeType === "asset" ? "Activo" : window.scopeType}</span>
          <span><strong>{formatDate(window.startsAt)}</strong><small> hasta {formatDate(window.endsAt)}</small></span>
          <span>{window.reason}</span>
          <span>{canWrite && (window.status === "scheduled" || window.status === "active") ? <button className="ghost-button" onClick={() => cancelWindow(window)}><IconBan size={15} /> Cancelar</button> : <IconClock size={16} />}</span>
        </div>)}
        {!data?.windows.length && <div className="table-empty-state"><IconCalendarTime size={21} /><div><strong>Sin ventanas registradas</strong><p>No hay mantenimientos programados para el sitio activo.</p></div></div>}
      </div></div>}
    </article>
  </div>;
}
