"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconActivity,
  IconAlertTriangle,
  IconBuilding,
  IconCheck,
  IconCircuitCell,
  IconDeviceFloppy,
  IconRefresh,
  IconRouter,
  IconServer,
  IconSettings,
  IconShieldCheck,
} from "@tabler/icons-react";

type NoticeTone = "success" | "info" | "warning";
type SettingsTab = "asset" | "devices" | "metrics";

type ConfigurationData = {
  asset: {
    id: string;
    code: string;
    name: string;
    area: string | null;
    state: string;
    active: boolean;
    siteId: string;
    siteCode: string;
    siteName: string;
    siteTimezone: string;
  };
  devices: Array<{
    id: string;
    code: string;
    name: string;
    state: string;
    serialNumber: string | null;
    firmwareVersion: string | null;
    lastReadAt: string | null;
    modelCode: string | null;
    modelName: string | null;
    gatewayId: string | null;
    gatewayCode: string | null;
    gatewayName: string | null;
    gatewayState: string | null;
    gatewayLastSeenAt: string | null;
  }>;
  gateways: Array<{
    id: string;
    code: string;
    name: string;
    state: string;
    lastSeenAt: string | null;
  }>;
  metrics: Array<{
    deviceId: string;
    id: string;
    code: string;
    name: string;
    enabled: boolean;
    key: string;
    category: string;
    unit: string;
    dataType: string;
  }>;
  capabilities: Array<{
    deviceId: string;
    key: string;
    enabled: boolean;
  }>;
  validation: { valid: boolean; warnings: string[] };
};

type DeviceDraft = { name: string; gatewayId: string };

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible completar la solicitud.");
  }
  return response.json() as Promise<T>;
}

