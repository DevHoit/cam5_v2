"use client";

import { useEffect, useState } from "react";
import {
  IconAlertTriangle,
  IconBellRinging,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconEdit,
  IconMail,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconShieldCheck,
  IconTrash,
  IconUsers,
  IconWebhook,
} from "@tabler/icons-react";
import { Pagination } from "./pagination";

type NoticeTone = "success" | "info" | "warning";
type ConfirmRequest = { title: string; detail: string; confirmLabel: string; tone?: "default" | "danger"; onConfirm: () => void };
type PaginationResult<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };
type EndpointKind = "email" | "teams" | "webhook";
type EndpointRecord = {
  id: string;
  name: string;
  kind: EndpointKind;
  configuration: { recipients?: string[]; channel?: string; url?: string; destination?: string };
  secretReference: string | null;
  enabled: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type PolicyRecord = {
  id: string;
  name: string;
  endpointId: string;
  endpointName: string;
  endpointKind: EndpointKind;
  endpointEnabled: boolean;
  minimumSeverity: "warning" | "critical";
  escalationDelayMinutes: number;
  repeatIntervalMinutes: number | null;
  active: boolean;
  filters: { alarmKinds?: string[]; notifyOnRecovery?: boolean };
  createdAt: string;
  updatedAt: string;
};
type DeliveryRecord = {
  id: number;
  subject: string;
  eventType: string;
  recipient: string | null;
  status: "queued" | "sending" | "delivered" | "failed";
  attemptCount: number;
  maxAttempts: number;
  providerMessageId: string | null;
  errorMessage: string | null;
  queuedAt: string;
  scheduledAt: string;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  sentAt: string | null;
  endpointId: string;
  endpointName: string;
  endpointKind: EndpointKind;
  policyName: string | null;
  alarmId: string | null;
  alarmCode: string | null;
};
type Summary = {
  endpoints: { total: number; active: number; verified: number };
  policies: { total: number; active: number };
  deliveries: { total24h: number; delivered24h: number; failed24h: number; pending24h: number; successRate: number | null };
};

const emptyEndpointForm = { name: "", kind: "email" as EndpointKind, recipients: "", channel: "", url: "", destination: "", secretReference: "", enabled: true };
const emptyPolicyForm = { name: "", endpointId: "", minimumSeverity: "critical" as "warning" | "critical", escalationDelayMinutes: "0", repeatIntervalMinutes: "", alarmKind: "all", notifyOnRecovery: true, active: true };

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible completar la solicitud.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

function kindLabel(kind: EndpointKind) {
  return kind === "email" ? "Correo" : kind === "teams" ? "Microsoft Teams" : "Webhook";
}

function destination(endpoint: EndpointRecord) {
  if (endpoint.kind === "email") return endpoint.configuration.recipients?.join(", ") || "Sin destinatarios";
  return endpoint.configuration.channel || endpoint.configuration.destination || endpoint.configuration.url || "Sin destino";
}

function statusLabel(status: DeliveryRecord["status"]) {
  if (status === "delivered") return "Entregada";
  if (status === "failed") return "Fallida";
  if (status === "sending") return "Enviando";
  return "Programada";
}

export function NotificationsView({
  canWrite,
  notify,
  confirm,
}: {
  canWrite: boolean;
  notify: (message: string, tone?: NoticeTone) => void;
  confirm: (request: ConfirmRequest) => void;
}) {
  const [tab, setTab] = useState<"channels" | "rules" | "delivery">("channels");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [endpoints, setEndpoints] = useState<PaginationResult<EndpointRecord> | null>(null);
  const [policies, setPolicies] = useState<PaginationResult<PolicyRecord> | null>(null);
  const [deliveries, setDeliveries] = useState<PaginationResult<DeliveryRecord> | null>(null);
  const [endpointOptions, setEndpointOptions] = useState<EndpointRecord[]>([]);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [showEndpointForm, setShowEndpointForm] = useState(false);
  const [editingEndpointId, setEditingEndpointId] = useState<string | null>(null);
  const [endpointForm, setEndpointForm] = useState(emptyEndpointForm);
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [policyForm, setPolicyForm] = useState(emptyPolicyForm);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ page: String(page), pageSize: tab === "delivery" ? "10" : "6" });
      if (query.trim()) params.set("q", query.trim());
      if (tab === "channels") {
        if (status !== "all") params.set("enabled", status);
        if (kind !== "all") params.set("kind", kind);
      } else if (tab === "rules") {
        if (status !== "all") params.set("active", status);
      } else {
        if (status !== "all") params.set("status", status);
        if (kind !== "all") params.set("kind", kind);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
      }
      const resource = tab === "channels" ? "notification-endpoints" : tab === "rules" ? "notification-policies" : "notification-deliveries";
      void Promise.all([
        requestJson<Summary>("/api/v1/notifications/summary"),
        requestJson<PaginationResult<EndpointRecord | PolicyRecord | DeliveryRecord>>(`/api/v1/${resource}?${params}`),
        tab === "rules" ? requestJson<PaginationResult<EndpointRecord>>("/api/v1/notification-endpoints?page=1&pageSize=50") : Promise.resolve(null),
      ]).then(([nextSummary, result, options]) => {
        setSummary(nextSummary);
        if (tab === "channels") setEndpoints(result as PaginationResult<EndpointRecord>);
        if (tab === "rules") {
          setPolicies(result as PaginationResult<PolicyRecord>);
          setEndpointOptions(options?.items ?? []);
        }
        if (tab === "delivery") setDeliveries(result as PaginationResult<DeliveryRecord>);
      }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "No fue posible cargar las notificaciones."))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [tab, page, query, status, kind, from, to, reload]);

  const refresh = () => setReload((value) => value + 1);
  const selectTab = (next: typeof tab) => { setTab(next); setPage(1); setQuery(""); setStatus("all"); setKind("all"); setError(""); };

  const openCreateEndpoint = () => { setEditingEndpointId(null); setEndpointForm(emptyEndpointForm); setShowEndpointForm(true); };
  const openEditEndpoint = (endpoint: EndpointRecord) => {
    setEditingEndpointId(endpoint.id);
    setEndpointForm({ name: endpoint.name, kind: endpoint.kind, recipients: endpoint.configuration.recipients?.join(", ") || "", channel: endpoint.configuration.channel || "", url: endpoint.configuration.url || "", destination: endpoint.configuration.destination || "", secretReference: endpoint.secretReference || "", enabled: endpoint.enabled });
    setShowEndpointForm(true);
  };
  const submitEndpoint = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const configuration = endpointForm.kind === "email"
        ? { recipients: endpointForm.recipients.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean) }
        : endpointForm.kind === "teams"
          ? { channel: endpointForm.channel }
          : { url: endpointForm.url, destination: endpointForm.destination };
      await requestJson(editingEndpointId ? `/api/v1/notification-endpoints/${editingEndpointId}` : "/api/v1/notification-endpoints", { method: editingEndpointId ? "PATCH" : "POST", body: JSON.stringify({ name: endpointForm.name, kind: endpointForm.kind, configuration, secretReference: endpointForm.secretReference || null, enabled: endpointForm.enabled }) });
      setShowEndpointForm(false);
      notify(editingEndpointId ? "Canal actualizado y auditado." : "Canal creado en PostgreSQL.");
      refresh();
    } catch (saveError) { notify(saveError instanceof Error ? saveError.message : "No fue posible guardar el canal.", "warning"); }
    finally { setSaving(false); }
  };
  const toggleEndpoint = async (endpoint: EndpointRecord) => {
    try {
      await requestJson(`/api/v1/notification-endpoints/${endpoint.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !endpoint.enabled }) });
      notify(endpoint.enabled ? "Canal desactivado; sus reglas también quedaron detenidas." : "Canal activado.", "info");
      refresh();
    } catch (toggleError) { notify(toggleError instanceof Error ? toggleError.message : "No fue posible cambiar el canal.", "warning"); }
  };
  const archiveEndpoint = (endpoint: EndpointRecord) => confirm({ title: `Archivar ${endpoint.name}`, detail: "Se conservará su historial de entregas, pero el canal y sus reglas quedarán inactivos.", confirmLabel: "Archivar canal", tone: "danger", onConfirm: () => { void requestJson(`/api/v1/notification-endpoints/${endpoint.id}`, { method: "DELETE" }).then(() => { notify("Canal archivado sin perder trazabilidad."); refresh(); }).catch((archiveError) => notify(archiveError instanceof Error ? archiveError.message : "No fue posible archivar el canal.", "warning")); } });
  const testEndpoint = async (endpoint: EndpointRecord) => {
    setTestingId(endpoint.id);
    try {
      const result = await requestJson<{ ok: boolean; error: string | null }>(`/api/v1/notification-endpoints/${endpoint.id}/test`, { method: "POST" });
      notify(result.ok ? "Prueba entregada y canal verificado." : result.error || "La prueba falló; revisa la configuración.", result.ok ? "success" : "warning");
      refresh();
    } catch (testError) { notify(testError instanceof Error ? testError.message : "No fue posible probar el canal.", "warning"); }
    finally { setTestingId(null); }
  };

  const openCreatePolicy = () => { setEditingPolicyId(null); setPolicyForm({ ...emptyPolicyForm, endpointId: endpointOptions.find((endpoint) => endpoint.enabled)?.id || "" }); setShowPolicyForm(true); };
  const openEditPolicy = (policy: PolicyRecord) => {
    setEditingPolicyId(policy.id);
    setPolicyForm({ name: policy.name, endpointId: policy.endpointId, minimumSeverity: policy.minimumSeverity, escalationDelayMinutes: String(policy.escalationDelayMinutes), repeatIntervalMinutes: policy.repeatIntervalMinutes === null ? "" : String(policy.repeatIntervalMinutes), alarmKind: policy.filters.alarmKinds?.length === 1 ? policy.filters.alarmKinds[0] : "all", notifyOnRecovery: policy.filters.notifyOnRecovery === true, active: policy.active });
    setShowPolicyForm(true);
  };
  const submitPolicy = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await requestJson(editingPolicyId ? `/api/v1/notification-policies/${editingPolicyId}` : "/api/v1/notification-policies", { method: editingPolicyId ? "PATCH" : "POST", body: JSON.stringify({ name: policyForm.name, endpointId: policyForm.endpointId, minimumSeverity: policyForm.minimumSeverity, escalationDelayMinutes: Number(policyForm.escalationDelayMinutes), repeatIntervalMinutes: policyForm.repeatIntervalMinutes ? Number(policyForm.repeatIntervalMinutes) : null, active: policyForm.active, filters: { alarmKinds: policyForm.alarmKind === "all" ? [] : [policyForm.alarmKind], notifyOnRecovery: policyForm.notifyOnRecovery } }) });
      setShowPolicyForm(false);
      notify(editingPolicyId ? "Regla actualizada y auditada." : "Regla de escalamiento creada.");
      refresh();
    } catch (saveError) { notify(saveError instanceof Error ? saveError.message : "No fue posible guardar la regla.", "warning"); }
    finally { setSaving(false); }
  };
  const togglePolicy = async (policy: PolicyRecord) => {
    try {
      await requestJson(`/api/v1/notification-policies/${policy.id}`, { method: "PATCH", body: JSON.stringify({ active: !policy.active }) });
      notify(policy.active ? "Regla detenida." : "Regla habilitada.", "info");
      refresh();
    } catch (toggleError) { notify(toggleError instanceof Error ? toggleError.message : "No fue posible cambiar la regla.", "warning"); }
  };
  const deletePolicy = (policy: PolicyRecord) => confirm({ title: `Eliminar ${policy.name}`, detail: "La regla dejará de generar mensajes. Las entregas históricas seguirán disponibles.", confirmLabel: "Eliminar regla", tone: "danger", onConfirm: () => { void requestJson(`/api/v1/notification-policies/${policy.id}`, { method: "DELETE" }).then(() => { notify("Regla eliminada; el historial permanece intacto."); refresh(); }).catch((deleteError) => notify(deleteError instanceof Error ? deleteError.message : "No fue posible eliminar la regla.", "warning")); } });

  const retryDelivery = async (delivery: DeliveryRecord) => {
    setRetryingId(delivery.id);
    try {
      const result = await requestJson<{ ok: boolean; error: string | null }>(`/api/v1/notification-deliveries/${delivery.id}/retry`, { method: "POST" });
      notify(result.ok ? "Entrega completada en el reintento." : result.error || "El reintento volvió a fallar.", result.ok ? "success" : "warning");
      refresh();
    } catch (retryError) { notify(retryError instanceof Error ? retryError.message : "No fue posible reintentar la entrega.", "warning"); }
    finally { setRetryingId(null); }
  };

  return <>
    <section className="module-summary-grid notification-summary">
      <article><span className="module-summary-icon green"><IconMail size={19} /></span><div><small>Canales activos</small><strong>{summary?.endpoints.active ?? 0}</strong><span>{summary?.endpoints.verified ?? 0} verificados de {summary?.endpoints.total ?? 0}</span></div></article>
      <article><span className="module-summary-icon blue"><IconBellRinging size={19} /></span><div><small>Reglas habilitadas</small><strong>{summary?.policies.active ?? 0}</strong><span>de {summary?.policies.total ?? 0} configuradas</span></div></article>
      <article><span className={`module-summary-icon ${(summary?.deliveries.failed24h ?? 0) > 0 ? "amber" : "green"}`}><CircleStatus summary={summary} /></span><div><small>Entrega últimas 24 h</small><strong>{summary?.deliveries.successRate === null || summary?.deliveries.successRate === undefined ? "—" : `${summary.deliveries.successRate}%`}</strong><span>{summary?.deliveries.delivered24h ?? 0} entregadas · {summary?.deliveries.failed24h ?? 0} fallidas</span></div></article>
    </section>
    <article className={`panel module-panel notification-module ${canWrite ? "" : "role-readonly"}`}>
      <div className="module-toolbar notification-toolbar"><div className="module-tabs" role="tablist" aria-label="Secciones de notificaciones"><button className={tab === "channels" ? "active" : ""} onClick={() => selectTab("channels")}><IconMail size={16} /> Canales</button><button className={tab === "rules" ? "active" : ""} onClick={() => selectTab("rules")}><IconBellRinging size={16} /> Escalamiento</button><button className={tab === "delivery" ? "active" : ""} onClick={() => selectTab("delivery")}><IconClock size={16} /> Entregas</button></div><span className="autosave-state"><IconShieldCheck size={14} /> PostgreSQL · trazabilidad activa</span></div>
      <div className="notification-list-toolbar"><label className="search-field"><IconSearch size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={tab === "delivery" ? "Buscar alarma, asunto o destino…" : "Buscar por nombre…"} /></label>{tab !== "rules" && <label className="status-filter"><span>Canal</span><select value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }}><option value="all">Todos</option><option value="email">Correo</option><option value="teams">Teams</option><option value="webhook">Webhook</option></select></label>}<label className="status-filter"><span>Estado</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>{tab === "delivery" ? <><option value="all">Todos</option><option value="queued">Programadas</option><option value="sending">Enviando</option><option value="delivered">Entregadas</option><option value="failed">Fallidas</option></> : <><option value="all">Todos</option><option value="true">Activos</option><option value="false">Inactivos</option></>}</select></label>{tab === "delivery" && <><label className="notification-date-filter"><span>Desde</span><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label><label className="notification-date-filter"><span>Hasta</span><input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label></>}<button className="secondary-button" onClick={refresh}><IconRefresh size={15} /> Actualizar</button>{canWrite && tab !== "delivery" && <button className="primary-button" onClick={tab === "channels" ? openCreateEndpoint : openCreatePolicy}><IconPlus size={16} /> {tab === "channels" ? "Nuevo canal" : "Nueva regla"}</button>}</div>

      {error && <div className="data-error"><IconAlertTriangle size={18} /><div><strong>No se pudo cargar el módulo</strong><p>{error}</p></div></div>}
      {loading && <div className="data-loading"><IconRefresh className="spin" size={18} /> Consultando notificaciones…</div>}

      {tab === "channels" && !loading && !error && <div className="notification-content">
        {showEndpointForm && <form className="notification-editor" onSubmit={submitEndpoint}><div className="notification-editor-head"><div><span className="eyebrow">{editingEndpointId ? "Editar canal" : "Nuevo canal"}</span><h2>{editingEndpointId ? "Actualizar destino de entrega" : "Configurar un destino real"}</h2></div><button type="button" className="secondary-button" onClick={() => setShowEndpointForm(false)}>Cancelar</button></div><div className="notification-form-grid"><label><span>Nombre</span><input required minLength={2} value={endpointForm.name} onChange={(event) => setEndpointForm({ ...endpointForm, name: event.target.value })} placeholder="Ej.: Correo mantenimiento" /></label><label><span>Tipo</span><select value={endpointForm.kind} onChange={(event) => setEndpointForm({ ...endpointForm, kind: event.target.value as EndpointKind })}><option value="email">Correo electrónico</option><option value="teams">Microsoft Teams</option><option value="webhook">Webhook HTTPS</option></select></label>{endpointForm.kind === "email" && <label className="wide"><span>Destinatarios</span><textarea required value={endpointForm.recipients} onChange={(event) => setEndpointForm({ ...endpointForm, recipients: event.target.value })} placeholder="operaciones@empresa.cl, mantenimiento@empresa.cl" /><small>Separa varias direcciones con coma, punto y coma o una línea nueva.</small></label>}{endpointForm.kind === "teams" && <><label><span>Canal o equipo</span><input required value={endpointForm.channel} onChange={(event) => setEndpointForm({ ...endpointForm, channel: event.target.value })} /></label><label><span>Variable segura del webhook</span><input required value={endpointForm.secretReference} onChange={(event) => setEndpointForm({ ...endpointForm, secretReference: event.target.value.toUpperCase() })} placeholder="TEAMS_MANTENIMIENTO_WEBHOOK" /></label></>}{endpointForm.kind === "webhook" && <><label className="wide"><span>URL HTTPS</span><input type="url" required value={endpointForm.url} onChange={(event) => setEndpointForm({ ...endpointForm, url: event.target.value })} placeholder="https://cmms.empresa.cl/api/events" /></label><label><span>Nombre del destino</span><input value={endpointForm.destination} onChange={(event) => setEndpointForm({ ...endpointForm, destination: event.target.value })} placeholder="CMMS corporativo" /></label><label><span>Secreto HMAC (opcional)</span><input value={endpointForm.secretReference} onChange={(event) => setEndpointForm({ ...endpointForm, secretReference: event.target.value.toUpperCase() })} placeholder="CMMS_WEBHOOK_SECRET" /></label></>}<label className="notification-checkbox"><input type="checkbox" checked={endpointForm.enabled} onChange={(event) => setEndpointForm({ ...endpointForm, enabled: event.target.checked })} /><span>Canal activo al guardar</span></label></div><div className="notification-editor-actions"><button type="submit" className="primary-button" disabled={saving}><IconCheck size={16} /> {saving ? "Guardando…" : "Guardar canal"}</button></div></form>}
        {!showEndpointForm && endpoints?.items.length === 0 && <NotificationEmpty icon="channel" title="Aún no hay canales configurados" detail="Crea el primer destino y envía una prueba antes de asociarlo a una regla." action={canWrite ? openCreateEndpoint : undefined} actionLabel="Configurar primer canal" />}
        {!showEndpointForm && endpoints && endpoints.items.length > 0 && <><div className="notification-channel-grid">{endpoints.items.map((endpoint) => <article className={`notification-channel-card ${endpoint.enabled ? "enabled" : ""}`} key={endpoint.id}><div className="notification-channel-head"><span className="notification-channel-icon">{endpoint.kind === "email" ? <IconMail size={20} /> : endpoint.kind === "teams" ? <IconUsers size={20} /> : <IconWebhook size={20} />}</span><span className={`notification-verification ${endpoint.verifiedAt ? "verified" : "pending"}`}>{endpoint.verifiedAt ? <><IconCircleCheck size={14} /> Verificado</> : "Sin verificar"}</span></div><span className="eyebrow">{kindLabel(endpoint.kind)}</span><h3>{endpoint.name}</h3><p title={destination(endpoint)}>{destination(endpoint)}</p><dl><div><dt>Estado</dt><dd className={endpoint.enabled ? "quality-ok" : "muted-state"}>{endpoint.enabled ? "Activo" : "Inactivo"}</dd></div><div><dt>Última prueba</dt><dd>{endpoint.verifiedAt ? formatDateTime(endpoint.verifiedAt) : "Pendiente"}</dd></div></dl><div className="notification-card-actions"><button className="test-notification-button" onClick={() => void testEndpoint(endpoint)} disabled={!canWrite || !endpoint.enabled || testingId === endpoint.id}><IconSend size={15} />{testingId === endpoint.id ? "Probando…" : "Enviar prueba"}</button>{canWrite && <><button className="ghost-button" onClick={() => openEditEndpoint(endpoint)}><IconEdit size={14} /> Editar</button><button className={`channel-toggle ${endpoint.enabled ? "on" : ""}`} onClick={() => void toggleEndpoint(endpoint)}><i />{endpoint.enabled ? "Activo" : "Inactivo"}</button><button className="icon-danger-button" onClick={() => archiveEndpoint(endpoint)} aria-label={`Archivar ${endpoint.name}`}><IconTrash size={15} /></button></>}</div></article>)}</div><Pagination page={endpoints.page} totalPages={endpoints.totalPages} total={endpoints.total} pageSize={endpoints.pageSize} onPageChange={setPage} itemLabel="canales" /></>}
      </div>}

      {tab === "rules" && !loading && !error && <div className="notification-content notification-rules">
        {showPolicyForm && <form className="notification-editor" onSubmit={submitPolicy}><div className="notification-editor-head"><div><span className="eyebrow">{editingPolicyId ? "Editar escalamiento" : "Nueva regla"}</span><h2>Cuándo y por dónde informar</h2></div><button type="button" className="secondary-button" onClick={() => setShowPolicyForm(false)}>Cancelar</button></div><div className="notification-form-grid"><label><span>Nombre</span><input required minLength={2} value={policyForm.name} onChange={(event) => setPolicyForm({ ...policyForm, name: event.target.value })} placeholder="Ej.: Críticas inmediatas" /></label><label><span>Canal</span><select required value={policyForm.endpointId} onChange={(event) => setPolicyForm({ ...policyForm, endpointId: event.target.value })}><option value="">Selecciona un canal</option>{endpointOptions.map((endpoint) => <option key={endpoint.id} value={endpoint.id} disabled={!endpoint.enabled}>{endpoint.name} · {kindLabel(endpoint.kind)}{endpoint.enabled ? "" : " (inactivo)"}</option>)}</select></label><label><span>Severidad mínima</span><select value={policyForm.minimumSeverity} onChange={(event) => setPolicyForm({ ...policyForm, minimumSeverity: event.target.value as "warning" | "critical" })}><option value="critical">Crítica</option><option value="warning">Advertencia y crítica</option></select></label><label><span>Tipo de alarma</span><select value={policyForm.alarmKind} onChange={(event) => setPolicyForm({ ...policyForm, alarmKind: event.target.value })}><option value="all">Todas</option><option value="threshold">Umbral</option><option value="communication">Comunicación</option><option value="data_quality">Calidad de datos</option></select></label><label><span>Espera inicial (min)</span><input type="number" min="0" max="1440" required value={policyForm.escalationDelayMinutes} onChange={(event) => setPolicyForm({ ...policyForm, escalationDelayMinutes: event.target.value })} /></label><label><span>Repetir cada (min)</span><input type="number" min="5" max="10080" value={policyForm.repeatIntervalMinutes} onChange={(event) => setPolicyForm({ ...policyForm, repeatIntervalMinutes: event.target.value })} placeholder="Sin repetición" /></label><label className="notification-checkbox"><input type="checkbox" checked={policyForm.notifyOnRecovery} onChange={(event) => setPolicyForm({ ...policyForm, notifyOnRecovery: event.target.checked })} /><span>Informar recuperación</span></label><label className="notification-checkbox"><input type="checkbox" checked={policyForm.active} onChange={(event) => setPolicyForm({ ...policyForm, active: event.target.checked })} /><span>Regla activa</span></label></div><div className="notification-editor-actions"><button type="submit" className="primary-button" disabled={saving || !policyForm.endpointId}><IconCheck size={16} /> {saving ? "Guardando…" : "Guardar regla"}</button></div></form>}
        {!showPolicyForm && policies?.items.length === 0 && <NotificationEmpty icon="rule" title="Aún no hay reglas de escalamiento" detail={endpointOptions.length ? "Crea una regla para transformar las alarmas reales en mensajes trazables." : "Primero configura y verifica un canal de entrega."} action={canWrite && endpointOptions.length ? openCreatePolicy : undefined} actionLabel="Crear primera regla" />}
        {!showPolicyForm && policies && policies.items.length > 0 && <><div className="notification-rule-table"><div className="notification-rule-head"><span>Regla</span><span>Canal</span><span>Condición</span><span>Programación</span><span>Acciones</span></div>{policies.items.map((policy) => <div className="notification-rule-row" key={policy.id}><span><strong>{policy.name}</strong><small>{policy.filters.notifyOnRecovery ? "Incluye recuperación" : "Solo condición activa"}</small></span><span><b className="notification-kind-chip">{kindLabel(policy.endpointKind)}</b><small>{policy.endpointName}</small></span><span><strong>{policy.minimumSeverity === "critical" ? "Crítica" : "Advertencia + crítica"}</strong><small>{policy.filters.alarmKinds?.length === 1 ? policy.filters.alarmKinds[0] === "communication" ? "Comunicación" : policy.filters.alarmKinds[0] === "data_quality" ? "Calidad de datos" : "Umbral" : "Todas las alarmas"}</small></span><span><strong>{policy.escalationDelayMinutes ? `${policy.escalationDelayMinutes} min de espera` : "Inmediata"}</strong><small>{policy.repeatIntervalMinutes ? `Repite cada ${policy.repeatIntervalMinutes} min` : "Sin repetición"}</small></span><span className="row-actions">{canWrite && <><button className="ghost-button" onClick={() => openEditPolicy(policy)}><IconEdit size={14} /> Editar</button><button className={`channel-toggle ${policy.active ? "on" : ""}`} onClick={() => void togglePolicy(policy)} disabled={!policy.endpointEnabled}><i />{policy.active ? "Activa" : "Inactiva"}</button><button className="icon-danger-button" onClick={() => deletePolicy(policy)} aria-label={`Eliminar ${policy.name}`}><IconTrash size={15} /></button></>}</span></div>)}</div><Pagination page={policies.page} totalPages={policies.totalPages} total={policies.total} pageSize={policies.pageSize} onPageChange={setPage} itemLabel="reglas" /></>}
      </div>}

      {tab === "delivery" && !loading && !error && <div className="notification-content delivery-content">
        {deliveries?.items.length === 0 && <NotificationEmpty icon="delivery" title="No hay entregas para estos filtros" detail="Las pruebas y los mensajes generados por alarmas aparecerán aquí con todos sus intentos." />}
        {deliveries && deliveries.items.length > 0 && <><div className="module-table-wrap"><div className="delivery-table notification-delivery-table"><div className="module-table-head"><span>Fecha</span><span>Mensaje</span><span>Canal y destino</span><span>Resultado</span><span>Acción</span></div>{deliveries.items.map((delivery) => <div className="module-table-row" key={delivery.id}><span><strong className="mono-cell">{formatDateTime(delivery.queuedAt)}</strong><small>{delivery.sentAt ? `Entregada ${formatDateTime(delivery.sentAt)}` : delivery.status === "queued" ? `Programada ${formatDateTime(delivery.scheduledAt)}` : `Intento ${formatDateTime(delivery.lastAttemptAt)}`}</small></span><span><strong>{delivery.subject}</strong><small>{delivery.alarmCode || delivery.policyName || "Prueba manual"}</small></span><span><strong>{delivery.endpointName}</strong><small title={delivery.recipient || ""}>{delivery.recipient || kindLabel(delivery.endpointKind)}</small></span><span><b className={`delivery-status status-${delivery.status}`}>{delivery.status === "delivered" ? <IconCircleCheck size={14} /> : delivery.status === "failed" ? <IconAlertTriangle size={14} /> : <IconClock size={14} />}{statusLabel(delivery.status)}</b><small title={delivery.errorMessage || ""}>{delivery.errorMessage || `${delivery.attemptCount} de ${delivery.maxAttempts} intentos`}</small></span><span>{canWrite && delivery.status === "failed" ? <button className="ghost-button" disabled={retryingId === delivery.id} onClick={() => void retryDelivery(delivery)}><IconRefresh size={14} />{retryingId === delivery.id ? "Reintentando…" : "Reintentar"}</button> : <span className="muted-state">—</span>}</span></div>)}</div></div><Pagination page={deliveries.page} totalPages={deliveries.totalPages} total={deliveries.total} pageSize={deliveries.pageSize} onPageChange={setPage} itemLabel="entregas" /></>}
      </div>}
    </article>
    <div className="configuration-note notification-security-note"><IconShieldCheck size={17} /><p><strong>Secretos fuera de la base de datos.</strong> Teams usa una variable segura para su webhook; los webhooks pueden firmarse con HMAC y el correo utiliza <code>RESEND_API_KEY</code> y <code>NOTIFICATION_FROM_EMAIL</code> del entorno de despliegue.</p></div>
  </>;
}

function CircleStatus({ summary }: { summary: Summary | null }) {
  return (summary?.deliveries.failed24h ?? 0) > 0 ? <IconAlertTriangle size={19} /> : <IconCircleCheck size={19} />;
}

function NotificationEmpty({ icon, title, detail, action, actionLabel }: { icon: "channel" | "rule" | "delivery"; title: string; detail: string; action?: () => void; actionLabel?: string }) {
  return <div className="notification-empty"><span>{icon === "channel" ? <IconMail size={25} /> : icon === "rule" ? <IconBellRinging size={25} /> : <IconClock size={25} />}</span><div><h3>{title}</h3><p>{detail}</p></div>{action && <button className="primary-button" onClick={action}><IconPlus size={16} />{actionLabel}</button>}</div>;
}
