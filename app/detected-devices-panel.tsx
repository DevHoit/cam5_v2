"use client";

import { useCallback, useEffect, useState } from "react";
import { IconBluetooth, IconCheck, IconEyeOff, IconPlus, IconRefresh } from "@tabler/icons-react";

type NoticeTone = "success" | "info" | "warning";
type ConfirmRequest = { title: string; detail: string; confirmLabel: string; tone?: "default" | "danger"; onConfirm: () => void };
type DetectedDevice = { id: string; gatewayId: string; gatewayCode: string; gatewayName: string; externalId: string; firstSeenAt: string; lastSeenAt: string; seenCount: number; lastRssi: number | null; lastValues: Record<string, number> };
type Template = { id: string; code: string; name: string; manufacturer: string; protocol: string; measurements: Array<{ key: string; name: string; unit: string; quantity: string }> };
type DetectedResponse = { items: DetectedDevice[]; templates: Template[]; points: Array<{ id: string; code: string; name: string }> };

function since(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 90) return `hace ${seconds} s`;
  if (seconds < 5400) return `hace ${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `hace ${Math.round(seconds / 3600)} h`;
  return `hace ${Math.round(seconds / 86400)} días`;
}

/** Valores tal como los envió el gateway, con la unidad de la plantilla cuando la clave coincide. */
function valueChips(values: Record<string, number>, template: Template | undefined) {
  const order = (key: string) => {
    const index = template?.measurements.findIndex((entry) => entry.key === key) ?? -1;
    return index === -1 ? 99 : index;
  };
  return Object.entries(values).filter(([key]) => key !== "rssi").sort(([a], [b]) => order(a) - order(b)).slice(0, 4).map(([key, value]) => {
    const measurement = template?.measurements.find((entry) => entry.key === key);
    const shown = key === "battery_mv" ? `${(value / 1000).toFixed(2)} V` : `${Number(value.toFixed(2))}${measurement?.unit ? ` ${measurement.unit}` : ""}`;
    return { key, label: measurement?.name ?? key, shown };
  });
}

async function call<T>(init?: RequestInit): Promise<T> {
  const response = await fetch("/api/v1/detected-devices", { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error || "No fue posible completar la operación.");
  return payload as T;
}

/**
 * Bandeja de equipos detectados: beacons BLE (u otros equipos) que un gateway reporta y que nadie ha
 * asignado. Al asignarlos se crean sus canales desde la plantilla y desde ese momento se guardan sus datos.
 */
export function DetectedDevicesPanel({ canWrite, notify, confirm }: { canWrite: boolean; notify: (message: string, tone?: NoticeTone) => void; confirm: (request: ConfirmRequest) => void }) {
  const [data, setData] = useState<DetectedResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ pointId: "", modelId: "", name: "", code: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await call<DetectedResponse>());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible cargar los equipos detectados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load]);

  function openAssign(item: DetectedDevice) {
    setOpenId(item.id);
    setForm({ pointId: data?.points[0]?.id ?? "", modelId: data?.templates[0]?.id ?? "", name: "", code: "" });
  }

  async function assign(event: React.FormEvent, item: DetectedDevice) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await call<{ item: { code: string; channels: number } }>({ method: "POST", body: JSON.stringify({ action: "assign", id: item.id, ...form, code: form.code || undefined }) });
      notify(`${result.item.code} quedó asignado con ${result.item.channels} canales. Define sus umbrales en Configuración.`, "success");
      setOpenId(null);
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "No fue posible asignar el equipo.", "warning");
    } finally {
      setSaving(false);
    }
  }

  function dismiss(item: DetectedDevice) {
    confirm({
      title: `Ignorar ${item.externalId}`,
      detail: "Dejará de aparecer en esta bandeja y sus datos no se guardarán. Puedes asignarlo más adelante si vuelve a ser necesario.",
      confirmLabel: "Ignorar equipo",
      onConfirm: () => void call({ method: "POST", body: JSON.stringify({ action: "dismiss", id: item.id }) })
        .then(() => { notify(`${item.externalId} se ignorará.`, "info"); return load(); })
        .catch((reason: unknown) => notify(reason instanceof Error ? reason.message : "No fue posible ignorar el equipo.", "warning")),
    });
  }

  const items = data?.items ?? [];
  return <section className="panel detected-devices-panel" aria-label="Equipos detectados">
    <header>
      <span className="detected-devices-icon"><IconBluetooth size={20} /></span>
      <div><span className="eyebrow">Bandeja de entrada</span><h2>Equipos detectados</h2><p>Beacons y sensores que un gateway del sitio está reportando y que aún no tienen punto de medición. Sus datos se guardan desde que los asignas.</p></div>
      <button className="secondary-button" onClick={() => void load()} disabled={loading}><IconRefresh className={loading ? "spin" : ""} size={16} /> Actualizar</button>
    </header>
    {error && !data && <div className="detected-devices-empty"><strong>No fue posible cargar la bandeja</strong><p>{error}</p></div>}
    {data && !items.length && <div className="detected-devices-empty"><IconCheck size={20} /><div><strong>No hay equipos pendientes</strong><p>Cuando un gateway reporte un beacon nuevo aparecerá aquí para asignarlo.</p></div></div>}
    {items.length > 0 && <div className="detected-devices-list">{items.map((item) => {
      const template = data?.templates.find((entry) => entry.id === form.modelId) ?? data?.templates[0];
      return <article key={item.id} className={openId === item.id ? "open" : ""}>
        <div className="detected-device-row">
          <span className="detected-device-identity"><strong><code>{item.externalId}</code></strong><small>{item.gatewayCode} · visto {since(item.lastSeenAt)} · {item.seenCount} envío(s){item.lastRssi !== null ? ` · señal ${item.lastRssi} dBm` : ""}</small></span>
          <span className="detected-device-values">{valueChips(item.lastValues, template).map((chip) => <i key={chip.key} title={chip.label}><small>{chip.label}</small>{chip.shown}</i>)}</span>
          {canWrite && <span className="detected-device-actions">
            <button className="primary-button" onClick={() => openId === item.id ? setOpenId(null) : openAssign(item)} disabled={!data?.points.length || !data.templates.length}><IconPlus size={15} />{openId === item.id ? "Cancelar" : "Asignar"}</button>
            <button className="ghost-button" onClick={() => dismiss(item)} aria-label={`Ignorar ${item.externalId}`}><IconEyeOff size={15} /> Ignorar</button>
          </span>}
        </div>
        {openId === item.id && <form className="provisioning-form detected-device-form" onSubmit={(event) => void assign(event, item)}>
          <label><span>Punto de medición</span><select required value={form.pointId} onChange={(event) => setForm({ ...form, pointId: event.target.value })}>{data?.points.map((point) => <option key={point.id} value={point.id}>{point.code} · {point.name}</option>)}</select></label>
          <label><span>Plantilla</span><select required value={form.modelId} onChange={(event) => setForm({ ...form, modelId: event.target.value })}>{data?.templates.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label><span>Nombre</span><input required minLength={2} maxLength={160} placeholder="Ej.: Cámara fría casino" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label><span>Código (opcional)</span><input maxLength={60} pattern="[A-Za-z0-9._\-]{2,60}" placeholder="Automático" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label>
          <button className="primary-button" disabled={saving || !form.pointId || !form.modelId || form.name.trim().length < 2}>{saving ? <><IconRefresh className="spin" size={16} /> Asignando…</> : <><IconCheck size={16} /> Asignar equipo</>}</button>
          {template && <p className="detected-device-template">Se crearán {template.measurements.length} canales: {template.measurements.map((entry) => `${entry.name}${entry.unit ? ` (${entry.unit})` : ""}`).join(", ")}.</p>}
        </form>}
      </article>;
    })}</div>}
    {!canWrite && items.length > 0 && <div className="provisioning-readonly">Tu perfil puede ver los equipos detectados, pero no asignarlos.</div>}
  </section>;
}
