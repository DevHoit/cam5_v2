"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { IconAdjustmentsHorizontal, IconPlus, IconRefresh, IconSearch } from "@tabler/icons-react";
import type { MetricRuleItem, MetricRuleMetric } from "../db/metric-rule-contract";
import styles from "./metric-rules.module.css";

const operators: Record<string, string> = { gte: "Mayor o igual (≥)", gt: "Mayor que (>)", lte: "Menor o igual (≤)", lt: "Menor que (<)", eq: "Igual (=)", neq: "Distinto (≠)" };
const states: Record<string, string> = { disabled: "Desactivada", unavailable: "Sin dato válido", unevaluated: "Aún sin evaluar", false: "Normal", pending: "En persistencia", firing: "En alarma", recovering: "En recuperación" };
const severities = { info: "Informativa", warning: "Advertencia", critical: "Crítica" };
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString("es-CL") : "Sin lectura";
type Editor = { metric: MetricRuleMetric; rule?: MetricRuleItem };
type Form = { name: string; op: string; value: string; severity: string; durationSeconds: string; recoveryThreshold: string; recoverySeconds: string; staleAfterSeconds: string; enabled: boolean };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" }, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "No fue posible consultar las reglas.");
  return result as T;
}

export function MetricRulesView({ assetId, canConfigure }: { assetId: string; canConfigure: boolean }) {
  const [metrics, setMetrics] = useState<MetricRuleMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [device, setDevice] = useState("");
  const [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState<Editor | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    request<{ metrics: MetricRuleMetric[] }>(`/api/v1/metric-rules?assetId=${encodeURIComponent(assetId)}`, { signal: abort.signal })
      .then((data) => { if (!abort.signal.aborted) { setMetrics(data.metrics); setError(""); } })
      .catch((err: unknown) => { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "No fue posible cargar las reglas."); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [assetId, revision]);
  const refresh = () => { setLoading(true); setRevision((value) => value + 1); };
  const visible = metrics.filter((metric) => (!device || metric.deviceId === device) &&
    `${metric.code} ${metric.name} ${metric.deviceName} ${metric.deviceCode}`.toLowerCase().includes(query.toLowerCase()) &&
    (filter === "all" || (filter === "unconfigured" ? !metric.rules.some((rule) => rule.enabled) : metric.rules.some((rule) => rule.enabled))));
  const devices = [...new Map(metrics.map((metric) => [metric.deviceId, metric])).values()];
  const configured = metrics.filter((metric) => metric.rules.some((rule) => rule.enabled)).length;
  return <section className={styles.root} aria-label="Reglas por dispositivo y métrica">
    <header className={styles.header}><div><h2><IconAdjustmentsHorizontal size={20} /> Reglas por dispositivo y métrica</h2><p>Define límites independientes para cada variable. Una métrica puede tener varias reglas.</p></div><button className="secondary-button" onClick={refresh} disabled={loading || !!editor}><IconRefresh size={16} /> Actualizar</button></header>
    <div className={styles.summary}><div><strong>{metrics.length}</strong><span>Métricas medidas</span></div><div><strong>{configured}</strong><span>Con reglas activas</span></div><div><strong>{metrics.length - configured}</strong><span>Sin reglas activas</span></div></div>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {editor && <RuleEditor key={`${editor.metric.id}-${editor.rule?.id ?? "new"}`} editor={editor} assetId={assetId} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice("Regla guardada. La evaluación comenzará con las próximas lecturas vigentes."); refresh(); }} />}
    <div className={styles.filters}><label><span><IconSearch size={15} /> Buscar</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sensor, medidor o métrica…" /></label><label><span>Dispositivo</span><select value={device} onChange={(e) => setDevice(e.target.value)}><option value="">Todos los dispositivos</option>{devices.map((metric) => <option key={metric.deviceId} value={metric.deviceId}>{metric.deviceCode} · {metric.deviceName}</option>)}</select></label><label><span>Configuración</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Todas las métricas</option><option value="unconfigured">Sin reglas activas</option><option value="configured">Con reglas activas</option></select></label></div>
    {loading ? <p role="status">Cargando métricas y reglas…</p> : !metrics.length ? <p>No hay métricas registradas para los dispositivos de este activo.</p> : !visible.length ? <p>No hay métricas que coincidan con los filtros.</p> : <div className={styles.metrics}>{visible.map((metric) => <article className={styles.metric} key={metric.id}>
      <header><div><small>{metric.deviceCode} · {metric.deviceName}</small><h3>{metric.code} · {metric.name}</h3><p>{metric.value === null ? "Sin datos" : `${String(metric.value)} ${metric.unit}`} · {dateLabel(metric.recordedAt)}{metric.quality && metric.quality !== "good" ? " · Calidad no válida" : ""}{!metric.enabled ? " · Métrica o dispositivo deshabilitado" : ""}</p></div>{canConfigure && <button className="secondary-button" onClick={() => { setEditor({ metric }); setNotice(""); }} disabled={!!editor}><IconPlus size={15} /> Añadir regla</button>}</header>
      {!metric.rules.length ? <p className={styles.empty}>Sin reglas configuradas para esta métrica.</p> : metric.rules.map((rule) => <div className={styles.rule} key={rule.id}>
        <div><strong>{rule.name}</strong><span>{operators[rule.op] ?? rule.op} {String(rule.value)} {metric.unit} · {severities[rule.severity]}</span><small>Activación: {rule.durationSeconds} s · Recuperación: {rule.recoveryThreshold === null ? "al normalizar" : `${rule.op.startsWith("g") ? "≤" : "≥"} ${rule.recoveryThreshold} ${metric.unit}`} durante {rule.recoverySeconds} s</small></div>
        <div><b className={rule.state === "firing" ? styles.alarm : styles.state}>{states[rule.state] ?? rule.state}</b><small>Evaluación: {rule.lastEvaluatedAt ? dateLabel(rule.lastEvaluatedAt) : "Pendiente"}</small><small>Vigencia máxima: {rule.staleAfterSeconds} s</small>{rule.lastValue?.unavailable === true && <small>Revisar vigencia, calidad y disponibilidad de la lectura.</small>}</div>
        {rule.editable && canConfigure ? <button className="ghost-button" disabled={!!editor} onClick={() => setEditor({ metric, rule })}>Editar</button> : <small>{!rule.editable ? "Administrada desde su módulo de origen" : "Sólo lectura"}</small>}
      </div>)}
    </article>)}</div>}
    <p className={styles.note}>Las reglas habilitadas se evalúan al recibir datos. El envío de mensajes se configura en Notificaciones; los límites de laboratorio no son límites productivos.</p>
  </section>;
}

