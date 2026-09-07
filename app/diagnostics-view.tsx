"use client";

import { useEffect, useState } from "react";
import {
  IconActivity,
  IconAlertTriangle,
  IconBolt,
  IconCheck,
  IconCircleCheck,
  IconCircuitCell,
  IconClock,
  IconDatabase,
  IconRefresh,
  IconRouter,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Pagination } from "./pagination";

type DiagnosticState = "healthy" | "warning" | "offline";
type DiagnosticStage = { key: "controller" | "modbus" | "gateway" | "core"; label: string; state: DiagnosticState; detail: string; evidence: string };
type DiagnosticResponse = {
  serverTime: string;
  window: { from: string; to: string; label: string };
  asset: { id: string; code: string; name: string };
  device: { id: string; code: string; name: string; state: string; protocol: string; host: string; port: number; unitId: number; timeoutMs: number; retries: number; lastReadAt: string | null; clockOffsetMs: number | null; modelName: string; registerMapVersion: string };
  gateway: { id: string; code: string; name: string; state: string; address: string | null; lastSeenAt: string | null };
  profile: { name: string; staleAfterSeconds: number; cycleIntervalMs: number | null; ranges: Array<{ name: string; startRegister: number; endRegister: number; functionCode: number; intervalMs: number }>; registerCount: number; enabledChannelCount: number };
  summary: { state: DiagnosticState; totalBatches: number; successfulBatches: number; failedBatches: number; successRate: number | null; averageLatencyMs: number | null; p95LatencyMs: number | null; totalSamples: number; goodSamples: number; badSamples: number; staleSamples: number; qualityRate: number | null };
  stages: DiagnosticStage[];
  transactions: Array<{ id: string; batchKey: string; startedAt: string; completedAt: string | null; expectedRegisters: number; receivedRegisters: number; latencyMs: number | null; success: boolean; errorMessage: string | null }>;
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
  if (seconds < 3_600) return `Hace ${Math.round(seconds / 60)} min`;
  return `Hace ${Math.round(seconds / 3_600)} h`;
}

function percent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

function stateLabel(state: DiagnosticState) {
  if (state === "healthy") return "Operativo";
  if (state === "warning") return "Revisar";
  return "Sin comunicación";
}

const stageIcons = { controller: IconCircuitCell, modbus: IconActivity, gateway: IconRouter, core: IconBolt };

