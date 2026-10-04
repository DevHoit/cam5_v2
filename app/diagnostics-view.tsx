"use client";

import { useEffect, useState } from "react";
import { IconActivity, IconAlertTriangle, IconBolt, IconCheck, IconCircleCheck, IconCircuitCell, IconDatabase, IconRefresh, IconRouter, IconShieldCheck } from "@tabler/icons-react";
import { Pagination } from "./pagination";

type DiagnosticState = "healthy" | "warning" | "offline";
type DiagnosticStage = { key: "device" | "gateway" | "ingestion" | "core"; label: string; state: DiagnosticState; detail: string; evidence: string };
type DiagnosticResponse = {
  serverTime: string; window: { from: string; to: string; label: string };
  asset: { id: string; code: string; name: string };
  device: { id: string; code: string; name: string; state: string; modelName: string; lastReadAt: string | null };
  gateway: { id: string; code: string; name: string; state: string; lastSeenAt: string | null };
  metrics: { configured: number; latest: number; recent: number; good: number };
  summary: { state: DiagnosticState; totalBatches: number; successfulBatches: number; failedBatches: number; successRate: number | null; totalSamples: number; qualityRate: number | null };
  stages: DiagnosticStage[];
  transactions: Array<{ id: string; batchKey: string; sampledAt: string; receivedAt: string; metricCount: number; success: boolean; errorMessage: string | null; quality: string; timeQuality: string }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

async function requestDiagnostic<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: string } | null; throw new Error(payload?.error || "No fue posible consultar el diagnóstico."); }
  return response.json() as Promise<T>;
}
function formatDateTime(value: string | null) { return value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "Sin registro"; }
function relativeAge(value: string | null) { if (!value) return "Sin registro"; const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000)); if (seconds < 60) return `Hace ${seconds} s`; if (seconds < 3600) return `Hace ${Math.round(seconds / 60)} min`; return `Hace ${Math.round(seconds / 3600)} h`; }
function percent(value: number | null) { return value === null ? "—" : `${value.toFixed(2)}%`; }
function stateLabel(state: DiagnosticState) { return state === "healthy" ? "Operativo" : state === "warning" ? "Revisar" : "Sin comunicación"; }
const stageIcons = { device: IconCircuitCell, gateway: IconRouter, ingestion: IconActivity, core: IconBolt };

