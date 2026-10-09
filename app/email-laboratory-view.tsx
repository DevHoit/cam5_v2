"use client";
import { useState } from "react";
import Link from "next/link";

type Result = { provisioned?: boolean; metricCount?: number; gatewayCode?: string; run?: { id: string; recipient: string; expiresAt: string }; activated?: boolean; alarm?: { id: string; status: string; openedAt: string }; jobs?: Array<{ id: string; dueAt: string; status: string }>; deliveries?: Array<{ id: number; recipient: string; subject: string; status: string; providerMessageId: string | null }>; state?: Result; dispatchSkipped?: boolean; closed?: boolean };
export function EmailLaboratoryView() {
  const [runId, setRunId] = useState("");
  const [recipient, setRecipient] = useState("pruebas@hoitlive.com");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const state = result?.state ?? result;
  async function perform(action: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/laboratory/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, runId, recipient }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No fue posible completar la acción.");
      setResult(payload);
      if (payload.run?.id) setRunId(payload.run.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Error de solicitud."); }
    finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 960, margin: "48px auto", padding: "0 24px", color: "var(--text-primary, #18181b)" }}>
    <Link href="/?view=notifications">Volver a Notificaciones</Link>
    <h1>Ensayo de correo de laboratorio</h1>
    <p>CAM5-E2E-01 · E2E-STAGING · ventana de 30 minutos. La preparación y revisión no envían correos.</p>
    <section className="notification-panel" style={{ padding: 24, marginTop: 24 }}>
      <label>Destino autorizado <select value={recipient} onChange={(event) => setRecipient(event.target.value)} disabled={busy || Boolean(runId)}><option>pruebas@hoitlive.com</option><option>emer.cl+3@gmail.com</option></select></label>
      <p>El canal verificado debe tener únicamente el destino elegido. Se crea un contacto de laboratorio sin contraseña ni identidad de acceso, con alcance temporal de lectura del sitio.</p>
      <label>Identificador del ensayo <input value={runId} onChange={(event) => setRunId(event.target.value)} placeholder="Se obtiene al preparar" disabled={busy} /></label>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
        <button className="secondary-button" disabled={busy || Boolean(runId)} onClick={() => perform("provision_cam5")}>Preparar banco CAM5</button>
        <button className="primary-button" disabled={busy || Boolean(runId)} onClick={() => perform("prepare")}>Preparar sin enviar</button>
        <button className="secondary-button" disabled={busy || !runId || result?.closed} onClick={() => perform("preflight")}>Revisar alcance</button>
        <button className="secondary-button" disabled={busy || !runId || result?.closed || Boolean(state?.activated)} onClick={() => perform("activate")}>Activar regla del ensayo</button>
        <button className="primary-button" disabled={busy || !runId || result?.closed || !state?.activated || !state.alarm} onClick={() => perform("process")}>Procesar sólo este ensayo</button>
        <button className="secondary-button" disabled={busy || !runId || result?.closed} onClick={() => perform("close")}>Cerrar ensayo</button>
      </div>
      {result?.provisioned && <p role="status">Banco CAM5 preparado: {result.metricCount} métricas · gateway {result.gatewayCode}. No se crearon credenciales ni se enviaron datos.</p>}
      {busy && <p role="status">Procesando…</p>}
      {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
      {state?.run && <p>Destino: <strong>{state.run.recipient}</strong> · vence: {new Date(state.run.expiresAt).toLocaleString("es-CL", { timeZone: "America/Santiago" })}</p>}
      {result?.closed && <p role="status">Ensayo cerrado. Reglas deshabilitadas y entregas pendientes suprimidas.</p>}
      <p>Umbral exclusivo de laboratorio; no configura límites productivos. Antes de activar, envía una muestra normal por el gateway. Luego mantén telemetría cada 20–30 segundos: temperatura T01 ≥75 °C durante 60 segundos, apertura, primer envío y segundo envío desde el minuto 5. Reconoce la alarma en el Centro de alertas; comprueba la cancelación del nivel de 10 minutos y finalmente envía valores normales para recuperar.</p>
      <p>Los ciclos son manuales desde este panel; no hay envíos en segundo plano. La recepción en cada casilla debe confirmarse por separado.</p>
    </section>
    {state?.alarm && <p>Alarma: <Link href={`/?view=alarms&record=${encodeURIComponent(state.alarm.id)}`}>{state.alarm.id}</Link> · {state.alarm.status}</p>}
    {state?.jobs && <table style={{ width: "100%", marginTop: 24 }}><caption>Trabajos del ensayo</caption><thead><tr><th scope="col">Vencimiento</th><th scope="col">Estado</th></tr></thead><tbody>{state.jobs.map((job) => <tr key={job.id}><td>{new Date(job.dueAt).toLocaleTimeString("es-CL", { timeZone: "America/Santiago" })}</td><td>{job.status}</td></tr>)}</tbody></table>}
    {state?.deliveries && <table style={{ width: "100%", marginTop: 24 }}><caption>Entregas del ensayo</caption><thead><tr><th scope="col">Asunto</th><th scope="col">Destino</th><th scope="col">Estado</th><th scope="col">ID proveedor</th></tr></thead><tbody>{state.deliveries.map((delivery) => <tr key={delivery.id}><td>{delivery.subject}</td><td>{delivery.recipient}</td><td>{delivery.status}</td><td>{delivery.providerMessageId ?? "—"}</td></tr>)}</tbody></table>}
  </main>;
}
