"use client";
import { useEffect, useState } from "react";
import styles from "./sensor-history.module.css";
type Sensor = { id: string; deviceId: string; deviceName: string; deviceCode: string; updatedAt: string; code: string; name: string; alias: string; installed: boolean; confirmed: boolean; recordedAt: string | null; unit: string };
export function SensorConfiguration({ assetId }: { assetId: string }) {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/v1/sensors?assetId=${encodeURIComponent(assetId)}`, { signal: abort.signal, cache: "no-store" }).then(async (r) => {
      const data = await r.json(); if (!r.ok) throw new Error(data.error); return data;
    }).then((data) => { setSensors(data.sensors); setError(""); }).catch((e) => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [assetId, revision]);
  async function save(deviceId: string) {
    setBusy(true); setError(""); setNotice("");
    const selected = sensors.filter((s) => s.deviceId === deviceId);
    try {
      const r = await fetch("/api/v1/sensors", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId, deviceId, updatedAt: selected[0].updatedAt, sensors: selected.map(({ id, installed, alias }) => ({ id, installed, alias })) }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      setNotice("Sensores guardados. La selección se aplicará al volver a supervisión, tendencias, reglas e histórico."); setRevision((v) => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); } finally { setBusy(false); }
  }
  return <section className={`panel ${styles.panel}`}><h2>Sensores instalados</h2><p>Selecciona lo instalado en cada equipo y asigna nombres reconocibles. Recibir datos no confirma una instalación; un sensor instalado permanece visible aunque deje de transmitir.</p>
    <p>Hasta la primera confirmación se mantiene la visualización anterior. Después, las nuevas variables quedarán pendientes.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!sensors.length && !error && <p>No hay sensores registrados para este activo.</p>}
    {[...new Set(sensors.map((s) => s.deviceId))].map((deviceId) => {
      const group = sensors.filter((s) => s.deviceId === deviceId);
      return <details key={deviceId} className={styles.device}><summary>{group[0].deviceName} · {group[0].deviceCode} · {group.filter((s) => s.installed).length}/{group.length} seleccionados</summary>
        <div className={styles.actions}><button disabled={busy} onClick={() => setSensors((list) => list.map((s) => s.deviceId === deviceId ? { ...s, installed: false } : s))}>Desmarcar todos</button><button disabled={busy} onClick={() => setSensors((list) => list.map((s) => s.deviceId === deviceId ? { ...s, installed: true } : s))}>Seleccionar todos</button></div>
        <div className={styles.sensorGrid}>{group.map((sensor) => <div key={sensor.id} className={styles.sensor}>
          <label><input type="checkbox" checked={sensor.installed} disabled={busy} onChange={(e) => setSensors((list) => list.map((s) => s.id === sensor.id ? { ...s, installed: e.target.checked } : s))} /> {sensor.code} · {sensor.unit}</label>
          <label>Nombre<input value={sensor.alias} maxLength={120} disabled={busy} onChange={(e) => setSensors((list) => list.map((s) => s.id === sensor.id ? { ...s, alias: e.target.value } : s))} /></label>
          <small>{!sensor.confirmed ? "Pendiente de confirmar · " : ""}{sensor.recordedAt ? `Última recepción: ${new Date(sensor.recordedAt).toLocaleString("es-CL")}` : "Sin datos recibidos"}</small>
        </div>)}</div><button className="primary-button" disabled={busy} onClick={() => void save(deviceId)}>{busy ? "Guardando…" : "Guardar sensores de este equipo"}</button>
      </details>;
    })}<button className="secondary-button" disabled={busy} onClick={() => { setNotice(""); setRevision((v) => v + 1); }}>Actualizar configuración</button>
  </section>;
}