export function DiagnosticsView({ assetId, canExecute, notify }: { assetId: string; canExecute: boolean; notify: (message: string, tone?: "success" | "info" | "warning") => void }) {
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
      } catch (loadError) {
        if (active && !silent) setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el diagnóstico.");
      } finally {
        if (active && !silent) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [assetId, page, reload]);

  useEffect(() => {
    Promise.resolve().then(() => setPage(1));
  }, [assetId]);

  const refreshDiagnostic = async () => {
    if (!assetId || !canExecute) return;
    setRunning(true);
    try {
      await requestDiagnostic("/api/v1/diagnostics", { method: "POST", body: JSON.stringify({ assetId }) });
      setReload((current) => current + 1);
      notify("Diagnóstico recalculado con la telemetría persistida más reciente.", "success");
    } catch (refreshError) {
      notify(refreshError instanceof Error ? refreshError.message : "No fue posible actualizar el diagnóstico.", "warning");
    } finally {
      setRunning(false);
    }
  };

  if (!assetId) return <section className="panel diagnostic-empty"><span><IconCircuitCell size={26} /></span><div><h2>Selecciona un punto de medición</h2><p>El diagnóstico necesita un controlador CAM-5 asociado al punto activo.</p></div></section>;
  if (loading && !data) return <section className="panel diagnostic-empty"><span><IconRefresh className="spin" size={26} /></span><div><h2>Cargando diagnóstico</h2><p>Consultando los ciclos de adquisición y la calidad almacenada.</p></div></section>;
  if (error && !data) return <section className="panel diagnostic-empty diagnostic-error"><span><IconAlertTriangle size={26} /></span><div><h2>No fue posible cargar el diagnóstico</h2><p>{error}</p><button onClick={() => setReload((current) => current + 1)}>Reintentar</button></div></section>;
  if (!data) return null;

  const overall = data.summary.state;
  const statusIcon = overall === "healthy" ? <IconCircleCheck size={17} /> : <IconAlertTriangle size={17} />;

  return <>
    <section className="module-summary-grid diagnostic-summary-grid">
      <article><span className={`module-summary-icon ${overall === "healthy" ? "green" : "amber"}`}><IconRouter size={19} /></span><div><small>Cadena de adquisición</small><strong>{stateLabel(overall)}</strong><span>{data.device.code} → {data.gateway.code} → Core</span></div></article>
      <article><span className="module-summary-icon blue"><IconClock size={19} /></span><div><small>Ciclo configurado</small><strong>{data.profile.cycleIntervalMs === null ? "—" : `${(data.profile.cycleIntervalMs / 1000).toFixed(1)} s`}</strong><span>{data.profile.ranges.length} bloques · {data.profile.registerCount} registros</span></div></article>
      <article><span className={`module-summary-icon ${data.summary.failedBatches ? "amber" : "green"}`}><IconCheck size={19} /></span><div><small>Éxito últimas 24 h</small><strong>{percent(data.summary.successRate)}</strong><span>{data.summary.failedBatches} ciclos con error</span></div></article>
    </section>

    <article className="panel module-panel diagnostics-module">
      <div className="diagnostics-toolbar"><div><span className="eyebrow">Diagnóstico basado en telemetría</span><h2>Estado de extremo a extremo</h2><p>Consolida evidencia real recibida del gateway durante las últimas 24 horas.</p></div><button className={`diagnostic-run-button ${running ? "running" : overall === "healthy" ? "success" : ""}`} onClick={refreshDiagnostic} disabled={running || !canExecute}>{running ? <><IconRefresh className="spin" size={16} /> Recalculando…</> : <><IconActivity size={16} /> Actualizar diagnóstico</>}</button></div>

      <div className={`diagnostic-chain ${overall}`} aria-live="polite">
        {data.stages.flatMap((stage, index) => {
          const Icon = stageIcons[stage.key];
          return [<article className={`stage-${stage.state}`} key={stage.key}><span><Icon size={21} /></span><small>Etapa {String(index + 1).padStart(2, "0")}</small><strong>{stage.label}</strong><p>{stage.detail}</p><i>{stage.evidence}</i></article>, ...(index < data.stages.length - 1 ? [<b key={`${stage.key}-arrow`}>→</b>] : [])];
        })}
      </div>

      <div className={`diagnostics-result-bar result-${overall}`}><span>{running ? <IconRefresh className="spin" size={16} /> : statusIcon}</span><div><strong>{running ? "Recalculando el estado de la cadena" : overall === "healthy" ? "La cadena tiene evidencia reciente y completa" : overall === "warning" ? "La cadena presenta evidencia incompleta o errores" : "No existe comunicación reciente"}</strong><p>Calculado {formatDateTime(data.serverTime)} · ventana de 24 horas</p></div><small>Dato atrasado desde {data.profile.staleAfterSeconds} s</small></div>

      <div className="diagnostic-profile-strip">
        <div><small>Perfil</small><strong>{data.profile.name}</strong></div><div><small>Controlador</small><strong>{data.device.modelName}</strong><span>{data.device.host}:{data.device.port} · ID {data.device.unitId}</span></div><div><small>Mapa</small><strong>{data.device.registerMapVersion}</strong><span>{data.profile.enabledChannelCount} canales activos</span></div><div><small>Política Modbus</small><strong>{data.device.timeoutMs} ms</strong><span>{data.device.retries} reintentos máximos</span></div>
      </div>

      <div className="diagnostics-grid">
        <section className="diagnostic-health-card"><div className="report-library-head"><div><span className="eyebrow">Salud de comunicación</span><h2>Indicadores medidos</h2></div><span className={`diagnostic-status status-${overall}`}><i />{stateLabel(overall)}</span></div><dl><div><dt>Latencia Modbus promedio</dt><dd>{data.summary.averageLatencyMs === null ? "—" : `${data.summary.averageLatencyMs} ms`}<small>24 h</small></dd></div><div><dt>Latencia Modbus P95</dt><dd>{data.summary.p95LatencyMs === null ? "—" : `${data.summary.p95LatencyMs} ms`}<small>24 h</small></dd></div><div><dt>Última lectura CAM-5</dt><dd>{relativeAge(data.device.lastReadAt)}<small>{formatDateTime(data.device.lastReadAt)}</small></dd></div><div><dt>Último enlace gateway</dt><dd>{relativeAge(data.gateway.lastSeenAt)}<small>{data.gateway.state}</small></dd></div><div><dt>Calidad de registros</dt><dd>{percent(data.summary.qualityRate)}<small>{data.summary.goodSamples}/{data.summary.totalSamples}</small></dd></div><div><dt>Registros inválidos</dt><dd>{data.summary.badSamples + data.summary.staleSamples}<small>{data.summary.badSamples} malos · {data.summary.staleSamples} atrasados</small></dd></div></dl></section>

        <section className="diagnostic-transactions"><div className="report-library-head"><div><span className="eyebrow">Evidencia persistida</span><h2>Últimos ciclos de adquisición</h2></div><span>{data.summary.totalBatches} ciclos / 24 h</span></div><div className="module-table-wrap"><div className="diagnostic-transaction-table"><div className="module-table-head"><span>Fecha y hora</span><span>Lote</span><span>Registros</span><span>Resultado</span><span>Latencia</span></div>{data.transactions.map((transaction) => <div className="module-table-row" key={transaction.id}><span className="mono-cell">{formatDateTime(transaction.startedAt)}</span><span className="mono-cell" title={transaction.batchKey}>{transaction.batchKey}</span><span className="mono-cell">{transaction.receivedRegisters}/{transaction.expectedRegisters}</span><span className={transaction.success ? "quality-ok" : "quality-error"}>{transaction.success ? <IconCircleCheck size={14} /> : <IconAlertTriangle size={14} />} <span>{transaction.success ? "Completo" : transaction.errorMessage || "Incompleto"}</span></span><span className="mono-cell">{transaction.latencyMs === null ? "—" : `${transaction.latencyMs} ms`}</span></div>)}{!data.transactions.length && <div className="diagnostic-table-empty"><IconDatabase size={20} /><span>No existen ciclos recibidos durante las últimas 24 horas.</span></div>}</div></div><Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} pageSize={data.pagination.pageSize} onPageChange={setPage} itemLabel="ciclos" /></section>
      </div>

      <div className="configuration-note diagnostics-note"><IconShieldCheck size={17} /><p><strong>Diagnóstico pasivo y verificable.</strong> El portal no inventa una prueba remota: evalúa los lotes que el gateway ya entregó, sus errores, latencia y calidad. Una prueba activa requerirá incorporar un canal de comandos de bajada en el gateway.</p></div>
    </article>
  </>;
}
