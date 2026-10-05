"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconFileReport,
  IconPencil,
  IconRefresh,
  IconRouter,
  IconSettings,
  IconShieldCheck,
  IconX,
  IconCircuitCell,
  IconDatabase,
} from "@tabler/icons-react";

type NoticeTone = "success" | "info" | "warning";
type ConfirmRequest = { title: string; detail: string; confirmLabel: string; tone?: "default" | "danger"; onConfirm: () => void };
type CheckStatus = "pending" | "passed" | "failed" | "not_applicable";

type CommissioningItem = {
  id: string;
  itemKey: string;
  label: string;
  status: CheckStatus;
  evidence: Record<string, unknown>;
  note: string | null;
  checkedAt: string | null;
  checkedById: string | null;
  checkedByName: string | null;
  automatic: boolean;
};

type CommissioningData = {
  asset: { id: string; code: string; name: string; state: string };
  site: { id: string; name: string; timezone: string };
  device: {
    id: string;
    code: string;
    name: string;
    state: string;
    serialNumber: string | null;
    firmwareVersion: string | null;
    dataVersion: number | null;
    lastReadAt: string | null;
    modelCode: string;
    modelName: string;
  };
  gateway: { id: string; code: string; name: string; state: string; lastSeenAt: string | null };
  metrics: {
    metrics: { configured: number; recent: number; good: number; latestAt: string | null };
    capabilities: { total: number };
    gatewayOnline: boolean;
  };
  items: CommissioningItem[];
  summary: { total: number; applicable: number; passed: number; failed: number; pending: number; percentage: number; ready: boolean };
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible completar la solicitud.");
  }
  return response.json() as Promise<T>;
}

function formatDateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "Sin registro";
}

function relativeAge(value: string | null) {
  if (!value) return "Sin registro";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `Hace ${seconds} s`;
  if (seconds < 3600) return `Hace ${Math.round(seconds / 60)} min`;
  return `Hace ${Math.round(seconds / 3600)} h`;
}

function stateLabel(value: CheckStatus) {
  if (value === "passed") return "Aprobado";
  if (value === "failed") return "Con hallazgo";
  if (value === "not_applicable") return "No aplica";
  return "Pendiente";
}

function deviceStateLabel(value: string) {
  if (value === "active") return "Habilitado";
  if (value === "commissioning") return "En puesta en marcha";
  if (value === "offline") return "Sin comunicación";
  return value.replaceAll("_", " ");
}

function evidenceSummary(item: CommissioningItem) {
  if (item.note) return item.note;
  return item.automatic ? "Se recalcula desde el estado actual de Core." : "Requiere confirmación y evidencia de terreno.";
}

