"use client";

import { useEffect, useState } from "react";
import {
  IconActivity,
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconCircuitCell,
  IconDatabase,
  IconRefresh,
  IconRouter,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Pagination } from "./pagination";

type DiagnosticState = "healthy" | "warning" | "offline";
type DiagnosticStage = { key: "device" | "gateway" | "ingestion" | "core"; label: string; state: DiagnosticState; detail: string; evidence: string };
type DiagnosticResponse = {
  serverTime: string;
  window: { from: string; to: string; label: string };
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
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible consultar el diagnóstico.");
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
function percent(value: number | null) { return value === null ? "—" : `${value.toFixed(1)}%`; }
function stateLabel(state: DiagnosticState) { return state === "healthy" ? "Operativo" : state === "warning" ? "Revisar" : "Sin comunicación"; }
const stageIcons = { device: IconCircuitCell, gateway: IconRouter, ingestion: IconActivity, core: IconDatabase };

export function DiagnosticsView({ assetId, canExecute, notify }: {
  assetId: string;
  canExecute: boolean;
  notify: (message: string, tone?: "success" | "info" | "warning") => void;
}) {
  const [data, setData] = useState<DiagnosticResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!assetId) return;
    let active = true;
    const load = async (silent = false) => {
      if (!silent) { setLoading(true); setError(""); }
      try {
        const params = new URLSearchParams({ assetId, page: String(page), pageSize: "6" });
        const result = await requestDiagnostic<DiagnosticResponse>(`/api/v1/diagnostics?${params}`);
        if (active) setData(result);
      } catch (cause) {
        if (active && !silent) setError(cause instanceof Error ? cause.message : "No fue posible cargar el diagnóstico.");
      } finally {
        if (active && !silent) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(true), 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [assetId, page, reload]);

  useEffect(() => { Promise.resolve().then(() => setPage(1)); }, [assetId]);

  const refresh = async () => {
    if (!assetId || !canExecute) return;
    setRunning(true);
    try {
      await requestDiagnostic("/api/v1/diagnostics", { method: "POST", body: JSON.stringify({ assetId }) });
      setReload((value) => value + 1);
      notify("Diagnóstico actualizado con la telemetría más reciente.", "success");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "No fue posible actualizar el diagnóstico.", "warning");
    } finally {
      setRunning(false);
    }
  };

  if (!assetId) return <section className="engineering-empty-state"><span><IconActivity size={24} /></span><div><h1>Selecciona un activo</h1><p>El diagnóstico evalúa el dispositivo, su gateway y la telemetría normalizada recibida por Core.</p></div></section>;
  if (loading && !data) return <section className="engineering-loading-state"><IconRefresh className="spin" size={18} /><span>Consultando salud de telemetría…</span></section>;
  if (error && !data) return <section className="engineering-error-state"><IconAlertTriangle size={20} /><div><strong>No se pudo cargar el diagnóstico</strong><p>{error}</p></div><button onClick={() => setReload((value) => value + 1)}>Reintentar</button></section>;
  if (!data) return null;

  const overall = data.summary.state;

  return <div className="diagnostics-v3">
    <section className="engineering-commandbar">
      <div><h1>Diagnóstico</h1><p>{data.asset.code} · {data.asset.name} · {data.device.code}</p></div>
      <div className="engineering-command-actions">
        <span className={`engineering-state state-${overall === "healthy" ? "ready" : overall === "warning" ? "warning" : "critical"}`}>
          {overall === "healthy" ? <IconCircleCheck size={14} /> : <IconAlertTriangle size={14} />}
          {stateLabel(overall)}
        </span>
        <button onClick={() => void refresh()} disabled={running || !canExecute}>{running ? <><IconRefresh className="spin" size={14} /> Actualizando</> : <><IconRefresh size={14} /> Actualizar</>}</button>
      </div>
    </section>

    <section className="diagnostic-status-strip">
      <article><span><IconCircuitCell size={17} /></span><div><small>Dispositivo</small><strong>{data.device.modelName}</strong><p>{data.device.code} · {relativeAge(data.device.lastReadAt)}</p></div></article>
      <article className={data.gateway.state === "online" ? "healthy" : "warning"}><span><IconRouter size={17} /></span><div><small>Gateway</small><strong>{data.gateway.state === "online" ? "Disponible" : "Revisar"}</strong><p>{data.gateway.code} · {relativeAge(data.gateway.lastSeenAt)}</p></div></article>
      <article className={data.metrics.recent === data.metrics.configured && data.metrics.configured > 0 ? "healthy" : "warning"}><span><IconActivity size={17} /></span><div><small>Métricas recientes</small><strong>{data.metrics.recent}/{data.metrics.configured}</strong><p>{data.metrics.good} con calidad válida</p></div></article>
      <article className={(data.summary.qualityRate ?? 0) >= 99 ? "healthy" : "warning"}><span><IconCheck size={17} /></span><div><small>Calidad</small><strong>{percent(data.summary.qualityRate)}</strong><p>{data.summary.totalSamples.toLocaleString("es-CL")} muestras · 24 h</p></div></article>
    </section>

    <article className="panel diagnostics-workspace-v3">
      <header className="diagnostics-section-head"><div><h2>Cadena de telemetría</h2><p>Estado de extremo a extremo desde el dispositivo lógico hasta Core.</p></div><span>{percent(data.summary.successRate)} lotes exitosos</span></header>

      <div className="diagnostic-chain-v3">
        {data.stages.map((stage, index) => {
          const Icon = stageIcons[stage.key];
          return <article className={`stage-${stage.state}`} key={stage.key}>
            <span><Icon size={18} /></span>
            <div><small>{String(index + 1).padStart(2, "0")} · {stage.label}</small><strong>{stateLabel(stage.state)}</strong><p>{stage.detail}</p></div>
            <i>{stage.evidence}</i>
          </article>;
        })}
      </div>

      <div className={`diagnostic-result-v3 result-${overall}`}>
        <span>{overall === "healthy" ? <IconCircleCheck size={17} /> : <IconAlertTriangle size={17} />}</span>
        <div><strong>{overall === "healthy" ? "La cadena presenta evidencia reciente y completa" : overall === "warning" ? "La cadena presenta evidencia incompleta" : "No existe comunicación reciente"}</strong><p>Calculado {formatDateTime(data.serverTime)} · ventana de 24 horas.</p></div>
      </div>

      <section className="diagnostic-evidence-v3">
        <header><div><h2>Evidencia reciente</h2><p>Lotes normalizados persistidos por Core durante las últimas 24 horas.</p></div><span>{data.summary.totalBatches} lotes</span></header>
        <div className="diagnostic-batch-list">
          {data.transactions.map((item) => <article key={item.id}>
            <time><strong>{formatDateTime(item.receivedAt)}</strong><small>{item.batchKey}</small></time>
            <div><strong>{item.metricCount} métricas</strong><small>{item.timeQuality} · {item.quality}</small></div>
            <span className={item.success ? "batch-state success" : "batch-state error"}>{item.success ? <IconCircleCheck size={13} /> : <IconAlertTriangle size={13} />}{item.success ? "Completo" : item.errorMessage || "Incompleto"}</span>
          </article>)}
          {!data.transactions.length && <div className="diagnostic-empty-batches"><IconDatabase size={20} /><div><strong>Sin lotes recientes</strong><p>No existen lotes normalizados durante las últimas 24 horas.</p></div></div>}
        </div>
        <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} pageSize={data.pagination.pageSize} onPageChange={setPage} itemLabel="lotes" />
      </section>

      <footer className="engineering-boundary-note"><IconShieldCheck size={16} /><p><strong>Core diagnostica datos semánticos.</strong> Buses, direcciones físicas, registros, factores de escala y drivers pertenecen al Gateway Agent.</p></footer>
    </article>
  </div>;
}
