"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconDownload,
  IconEye,
  IconFileReport,
  IconFileTypePdf,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTable,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { Pagination } from "./pagination";

type NoticeTone = "success" | "info" | "warning";
type ConfirmRequest = { title: string; detail: string; confirmLabel: string; tone?: "default" | "danger"; onConfirm: () => void };
type PageResult<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };
type Template = { id: string; key: string; name: string; description: string | null; definition: Record<string, unknown>; siteId: string | null };
type ReportRun = {
  id: string; title: string; format: "pdf" | "csv"; status: "queued" | "running" | "completed" | "failed";
  periodStart: string; periodEnd: string; createdAt: string; completedAt: string | null; errorMessage: string | null;
  templateId: string; templateName: string; assetId: string; assetCode: string; assetName: string; requestedBy: string;
};
type Snapshot = {
  generatedAt: string; generatedBy: string;
  template: { id: string; key: string; name: string; description: string | null };
  client: { code: string; name: string }; site: { code: string; name: string; timezone: string };
  asset: { id: string; code: string; name: string; area: string | null; nominalVoltageKv: number | null };
  period: { start: string; end: string };
  summary: { condition: "normal" | "warning" | "critical"; channelCount: number; sampleCount: number; validSampleCount: number; qualityPercent: number | null; alarmCount: number; warningCount: number; criticalCount: number };
  channels: Array<{ code: string; name: string; zone: string | null; unit: string; sampleCount: number; validSampleCount: number; minimum: number | null; average: number | null; maximum: number | null; latest: number | null; latestAt: string | null }>;
  alarms: Array<{ code: string; title: string; severity: string; status: string; openedAt: string; channelCode: string | null; triggerValue: number | null; thresholdValue: number | null }>;
};
type ReportDetail = ReportRun & { payload: Snapshot };
type Schedule = { id: string; templateId: string; templateName: string; assetId: string; assetCode: string; assetName: string; cronExpression: string; timezone: string; recipients: string[]; active: boolean; nextRunAt: string | null; createdAt: string; updatedAt: string };

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible completar la solicitud.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function dateInput(date: Date) { return date.toISOString().slice(0, 10); }
function formatDate(value: string) { return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)); }
function formatDateTime(value: string | null) { return value ? new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "—"; }
/** Rangos rápidos para el periodo del reporte (fechas en formato yyyy-mm-dd). */
function quickRange(kind: "7d" | "30d" | "lastMonth" | "thisMonth", now: Date): [string, string] {
  const day = 86400_000;
  if (kind === "7d") return [dateInput(new Date(now.getTime() - 7 * day)), dateInput(now)];
  if (kind === "30d") return [dateInput(new Date(now.getTime() - 30 * day)), dateInput(now)];
  if (kind === "thisMonth") return [dateInput(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), dateInput(now)];
  return [dateInput(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))), dateInput(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)))];
}
function formatNumber(value: number | null, digits = 1) { return value === null ? "s/d" : new Intl.NumberFormat("es-CL", { maximumFractionDigits: digits }).format(value); }
function frequencyLabel(value: string) { return value === "0 8 * * *" ? "Diario · 08:00" : value === "0 8 * * 1" ? "Semanal · lunes 08:00" : "Mensual · día 1, 08:00"; }
function statusLabel(value: ReportRun["status"]) { return value === "completed" ? "Disponible" : value === "failed" ? "Fallido" : value === "running" ? "Generando" : "En cola"; }
function conditionLabel(value: Snapshot["summary"]["condition"]) { return value === "critical" ? "Crítica" : value === "warning" ? "Advertencia" : "Normal"; }