export function CommissioningView({ assetId, canExecute, notify, confirm, onOpenSettings, onOpenReports }: {
  assetId: string;
  canExecute: boolean;
  notify: (message: string, tone?: NoticeTone) => void;
  confirm: (request: ConfirmRequest) => void;
  onOpenSettings: () => void;
  onOpenReports: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "controls" | "evidence">("overview");
  const [data, setData] = useState<CommissioningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [activating, setActivating] = useState(false);
  const [editing, setEditing] = useState<CommissioningItem | null>(null);
  const [manualStatus, setManualStatus] = useState<CheckStatus>("passed");
  const [manualNote, setManualNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!assetId) return;
    let active = true;
    Promise.resolve().then(() => { if (active) { setLoading(true); setError(""); } })
      .then(() => requestJson<CommissioningData>(`/api/v1/commissioning?assetId=${encodeURIComponent(assetId)}`))
      .then((result) => { if (active) setData(result); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la puesta en marcha."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [assetId, reload]);

  const orderedItems = useMemo(() => {
    const order = ["identity", "gateway", "metrics", "quality", "field"];
    return [...(data?.items ?? [])].sort((left, right) => order.indexOf(left.itemKey) - order.indexOf(right.itemKey));
  }, [data]);

  const validate = async () => {
    setRunning(true);
    try {
      const result = await requestJson<CommissioningData>("/api/v1/commissioning", { method: "POST", body: JSON.stringify({ assetId, action: "validate" }) });
      setData(result);
      setTab("controls");
      notify(result.summary.failed ? `Validación terminada con ${result.summary.failed} controles con hallazgos.` : "Validaciones automáticas completadas.", result.summary.failed ? "warning" : "success");
    } catch (runError) {
      notify(runError instanceof Error ? runError.message : "No fue posible ejecutar las validaciones.", "warning");
    } finally {
      setRunning(false);
    }
  };

  const openEvidence = (item: CommissioningItem) => {
    if (item.automatic) return;
    setEditing(item);
    setManualStatus(item.status === "pending" ? "passed" : item.status);
    setManualNote(item.note ?? "");
  };

  const saveEvidence = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      await requestJson("/api/v1/commissioning", { method: "PATCH", body: JSON.stringify({ assetId, itemId: editing.id, status: manualStatus, note: manualNote }) });
      notify("Evidencia de terreno guardada y auditada.");
      setEditing(null);
      setReload((value) => value + 1);
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : "No fue posible guardar la evidencia.", "warning");
    } finally {
      setSaving(false);
    }
  };

  const activate = () => confirm({
    title: `Habilitar ${data?.device.code ?? "dispositivo"}`,
    detail: "El dispositivo y el activo pasarán a estado operativo. La decisión quedará registrada en auditoría.",
    confirmLabel: "Habilitar dispositivo",
    onConfirm: () => {
      setActivating(true);
      void requestJson<CommissioningData>("/api/v1/commissioning", { method: "POST", body: JSON.stringify({ assetId, action: "activate" }) })
        .then((result) => { setData(result); notify("Dispositivo habilitado para operación productiva."); })
        .catch((activationError) => notify(activationError instanceof Error ? activationError.message : "No fue posible habilitar el dispositivo.", "warning"))
        .finally(() => setActivating(false));
    },
  });

  if (!assetId) return <section className="engineering-empty-state">
    <span><IconShieldCheck size={24} /></span>
    <div><h1>Selecciona un activo</h1><p>La puesta en marcha valida el dispositivo, el gateway y la telemetría normalizada del activo seleccionado.</p></div>
  </section>;

  if (loading && !data) return <section className="engineering-loading-state"><IconRefresh className="spin" size={18} /><span>Consultando readiness del dispositivo…</span></section>;
  if (error && !data) return <section className="engineering-error-state"><IconAlertTriangle size={20} /><div><strong>No se pudo cargar la puesta en marcha</strong><p>{error}</p></div><button onClick={() => setReload((value) => value + 1)}>Reintentar</button></section>;
  if (!data) return null;

  const metrics = data.metrics.metrics;
  const gatewayFresh = data.metrics.gatewayOnline && Boolean(data.gateway.lastSeenAt);
  const telemetryFresh = metrics.recent > 0 && Boolean(metrics.latestAt);

  return <div className="commissioning-v3">
    <section className="engineering-commandbar">
      <div>
        <h1>Puesta en marcha</h1>
        <p>{data.asset.code} · {data.asset.name} · {data.device.code}</p>
      </div>
      <div className="engineering-command-actions">
        <span className={`engineering-state state-${data.summary.ready ? "ready" : data.summary.failed ? "warning" : "pending"}`}>
          {data.summary.ready ? <IconCircleCheck size={14} /> : <IconClock size={14} />}
          {data.summary.ready ? "Listo para habilitar" : data.summary.failed ? "Requiere revisión" : "En validación"}
        </span>
        <button onClick={onOpenSettings}><IconSettings size={14} /> Configuración</button>
      </div>
    </section>

    <section className="commissioning-status-strip">
      <article><span><IconCircuitCell size={17} /></span><div><small>Dispositivo</small><strong>{data.device.modelName}</strong><p>{data.device.code} · {deviceStateLabel(data.device.state)}</p></div></article>
      <article className={gatewayFresh ? "healthy" : "warning"}><span><IconRouter size={17} /></span><div><small>Gateway</small><strong>{gatewayFresh ? "Disponible" : "Pendiente"}</strong><p>{data.gateway.code} · {relativeAge(data.gateway.lastSeenAt)}</p></div></article>
      <article className={telemetryFresh ? "healthy" : "warning"}><span><IconDatabase size={17} /></span><div><small>Telemetría</small><strong>{metrics.recent}/{metrics.configured}</strong><p>{metrics.good} métricas con calidad válida</p></div></article>
      <article className={data.summary.ready ? "healthy" : ""}><span><IconShieldCheck size={17} /></span><div><small>Readiness</small><strong>{data.summary.percentage}%</strong><p>{data.summary.passed} de {data.summary.applicable} controles aprobados</p></div></article>
    </section>

    <article className="panel commissioning-workspace-v3">
      <div className="engineering-tabs-v3" role="tablist" aria-label="Puesta en marcha">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Resumen</button>
        <button className={tab === "controls" ? "active" : ""} onClick={() => setTab("controls")}>Controles</button>
        <button className={tab === "evidence" ? "active" : ""} onClick={() => setTab("evidence")}>Evidencias</button>
      </div>

      {error && <div className="engineering-inline-warning"><IconAlertTriangle size={16} /><span>{error}</span></div>}

      {tab === "overview" && <div className="commissioning-overview-v3">
        <section className="commissioning-readiness-v3">
          <div className="readiness-dial" style={{ "--readiness": `${data.summary.percentage * 3.6}deg` } as React.CSSProperties}><span><strong>{data.summary.percentage}%</strong><small>readiness</small></span></div>
          <div>
            <h2>{data.summary.ready ? "El dispositivo cumple los requisitos de habilitación" : "Aún existen requisitos pendientes"}</h2>
            <p>{data.summary.failed ? `${data.summary.failed} controles presentan hallazgos y ${data.summary.pending} siguen pendientes.` : data.summary.pending ? `${data.summary.pending} controles todavía requieren evidencia o validación.` : "Todos los controles aplicables están aprobados."}</p>
            <div className="commissioning-readiness-actions"><button className="primary-button" disabled={!canExecute || running} onClick={() => void validate()}>{running ? <><IconRefresh className="spin" size={15} /> Validando…</> : <><IconRefresh size={15} /> Ejecutar validaciones</>}</button><button className="secondary-button" onClick={() => setTab("controls")}>Revisar controles</button></div>
          </div>
        </section>

        <section className="commissioning-readiness-facts">
          <div><small>Capacidades</small><strong>{data.metrics.capabilities.total}</strong><span>habilitadas</span></div>
          <div><small>Métricas configuradas</small><strong>{metrics.configured}</strong><span>{metrics.recent} recientes</span></div>
          <div><small>Calidad reciente</small><strong>{metrics.recent ? Math.round(metrics.good / metrics.recent * 100) : 0}%</strong><span>{metrics.good}/{metrics.recent} válidas</span></div>
          <div><small>Última telemetría</small><strong>{relativeAge(metrics.latestAt)}</strong><span>{formatDateTime(metrics.latestAt)}</span></div>
        </section>

        <section className="commissioning-boundary-note"><IconShieldCheck size={17} /><div><strong>Responsabilidad de Core</strong><p>Esta puesta en marcha valida identidad, asociación lógica, disponibilidad del gateway, métricas normalizadas y calidad de datos. La configuración física del dispositivo pertenece al Gateway Agent.</p></div></section>
      </div>}

      {tab === "controls" && <div className="commissioning-controls-v3">
        <header><div><h2>Controles de habilitación</h2><p>Las validaciones automáticas se recalculan con el estado actual de Core; la verificación de terreno conserva responsable y evidencia.</p></div>{canExecute && <button className="primary-button" disabled={running} onClick={() => void validate()}>{running ? <><IconRefresh className="spin" size={15} /> Validando…</> : <><IconRefresh size={15} /> Validar ahora</>}</button>}</header>
        <div className="commissioning-control-list">
          {orderedItems.map((item, index) => <article className={`commissioning-control control-${item.status}`} key={item.id}>
            <span className="control-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="control-status">{item.status === "passed" ? <IconCheck size={17} /> : item.status === "failed" ? <IconX size={17} /> : <IconClock size={17} />}</span>
            <div><span className="control-type">{item.automatic ? "Automático" : "Terreno"}</span><strong>{item.label}</strong><p>{evidenceSummary(item)}</p>{item.checkedAt && <small>{formatDateTime(item.checkedAt)} · {item.checkedByName || "Sistema"}</small>}</div>
            <i>{stateLabel(item.status)}</i>
            {!item.automatic && canExecute && <button className="ghost-button" onClick={() => openEvidence(item)}><IconPencil size={14} /> Evidencia</button>}
          </article>)}
        </div>
        <footer className="commissioning-activation">
          <span className={data.summary.ready ? "ready" : "blocked"}>{data.summary.ready ? <IconCircleCheck size={21} /> : <IconShieldCheck size={21} />}</span>
          <div><strong>{data.device.state === "active" ? "Dispositivo habilitado" : data.summary.ready ? "Expediente listo para habilitación" : "Habilitación bloqueada"}</strong><p>{data.device.state === "active" ? "El dispositivo está incorporado a la operación productiva." : data.summary.ready ? "La habilitación cambiará el dispositivo y el activo a estado operativo." : "Completa todos los controles aplicables antes de habilitar el dispositivo."}</p></div>
          {data.device.state === "active" ? <button className="secondary-button" onClick={onOpenReports}><IconFileReport size={15} /> Generar acta</button> : <button className="commissioning-activate-button" disabled={!data.summary.ready || !canExecute || activating} onClick={activate}>{activating ? "Habilitando…" : "Habilitar dispositivo"}</button>}
        </footer>
      </div>}

      {tab === "evidence" && <div className="commissioning-evidence-v3">
        <header><div><h2>Evidencias registradas</h2><p>Resultados, responsable y marcas de tiempo del expediente de puesta en marcha.</p></div><button className="secondary-button" onClick={onOpenReports}><IconFileReport size={15} /> Reportes</button></header>
        <div className="commissioning-evidence-grid">
          {orderedItems.map((item) => <article key={item.id} className={`evidence-${item.status}`}><div><span>{item.status === "passed" ? <IconCheck size={16} /> : item.status === "failed" ? <IconAlertTriangle size={16} /> : <IconClock size={16} />}</span><i>{stateLabel(item.status)}</i></div><h3>{item.label}</h3><p>{evidenceSummary(item)}</p><dl>{Object.entries(item.evidence).slice(0, 4).map(([key, value]) => <div key={key}><dt>{key.replaceAll(/([A-Z])/g, " $1").trim()}</dt><dd>{value === null ? "—" : typeof value === "number" ? value.toLocaleString("es-CL") : String(value)}</dd></div>)}</dl><footer>{item.checkedAt ? `${formatDateTime(item.checkedAt)} · ${item.checkedByName || "Sistema"}` : "Sin revisión registrada"}</footer></article>)}
        </div>
      </div>}
    </article>

    {editing && <div className="commissioning-modal-backdrop" role="presentation" onMouseDown={() => setEditing(null)}><form className="commissioning-evidence-dialog" onSubmit={saveEvidence} onMouseDown={(event) => event.stopPropagation()}><div><h2>{editing.label}</h2><p>La decisión quedará asociada a tu usuario y registrada en auditoría.</p></div><button type="button" className="dialog-close" onClick={() => setEditing(null)} aria-label="Cerrar"><IconX size={18} /></button><label><span>Resultado</span><select value={manualStatus} onChange={(event) => setManualStatus(event.target.value as CheckStatus)}><option value="passed">Aprobado</option><option value="failed">Con hallazgo</option><option value="pending">Pendiente</option><option value="not_applicable">No aplica</option></select></label><label><span>Nota de evidencia</span><textarea required={manualStatus === "passed" || manualStatus === "failed"} minLength={3} value={manualNote} onChange={(event) => setManualNote(event.target.value)} placeholder="Indica qué se verificó, instrumento utilizado o referencia del acta…" /></label><div className="commissioning-dialog-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Guardando…" : "Guardar evidencia"}</button></div></form></div>}
  </div>;
}