export function DiagnosticsView({ assetId, canExecute, notify }: { assetId: string; canExecute: boolean; notify: (message: string, tone?: "success" | "info" | "warning") => void }) {
  const [data, setData] = useState<DiagnosticResponse | null>(null); const [loading, setLoading] = useState(true); const [running, setRunning] = useState(false); const [error, setError] = useState(""); const [page, setPage] = useState(1); const [reload, setReload] = useState(0);
  useEffect(() => { if (!assetId) return; let active = true; const load = async (silent = false) => { if (!silent) { setLoading(true); setError(""); } try { const params = new URLSearchParams({ assetId, page: String(page), pageSize: "6" }); const result = await requestDiagnostic<DiagnosticResponse>(`/api/v1/diagnostics?${params}`); if (active) setData(result); } catch (e) { if (active && !silent) setError(e instanceof Error ? e.message : "No fue posible cargar el diagnóstico."); } finally { if (active && !silent) setLoading(false); } }; void load(); const timer = window.setInterval(() => void load(true), 30000); return () => { active = false; window.clearInterval(timer); }; }, [assetId, page, reload]);
  useEffect(() => { Promise.resolve().then(() => setPage(1)); }, [assetId]);
  const refresh = async () => { if (!assetId || !canExecute) return; setRunning(true); try { await requestDiagnostic("/api/v1/diagnostics", { method: "POST", body: JSON.stringify({ assetId }) }); setReload(v => v + 1); notify("Diagnóstico recalculado con la telemetría normalizada más reciente.", "success"); } catch (e) { notify(e instanceof Error ? e.message : "No fue posible actualizar el diagnóstico.", "warning"); } finally { setRunning(false); } };

  if (!assetId) return <section className="panel diagnostic-empty"><span><IconCircuitCell size={26}/></span><div><h2>Selecciona un activo</h2><p>El diagnóstico evalúa el dispositivo asociado, su gateway y la telemetría recibida por Core.</p></div></section>;
  if (loading && !data) return <section className="panel diagnostic-empty"><span><IconRefresh className="spin" size={26}/></span><div><h2>Cargando diagnóstico</h2><p>Consultando telemetría normalizada y salud de la cadena.</p></div></section>;
  if (error && !data) return <section className="panel diagnostic-empty diagnostic-error"><span><IconAlertTriangle size={26}/></span><div><h2>No fue posible cargar el diagnóstico</h2><p>{error}</p><button onClick={() => setReload(v => v + 1)}>Reintentar</button></div></section>;
  if (!data) return null;
  const overall=data.summary.state;
  return <>
    <section className="module-summary-grid diagnostic-summary-grid">
      <article><span className={`module-summary-icon ${overall==="healthy"?"green":"amber"}`}><IconRouter size={19}/></span><div><small>Cadena de datos</small><strong>{stateLabel(overall)}</strong><span>{data.device.code} → {data.gateway.code} → Core</span></div></article>
      <article><span className="module-summary-icon blue"><IconActivity size={19}/></span><div><small>Métricas recientes</small><strong>{data.metrics.recent}/{data.metrics.configured}</strong><span>{data.metrics.good} con calidad válida</span></div></article>
      <article><span className={`module-summary-icon ${data.summary.failedBatches?"amber":"green"}`}><IconCheck size={19}/></span><div><small>Lotes exitosos · 24 h</small><strong>{percent(data.summary.successRate)}</strong><span>{data.summary.failedBatches} con error</span></div></article>
    </section>
    <article className="panel module-panel diagnostics-module">
      <div className="diagnostics-toolbar"><div><span className="eyebrow">Diagnóstico basado en telemetría</span><h2>Estado de extremo a extremo</h2><p>Core evalúa únicamente el contrato normalizado recibido desde el gateway.</p></div><button className="diagnostic-run-button" onClick={refresh} disabled={running||!canExecute}>{running?<><IconRefresh className="spin" size={16}/> Recalculando…</>:<><IconActivity size={16}/> Actualizar diagnóstico</>}</button></div>
      <div className={`diagnostic-chain ${overall}`}>{data.stages.flatMap((stage,index)=>{const Icon=stageIcons[stage.key]; return [<article className={`stage-${stage.state}`} key={stage.key}><span><Icon size={21}/></span><small>Etapa {String(index+1).padStart(2,"0")}</small><strong>{stage.label}</strong><p>{stage.detail}</p><i>{stage.evidence}</i></article>,...(index<data.stages.length-1?[<b key={stage.key+"-arrow"}>→</b>]:[])];})}</div>
      <div className={`diagnostics-result-bar result-${overall}`}><span>{overall==="healthy"?<IconCircleCheck size={16}/>:<IconAlertTriangle size={16}/>}</span><div><strong>{overall==="healthy"?"La cadena normalizada tiene evidencia reciente y completa":overall==="warning"?"La cadena presenta evidencia incompleta":"No existe comunicación reciente"}</strong><p>Calculado {formatDateTime(data.serverTime)} · ventana de 24 horas</p></div></div>
      <div className="diagnostic-profile-strip"><div><small>Modelo</small><strong>{data.device.modelName}</strong></div><div><small>Última telemetría</small><strong>{relativeAge(data.device.lastReadAt)}</strong></div><div><small>Último gateway</small><strong>{relativeAge(data.gateway.lastSeenAt)}</strong></div><div><small>Calidad actual</small><strong>{percent(data.summary.qualityRate)}</strong></div></div>
      <section className="diagnostic-transactions"><div className="report-library-head"><div><span className="eyebrow">Evidencia persistida</span><h2>Últimos lotes normalizados</h2></div><span>{data.summary.totalBatches} lotes / 24 h</span></div><div className="module-table-wrap"><div className="diagnostic-transaction-table"><div className="module-table-head"><span>Fecha y hora</span><span>Lote</span><span>Métricas</span><span>Resultado</span><span>Calidad</span></div>{data.transactions.map(t=><div className="module-table-row" key={t.id}><span className="mono-cell">{formatDateTime(t.receivedAt)}</span><span className="mono-cell" title={t.batchKey}>{t.batchKey}</span><span>{t.metricCount}</span><span className={t.success?"quality-ok":"quality-error"}>{t.success?<IconCircleCheck size={14}/>:<IconAlertTriangle size={14}/>} <span>{t.success?"Completo":t.errorMessage||"Incompleto"}</span></span><span>{t.quality}</span></div>)}{!data.transactions.length&&<div className="diagnostic-table-empty"><IconDatabase size={20}/><span>No existen lotes normalizados durante las últimas 24 horas.</span></div>}</div></div><Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} pageSize={data.pagination.pageSize} onPageChange={setPage} itemLabel="lotes"/></section>
      <div className="configuration-note diagnostics-note"><IconShieldCheck size={17}/><p><strong>Separación de responsabilidades.</strong> Core no conoce buses, registros ni direcciones físicas. Esos detalles pertenecen al Gateway; el diagnóstico comienza en el dispositivo lógico y el JSON normalizado que recibe la plataforma.</p></div>
    </article>
  </>;
}
