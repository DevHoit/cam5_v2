"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconCircuitCell,
  IconClock,
  IconDatabase,
  IconFileReport,
  IconPencil,
  IconRefresh,
  IconRouter,
  IconShieldCheck,
  IconX,
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
  device: { id: string; code: string; name: string; state: string; serialNumber: string | null; firmwareVersion: string | null; dataVersion: number | null; protocol: string; host: string; port: number; unitId: number; lastReadAt: string | null; modelCode: string; modelName: string; registerMapVersion: string };
  gateway: { id: string; code: string; name: string; state: string; lastSeenAt: string | null };
  metrics: {
    inputs: { total: number; enabled: number };
    registers: { total: number; minimum: number | null; maximum: number | null };
    alarms: { enabledChannels: number; configuredRules: number };
    relays: { total: number; enabled: number };
    snapshots: { total: number; latestAt: string | null };
    readings: { total: number; valid: number; qualityPercent: number | null; firstAt: string | null; lastAt: string | null; stabilityHours: number };
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
  return value ? new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "Sin registro";
}

const EVIDENCE_LABELS: Record<string, string> = {
  serialNumber: "Serie", firmwareVersion: "Firmware", dataVersion: "Versión de datos",
  registerCount: "Registros", minimumRegister: "Registro inicial", maximumRegister: "Registro final", lastReadAt: "Última lectura",
  enabledChannelCount: "Canales habilitados", configuredRuleCount: "Reglas configuradas", relayCount: "Relés definidos", snapshotCount: "Respaldos",
  readingCount: "Muestras", validReadingCount: "Muestras válidas", stabilityHours: "Horas observadas", qualityPercent: "Calidad (%)", firstReadingAt: "Primera muestra", lastReadingAt: "Última muestra",
};

/** Evidencia en lenguaje legible: oculta metadatos internos y formatea fechas. */
function evidenceEntries(evidence: Record<string, unknown>) {
  return Object.entries(evidence)
    .filter(([key]) => key !== "validatedAt" && key !== "source")
    .map(([key, value]) => {
      const label = EVIDENCE_LABELS[key] ?? key.replaceAll(/([A-Z])/g, " $1").toLowerCase();
      if (value === null || value === undefined || value === "") return [label, "—"] as const;
      if (typeof value === "number") return [label, value.toLocaleString("es-CL")] as const;
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return [label, formatDateTime(value)] as const;
      return [label, String(value)] as const;
    });
}

function stateLabel(value: string) {
  if (value === "passed") return "Aprobado";
  if (value === "failed") return "Con hallazgo";
  if (value === "not_applicable") return "No aplica";
  return "Pendiente";
}

function deviceStateLabel(value: string) {
  if (value === "active") return "Habilitado";
  if (value === "commissioning") return "En puesta en marcha";
  if (value === "offline") return "Sin conexión";
  return value.replaceAll("_", " ");
}