export function ReportsView({ assetId, assetLabel, timezone, canGenerate, canSchedule, notify, confirm }: {
  assetId: string;
  assetLabel: string;
  timezone: string;
  canGenerate: boolean;
  canSchedule: boolean;
  notify: (message: string, tone?: NoticeTone) => void;
  confirm: (request: ConfirmRequest) => void;
}) {
  const now = useMemo(() => new Date(), []);
  const [tab, setTab] = useState<"create" | "library" | "schedules">("create");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [periodStart, setPeriodStart] = useState(dateInput(new Date(now.getTime() - 30 * 86400_000)));
  const [periodEnd, setPeriodEnd] = useState(dateInput(now));
  const [format, setFormat] = useState<"pdf" | "csv">("pdf");
  const [reports, setReports] = useState<(PageResult<ReportRun> & { summary: { total: number; completed: number; pending: number; failed: number } }) | null>(null);
  const [schedules, setSchedules] = useState<PageResult<Schedule> | null>(null);
  const [page, setPage] = useState(1);
  const [schedulePage, setSchedulePage] = useState(1);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [filterTemplate, setFilterTemplate] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<ReportDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ templateId: "", cronExpression: "0 8 1 * *", recipients: "" });

  useEffect(() => {
    let active = true;
    void requestJson<{ items: Template[] }>("/api/v1/reports/templates").then((result) => {
      if (!active) return;
      setTemplates(result.items);
      setTemplateId((current) => current || result.items[0]?.id || "");
      setScheduleForm((current) => ({ ...current, templateId: current.templateId || result.items[0]?.id || "" }));
    }).catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "No fue posible cargar las plantillas."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!assetId) return;
    const timeout = window.setTimeout(() => {
      setLoading(true); setError("");
      const reportParams = new URLSearchParams({ assetId, page: String(page), pageSize: "8" });
      if (query.trim()) reportParams.set("q", query.trim());
      if (status !== "all") reportParams.set("status", status);
      if (filterTemplate !== "all") reportParams.set("templateId", filterTemplate);
      if (filterFrom) reportParams.set("from", filterFrom);
      if (filterTo) reportParams.set("to", filterTo);
      const scheduleParams = new URLSearchParams({ assetId, page: String(schedulePage), pageSize: "6" });
      void Promise.all([
        requestJson<PageResult<ReportRun> & { summary: { total: number; completed: number; pending: number; failed: number } }>(`/api/v1/reports?${reportParams}`),
        requestJson<PageResult<Schedule>>(`/api/v1/report-schedules?${scheduleParams}`),
      ]).then(([reportResult, scheduleResult]) => { setReports(reportResult); setSchedules(scheduleResult); })
        .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el módulo de reportes."))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [assetId, page, schedulePage, query, status, filterTemplate, filterFrom, filterTo, reload]);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canGenerate) return notify("Tu perfil no permite generar reportes.", "warning");
    setGenerating(true);
    try {
      const reportEnd = periodEnd === dateInput(new Date()) ? new Date().toISOString() : `${periodEnd}T23:59:59.999Z`;
      const result = await requestJson<{ item: { id: string; title: string; status: string } }>("/api/v1/reports", { method: "POST", body: JSON.stringify({ assetId, templateId, format, periodStart: `${periodStart}T00:00:00.000Z`, periodEnd: reportEnd }) });
      notify("Reporte generado con una copia inmutable de los datos del periodo.");
      setReload((value) => value + 1); setPage(1); setTab("library");
      await openPreview(result.item.id);
    } catch (generateError) { notify(generateError instanceof Error ? generateError.message : "No fue posible generar el reporte.", "warning"); }
    finally { setGenerating(false); }
  };

  const openPreview = async (id: string) => {
    setPreviewLoading(true);
    try { const result = await requestJson<{ item: ReportDetail }>(`/api/v1/reports/${id}`); setPreview(result.item); }
    catch (previewError) { notify(previewError instanceof Error ? previewError.message : "No fue posible abrir el reporte.", "warning"); }
    finally { setPreviewLoading(false); }
  };

  const download = (id: string, requestedFormat: "pdf" | "csv") => {
    const anchor = document.createElement("a"); anchor.href = `/api/v1/reports/${id}/download?format=${requestedFormat}`; anchor.click();
    notify(`Preparando descarga ${requestedFormat.toUpperCase()}.`, "info");
  };

  const createSchedule = async (event: React.FormEvent) => {
    event.preventDefault(); setSavingSchedule(true);
    try {
      await requestJson("/api/v1/report-schedules", { method: "POST", body: JSON.stringify({ assetId, templateId: scheduleForm.templateId, cronExpression: scheduleForm.cronExpression, timezone, recipients: scheduleForm.recipients.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean), active: true }) });
      notify("Programación guardada."); setShowScheduleForm(false); setSchedulePage(1); setReload((value) => value + 1);
    } catch (saveError) { notify(saveError instanceof Error ? saveError.message : "No fue posible crear la programación.", "warning"); }
    finally { setSavingSchedule(false); }
  };

  const toggleSchedule = async (schedule: Schedule) => {
    try { await requestJson(`/api/v1/report-schedules/${schedule.id}`, { method: "PATCH", body: JSON.stringify({ active: !schedule.active }) }); notify(schedule.active ? "Programación pausada." : "Programación reactivada.", "info"); setReload((value) => value + 1); }
    catch (toggleError) { notify(toggleError instanceof Error ? toggleError.message : "No fue posible actualizar la programación.", "warning"); }
  };
  const deleteSchedule = (schedule: Schedule) => confirm({ title: "Eliminar programación", detail: `Se eliminará la generación automática de “${schedule.templateName}”. Los reportes ya generados se conservarán.`, confirmLabel: "Eliminar programación", tone: "danger", onConfirm: () => { void requestJson(`/api/v1/report-schedules/${schedule.id}`, { method: "DELETE" }).then(() => { notify("Programación eliminada; el historial se mantiene."); setReload((value) => value + 1); }).catch((deleteError) => notify(deleteError instanceof Error ? deleteError.message : "No fue posible eliminar la programación.", "warning")); } });

  const selectedTemplate = templates.find((template) => template.id === templateId);
  const activeSchedules = schedules?.items.filter((schedule) => schedule.active).length ?? 0;
  const ranges = [["7d", "Últimos 7 días"], ["30d", "Últimos 30 días"], ["thisMonth", "Este mes"], ["lastMonth", "Mes anterior"]] as const;
  const activeRange = ranges.find(([kind]) => { const [from, to] = quickRange(kind, now); return from === periodStart && to === periodEnd; })?.[0] ?? null;
  const filtersActive = Boolean(query.trim() || status !== "all" || filterTemplate !== "all" || filterFrom || filterTo);
  const clearFilters = () => { setQuery(""); setStatus("all"); setFilterTemplate("all"); setFilterFrom(""); setFilterTo(""); setPage(1); };

  if (!assetId) return <article className="panel permission-state"><span><IconFileReport size={26} /></span><div><span className="eyebrow">Reportes</span><h2>Selecciona un punto de medición</h2><p>Los reportes se generan y consultan dentro del contexto operacional activo.</p></div></article>;

  return <>
    <section className="module-summary-strip" aria-label="Resumen de reportes">
      <span><IconFileReport size={15} aria-hidden="true" /><strong>{reports?.summary.total ?? 0}</strong> {(reports?.summary.total ?? 0) === 1 ? "reporte" : "reportes"} · <strong>{reports?.summary.completed ?? 0}</strong> {(reports?.summary.completed ?? 0) === 1 ? "disponible" : "disponibles"}</span>
      <span><IconCalendarEvent size={15} aria-hidden="true" />{schedules?.total ? <><strong>{activeSchedules}</strong> de {schedules.total} {schedules.total === 1 ? "programación activa" : "programaciones activas"}</> : "Sin programaciones"}</span>
      {(reports?.summary.pending ?? 0) > 0 && <span><IconClock size={15} aria-hidden="true" /><strong>{reports?.summary.pending}</strong> en proceso</span>}
      {(reports?.summary.failed ?? 0) > 0 && <span className="has-failures"><IconAlertTriangle size={15} aria-hidden="true" /><strong>{reports?.summary.failed}</strong> {reports?.summary.failed === 1 ? "fallido" : "fallidos"}</span>}
    </section>

    <article className="panel module-panel report-module">
      <div className="module-toolbar"><div className="module-tabs" role="tablist" aria-label="Secciones de reportes"><button role="tab" aria-selected={tab === "create"} className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}><IconPlus size={16} aria-hidden="true" /> Crear reporte</button><button role="tab" aria-selected={tab === "library"} className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><IconFileReport size={16} aria-hidden="true" /> Biblioteca{reports?.summary.total ? <i className="tab-count">{reports.summary.total}</i> : null}</button><button role="tab" aria-selected={tab === "schedules"} className={tab === "schedules" ? "active" : ""} onClick={() => setTab("schedules")}><IconCalendarEvent size={16} aria-hidden="true" /> Programaciones{schedules?.total ? <i className="tab-count">{schedules.total}</i> : null}</button></div></div>
      {error && <div className="validation-summary"><IconAlertTriangle size={17} aria-hidden="true" /><div><strong>No fue posible cargar todos los datos</strong><p>{error}</p></div><button className="ghost-button" onClick={() => setReload((value) => value + 1)}><IconRefresh size={14} aria-hidden="true" /> Reintentar</button></div>}

      {tab === "create" && <form className="report-builder report-builder-compact" onSubmit={generate}>
        <fieldset className="report-step">
          <legend><b>1</b> Plantilla</legend>
          <div className="report-template-options" role="radiogroup" aria-label="Plantilla del reporte">{templates.map((template) => <label key={template.id} className={`report-template-option ${templateId === template.id ? "selected" : ""}`}><input type="radio" name="report-template" value={template.id} checked={templateId === template.id} onChange={() => setTemplateId(template.id)} /><span><strong>{template.name}</strong><small>{template.description || "Reporte operacional configurado para el sitio."}</small></span>{templateId === template.id && <IconCheck size={16} aria-hidden="true" />}</label>)}{!templates.length && !loading && <div className="module-empty-state"><IconFileReport size={24} aria-hidden="true" /><strong>Sin plantillas activas</strong><p>Configura al menos una plantilla para generar reportes.</p></div>}</div>
        </fieldset>
        <fieldset className="report-step">
          <legend><b>2</b> Periodo y formato</legend>
          <div className="report-range-chips" role="group" aria-label="Rangos rápidos">{ranges.map(([kind, label]) => <button type="button" key={kind} aria-pressed={activeRange === kind} className={activeRange === kind ? "active" : ""} onClick={() => { const [from, to] = quickRange(kind, now); setPeriodStart(from); setPeriodEnd(to); }}>{label}</button>)}</div>
          <div className="report-date-fields"><label><span>Desde</span><input type="date" required value={periodStart} max={periodEnd} onChange={(event) => setPeriodStart(event.target.value)} /></label><label><span>Hasta</span><input type="date" required value={periodEnd} min={periodStart} max={dateInput(now)} onChange={(event) => setPeriodEnd(event.target.value)} /></label></div>
          <div className="report-format-toggle" role="radiogroup" aria-label="Formato principal"><span>Formato</span>{(["pdf", "csv"] as const).map((value) => <label key={value} className={format === value ? "active" : ""}><input type="radio" name="report-format" value={value} checked={format === value} onChange={() => setFormat(value)} />{value === "pdf" ? <IconFileTypePdf size={15} aria-hidden="true" /> : <IconTable size={15} aria-hidden="true" />}{value.toUpperCase()}</label>)}</div>
          <div className="report-generate-row">
            <p><strong>{selectedTemplate?.name || "Selecciona una plantilla"}</strong> · {assetLabel} · {formatDate(`${periodStart}T12:00:00Z`)} al {formatDate(`${periodEnd}T12:00:00Z`)}<small>Zona horaria {timezone}. El contenido queda congelado al generarlo, aunque los datos cambien después.</small></p>
            <button className="generate-report-button" type="submit" disabled={generating || !templateId || !canGenerate}>{generating ? <><IconRefresh className="spin" size={17} aria-hidden="true" /> Generando…</> : <><IconFileReport size={17} aria-hidden="true" /> Generar reporte</>}</button>
          </div>
          {!canGenerate && <small className="report-disclaimer">Tu perfil puede consultar y descargar, pero no generar reportes.</small>}
        </fieldset>
      </form>}

      {tab === "library" && <section className="report-library-section" aria-label="Biblioteca documental">
        <div className="report-filter-bar">
          <label className="module-search"><IconSearch size={16} aria-hidden="true" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar por nombre, plantilla o punto…" aria-label="Buscar reportes" /></label>
          <select aria-label="Estado" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">Todos los estados</option><option value="completed">Disponibles</option><option value="queued">En cola</option><option value="running">Generando</option><option value="failed">Fallidos</option></select>
          <select aria-label="Plantilla" value={filterTemplate} onChange={(event) => { setFilterTemplate(event.target.value); setPage(1); }}><option value="all">Todas las plantillas</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>
          <label className="report-filter-date"><span>Desde</span><input type="date" value={filterFrom} onChange={(event) => { setFilterFrom(event.target.value); setPage(1); }} /></label>
          <label className="report-filter-date"><span>Hasta</span><input type="date" value={filterTo} onChange={(event) => { setFilterTo(event.target.value); setPage(1); }} /></label>
          {filtersActive && <button type="button" className="ghost-button" onClick={clearFilters}><IconX size={14} aria-hidden="true" /> Limpiar</button>}
        </div>
        {loading && !reports ? <div className="module-loading"><IconRefresh className="spin" size={20} aria-hidden="true" /> Cargando reportes…</div> : !reports?.items.length ? <div className="module-empty-state"><IconFileReport size={25} aria-hidden="true" /><strong>{filtersActive ? "No hay reportes para estos filtros" : "Aún no hay reportes generados"}</strong><p>{filtersActive ? "Amplía la búsqueda o limpia los filtros." : "Crea el primero desde la pestaña Crear reporte."}</p>{filtersActive ? <button className="secondary-button" onClick={clearFilters}>Limpiar filtros</button> : canGenerate && <button className="secondary-button" onClick={() => setTab("create")}><IconPlus size={15} aria-hidden="true" /> Crear reporte</button>}</div> : <><div className="module-table-wrap" role="region" aria-label="Reportes generados" tabIndex={0}><div className="report-table report-database-table"><div className="module-table-head"><span>Reporte</span><span>Periodo</span><span>Generado</span><span>Estado</span><span><span className="sr-only">Acciones</span></span></div>{reports.items.map((report) => <div className="module-table-row" key={report.id}><span className="report-name-cell"><span><strong>{report.title}</strong><small>{report.templateName} · {report.requestedBy}</small></span></span><span><strong>{formatDate(report.periodStart)}</strong><small>al {formatDate(report.periodEnd)}</small></span><span>{formatDateTime(report.createdAt)}</span><span><i className={`report-run-status report-${report.status}`}>{statusLabel(report.status)}</i>{report.errorMessage && <small>{report.errorMessage}</small>}</span><span className="report-row-actions">{report.status === "completed" && <><button className="ghost-button" disabled={previewLoading} onClick={() => void openPreview(report.id)} aria-label={`Ver ${report.title}`}><IconEye size={14} aria-hidden="true" /> Ver</button><button className="ghost-button" onClick={() => download(report.id, "pdf")} aria-label={`Descargar PDF de ${report.title}`}><IconDownload size={14} aria-hidden="true" /> PDF</button><button className="ghost-button" onClick={() => download(report.id, "csv")} aria-label={`Descargar CSV de ${report.title}`}><IconTable size={14} aria-hidden="true" /> CSV</button></>}</span></div>)}</div></div>{reports.totalPages > 1 && <Pagination page={reports.page} totalPages={reports.totalPages} total={reports.total} pageSize={reports.pageSize} onPageChange={setPage} itemLabel="reportes" />}</>}
      </section>}

      {tab === "schedules" && <section className="report-schedules-section">
        <div className="report-schedules-bar"><p>Cada programación genera el reporte automáticamente para {assetLabel}. El envío por correo se configura en Notificaciones.</p>{canSchedule && <button className={showScheduleForm ? "secondary-button" : "primary-button"} onClick={() => setShowScheduleForm((value) => !value)}>{showScheduleForm ? <><IconX size={15} aria-hidden="true" /> Cancelar</> : <><IconPlus size={15} aria-hidden="true" /> Nueva programación</>}</button>}</div>
        {showScheduleForm && <form className="report-schedule-form" onSubmit={createSchedule}><label><span>Plantilla</span><select required value={scheduleForm.templateId} onChange={(event) => setScheduleForm({ ...scheduleForm, templateId: event.target.value })}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><label><span>Frecuencia</span><select value={scheduleForm.cronExpression} onChange={(event) => setScheduleForm({ ...scheduleForm, cronExpression: event.target.value })}><option value="0 8 * * *">Diario · 08:00</option><option value="0 8 * * 1">Semanal · lunes 08:00</option><option value="0 8 1 * *">Mensual · día 1, 08:00</option></select></label><label><span>Destinatarios de referencia</span><input value={scheduleForm.recipients} onChange={(event) => setScheduleForm({ ...scheduleForm, recipients: event.target.value })} placeholder="operaciones@empresa.cl, confiabilidad@empresa.cl" /></label><button className="primary-button" disabled={savingSchedule}>{savingSchedule ? "Guardando…" : "Guardar programación"}</button></form>}
        {loading && !schedules ? <div className="module-loading"><IconRefresh className="spin" size={20} aria-hidden="true" /> Cargando programaciones…</div> : !schedules?.items.length ? (!showScheduleForm && <div className="module-empty-state"><IconCalendarEvent size={25} aria-hidden="true" /><strong>No hay reportes programados</strong><p>Crea una frecuencia diaria, semanal o mensual para generarlos sin intervención.</p></div>) : <><div className="report-schedule-table" role="table" aria-label="Programaciones">
          <div className="report-schedule-head" role="row"><span role="columnheader">Plantilla</span><span role="columnheader">Frecuencia</span><span role="columnheader">Próxima ejecución</span><span role="columnheader">Estado</span><span role="columnheader"><span className="sr-only">Acciones</span></span></div>
          {schedules.items.map((schedule) => <div role="row" key={schedule.id} className={`report-schedule-row ${schedule.active ? "" : "paused"}`}><span role="cell"><strong>{schedule.templateName}</strong>{schedule.recipients.length > 0 && <small title={schedule.recipients.join(", ")}>{schedule.recipients.join(", ")}</small>}</span><span role="cell">{frequencyLabel(schedule.cronExpression)}</span><span role="cell">{schedule.active ? formatDateTime(schedule.nextRunAt) : "—"}<small>{schedule.timezone}</small></span><span role="cell"><i className={`report-schedule-state ${schedule.active ? "active" : "paused"}`}>{schedule.active ? "Activa" : "Pausada"}</i></span><span role="cell" className="report-row-actions">{canSchedule && <><button className="ghost-button" onClick={() => void toggleSchedule(schedule)}>{schedule.active ? "Pausar" : "Activar"}</button><button className="icon-danger-button" aria-label={`Eliminar programación ${schedule.templateName}`} onClick={() => deleteSchedule(schedule)}><IconTrash size={15} aria-hidden="true" /></button></>}</span></div>)}
        </div>{schedules.totalPages > 1 && <Pagination page={schedules.page} totalPages={schedules.totalPages} total={schedules.total} pageSize={schedules.pageSize} onPageChange={setSchedulePage} itemLabel="programaciones" />}</>}
      </section>}
    </article>

    {preview && <div className="report-modal-backdrop" role="presentation" onMouseDown={() => setPreview(null)}><section className="report-modal" role="dialog" aria-modal="true" aria-label="Vista previa del reporte" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setPreview(null); }}><div className="report-preview-toolbar"><div><span className="eyebrow">Vista previa</span><h2>{preview.title}</h2></div><div><button className="secondary-button" onClick={() => setPreview(null)}><IconX size={15} /> Cerrar</button><button className="secondary-button" onClick={() => download(preview.id, "csv")}><IconTable size={15} /> CSV</button><button className="primary-button" onClick={() => download(preview.id, "pdf")}><IconDownload size={15} /> Descargar PDF</button></div></div><div className="report-modal-scroll"><div className="report-sheet"><header><span className="brand-mark"><IconFileReport size={21} /></span><div><strong>HoitLive Core</strong><small>Reporte de monitoreo de condición eléctrica</small></div><time>{formatDateTime(preview.payload.generatedAt)}</time></header><section><span className="eyebrow">{preview.payload.client.name} · {preview.payload.site.name}</span><h1>{preview.payload.template.name}</h1><p>{preview.payload.asset.code} · {preview.payload.asset.name} · {formatDate(preview.payload.period.start)} al {formatDate(preview.payload.period.end)}</p></section><div className="report-kpi-row"><article><small>Condición</small><strong className={`condition-${preview.payload.summary.condition}`}>{conditionLabel(preview.payload.summary.condition)}</strong></article><article><small>Canales / muestras</small><strong>{preview.payload.summary.channelCount} / {preview.payload.summary.sampleCount.toLocaleString("es-CL")}</strong></article><article><small>Calidad</small><strong>{preview.payload.summary.qualityPercent === null ? "Sin muestras" : `${preview.payload.summary.qualityPercent}%`}</strong></article></div>{preview.payload.summary.alarmCount > 0 && <section className={`report-finding finding-${preview.payload.summary.condition}`}><IconAlertTriangle size={20} /><div><strong>Hallazgos del periodo</strong><h2>{preview.payload.summary.criticalCount} críticas · {preview.payload.summary.warningCount} advertencias</h2><p>Revisa el detalle de alarmas y su flujo de atención antes de cerrar el análisis.</p></div><b>{preview.payload.summary.alarmCount}</b></section>}<section className="report-channel-summary"><h2>Resumen por canal</h2><div>{preview.payload.channels.map((channel) => <span key={channel.code}><b className="sensor-code">{channel.code}</b><span><strong>{channel.name}</strong><small>{channel.zone || "Sin zona"} · {channel.sampleCount.toLocaleString("es-CL")} muestras</small></span><em>{formatNumber(channel.latest)} {channel.unit}</em></span>)}</div></section><section className="report-alarm-summary"><h2>Alarmas del periodo</h2>{preview.payload.alarms.length ? preview.payload.alarms.slice(0, 15).map((alarm) => <span key={alarm.code}><i className={`report-alarm-dot ${alarm.severity}`} /><strong>{alarm.code}</strong><p>{alarm.title}</p><small>{formatDateTime(alarm.openedAt)}</small></span>) : <p>No se registraron alarmas en el periodo seleccionado.</p>}</section><footer><IconCircleCheck size={16} /><span>Copia inmutable de los datos del periodo. Generado por {preview.payload.generatedBy}.</span></footer></div></div></section></div>}
  </>;
}
