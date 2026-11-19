"use client";

import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { IconArrowLeft, IconDownload, IconFileReport, IconPlus, IconRefresh, IconSend, IconX } from "@tabler/icons-react";
import type { SiteReport } from "../db/site-report";

type Kind = "weekly" | "monthly";
type Recipient = { email: string; name?: string | null; userId?: string | null };
type RunItem = { id: string; title: string; kind: Kind; periodStart: string; periodEnd: string; createdAt: string; requestedBy: string; label: string; conclusion: SiteReport["conclusion"] | null; actions: number };
type Schedule = { id: string; kind: Kind; hour: number; recipients: Recipient[]; attachPdf: boolean; onlyIfFindings: boolean; active: boolean; nextRunAt: string | null; lastRunAt: string | null; lastStatus: "sent" | "skipped" | "failed" | null; lastError: string | null; lastReportId: string | null };
type PortalUser = { id: string; email: string; name: string };
type Notify = (message: string, tone?: "success" | "info" | "warning") => void;
type Confirm = (request: { title: string; detail: string; confirmLabel: string; tone?: "default" | "danger"; onConfirm: () => void }) => void;

const KIND_LABEL: Record<Kind, string> = { weekly: "Informe semanal de operación", monthly: "Informe mensual de condición" };
const KIND_SHORT: Record<Kind, string> = { weekly: "Semanal", monthly: "Mensual" };
const HEALTH: Record<string, { label: string; tone: string }> = { action: { label: "Requiere acción", tone: "critical" }, watch: { label: "Observar", tone: "warning" }, good: { label: "Bueno", tone: "normal" } };
const PRIORITY: Record<string, { label: string; tone: string }> = { now: { label: "Este periodo", tone: "critical" }, next: { label: "Próxima visita", tone: "warning" }, watch: { label: "Observar", tone: "offline" } };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error ?? "No fue posible completar la solicitud.");
  return payload as T;
}