export function Cam5CommissioningView({ assetId, canExecute, notify, confirm, onOpenSettings, onOpenReports }: {
  assetId: string;
  canExecute: boolean;
  notify: (message: string, tone?: NoticeTone) => void;
  confirm: (request: ConfirmRequest) => void;
  onOpenSettings: () => void;
  onOpenReports: () => void;
}) {
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
    const order = ["identity", "registers", "inputs", "clock", "alarms", "relays", "backup", "stability"];
    return [...(data?.items ?? [])].sort((left, right) => order.indexOf(left.itemKey) - order.indexOf(right.itemKey));
  }, [data]);

  const validate = async () => {
    setRunning(true);
    try {
      const result = await requestJson<CommissioningData>("/api/v1/commissioning", { method: "POST", body: JSON.stringify({ assetId, action: "validate" }) });
      setData(result);
      notify(result.summary.failed ? `Validación terminada con ${result.summary.failed} controles pendientes de resolver.` : "Validaciones automáticas completadas.", result.summary.failed ? "warning" : "success");
    } catch (runError) { notify(runError instanceof Error ? runError.message : "No fue posible ejecutar las validaciones.", "warning"); }
    finally { setRunning(false); }
  };

  const openEvidence = (item: CommissioningItem) => {
    if (item.automatic) return;
    setEditing(item); setManualStatus(item.status === "pending" ? "passed" : item.status); setManualNote(item.note ?? "");
  };

  const saveEvidence = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      await requestJson("/api/v1/commissioning", { method: "PATCH", body: JSON.stringify({ assetId, itemId: editing.id, status: manualStatus, note: manualNote }) });
      notify("Evidencia de terreno guardada y auditada."); setEditing(null); setReload((value) => value + 1);
    } catch (saveError) { notify(saveError instanceof Error ? saveError.message : "No fue posible guardar la evidencia.", "warning"); }
    finally { setSaving(false); }
  };

  const activate = () => confirm({
    title: `Habilitar ${data?.device.code ?? "CAM-5"}`,
    detail: "El controlador y el punto de medición pasarán a estado operativo. Esta decisión quedará registrada en auditoría.",
    confirmLabel: "Habilitar equipo",
    onConfirm: () => {
      setActivating(true);
      void requestJson<CommissioningData>("/api/v1/commissioning", { method: "POST", body: JSON.stringify({ assetId, action: "activate" }) })
        .then((result) => { setData(result); notify("CAM-5 habilitado para operación productiva."); })
        .catch((activationError) => notify(activationError instanceof Error ? activationError.message : "No fue posible habilitar el equipo.", "warning"))
        .finally(() => setActivating(false));
    },
  });

  if (!assetId) return <article className="panel permission-state"><span><IconCircuitCell size={27} aria-hidden="true" /></span><div><span className="eyebrow">Puesta en marcha</span><h2>Selecciona un punto de medición</h2><p>El proceso se ejecuta sobre el controlador CAM-5 asociado al contexto activo.</p></div></article>;
  if (loading && !data) return <article className="panel commissioning-loading"><IconRefresh className="spin" size={21} /> Cargando expediente de puesta en marcha…</article>;
  if (error && !data) return <article className="panel commissioning-error"><IconAlertTriangle size={22} /><div><strong>No se pudo cargar el expediente</strong><p>{error}</p></div><button onClick={() => setReload((value) => value + 1)}>Reintentar</button></article>;
  if (!data) return null;

  const gatewayFresh = data.gateway.state === "online" && Boolean(data.gateway.lastSeenAt);
  const cam5Fresh = Boolean(data.device.lastReadAt);
  const { metrics, summary } = data;
  /** Lo que el sistema mide hoy para cada control (antes "Requisitos técnicos"). */
  const currentMeasure = (item: CommissioningItem): { text: string; ok: boolean } | null => {
    switch (item.itemKey) {
      case "identity": return { text: data.device.serialNumber ? `Serie ${data.device.serialNumber}${data.device.firmwareVersion ? ` · FW ${data.device.firmwareVersion}` : ""}` : "Sin serie ni firmware", ok: Boolean(data.device.serialNumber && data.device.firmwareVersion) };
      case "registers": return { text: `Mapa Modbus ${metrics.registers.total}/105`, ok: metrics.registers.total === 105 && cam5Fresh };
      case "alarms": return { text: `${metrics.alarms.configuredRules}/${metrics.alarms.enabledChannels} reglas`, ok: metrics.alarms.enabledChannels > 0 && metrics.alarms.configuredRules === metrics.alarms.enabledChannels };
      case "relays": return { text: `${metrics.relays.total}/6 relés`, ok: metrics.relays.total === 6 };
      case "backup": return { text: `${metrics.snapshots.total} ${metrics.snapshots.total === 1 ? "respaldo" : "respaldos"}`, ok: metrics.snapshots.total > 0 };
      case "stability": return { text: `${metrics.readings.stabilityHours} h · ${metrics.readings.qualityPercent ?? 0}% válidas`, ok: metrics.readings.stabilityHours >= 24 && (metrics.readings.qualityPercent ?? 0) >= 99 };
      default: return null;
    }
  };
  const headline = summary.ready ? "Todos los controles aprobados" : `${summary.passed} de ${summary.applicable} controles aprobados`;
  const detail = summary.ready ? (data.device.state === "active" ? "El equipo está incorporado a la supervisión productiva." : "El expediente está listo para habilitar el equipo.")
    : [summary.failed ? `${summary.failed} con hallazgo` : "", summary.pending ? `${summary.pending} ${summary.pending === 1 ? "pendiente" : "pendientes"}` : ""].filter(Boolean).join(" · ");
  return <>
    <section className="module-summary-strip commissioning-summary" aria-label="Resumen de puesta en marcha">
      <span><IconCircuitCell size={15} aria-hidden="true" /><strong>{data.device.code}</strong> · {data.device.modelCode}</span>
      <span className={gatewayFresh ? "is-ok" : "is-warning"}><IconRouter size={15} aria-hidden="true" />Gateway {data.gateway.code}: <strong>{gatewayFresh ? "comunicando" : "sin comunicación"}</strong></span>
      <span><IconDatabase size={15} aria-hidden="true" />Última lectura: <strong>{cam5Fresh ? formatDateTime(data.device.lastReadAt) : "sin lecturas"}</strong></span>
      <span className={`commissioning-state state-${data.device.state}`}><i aria-hidden="true" /> {deviceStateLabel(data.device.state)}</span>
    </section>

    <article className="panel commissioning-module">
      {error && <div className="validation-summary"><IconAlertTriangle size={17} aria-hidden="true" /><div><strong>Los datos podrían estar desactualizados</strong><p>{error}</p></div></div>}
      <header className="commissioning-head">
        <div className="commissioning-head-text">
          <span className="eyebrow">Expediente · {data.asset.code} · {data.asset.name}</span>
          <h2>{headline}</h2>
          {detail && <p>{detail}</p>}
          <div className="commissioning-progress" role="progressbar" aria-label="Avance de la puesta en marcha" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.percentage}><i style={{ width: `${summary.percentage}%` }} className={summary.ready ? "ready" : summary.failed ? "warning" : ""} /></div>
        </div>
        <div className="commissioning-head-actions">
          <button className="secondary-button" onClick={onOpenSettings}><IconPencil size={16} aria-hidden="true" /> Abrir configuración</button>
          {canExecute && <button className="primary-button" disabled={running} onClick={() => void validate()}>{running ? <><IconRefresh className="spin" size={16} aria-hidden="true" /> Validando…</> : <><IconRefresh size={16} aria-hidden="true" /> Ejecutar validaciones</>}</button>}
        </div>
      </header>

      <ol className="commissioning-chain" aria-label="Cadena de adquisición">
        <li className="passed"><IconShieldCheck size={16} aria-hidden="true" /><span><small>Configuración</small><strong>{metrics.registers.total} registros · {metrics.inputs.enabled} entradas</strong></span></li>
        <li className={gatewayFresh ? "passed" : "pending"}><IconRouter size={16} aria-hidden="true" /><span><small>Gateway</small><strong>{data.gateway.code} · {gatewayFresh ? "en línea" : "esperando"}</strong></span></li>
        <li className={cam5Fresh ? "passed" : "pending"}><IconCircuitCell size={16} aria-hidden="true" /><span><small>CAM-5 · Unit ID {data.device.unitId}</small><strong>{data.device.host}:{data.device.port}</strong></span></li>
        <li className={metrics.readings.total ? "passed" : "pending"}><IconDatabase size={16} aria-hidden="true" /><span><small>Datos</small><strong>{metrics.readings.total.toLocaleString("es-CL")} muestras{metrics.readings.qualityPercent === null ? "" : ` · ${metrics.readings.qualityPercent}%`}</strong></span></li>
      </ol>

      <section className="commissioning-controls" aria-labelledby="commissioning-controls-title">
        <div className="commissioning-controls-title"><h3 id="commissioning-controls-title">Controles previos a operación</h3><p>Los automáticos se recalculan con los datos recibidos. Sensores, antenas, reloj y zona horaria se confirman en terreno.</p></div>
        <div className="commissioning-control-list" role="table" aria-label="Controles previos a operación">
          <div className="commissioning-control-head" role="row"><span role="columnheader">Control</span><span role="columnheader">Medición actual</span><span role="columnheader">Estado</span><span role="columnheader">Última revisión</span><span role="columnheader"><span className="sr-only">Acción</span></span></div>
          {orderedItems.map((item, index) => {
            const measure = currentMeasure(item);
            const entries = evidenceEntries(item.evidence);
            return <div role="row" className={`commissioning-control control-${item.status}`} key={item.id}>
              <span role="cell" className="commissioning-control-name">
                <span className="control-status" aria-hidden="true">{item.status === "passed" ? <IconCheck size={15} /> : item.status === "failed" ? <IconX size={15} /> : <IconClock size={15} />}</span>
                <span>
                  <strong><span className="control-index">{String(index + 1).padStart(2, "0")}</span> {item.label}</strong>
                  <small>{item.automatic ? "Automático" : "Terreno"}{item.note ? ` · ${item.note}` : ""}</small>
                  {entries.length > 0 && <details className="commissioning-evidence"><summary>Ver evidencia</summary><dl>{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>}
                </span>
              </span>
              <span role="cell" className={`commissioning-measure ${measure ? measure.ok ? "ok" : "warning" : ""}`}>{measure ? measure.text : item.automatic ? "—" : "Confirmación manual"}</span>
              <span role="cell"><i className="commissioning-status-badge">{stateLabel(item.status)}</i></span>
              <span role="cell" className="commissioning-checked">{item.checkedAt ? <>{formatDateTime(item.checkedAt)}<small>{item.checkedByName || "Sistema"}</small></> : <small>Sin revisión</small>}</span>
              <span role="cell">{!item.automatic && canExecute && <button className="ghost-button" onClick={() => openEvidence(item)} aria-label={`Registrar evidencia: ${item.label}`}><IconPencil size={14} aria-hidden="true" /> Registrar</button>}</span>
            </div>;
          })}
        </div>
      </section>

      <footer className="commissioning-activation"><span className={data.device.state === "active" || summary.ready ? "ready" : "blocked"} aria-hidden="true">{data.device.state === "active" || summary.ready ? <IconCircleCheck size={20} /> : <IconShieldCheck size={20} />}</span><div><strong>{data.device.state === "active" ? "CAM-5 habilitado" : summary.ready ? "Expediente listo para habilitación" : "Habilitación bloqueada"}</strong><p>{data.device.state === "active" ? "Puedes generar el acta de puesta en marcha desde Reportes." : summary.ready ? "La activación cambiará el estado del controlador y del punto de medición." : "Completa todos los controles aplicables antes de habilitar el equipo."}</p></div>{data.device.state === "active" ? <button className="secondary-button" onClick={onOpenReports}><IconFileReport size={16} aria-hidden="true" /> Generar acta</button> : <button className="commissioning-activate-button" disabled={!summary.ready || !canExecute || activating} onClick={activate}>{activating ? "Habilitando…" : "Habilitar CAM-5"}</button>}</footer>
    </article>

    {editing && <div className="commissioning-modal-backdrop" role="presentation" onMouseDown={() => setEditing(null)}><form className="commissioning-evidence-dialog" role="dialog" aria-modal="true" aria-label={`Evidencia de terreno: ${editing.label}`} onKeyDown={(event) => { if (event.key === "Escape") setEditing(null); }} onSubmit={saveEvidence} onMouseDown={(event) => event.stopPropagation()}><div><span className="eyebrow">Evidencia de terreno</span><h2>{editing.label}</h2><p>La decisión quedará asociada a tu usuario y registrada en auditoría.</p></div><button type="button" className="dialog-close" onClick={() => setEditing(null)} aria-label="Cerrar"><IconX size={18} aria-hidden="true" /></button><label><span>Resultado</span><select value={manualStatus} onChange={(event) => setManualStatus(event.target.value as CheckStatus)}><option value="passed">Aprobado</option><option value="failed">Con hallazgo</option><option value="pending">Pendiente</option><option value="not_applicable">No aplica</option></select></label><label><span>Nota de evidencia</span><textarea required={manualStatus === "passed" || manualStatus === "failed"} minLength={3} value={manualNote} onChange={(event) => setManualNote(event.target.value)} placeholder="Indica qué se verificó, instrumento utilizado o referencia del acta…" /></label><div className="commissioning-dialog-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Guardando…" : "Guardar evidencia"}</button></div></form></div>}
  </>;
}