function RuleEditor({ editor: { metric, rule }, assetId, onCancel, onSaved }: { editor: Editor; assetId: string; onCancel: () => void; onSaved: () => void }) {
  const numeric = ["float", "integer"].includes(metric.dataType);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { formRef.current?.scrollIntoView({ block: "nearest" }); }, []);
  const [form, setForm] = useState<Form>({ name: rule?.name ?? `${metric.deviceCode} · ${metric.code}`, op: rule?.op ?? (numeric ? "gte" : "eq"), value: rule ? String(rule.value) : metric.dataType === "boolean" ? "true" : "", severity: rule?.severity ?? "warning", durationSeconds: String(rule?.durationSeconds ?? 60), recoveryThreshold: rule?.recoveryThreshold === null || rule?.recoveryThreshold === undefined ? "" : String(rule.recoveryThreshold), recoverySeconds: String(rule?.recoverySeconds ?? 0), staleAfterSeconds: String(rule?.staleAfterSeconds ?? metric.staleAfterSeconds), enabled: rule?.enabled ?? false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const field = (key: keyof Form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const directional = numeric && ["gt", "gte", "lt", "lte"].includes(form.op);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await request(rule ? `/api/v1/metric-rules/${rule.id}` : "/api/v1/metric-rules", { method: rule ? "PATCH" : "POST", body: JSON.stringify({ ...form, assetId, deviceMetricId: metric.id, updatedAt: rule?.updatedAt, value: numeric ? Number(form.value) : metric.dataType === "boolean" ? form.value === "true" : form.value, durationSeconds: Number(form.durationSeconds), recoverySeconds: Number(form.recoverySeconds), staleAfterSeconds: Number(form.staleAfterSeconds), recoveryThreshold: directional && form.recoveryThreshold !== "" ? Number(form.recoveryThreshold) : null }) });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "No fue posible guardar."); setSaving(false); }
  }
  return <form ref={formRef} className={styles.editor} onSubmit={submit}><header><div><h3>{rule ? "Editar regla" : "Nueva regla"}</h3><p>{metric.deviceCode} → {metric.code} · {metric.name} ({metric.unit})</p></div><button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>Cancelar</button></header>
    <div className={styles.formGrid}>
      <label>Nombre<input required minLength={3} maxLength={180} value={form.name} onChange={(e) => field("name", e.target.value)} /></label>
      <label>Condición<select value={form.op} onChange={(e) => field("op", e.target.value)}>{Object.entries(operators).filter(([op]) => numeric || ["eq", "neq"].includes(op)).map(([op, label]) => <option key={op} value={op}>{label}</option>)}</select></label>
      <label>Límite o estado {metric.unit && `(${metric.unit})`}{metric.dataType === "boolean" ? <select value={form.value} onChange={(e) => field("value", e.target.value)}><option value="true">Verdadero / activo</option><option value="false">Falso / inactivo</option></select> : <input type={numeric ? "number" : "text"} step="any" required value={form.value} onChange={(e) => field("value", e.target.value)} />}</label>
      <label>Severidad<select value={form.severity} onChange={(e) => field("severity", e.target.value)}>{Object.entries(severities).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Persistencia antes de activar (s)<input type="number" min="0" max="86400" required value={form.durationSeconds} onChange={(e) => field("durationSeconds", e.target.value)} /></label>
      <label>Vigencia máxima del dato (s)<input type="number" min="1" max="86400" required value={form.staleAfterSeconds} onChange={(e) => field("staleAfterSeconds", e.target.value)} /></label>
      {directional && <label>Límite de recuperación ({metric.unit})<input type="number" step="any" value={form.recoveryThreshold} placeholder="Opcional: al normalizar" onChange={(e) => field("recoveryThreshold", e.target.value)} /></label>}
      <label>Persistencia para recuperar (s)<input type="number" min="0" max="86400" required value={form.recoverySeconds} onChange={(e) => field("recoverySeconds", e.target.value)} /></label>
    </div>
    <label className={styles.checkbox}><input type="checkbox" checked={form.enabled} disabled={!metric.enabled} onChange={(e) => field("enabled", e.target.checked)} /> Regla habilitada</label>
    {rule && <p>Al guardar se reinicia la evaluación y se atienden las alarmas abiertas de esta regla; sus envíos pendientes se cancelan.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button className="primary-button" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar regla"}</button>
  </form>;
}