const num = (value: number | null, digits = 1, unit = "") => value === null ? "—" : `${new Intl.NumberFormat("es-CL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}${unit}`;
const dateTime = (iso: string | null) => iso ? new Intl.DateTimeFormat("es-CL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";

/** Reportes del sitio: informes semanales y mensuales, sus programaciones por correo y los reportes por punto. */
export function SiteReportsView({ canGenerate, canSchedule, notify, confirm, pointReports }: { canGenerate: boolean; canSchedule: boolean; notify: Notify; confirm: Confirm; pointReports: ReactNode }) {
  const initialReport = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("report");
  const [tab, setTab] = useState<"reports" | "schedules" | "points">("reports");
  const [openId, setOpenId] = useState<string | null>(initialReport);
  if (openId) return <SiteReportDocument id={openId} onBack={() => setOpenId(null)} />;
  return <>
    <nav className="point-tabs sr-tabs" aria-label="Secciones de reportes">
      {([["reports", "Informes"], ["schedules", "Programaciones"], ["points", "Reportes por punto"]] as const).map(([id, label]) => <button key={id} type="button" className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {tab === "reports" && <SiteReportList canGenerate={canGenerate} notify={notify} onOpen={setOpenId} />}
    {tab === "schedules" && <SiteReportSchedules canSchedule={canSchedule} notify={notify} confirm={confirm} onOpenReport={setOpenId} />}
    {tab === "points" && pointReports}
  </>;
}

function SiteReportList({ canGenerate, notify, onOpen }: { canGenerate: boolean; notify: Notify; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<RunItem[] | null>(null);
  const [kind, setKind] = useState<Kind>("monthly");
  const [range, setRange] = useState<"previous" | "current">("previous");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  // El aviso no debe volver a cargar la lista: el padre lo recrea en cada render.
  const warn = useEffectEvent((message: string) => notify(message, "warning"));
  useEffect(() => {
    let active = true;
    api<{ items: RunItem[] }>("/api/v1/site-reports").then((data) => { if (active) setItems(data.items); }).catch((error: unknown) => { if (active) { setItems([]); warn(error instanceof Error ? error.message : "No fue posible cargar los informes."); } });
    return () => { active = false; };
  }, [reload]);

  const generate = async () => {
    setBusy(true);
    try {
      const run = await api<{ id: string }>("/api/v1/site-reports", { method: "POST", body: JSON.stringify({ kind, range }) });
      setReload((value) => value + 1);
      onOpen(run.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "No fue posible generar el informe.", "warning");
    } finally {
      setBusy(false);
    }
  };

  return <div className="sr-layout">
    {canGenerate && <section className="panel sr-generate" aria-label="Generar informe">
      <header><h2>Generar informe</h2></header>
      <div className="sr-generate-body">
        <label><span>Tipo</span><select value={kind} onChange={(event) => setKind(event.target.value as Kind)}><option value="monthly">Mensual de condición</option><option value="weekly">Semanal de operación</option></select></label>
        <label><span>Periodo</span><select value={range} onChange={(event) => setRange(event.target.value as "previous" | "current")}><option value="previous">{kind === "weekly" ? "Semana anterior (lunes a domingo)" : "Mes anterior"}</option><option value="current">{kind === "weekly" ? "Semana en curso hasta ahora" : "Mes en curso hasta ahora"}</option></select></label>
        <button type="button" className="primary-button" onClick={() => void generate()} disabled={busy}>{busy ? <><IconRefresh className="spin" size={16} aria-hidden="true" /> Generando…</> : <><IconFileReport size={16} aria-hidden="true" /> Generar y ver</>}</button>
      </div>
    </section>}
    <section className="panel sr-list" aria-label="Informes generados">
      <header><h2>Informes generados</h2><span>{items ? `${items.length} ${items.length === 1 ? "informe" : "informes"}` : ""}</span></header>
      {items === null ? <p className="point-empty"><IconRefresh className="spin" size={15} aria-hidden="true" /> Cargando…</p>
        : !items.length ? <p className="point-empty">Aún no hay informes. Genera el primero o programa su envío por correo.</p>
          : <ul>{items.map((item) => <li key={item.id}><button type="button" onClick={() => onOpen(item.id)}>
            <i className={`dot ${item.conclusion?.tone === "critical" ? "critical" : item.conclusion?.tone === "warning" ? "warning" : "normal"}`} />
            <span><strong>{KIND_SHORT[item.kind]} · {item.label}</strong><small>{item.conclusion?.title ?? item.title}</small></span>
            <em>{item.actions ? `${item.actions} ${item.actions === 1 ? "acción" : "acciones"}` : "Sin acciones"}</em>
            <time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time>
          </button></li>)}</ul>}
    </section>
  </div>;
}

/** El informe en línea: la misma información del PDF, para leer en pantalla. */
function SiteReportDocument({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<{ title: string; report: SiteReport } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<{ title: string; report: SiteReport }>(`/api/v1/site-reports/${encodeURIComponent(id)}`).then((result) => { if (active) setData(result); }).catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : "No fue posible abrir el informe."); });
    return () => { active = false; };
  }, [id]);
  const back = () => {
    if (new URLSearchParams(window.location.search).has("report")) window.history.replaceState(null, "", "/?view=reports");
    onBack();
  };
  if (error) return <section className="panel sr-doc"><button type="button" className="point-link" onClick={back}><IconArrowLeft size={14} aria-hidden="true" /> Volver a reportes</button><p className="point-empty">{error}</p></section>;
  if (!data) return <section className="panel sr-doc"><p className="point-empty"><IconRefresh className="spin" size={15} aria-hidden="true" /> Abriendo el informe…</p></section>;
  const r = data.report;
  const chart = r.imbalanceChart;
  return <article className="sr-doc">
    <div className="sr-doc-bar">
      <button type="button" className="secondary-button" onClick={back}><IconArrowLeft size={16} aria-hidden="true" /> Reportes</button>
      <span />
      <a className="primary-button" href={`/api/v1/site-reports/${encodeURIComponent(id)}/pdf`}><IconDownload size={16} aria-hidden="true" /> Descargar PDF</a>
    </div>
    <section className="panel sr-sheet">
      <header className="sr-sheet-head">
        <div><small>{KIND_LABEL[r.kind]} · {r.period.label}</small><h2>{r.site.name}</h2><span>{r.client.name} · {r.kpis.totalPoints} puntos de medición</span></div>
      </header>
      <div className="sr-top">
        <div className={`sr-conclusion ${r.conclusion.tone}`}><small>Conclusión del periodo</small><strong>{r.conclusion.title}</strong><p>{r.conclusion.detail}</p></div>
        <div className="sr-kpis">
          <div><span>Puntos en buen estado</span><strong>{r.kpis.healthyPoints} / {r.kpis.totalPoints}</strong></div>
          <div><span>Alarmas</span><strong>{r.kpis.alarms}</strong><small>{r.kpis.criticalAlarms} críticas · {r.kpis.warningAlarms} advertencias</small></div>
          <div><span>Reconocimiento</span><strong>{r.kpis.mttaMinutes === null ? "—" : `${r.kpis.mttaMinutes} min`}</strong><small>{r.kpis.previousMttaMinutes === null ? "tiempo medio" : `antes ${r.kpis.previousMttaMinutes} min`}</small></div>
          <div><span>Disponibilidad</span><strong>{num(r.kpis.availabilityPercent, 1, " %")}</strong><small>datos recibidos</small></div>
        </div>
      </div>

      <h3>Acciones recomendadas</h3>
      {!r.actions.length ? <p className="sr-muted">Sin acciones: los puntos operaron dentro de sus umbrales.</p> : <ol className="sr-actions">{r.actions.map((action, index) => <li key={`${action.pointName}-${index}`}>
        <b className={`sr-n ${PRIORITY[action.priority].tone}`}>{index + 1}</b>
        <span><strong>{action.title} · {action.pointName}</strong><small>{action.why}</small></span>
        <em className={`site-badge ${PRIORITY[action.priority].tone}`}>{PRIORITY[action.priority].label}</em>
      </li>)}</ol>}

      <h3>Estado por punto de medición</h3>
      <div className="sr-table" role="table">
        <div className="sr-row sr-head" role="row"><span>Punto</span><span>Temp. máx.</span><span>Desbalance</span><span>Sobre ambiente</span><span>UHF máx.</span><span>Alarmas</span><span>Datos</span><span>Salud</span></div>
        {r.points.map((point) => <div className="sr-row" role="row" key={point.id}>
          <span><strong>{point.name}</strong><small>{point.reasons[0] ?? point.device ?? ""}</small></span>
          <span>{num(point.tempMax, 1, " °C")}</span>
          <span className={point.imbalance !== null && point.imbalance >= r.criteria.imbalanceWatch ? "warn" : ""}>{num(point.imbalance, 1, " °C")}{point.hotPhase && point.imbalance !== null && point.imbalance >= r.criteria.imbalanceWatch ? <small>{point.hotPhase}</small> : null}</span>
          <span>{num(point.riseOverAmbient, 1, " °C")}</span>
          <span>{num(point.uhfMax, 0)}</span>
          <span>{point.alarms}</span>
          <span>{num(point.availabilityPercent, 1, " %")}</span>
          <span><em className={`site-badge ${HEALTH[point.health].tone}`}>{HEALTH[point.health].label}</em></span>
        </div>)}
      </div>
      <p className="sr-note">Desbalance: diferencia entre fases del mismo punto (percentil 95 del periodo). Sobre {r.criteria.imbalanceWatch} °C, observar; sobre {r.criteria.imbalanceAct} °C, actuar.</p>

      {chart && <><h3>Desbalance entre fases · {chart.pointName}</h3><PhaseChart chart={chart} hot={r.points.find((point) => point.name === chart.pointName)?.hotPhase ?? null} timezone={r.timezone} /></>}

      <div className="sr-grid">
        <div><h3>Descarga parcial y humedad</h3><div className="sr-mini">
          <div className="sr-mini-head"><span>Punto</span><span>DP / DS</span><span>Humedad &gt; {r.criteria.humidityLimit} %</span></div>
          {r.points.map((point) => <div key={point.id}><span>{point.name}</span><span>{point.pdEvents} h / {point.sdEvents} h</span><span>{point.humidityHours} h</span></div>)}
        </div></div>
        <div><h3>Gestión de alarmas</h3>
          <div className="sr-stats"><div><span>Alarmas</span><strong>{r.alarmsSummary.total}</strong></div><div><span>Reconocimiento</span><strong>{r.alarmsSummary.mttaMinutes === null ? "—" : `${r.alarmsSummary.mttaMinutes} min`}</strong></div><div><span>Sin cerrar</span><strong className={r.alarmsSummary.unresolved ? "warn" : ""}>{r.alarmsSummary.unresolved}</strong></div></div>
          {r.alarmsSummary.recurrent.map((item) => <p className="sr-muted" key={`${item.pointName}-${item.channel}`}>Recurrente: {item.channel} en {item.pointName}, {item.count} veces.</p>)}
          <h3>Disponibilidad del monitoreo</h3>
          <p className="sr-muted">Datos recibidos: <strong>{num(r.availability.percent, 1, " %")}</strong>.{r.availability.gaps.length ? "" : " Sin cortes de una hora o más."}</p>
          {r.availability.gaps.slice(0, 4).map((gap) => <p className="sr-muted" key={`${gap.pointName}-${gap.start}`}>{gap.pointName}: {gap.hours} h sin datos desde el {new Date(gap.start).toLocaleString("es-CL", { timeZone: r.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.</p>)}
        </div>
      </div>
      <footer className="sr-sheet-foot">Generado el {new Date(r.generatedAt).toLocaleString("es-CL", { timeZone: r.timezone })} · HoitLive Core</footer>
    </section>
  </article>;
}

const PHASE_COLOR: Record<string, string> = { L1: "#0284c7", L2: "#d97706", L3: "#0f766e" };

function PhaseChart({ chart, hot, timezone }: { chart: NonNullable<SiteReport["imbalanceChart"]>; hot: string | null; timezone: string }) {
  const values = chart.series.flatMap((series) => series.values.filter((value): value is number => value !== null));
  if (!values.length) return <p className="sr-muted">Sin datos diarios para graficar.</p>;
  const low = Math.floor(Math.min(...values) / 5) * 5, high = Math.max(Math.ceil(Math.max(...values) / 5) * 5, low + 10);
  const W = 760, H = 200, L = 34, B = 22, n = chart.days.length;
  const x = (index: number) => L + (n === 1 ? 0 : index / (n - 1)) * (W - L - 8);
  const y = (value: number) => 8 + (high - value) / (high - low) * (H - B - 8);
  const ticks = Array.from({ length: 5 }, (_, index) => low + (high - low) * index / 4);
  return <div className="sr-chart">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Máximo diario por fase en ${chart.pointName}`}>
      {ticks.map((tick) => <g key={tick}><line x1={L} x2={W - 8} y1={y(tick)} y2={y(tick)} className="grid" /><text x={L - 6} y={y(tick) + 4} textAnchor="end" className="axis">{Math.round(tick)}</text></g>)}
      {[...new Set([0, Math.floor((n - 1) / 2), n - 1])].map((index) => <text key={index} x={x(index)} y={H - 6} textAnchor={index === 0 ? "start" : index === n - 1 ? "end" : "middle"} className="axis">{new Date(chart.days[index]).toLocaleDateString("es-CL", { timeZone: timezone, day: "numeric", month: "short" })}</text>)}
      {chart.series.map((series) => {
        let d = "", pen = false;
        series.values.forEach((value, index) => { if (value === null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)} `; pen = true; });
        return <path key={series.phase} d={d} fill="none" stroke={PHASE_COLOR[series.phase] ?? "#52525b"} strokeWidth={series.phase === hot ? 2.4 : 1.6} strokeLinejoin="round" />;
      })}
    </svg>
    <div className="sr-legend">{chart.series.map((series) => <span key={series.phase}><i style={{ background: PHASE_COLOR[series.phase] ?? "#52525b" }} />{series.phase}{series.phase === hot ? " · más caliente" : ""}</span>)}</div>
  </div>;
}