function relativeAge(value: string | null) {
  if (!value) return "Sin registro";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `Hace ${seconds} s`;
  if (seconds < 3600) return `Hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `Hace ${Math.round(seconds / 3600)} h`;
  return `Hace ${Math.round(seconds / 86400)} d`;
}

function stateLabel(value: string) {
  if (["active", "online", "normal"].includes(value)) return "Operativo";
  if (["commissioning", "pending", "degraded", "warning"].includes(value)) return "Atención";
  if (value === "critical") return "Crítico";
  return "Sin comunicación";
}

export function SettingsView({
  assetId,
  canWrite,
  notify,
  onReloadHierarchy,
}: {
  assetId: string;
  canWrite: boolean;
  notify: (message: string, tone?: NoticeTone) => void;
  onReloadHierarchy: () => Promise<void>;
}) {
  const [tab, setTab] = useState<SettingsTab>("asset");
  const [data, setData] = useState<ConfigurationData | null>(null);
  const [assetForm, setAssetForm] = useState({ name: "", area: "" });
  const [deviceDrafts, setDeviceDrafts] = useState<Record<string, DeviceDraft>>({});
  const [loading, setLoading] = useState(false);
  const [savingAsset, setSavingAsset] = useState(false);
  const [savingDevice, setSavingDevice] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!assetId) return;
    let active = true;
    setLoading(true);
    setError("");
    void requestJson<ConfigurationData>(`/api/v1/configuration?assetId=${encodeURIComponent(assetId)}`)
      .then((result) => {
        if (!active) return;
        setData(result);
        setAssetForm({ name: result.asset.name, area: result.asset.area ?? "" });
        setDeviceDrafts(Object.fromEntries(result.devices.map((device) => [device.id, { name: device.name, gatewayId: device.gatewayId ?? "" }])));
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "No fue posible cargar la configuración."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [assetId, reload]);

  const refresh = () => setReload((value) => value + 1);
  const assetDirty = Boolean(data && (assetForm.name !== data.asset.name || assetForm.area !== (data.asset.area ?? "")));
  const configuredMetrics = data?.metrics.filter((metric) => metric.enabled).length ?? 0;
  const enabledCapabilities = data?.capabilities.filter((capability) => capability.enabled).length ?? 0;
  const onlineDevices = data?.devices.filter((device) => ["active", "online", "normal"].includes(device.state)).length ?? 0;

  const metricsByDevice = useMemo(() => {
    const grouped = new Map<string, ConfigurationData["metrics"]>();
    for (const metric of data?.metrics ?? []) {
      const list = grouped.get(metric.deviceId) ?? [];
      list.push(metric);
      grouped.set(metric.deviceId, list);
    }
    return grouped;
  }, [data]);

  const capabilitiesByDevice = useMemo(() => {
    const grouped = new Map<string, ConfigurationData["capabilities"]>();
    for (const capability of data?.capabilities ?? []) {
      const list = grouped.get(capability.deviceId) ?? [];
      list.push(capability);
      grouped.set(capability.deviceId, list);
    }
    return grouped;
  }, [data]);

  const saveAsset = async () => {
    if (!data || !assetDirty) return;
    setSavingAsset(true);
    try {
      await requestJson("/api/v1/configuration", {
        method: "PATCH",
        body: JSON.stringify({ assetId, section: "asset", name: assetForm.name, area: assetForm.area }),
      });
      notify("Identificación del activo actualizada.");
      await onReloadHierarchy();
      refresh();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "No fue posible actualizar el activo.", "warning");
    } finally {
      setSavingAsset(false);
    }
  };

  const saveDevice = async (deviceId: string) => {
    const draft = deviceDrafts[deviceId];
    if (!draft) return;
    setSavingDevice(deviceId);
    try {
      await requestJson("/api/v1/configuration", {
        method: "PATCH",
        body: JSON.stringify({ assetId, section: "device", deviceId, name: draft.name, gatewayId: draft.gatewayId }),
      });
      notify("Asociación lógica del dispositivo actualizada.");
      await onReloadHierarchy();
      refresh();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "No fue posible actualizar el dispositivo.", "warning");
    } finally {
      setSavingDevice(null);
    }
  };

  if (!assetId) return <section className="engineering-empty-state">
    <span><IconSettings size={24} /></span>
    <div><h1>Selecciona un activo</h1><p>La configuración de Core se aplica dentro del contexto del activo seleccionado.</p></div>
  </section>;

  if (loading && !data) return <section className="engineering-loading-state"><IconRefresh className="spin" size={18} /><span>Consultando configuración de Core…</span></section>;
  if (error && !data) return <section className="engineering-error-state"><IconAlertTriangle size={20} /><div><strong>No se pudo cargar la configuración</strong><p>{error}</p></div><button onClick={refresh}>Reintentar</button></section>;
  if (!data) return null;

  return <div className="core-settings-v3">
    <section className="engineering-commandbar">
      <div><h1>Configuración</h1><p>{data.asset.code} · {data.asset.name} · {data.asset.siteName}</p></div>
      <div className="engineering-command-actions">
        <span className={`engineering-state state-${data.validation.valid ? "ready" : "warning"}`}>{data.validation.valid ? <IconCheck size={14} /> : <IconAlertTriangle size={14} />}{data.validation.valid ? "Configuración lista" : "Revisar configuración"}</span>
        <button onClick={refresh} disabled={loading}><IconRefresh className={loading ? "spin" : ""} size={14} /> Actualizar</button>
      </div>
    </section>

    <section className="core-settings-status">
      <article><span><IconBuilding size={17} /></span><div><small>Activo</small><strong>{stateLabel(data.asset.state)}</strong><p>{data.asset.code} · {data.asset.area || "Sin área"}</p></div></article>
      <article className={onlineDevices === data.devices.length && data.devices.length ? "healthy" : "warning"}><span><IconCircuitCell size={17} /></span><div><small>Dispositivos</small><strong>{data.devices.length}</strong><p>{onlineDevices} operativos</p></div></article>
      <article><span><IconActivity size={17} /></span><div><small>Métricas</small><strong>{configuredMetrics}</strong><p>{enabledCapabilities} capacidades habilitadas</p></div></article>
      <article><span><IconServer size={17} /></span><div><small>Gateways disponibles</small><strong>{data.gateways.length}</strong><p>del sitio {data.asset.siteCode}</p></div></article>
    </section>

    <article className="panel core-settings-workspace">
      <div className="engineering-tabs-v3" role="tablist" aria-label="Configuración de Core">
        <button className={tab === "asset" ? "active" : ""} onClick={() => setTab("asset")}>Activo</button>
        <button className={tab === "devices" ? "active" : ""} onClick={() => setTab("devices")}>Dispositivos</button>
        <button className={tab === "metrics" ? "active" : ""} onClick={() => setTab("metrics")}>Métricas y capacidades</button>
      </div>

      {error && <div className="engineering-inline-warning"><IconAlertTriangle size={16} /><span>{error}</span></div>}
      {!data.validation.valid && <div className="core-settings-warnings">{data.validation.warnings.map((warning) => <span key={warning}><IconAlertTriangle size={14} />{warning}</span>)}</div>}

      {tab === "asset" && <section className="core-settings-section">
        <header><div><h2>Identificación del activo</h2><p>Datos lógicos usados en navegación, contexto y reportes.</p></div>{canWrite && <button className="primary-button" disabled={!assetDirty || savingAsset} onClick={() => void saveAsset()}>{savingAsset ? <><IconRefresh className="spin" size={14} /> Guardando</> : <><IconDeviceFloppy size={14} /> Guardar</>}</button>}</header>
        <div className="core-settings-form">
          <label><span>Código</span><input value={data.asset.code} readOnly /></label>
          <label><span>Nombre</span><input value={assetForm.name} disabled={!canWrite} onChange={(event) => setAssetForm({ ...assetForm, name: event.target.value })} /></label>
          <label><span>Área / ubicación</span><input value={assetForm.area} disabled={!canWrite} onChange={(event) => setAssetForm({ ...assetForm, area: event.target.value })} placeholder="Ej.: Sala eléctrica norte" /></label>
          <label><span>Sitio</span><input value={`${data.asset.siteCode} · ${data.asset.siteName}`} readOnly /></label>
          <label><span>Zona horaria</span><input value={data.asset.siteTimezone} readOnly /></label>
          <label><span>Estado</span><input value={stateLabel(data.asset.state)} readOnly /></label>
        </div>
      </section>}

      {tab === "devices" && <section className="core-settings-section">
        <header><div><h2>Dispositivos asociados</h2><p>Core administra identidad y asociación lógica con un gateway del sitio.</p></div><span>{data.devices.length} dispositivos</span></header>
        <div className="core-device-list">
          {data.devices.map((device) => {
            const draft = deviceDrafts[device.id] ?? { name: device.name, gatewayId: device.gatewayId ?? "" };
            const dirty = draft.name !== device.name || draft.gatewayId !== (device.gatewayId ?? "");
            return <article key={device.id}>
              <span className="core-device-icon"><IconCircuitCell size={17} /></span>
              <div className="core-device-identity"><small>{device.code}</small><strong>{device.modelName || device.modelCode || "Modelo no informado"}</strong><p>{device.serialNumber || "Sin número de serie"} · {relativeAge(device.lastReadAt)}</p></div>
              <label><span>Nombre lógico</span><input value={draft.name} disabled={!canWrite} onChange={(event) => setDeviceDrafts((current) => ({ ...current, [device.id]: { ...draft, name: event.target.value } }))} /></label>
              <label><span>Gateway asociado</span><select value={draft.gatewayId} disabled={!canWrite} onChange={(event) => setDeviceDrafts((current) => ({ ...current, [device.id]: { ...draft, gatewayId: event.target.value } }))}><option value="">Seleccionar…</option>{data.gateways.map((gateway) => <option key={gateway.id} value={gateway.id}>{gateway.code} · {gateway.name}</option>)}</select></label>
              <span className={`core-device-state state-${["active","online","normal"].includes(device.state) ? "ready" : "warning"}`}>{stateLabel(device.state)}</span>
              {canWrite && <button disabled={!dirty || savingDevice === device.id || !draft.gatewayId} onClick={() => void saveDevice(device.id)}>{savingDevice === device.id ? <IconRefresh className="spin" size={14} /> : <IconDeviceFloppy size={14} />}{savingDevice === device.id ? "Guardando" : "Guardar"}</button>}
            </article>;
          })}
          {!data.devices.length && <div className="core-settings-empty"><IconCircuitCell size={20} /><div><strong>Sin dispositivos asociados</strong><p>Agrega un dispositivo desde Activos → Infraestructura.</p></div></div>}
        </div>
      </section>}

      {tab === "metrics" && <section className="core-settings-section">
        <header><div><h2>Métricas y capacidades</h2><p>Contrato semántico que Core recibe y utiliza para supervisión, alertas, tendencias y reportes.</p></div><span>{configuredMetrics} métricas habilitadas</span></header>
        <div className="core-metric-device-list">
          {data.devices.map((device) => {
            const metrics = metricsByDevice.get(device.id) ?? [];
            const capabilities = capabilitiesByDevice.get(device.id) ?? [];
            return <article key={device.id}>
              <header><span><IconActivity size={16} /></span><div><small>{device.code}</small><strong>{device.name}</strong><p>{device.modelName || device.modelCode || "Modelo no informado"}</p></div><b>{metrics.filter((metric) => metric.enabled).length} métricas</b></header>
              <div className="core-capability-tags">{capabilities.filter((item) => item.enabled).map((capability) => <span key={capability.key}>{capability.key}</span>)}{!capabilities.some((item) => item.enabled) && <span className="empty">Sin capacidades declaradas</span>}</div>
              <div className="core-metric-list">{metrics.map((metric) => <span key={metric.id} className={metric.enabled ? "" : "disabled"}><i>{metric.category}</i><strong>{metric.name}</strong><small>{metric.key} · {metric.dataType}{metric.unit ? ` · ${metric.unit}` : ""}</small></span>)}{!metrics.length && <div className="core-settings-empty compact"><IconActivity size={18} /><div><strong>Sin métricas configuradas</strong><p>El modelo del dispositivo aún no materializa métricas semánticas.</p></div></div>}</div>
            </article>;
          })}
        </div>
      </section>}

      <footer className="engineering-boundary-note"><IconShieldCheck size={16} /><p><strong>Configuración física fuera de Core.</strong> Drivers, buses, direcciones, registros, escalamiento, endianess y polling se administran en el Gateway Agent. Esta pantalla sólo administra contexto lógico y contrato semántico.</p></footer>
    </article>
  </div>;
}
