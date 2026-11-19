"use client";

import { useEffect, useState } from "react";
import {
  IconActivity,
  IconAlertTriangle,
  IconBolt,
  IconCircleCheck,
  IconCircuitCell,
  IconDatabase,
  IconRefresh,
  IconRouter,
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
  return value ? new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value)) : "Sin registro";
}

function relativeAge(value: string | null) {
  if (!value) return "Sin registro";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `Hace ${seconds} s`;
  if (seconds < 3_600) return `Hace ${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `Hace ${Math.round(seconds / 3_600)} h`;
  return `Hace ${Math.round(seconds / 86_400)} días`;
}

function percent(value: number | null) {
  if (value === null) return "—";
  return `${Number(value.toFixed(1))}%`;
}

function gatewayStateLabel(state: string) {
  const labels: Record<string, string> = { online: "En línea", offline: "Sin conexión", degraded: "Degradado", pending: "Pendiente" };
  return labels[state] ?? state;
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
  const tone = overall === "healthy" ? "normal" : overall === "warning" ? "warning" : "critical";
  const stat = (label: string, value: string, note: string) => <div className="diag-stat"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;

  return <div className="diag">
    <section className={`site-incident diag-result ${tone}`} aria-live="polite">
      {running ? <IconRefresh className="spin" size={18} aria-hidden="true" /> : overall === "healthy" ? <IconCircleCheck size={18} aria-hidden="true" /> : <IconAlertTriangle size={18} aria-hidden="true" />}
      <div><strong>{running ? "Recalculando el estado de la cadena" : overall === "healthy" ? "La cadena de adquisición funciona" : overall === "warning" ? "La cadena tiene errores o datos incompletos" : "No hay comunicación reciente"}</strong><p>Últimas 24 h · calculado {formatDateTime(data.serverTime)}</p></div>
      <button type="button" onClick={refreshDiagnostic} disabled={running || !canExecute}>{running ? "Recalculando…" : "Actualizar"}</button>
    </section>

    <section className="panel diag-chain-panel" aria-label="Cadena de adquisición">
      <header><h2>Cadena de adquisición</h2><span>Una lectura se considera atrasada después de {data.profile.staleAfterSeconds} s</span></header>
      <ol className="diag-chain">
        {data.stages.map((stage) => {
          const Icon = stageIcons[stage.key];
          return <li key={stage.key} className={`diag-stage ${stage.state}`}>
            <span className="diag-stage-icon"><Icon size={18} aria-hidden="true" /></span>
            <div><strong>{stage.label}</strong><p>{stage.detail}</p><small>{stage.evidence}</small></div>
            <i className={`dot ${stage.state === "healthy" ? "normal" : stage.state === "warning" ? "warning" : "critical"}`} aria-label={stateLabel(stage.state)} />
          </li>;
        })}
      </ol>
    </section>

    <div className="diag-grid">
      <section className="panel diag-panel" aria-label="Indicadores de las últimas 24 horas">
        <header><h2>Indicadores · 24 h</h2></header>
        <div className="diag-stats">
          {stat("Ciclos correctos", percent(data.summary.successRate), `${data.summary.successfulBatches} de ${data.summary.totalBatches}`)}
          {stat("Latencia promedio", data.summary.averageLatencyMs === null ? "—" : `${data.summary.averageLatencyMs} ms`, data.summary.p95LatencyMs === null ? "P95 —" : `P95 ${data.summary.p95LatencyMs} ms`)}
          {stat("Calidad de registros", percent(data.summary.qualityRate), `${data.summary.goodSamples} de ${data.summary.totalSamples}`)}
          {stat("Registros inválidos", String(data.summary.badSamples + data.summary.staleSamples), `${data.summary.badSamples} malos · ${data.summary.staleSamples} atrasados`)}
          {stat("Última lectura CAM-5", relativeAge(data.device.lastReadAt), formatDateTime(data.device.lastReadAt))}
          {stat("Último enlace gateway", relativeAge(data.gateway.lastSeenAt), gatewayStateLabel(data.gateway.state))}
        </div>
      </section>
      <section className="panel diag-panel" aria-label="Configuración de lectura">
        <header><h2>Configuración de lectura</h2></header>
        <dl className="point-facts">
          <dt>Controlador</dt><dd>{data.device.modelName} · {data.device.code}</dd>
          <dt>Conexión</dt><dd>{data.device.protocol === "modbus_tcp" ? "Modbus TCP" : data.device.protocol === "modbus_rtu" ? "Modbus RTU" : data.device.protocol} {data.device.host}:{data.device.port} · ID {data.device.unitId}</dd>
          <dt>Mapa de registros</dt><dd>{data.device.registerMapVersion} · {data.profile.enabledChannelCount} canales activos</dd>
          <dt>Ciclo</dt><dd>{data.profile.cycleIntervalMs === null ? "—" : `${(data.profile.cycleIntervalMs / 1000).toFixed(1)} s`} · {data.profile.ranges.length} bloques · {data.profile.registerCount} registros</dd>
          <dt>Política Modbus</dt><dd>{data.device.timeoutMs} ms · {data.device.retries} reintentos</dd>
          <dt>Gateway</dt><dd>{data.gateway.code}{data.gateway.address ? ` · ${data.gateway.address}` : ""}</dd>
          <dt>Perfil</dt><dd>{data.profile.name}</dd>
        </dl>
      </section>
    </div>

    <section className="panel diag-panel" aria-label="Últimos ciclos de adquisición">
      <header><h2>Últimos ciclos</h2><span>{data.summary.totalBatches} ciclos en 24 h</span></header>
      <div className="module-table-wrap" role="region" aria-label="Últimos ciclos de adquisición" tabIndex={0}><div className="diagnostic-transaction-table"><div className="module-table-head"><span>Fecha y hora</span><span>Registros</span><span>Resultado</span><span>Latencia</span></div>{data.transactions.map((transaction) => <div className="module-table-row" key={transaction.id} title={`Lote ${transaction.batchKey}`}><span>{formatDateTime(transaction.startedAt)}</span><span>{transaction.receivedRegisters}/{transaction.expectedRegisters}</span><span className={transaction.success ? "quality-ok" : "quality-error"}>{transaction.success ? <IconCircleCheck size={14} /> : <IconAlertTriangle size={14} />} <span>{transaction.success ? "Completo" : transaction.errorMessage || "Incompleto"}</span></span><span>{transaction.latencyMs === null ? "—" : `${transaction.latencyMs} ms`}</span></div>)}{!data.transactions.length && <div className="diagnostic-table-empty"><IconDatabase size={20} /><span>Sin ciclos recibidos en las últimas 24 horas.</span></div>}</div></div>
      <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} pageSize={data.pagination.pageSize} onPageChange={setPage} itemLabel="ciclos" />
    </section>
  </div>;
}