function SiteReportSchedules({ canSchedule, notify, confirm, onOpenReport }: { canSchedule: boolean; notify: Notify; confirm: Confirm; onOpenReport: (id: string) => void }) {
  const [items, setItems] = useState<Schedule[] | null>(null);
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [reload, setReload] = useState(0);
  const warn = useEffectEvent((message: string) => notify(message, "warning"));
  useEffect(() => {
    let active = true;
    api<{ items: Schedule[]; users: PortalUser[] }>("/api/v1/site-report-schedules").then((data) => {
      if (!active) return;
      setItems(data.items);
      setUsers(data.users);
      setSelected((current) => current ?? data.items[0]?.id ?? "new");
    }).catch((error: unknown) => { if (active) { setItems([]); warn(error instanceof Error ? error.message : "No fue posible cargar las programaciones."); } });
    return () => { active = false; };
  }, [reload]);
  const current = items?.find((item) => item.id === selected) ?? null;
  const statusText = (item: Schedule) => item.lastStatus === "sent" ? `Último envío ${dateTime(item.lastRunAt)} · entregado` : item.lastStatus === "skipped" ? `Último ${dateTime(item.lastRunAt)} · omitido, sin hallazgos` : item.lastStatus === "failed" ? `Último intento ${dateTime(item.lastRunAt)} · falló` : "Aún no se ha enviado";

  return <div className="sr-sched">
    <section className="panel sr-sched-list" aria-label="Programaciones">
      <header><h2>Programaciones</h2>{canSchedule && <button type="button" className="secondary-button small" onClick={() => setSelected("new")}><IconPlus size={14} aria-hidden="true" /> Nueva</button>}</header>
      {items === null ? <p className="point-empty"><IconRefresh className="spin" size={15} aria-hidden="true" /> Cargando…</p>
        : !items.length && selected !== "new" ? <p className="point-empty">Sin programaciones.</p>
          : <ul>{items.map((item) => <li key={item.id}><button type="button" className={selected === item.id ? "active" : ""} onClick={() => setSelected(item.id)}>
            <strong>{KIND_LABEL[item.kind]}</strong>
            <small>{item.kind === "weekly" ? "Lunes" : "Día 1 de cada mes"}, {String(item.hour).padStart(2, "0")}:00 · {item.recipients.length} {item.recipients.length === 1 ? "destinatario" : "destinatarios"}{item.active ? "" : " · en pausa"}</small>
            <em className={item.lastStatus === "failed" ? "failed" : item.lastStatus === "sent" ? "sent" : ""}>{statusText(item)}</em>
          </button></li>)}</ul>}
    </section>
    {selected && (selected === "new" || current) ? <ScheduleEditor key={selected} schedule={current} users={users} canSchedule={canSchedule} notify={notify} confirm={confirm} onOpenReport={onOpenReport}
      onSaved={(id) => { setSelected(id); setReload((value) => value + 1); }} onDeleted={() => { setSelected(null); setReload((value) => value + 1); }} /> : null}
  </div>;
}

