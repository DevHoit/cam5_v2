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
  IconInfoCircle,
  IconNetwork,
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
  return value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "Sin registro";
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

function evidenceSummary(item: CommissioningItem) {
  if (item.note) return item.note;
  return item.automatic ? "Se completa al ejecutar las validaciones automáticas." : "Requiere confirmación y evidencia de terreno.";
}

export function Cam5CommissioningView({ assetId, canExecute, notify, confirm, onOpenSettings, onOpenReports }: {
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
    const order = ["identity", "registers", "inputs", "clock", "alarms", "relays", "backup", "stability"];
    return [...(data?.items ?? [])].sort((left, right) => order.indexOf(left.itemKey) - order.indexOf(right.itemKey));
  }, [data]);

  const validate = async () => {
    setRunning(true);
    try {
      const result = await requestJson<CommissioningData>("/api/v1/commissioning", { method: "POST", body: JSON.stringify({ assetId, action: "validate" }) });
      setData(result); setTab("controls");
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

  if (!assetId) return <article className="panel permission-state"><span><IconCircuitCell size={27} /></span><div><span className="eyebrow">Puesta en marcha</span><h2>Selecciona un punto de medición</h2><p>El proceso se ejecuta sobre el controlador CAM-5 asociado al contexto activo.</p></div></article>;
  if (loading && !data) return <article className="panel commissioning-loading"><IconRefresh className="spin" size={21} /> Cargando expediente de puesta en marcha…</article>;
  if (error && !data) return <article className="panel commissioning-error"><IconAlertTriangle size={22} /><div><strong>No se pudo cargar el expediente</strong><p>{error}</p></div><button onClick={() => setReload((value) => value + 1)}>Reintentar</button></article>;
  if (!data) return null;

  const gatewayFresh = data.gateway.state === "online" && Boolean(data.gateway.lastSeenAt);
  const cam5Fresh = Boolean(data.device.lastReadAt);
  return <>
    <section className="commissioning-summary commissioning-summary-live">
      <article><span className="summary-symbol blue"><IconCircuitCell size={20} /></span><div><small>Controlador</small><strong>{data.device.modelCode}</strong><p>{data.device.serialNumber || "Identidad pendiente"}</p></div></article>
      <article><span className={`summary-symbol ${gatewayFresh ? "green" : "amber"}`}><IconRouter size={20} /></span><div><small>Gateway</small><strong>{gatewayFresh ? "Comunicando" : "Pendiente"}</strong><p>{data.gateway.code} · {formatDateTime(data.gateway.lastSeenAt)}</p></div></article>
      <article><span className={`summary-symbol ${cam5Fresh ? "green" : "amber"}`}><IconDatabase size={20} /></span><div><small>Última lectura CAM-5</small><strong>{cam5Fresh ? formatDateTime(data.device.lastReadAt) : "Sin lecturas"}</strong><p>Mapa Modbus {data.metrics.registers.minimum ?? 418}–{data.metrics.registers.maximum ?? 522}</p></div></article>
      <article><span className={`summary-symbol ${data.summary.ready ? "green" : data.summary.failed ? "amber" : "slate"}`}><IconShieldCheck size={20} /></span><div><small>Preparación</small><strong>{data.summary.percentage}%</strong><p>{data.summary.passed} de {data.summary.applicable} controles aprobados</p></div></article>
    </section>

    <article className="panel engineering-module commissioning-live-module">
      <div className="module-toolbar engineering-toolbar"><div className="module-tabs" role="tablist" aria-label="Puesta en marcha CAM-5"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><IconNetwork size={16} /> Resumen</button><button className={tab === "controls" ? "active" : ""} onClick={() => setTab("controls")}><IconShieldCheck size={16} /> Controles</button><button className={tab === "evidence" ? "active" : ""} onClick={() => setTab("evidence")}><IconFileReport size={16} /> Evidencias</button></div><span className={`commissioning-state state-${data.device.state}`}><i /> {deviceStateLabel(data.device.state)}</span></div>
      {error && <div className="validation-summary"><IconAlertTriangle size={17} /><div><strong>Los datos podrían estar desactualizados</strong><p>{error}</p></div></div>}

      {tab === "overview" && <div className="engineering-content commissioning-overview">
        <div className="commissioning-title-row"><div><span className="eyebrow">Expediente activo</span><h2>{data.asset.code} · {data.asset.name}</h2><p>La puesta en marcha valida la configuración existente; los parámetros se editan exclusivamente en Configuración.</p></div><button className="secondary-button" onClick={onOpenSettings}><IconPencil size={16} /> Abrir configuración</button></div>
        <section className="commissioning-chain" aria-label="Cadena de adquisición"><article className="passed"><span><IconShieldCheck size={19} /></span><small>01 · Configuración</small><strong>{data.metrics.registers.total} registros</strong><p>{data.metrics.inputs.enabled} entradas habilitadas</p></article><b>→</b><article className={gatewayFresh ? "passed" : "pending"}><span><IconRouter size={19} /></span><small>02 · Gateway</small><strong>{data.gateway.code}</strong><p>{gatewayFresh ? "En línea" : "Esperando comunicación"}</p></article><b>→</b><article className={cam5Fresh ? "passed" : "pending"}><span><IconCircuitCell size={19} /></span><small>03 · CAM-5</small><strong>{data.device.host}:{data.device.port}</strong><p>FC03 · Unit ID {data.device.unitId}</p></article><b>→</b><article className={data.metrics.readings.total ? "passed" : "pending"}><span><IconDatabase size={19} /></span><small>04 · Datos</small><strong>{data.metrics.readings.total.toLocaleString("es-CL")} muestras</strong><p>{data.metrics.readings.qualityPercent === null ? "Sin calidad calculada" : `${data.metrics.readings.qualityPercent}% válidas`}</p></article></section>
        <div className="commissioning-overview-grid"><section className="commissioning-readiness"><div className="readiness-dial" style={{ "--readiness": `${data.summary.percentage * 3.6}deg` } as React.CSSProperties}><span><strong>{data.summary.percentage}%</strong><small>completo</small></span></div><div><span className="eyebrow">Estado de habilitación</span><h3>{data.summary.ready ? "Todos los controles están aprobados" : "El equipo aún no puede habilitarse"}</h3><p>{data.summary.failed ? `${data.summary.failed} controles presentan hallazgos y ${data.summary.pending} siguen pendientes.` : `${data.summary.pending} controles todavía requieren evidencia.`}</p><div className="commissioning-readiness-actions"><button className="primary-button" disabled={!canExecute || running} onClick={() => void validate()}>{running ? <><IconRefresh className="spin" size={16} /> Validando…</> : <><IconRefresh size={16} /> Ejecutar validaciones</>}</button><button className="secondary-button" onClick={() => setTab("controls")}>Revisar controles</button></div></div></section><section className="commissioning-prerequisites"><h3>Requisitos técnicos</h3><dl><div><dt>Mapa Modbus</dt><dd className={data.metrics.registers.total === 105 ? "ok" : "warning"}>{data.metrics.registers.total}/105</dd></div><div><dt>Reglas configuradas</dt><dd className={data.metrics.alarms.configuredRules === data.metrics.alarms.enabledChannels ? "ok" : "warning"}>{data.metrics.alarms.configuredRules}/{data.metrics.alarms.enabledChannels}</dd></div><div><dt>Relés definidos</dt><dd className={data.metrics.relays.total === 6 ? "ok" : "warning"}>{data.metrics.relays.total}/6</dd></div><div><dt>Respaldos</dt><dd className={data.metrics.snapshots.total ? "ok" : "warning"}>{data.metrics.snapshots.total}</dd></div><div><dt>Estabilidad observada</dt><dd className={data.metrics.readings.stabilityHours >= 24 ? "ok" : "warning"}>{data.metrics.readings.stabilityHours} h</dd></div><div><dt>Calidad de datos</dt><dd className={(data.metrics.readings.qualityPercent ?? 0) >= 99 ? "ok" : "warning"}>{data.metrics.readings.qualityPercent ?? 0}%</dd></div></dl></section></div>
        <div className="engineering-note"><IconInfoCircle size={17} /><p>Las pruebas automáticas nunca sustituyen la verificación física de sensores, antenas, reloj y zona horaria. Esos dos controles requieren una confirmación firmada por el responsable.</p></div>
      </div>}

      {tab === "controls" && <div className="engineering-content commissioning-controls"><div className="commissioning-title-row"><div><span className="eyebrow">Lista de aceptación</span><h2>Controles previos a operación</h2><p>Los controles automáticos se recalculan desde PostgreSQL; los manuales conservan evidencia y responsable.</p></div>{canExecute && <button className="primary-button" disabled={running} onClick={() => void validate()}>{running ? <><IconRefresh className="spin" size={16} /> Validando…</> : <><IconRefresh size={16} /> Validar automáticamente</>}</button>}</div><div className="commissioning-control-list">{orderedItems.map((item, index) => <article className={`commissioning-control control-${item.status}`} key={item.id}><span className="control-index">{String(index + 1).padStart(2, "0")}</span><span className="control-status">{item.status === "passed" ? <IconCheck size={18} /> : item.status === "failed" ? <IconX size={18} /> : <IconClock size={18} />}</span><div><span className="control-type">{item.automatic ? "Validación automática" : "Confirmación de terreno"}</span><strong>{item.label}</strong><p>{evidenceSummary(item)}</p>{item.checkedAt && <small>{formatDateTime(item.checkedAt)} · {item.checkedByName || "Sistema"}</small>}</div><i>{stateLabel(item.status)}</i>{!item.automatic && canExecute && <button className="ghost-button" onClick={() => openEvidence(item)}><IconPencil size={14} /> Registrar evidencia</button>}</article>)}</div><footer className="commissioning-activation"><span className={data.summary.ready ? "ready" : "blocked"}>{data.summary.ready ? <IconCircleCheck size={22} /> : <IconShieldCheck size={22} />}</span><div><strong>{data.device.state === "active" ? "CAM-5 habilitado" : data.summary.ready ? "Expediente listo para habilitación" : "Habilitación bloqueada"}</strong><p>{data.device.state === "active" ? "El equipo está incorporado a la supervisión productiva." : data.summary.ready ? "La activación cambiará el estado del controlador y del punto de medición." : "Completa todos los controles aplicables antes de habilitar el equipo."}</p></div>{data.device.state === "active" ? <button className="secondary-button" onClick={onOpenReports}><IconFileReport size={16} /> Generar acta</button> : <button className="commissioning-activate-button" disabled={!data.summary.ready || !canExecute || activating} onClick={activate}>{activating ? "Habilitando…" : "Habilitar CAM-5"}</button>}</footer></div>}

      {tab === "evidence" && <div className="engineering-content commissioning-evidence"><div className="commissioning-title-row"><div><span className="eyebrow">Trazabilidad</span><h2>Evidencias registradas</h2><p>Resumen de resultados, responsables y marcas de tiempo del expediente activo.</p></div><button className="secondary-button" onClick={onOpenReports}><IconFileReport size={16} /> Abrir reportes</button></div><div className="commissioning-evidence-grid">{orderedItems.map((item) => <article key={item.id} className={`evidence-${item.status}`}><div><span>{item.status === "passed" ? <IconCheck size={16} /> : item.status === "failed" ? <IconAlertTriangle size={16} /> : <IconClock size={16} />}</span><i>{stateLabel(item.status)}</i></div><h3>{item.label}</h3><p>{evidenceSummary(item)}</p><dl>{Object.entries(item.evidence).slice(0, 4).map(([key, value]) => <div key={key}><dt>{key.replaceAll(/([A-Z])/g, " $1").replaceAll("At", "").trim()}</dt><dd>{value === null ? "—" : typeof value === "number" ? value.toLocaleString("es-CL") : String(value)}</dd></div>)}</dl><footer>{item.checkedAt ? `${formatDateTime(item.checkedAt)} · ${item.checkedByName || "Sistema"}` : "Sin revisión registrada"}</footer></article>)}</div></div>}
    </article>

    {editing && <div className="commissioning-modal-backdrop" role="presentation" onMouseDown={() => setEditing(null)}><form className="commissioning-evidence-dialog" onSubmit={saveEvidence} onMouseDown={(event) => event.stopPropagation()}><div><span className="eyebrow">Evidencia de terreno</span><h2>{editing.label}</h2><p>La decisión quedará asociada a tu usuario y registrada en auditoría.</p></div><button type="button" className="dialog-close" onClick={() => setEditing(null)} aria-label="Cerrar"><IconX size={18} /></button><label><span>Resultado</span><select value={manualStatus} onChange={(event) => setManualStatus(event.target.value as CheckStatus)}><option value="passed">Aprobado</option><option value="failed">Con hallazgo</option><option value="pending">Pendiente</option><option value="not_applicable">No aplica</option></select></label><label><span>Nota de evidencia</span><textarea required={manualStatus === "passed" || manualStatus === "failed"} minLength={3} value={manualNote} onChange={(event) => setManualNote(event.target.value)} placeholder="Indica qué se verificó, instrumento utilizado o referencia del acta…" /></label><div className="commissioning-dialog-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Guardando…" : "Guardar evidencia"}</button></div></form></div>}
  </>;
}