function ScheduleEditor({ schedule, users, canSchedule, notify, confirm, onSaved, onDeleted, onOpenReport }: { schedule: Schedule | null; users: PortalUser[]; canSchedule: boolean; notify: Notify; confirm: Confirm; onSaved: (id: string) => void; onDeleted: () => void; onOpenReport: (id: string) => void }) {
  const [kind, setKind] = useState<Kind>(schedule?.kind ?? "weekly");
  const [hour, setHour] = useState(schedule?.hour ?? 8);
  const [recipients, setRecipients] = useState<Recipient[]>(schedule?.recipients ?? []);
  const [attachPdf, setAttachPdf] = useState(schedule?.attachPdf ?? true);
  const [onlyIfFindings, setOnlyIfFindings] = useState(schedule?.onlyIfFindings ?? false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "send" | "pause">("");
  const has = (email: string) => recipients.some((recipient) => recipient.email.toLowerCase() === email.toLowerCase());
  const nameOf = (recipient: Recipient) => recipient.name || users.find((user) => user.email.toLowerCase() === recipient.email.toLowerCase())?.name || null;

  const addDraft = () => {
    const email = draft.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) { setDraftError("Escribe un correo válido, por ejemplo nombre@saesa.cl."); return; }
    if (has(email)) { setDraftError("Ese correo ya está en la lista."); return; }
    if (recipients.length >= 20) { setDraftError("Puedes agregar hasta 20 destinatarios."); return; }
    setRecipients([...recipients, { email }]);
    setDraft("");
    setDraftError("");
  };
  const body = () => JSON.stringify({ kind, hour, recipients, attachPdf, onlyIfFindings });
  const save = async () => {
    if (!recipients.length) { setDraftError("Agrega al menos un destinatario."); return; }
    setBusy("save");
    try {
      const result = schedule
        ? await api<{ item: Schedule }>(`/api/v1/site-report-schedules/${schedule.id}`, { method: "PATCH", body: body() })
        : await api<{ item: Schedule }>("/api/v1/site-report-schedules", { method: "POST", body: body() });
      notify(schedule ? "Programación guardada." : `Programación creada. Primer envío: ${dateTime(result.item.nextRunAt)}.`, "success");
      onSaved(result.item.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "No fue posible guardar.", "warning");
    } finally { setBusy(""); }
  };
  const sendNow = async () => {
    if (!schedule) return;
    setBusy("send");
    try {
      await api(`/api/v1/site-report-schedules/${schedule.id}`, { method: "PATCH", body: body() });
      await api(`/api/v1/site-report-schedules/${schedule.id}/send`, { method: "POST" });
      notify(`Informe enviado a ${recipients.length} ${recipients.length === 1 ? "destinatario" : "destinatarios"}.`, "success");
      onSaved(schedule.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "No fue posible enviar el informe.", "warning");
      onSaved(schedule.id); // muestra el estado "falló" y el motivo
    } finally { setBusy(""); }
  };
  const togglePause = async () => {
    if (!schedule) return;
    setBusy("pause");
    try {
      await api(`/api/v1/site-report-schedules/${schedule.id}`, { method: "PATCH", body: JSON.stringify({ active: !schedule.active }) });
      notify(schedule.active ? "Programación en pausa." : "Programación reactivada.", "success");
      onSaved(schedule.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "No fue posible cambiar el estado.", "warning");
    } finally { setBusy(""); }
  };
  const remove = () => schedule && confirm({ title: "Eliminar programación", detail: "Se dejará de enviar este informe. Los informes ya generados se conservan.", confirmLabel: "Eliminar", tone: "danger", onConfirm: async () => {
    try { await api(`/api/v1/site-report-schedules/${schedule.id}`, { method: "DELETE" }); notify("Programación eliminada.", "success"); onDeleted(); }
    catch (error) { notify(error instanceof Error ? error.message : "No fue posible eliminar.", "warning"); }
  } });

  return <section className="panel sr-editor" aria-label="Editar programación">
    <header><h2>{schedule ? KIND_LABEL[schedule.kind] : "Nueva programación"}</h2>{schedule && <em className={`site-badge ${schedule.active ? "normal" : "offline"}`}>{schedule.active ? "Activa" : "En pausa"}</em>}</header>
    {schedule?.lastStatus === "failed" && schedule.lastError && <p className="sr-error">El último envío falló: {schedule.lastError}</p>}
    <div className="sr-editor-grid">
      <label><span>Tipo de informe</span><select value={kind} disabled={!canSchedule} onChange={(event) => setKind(event.target.value as Kind)}><option value="weekly">Semanal de operación (cada lunes)</option><option value="monthly">Mensual de condición (cada día 1)</option></select></label>
      <label><span>Hora de envío</span><select value={hour} disabled={!canSchedule} onChange={(event) => setHour(Number(event.target.value))}>{Array.from({ length: 24 }, (_, value) => <option key={value} value={value}>{String(value).padStart(2, "0")}:00</option>)}</select></label>
      <fieldset className="sr-recipients">
        <legend>Destinatarios</legend>
        <div className="sr-chips">
          {recipients.map((recipient) => <span className="sr-chip" key={recipient.email}>
            <b aria-hidden="true">{(nameOf(recipient) ?? recipient.email).replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("")}</b>
            <span><strong>{nameOf(recipient) ?? recipient.email}</strong>{nameOf(recipient) && <small>{recipient.email}</small>}</span>
            {canSchedule && <button type="button" onClick={() => setRecipients(recipients.filter((item) => item.email !== recipient.email))} aria-label={`Quitar ${recipient.email}`}><IconX size={13} /></button>}
          </span>)}
          {!recipients.length && <span className="sr-muted">Aún no hay destinatarios.</span>}
        </div>
        {canSchedule && <div className="sr-add">
          <label><span>Agregar destinatario</span><input type="email" value={draft} placeholder="nombre@saesa.cl" onChange={(event) => { setDraft(event.target.value); setDraftError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addDraft(); } }} aria-invalid={Boolean(draftError)} /></label>
          <button type="button" className="secondary-button" onClick={addDraft}><IconPlus size={15} aria-hidden="true" /> Agregar</button>
        </div>}
        {draftError && <small className="field-error">{draftError}</small>}
        {canSchedule && users.some((user) => !has(user.email)) && <div className="sr-suggest"><span>Usuarios del portal:</span>{users.filter((user) => !has(user.email)).slice(0, 8).map((user) => <button type="button" key={user.id} onClick={() => setRecipients([...recipients, { email: user.email.toLowerCase(), name: user.name, userId: user.id }])}>+ {user.name}</button>)}</div>}
        <small className="sr-muted">Pueden ser usuarios del portal o correos externos (por ejemplo, el jefe de mantenimiento). Reciben el resumen, el PDF adjunto y un enlace al informe en el portal.</small>
      </fieldset>
      <label className="sr-check"><input type="checkbox" checked={attachPdf} disabled={!canSchedule} onChange={(event) => setAttachPdf(event.target.checked)} /><span>Adjuntar el PDF del informe</span></label>
      <label className="sr-check"><input type="checkbox" checked={onlyIfFindings} disabled={!canSchedule} onChange={(event) => setOnlyIfFindings(event.target.checked)} /><span>Enviar solo si hay hallazgos o alarmas en el periodo</span></label>
    </div>
    {schedule && <p className="sr-next">Próximo envío: <strong>{schedule.active ? dateTime(schedule.nextRunAt) : "en pausa"}</strong>{schedule.lastReportId && <> · <button type="button" className="point-link" onClick={() => onOpenReport(schedule.lastReportId!)}>Ver el último informe</button></>}</p>}
    {canSchedule && <footer>
      {schedule && <button type="button" className="secondary-button" onClick={() => void sendNow()} disabled={Boolean(busy)}>{busy === "send" ? <><IconRefresh className="spin" size={15} aria-hidden="true" /> Enviando…</> : <><IconSend size={15} aria-hidden="true" /> Enviar ahora</>}</button>}
      <span />
      {schedule && <button type="button" className="secondary-button" onClick={remove} disabled={Boolean(busy)}>Eliminar</button>}
      {schedule && <button type="button" className="secondary-button" onClick={() => void togglePause()} disabled={Boolean(busy)}>{schedule.active ? "Pausar" : "Reactivar"}</button>}
      <button type="button" className="primary-button" onClick={() => void save()} disabled={Boolean(busy)}>{busy === "save" ? "Guardando…" : schedule ? "Guardar" : "Crear programación"}</button>
    </footer>}
  </section>;
}
