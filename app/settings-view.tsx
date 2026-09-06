"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconActivity,
  IconAlertTriangle,
  IconBook2,
  IconBuilding,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconDatabase,
  IconDeviceFloppy,
  IconHistory,
  IconPlugConnected,
  IconRefresh,
  IconSearch,
  IconServer,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Pagination, useClientPagination } from "./pagination";

type NoticeTone = "success" | "info" | "warning";
type ConfirmRequest = { title: string; detail: string; confirmLabel: string; tone?: "default" | "danger"; onConfirm: () => void };
type SettingsTab = "asset" | "channels" | "registers" | "acquisition" | "versions";
type ConfigurationData = {
  asset: {
    id: string;
    code: string;
    name: string;
    area: string | null;
    nominalVoltageKv: number | null;
    state: string;
    active: boolean;
    siteId: string;
    siteCode: string;
    siteName: string;
    siteTimezone: string;
  };
  controller: {
    id: string;
    code: string;
    name: string;
    serialNumber: string | null;
    firmwareVersion: string | null;
    dataVersion: number | null;
    state: string;
    active: boolean;
    protocol: string;
    host: string;
    port: number;
    unitId: number;
    timeoutMs: number;
    retries: number;
    registerConvention: string;
    lastReadAt: string | null;
    updatedAt: string;
    modelId: string;
    modelCode: string;
    modelName: string;
    registerMapVersion: string;
    profileId: string | null;
    gatewayId: string;
    gatewayCode: string;
    gatewayName: string;
    gatewayIpAddress: string | null;
    gatewayState: string;
    gatewayLastSeenAt: string | null;
  } | null;
  gateways: Array<{ id: string; code: string; name: string; state: string; active: boolean; ipAddress: string | null; lastSeenAt: string | null }>;
  profile: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    staleAfterSeconds: number;
    rawRetentionDays: number;
    aggregateRetentionDays: number;
    ranges: Array<{ id: string; name: string; startRegister: number; endRegister: number; functionCode: number; intervalMs: number; priority: number; enabled: boolean }>;
  } | null;
  channels: Array<{
    id: string;
    code: string;
    name: string;
    zone: string | null;
    metric: string;
    unit: string;
    enabled: boolean;
    displayOrder: number;
    register: number;
    reference: string;
    warningThreshold: number | null;
    criticalThreshold: number | null;
    hysteresis: number;
    activationSamples: number | null;
    recoverySamples: number | null;
    staleAfterSeconds: number | null;
    ruleId: string | null;
  }>;
  registers: Array<{
    id: string;
    nativeRegister: number;
    humanReference: string;
    name: string;
    group: string;
    metric: string;
    dataType: "int16" | "uint16";
    scaleFactor: number;
    scaleNote: string | null;
    unit: string;
    errorRawValue: number | null;
    minimumValue: number | null;
    maximumValue: number | null;
    writable: boolean;
  }>;
  snapshots: Array<{ id: string; version: number; kind: string; checksumSha256: string; section: string; createdAt: string }>;
  validation: { valid: boolean; warnings: string[]; mapValid: boolean };
};
type ChannelDraft = {
  enabled: boolean;
  warningThreshold: string;
  criticalThreshold: string;
  hysteresis: string;
  activationSamples: string;
  recoverySamples: string;
  staleAfterSeconds: string;
};
type AcquisitionDraft = {
  name: string;
  gatewayId: string;
  host: string;
  port: string;
  unitId: string;
  timeoutMs: string;
  retries: string;
  staleAfterSeconds: string;
  rawRetentionDays: string;
  aggregateRetentionDays: string;
  ranges: Array<{ id: string; name: string; startRegister: string; endRegister: string; functionCode: string; intervalMs: string; enabled: boolean }>;
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible completar la solicitud.");
  }
  return response.json() as Promise<T>;
}

function formatDateTime(value: string | null) {
  if (!value) return "Sin actividad registrada";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}

function age(value: string | null) {
  if (!value) return "Nunca";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000));
  if (seconds < 60) return `Hace ${seconds} s`;
  if (seconds < 3_600) return `Hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `Hace ${Math.round(seconds / 3_600)} h`;
  return `Hace ${Math.round(seconds / 86_400)} d`;
}

function channelDrafts(data: ConfigurationData) {
  return Object.fromEntries(data.channels.map((channel) => [channel.id, {
    enabled: channel.enabled,
    warningThreshold: channel.warningThreshold === null ? "" : String(channel.warningThreshold),
    criticalThreshold: channel.criticalThreshold === null ? "" : String(channel.criticalThreshold),
    hysteresis: String(channel.hysteresis),
    activationSamples: String(channel.activationSamples ?? 3),
    recoverySamples: String(channel.recoverySamples ?? 3),
    staleAfterSeconds: String(channel.staleAfterSeconds ?? 30),
  }])) as Record<string, ChannelDraft>;
}

function acquisitionDraft(data: ConfigurationData): AcquisitionDraft | null {
  if (!data.controller || !data.profile) return null;
  return {
    name: data.controller.name,
    gatewayId: data.controller.gatewayId,
    host: data.controller.host,
    port: String(data.controller.port),
    unitId: String(data.controller.unitId),
    timeoutMs: String(data.controller.timeoutMs),
    retries: String(data.controller.retries),
    staleAfterSeconds: String(data.profile.staleAfterSeconds),
    rawRetentionDays: String(data.profile.rawRetentionDays),
    aggregateRetentionDays: String(data.profile.aggregateRetentionDays),
    ranges: data.profile.ranges.map((range) => ({
      id: range.id,
      name: range.name,
      startRegister: String(range.startRegister),
      endRegister: String(range.endRegister),
      functionCode: String(range.functionCode),
      intervalMs: String(range.intervalMs),
      enabled: range.enabled,
    })),
  };
}

export function SettingsView({
  assetId,
  canWrite,
  notify,
  confirm,
  onReloadHierarchy,
}: {
  assetId: string;
  canWrite: boolean;
  notify: (message: string, tone?: NoticeTone) => void;
  confirm: (request: ConfirmRequest) => void;
  onReloadHierarchy: () => Promise<void>;
}) {
  const [tab, setTab] = useState<SettingsTab>("asset");
  const [data, setData] = useState<ConfigurationData | null>(null);
  const [assetForm, setAssetForm] = useState({ name: "", area: "", nominalVoltageKv: "" });
  const [acquisitionForm, setAcquisitionForm] = useState<AcquisitionDraft | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ChannelDraft>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [channelQuery, setChannelQuery] = useState("");
  const [channelState, setChannelState] = useState("all");
  const [registerQuery, setRegisterQuery] = useState("");
  const [registerGroup, setRegisterGroup] = useState("all");

  useEffect(() => {
    if (!assetId) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void requestJson<ConfigurationData>(`/api/v1/configuration?assetId=${encodeURIComponent(assetId)}`)
        .then((result) => {
          if (!active) return;
          setData(result);
          setAssetForm({ name: result.asset.name, area: result.asset.area ?? "", nominalVoltageKv: result.asset.nominalVoltageKv === null ? "" : String(result.asset.nominalVoltageKv) });
          setAcquisitionForm(acquisitionDraft(result));
          setDrafts(channelDrafts(result));
        })
        .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la configuración."); })
        .finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [assetId, reload]);

  const refresh = () => setReload((value) => value + 1);
  const channelItems = useMemo(() => (data?.channels ?? []).filter((channel) => {
    const matchesQuery = !channelQuery.trim() || `${channel.code} ${channel.name} ${channel.zone ?? ""} ${channel.reference}`.toLowerCase().includes(channelQuery.trim().toLowerCase());
    const matchesState = channelState === "all" || (channelState === "enabled" ? channel.enabled : !channel.enabled);
    return matchesQuery && matchesState;
  }), [channelQuery, channelState, data]);
  const channelPage = useClientPagination(channelItems, 8);
  const registerGroups = useMemo(() => [...new Set((data?.registers ?? []).map((register) => register.group))], [data]);
  const registerItems = useMemo(() => (data?.registers ?? []).filter((register) => {
    const matchesQuery = !registerQuery.trim() || `${register.nativeRegister} ${register.humanReference} ${register.name}`.toLowerCase().includes(registerQuery.trim().toLowerCase());
    return matchesQuery && (registerGroup === "all" || register.group === registerGroup);
  }), [data, registerGroup, registerQuery]);
  const registerPage = useClientPagination(registerItems, 10);

  const changedChannels = useMemo(() => (data?.channels ?? []).filter((channel) => {
    const draft = drafts[channel.id];
    if (!draft) return false;
    return draft.enabled !== channel.enabled
      || draft.warningThreshold !== String(channel.warningThreshold ?? "")
      || draft.criticalThreshold !== String(channel.criticalThreshold ?? "")
      || draft.hysteresis !== String(channel.hysteresis)
      || draft.activationSamples !== String(channel.activationSamples ?? 3)
      || draft.recoverySamples !== String(channel.recoverySamples ?? 3)
      || draft.staleAfterSeconds !== String(channel.staleAfterSeconds ?? 30);
  }), [data, drafts]);
  const assetDirty = Boolean(data && (assetForm.name !== data.asset.name || assetForm.area !== (data.asset.area ?? "") || assetForm.nominalVoltageKv !== String(data.asset.nominalVoltageKv ?? "")));
  const acquisitionDirty = Boolean(data && JSON.stringify(acquisitionForm) !== JSON.stringify(acquisitionDraft(data)));

  const patchConfiguration = async (payload: Record<string, unknown>, successMessage: string) => {
    setSaving(true);
    try {
      const response = await requestJson<{ snapshot: { version: number } | null }>("/api/v1/configuration", { method: "PATCH", body: JSON.stringify({ assetId, ...payload }) });
      notify(`${successMessage}${response.snapshot ? ` · versión ${response.snapshot.version}` : ""}`);
      refresh();
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : "No fue posible guardar la configuración.", "warning");
    } finally {
      setSaving(false);
    }
  };

  const saveAsset = async () => {
    await patchConfiguration({ section: "asset", name: assetForm.name, area: assetForm.area, nominalVoltageKv: assetForm.nominalVoltageKv || null }, "Identificación actualizada en PostgreSQL");
    await onReloadHierarchy();
  };

  const saveAcquisition = () => {
    if (!acquisitionForm) return;
    void patchConfiguration({
      section: "acquisition",
      ...acquisitionForm,
      port: Number(acquisitionForm.port),
      unitId: Number(acquisitionForm.unitId),
      timeoutMs: Number(acquisitionForm.timeoutMs),
      retries: Number(acquisitionForm.retries),
      staleAfterSeconds: Number(acquisitionForm.staleAfterSeconds),
      rawRetentionDays: Number(acquisitionForm.rawRetentionDays),
      aggregateRetentionDays: Number(acquisitionForm.aggregateRetentionDays),
      ranges: acquisitionForm.ranges.map((range) => ({ ...range, startRegister: Number(range.startRegister), endRegister: Number(range.endRegister), functionCode: Number(range.functionCode), intervalMs: Number(range.intervalMs) })),
    }, "Adquisición CAM5 actualizada");
  };

  const saveChannels = () => {
    const items = changedChannels.map((channel) => ({ id: channel.id, ...drafts[channel.id], warningThreshold: Number(drafts[channel.id].warningThreshold), criticalThreshold: Number(drafts[channel.id].criticalThreshold), hysteresis: Number(drafts[channel.id].hysteresis), activationSamples: Number(drafts[channel.id].activationSamples), recoverySamples: Number(drafts[channel.id].recoverySamples), staleAfterSeconds: Number(drafts[channel.id].staleAfterSeconds) }));
    if (!items.length) return;
    const submit = () => void patchConfiguration({ section: "channels", items }, `${items.length} canal${items.length === 1 ? "" : "es"} actualizado${items.length === 1 ? "" : "s"}`);
    if (changedChannels.some((channel) => channel.enabled && !drafts[channel.id].enabled)) {
      confirm({ title: "Desactivar canales de adquisición", detail: "Los canales desactivados dejarán de generar lecturas y alarmas. Las alarmas activas asociadas se resolverán con trazabilidad.", confirmLabel: "Guardar y desactivar", tone: "danger", onConfirm: submit });
    } else submit();
  };

  const updateChannel = (id: string, field: keyof ChannelDraft, value: string | boolean) => setDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  const updateRange = (id: string, field: "enabled" | "startRegister" | "endRegister" | "functionCode" | "intervalMs", value: string | boolean) => setAcquisitionForm((current) => current ? ({ ...current, ranges: current.ranges.map((range) => range.id === id ? { ...range, [field]: value } : range) }) : current);
  const tabDirty = tab === "channels" ? changedChannels.length > 0 : false;

  if (!assetId) return <article className="panel configuration-empty"><IconBuilding size={26} /><h2>Selecciona un punto de medición</h2><p>La configuración técnica se aplica al punto activo del encabezado.</p></article>;

  return <article className={`panel module-panel settings-module ${!canWrite ? "role-readonly" : ""}`}>
    <div className="module-toolbar configuration-toolbar">
      <div className="module-tabs" role="tablist" aria-label="Secciones de configuración">
        <button className={tab === "asset" ? "active" : ""} onClick={() => setTab("asset")}><IconBuilding size={16} /> Punto</button>
        <button className={tab === "acquisition" ? "active" : ""} onClick={() => setTab("acquisition")}><IconPlugConnected size={16} /> Adquisición</button>
        <button className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}><IconActivity size={16} /> Canales</button>
        <button className={tab === "registers" ? "active" : ""} onClick={() => setTab("registers")}><IconDatabase size={16} /> Mapa Modbus</button>
        <button className={tab === "versions" ? "active" : ""} onClick={() => setTab("versions")}><IconHistory size={16} /> Versiones</button>
      </div>
      <div className="configuration-actions">
        <button className="secondary-button" onClick={refresh} disabled={loading}><IconRefresh className={loading ? "spin" : ""} size={16} /> Actualizar</button>
        {canWrite && tab === "asset" && <button className="save-config-button" onClick={() => void saveAsset()} disabled={saving || loading || !assetDirty}><IconDeviceFloppy size={16} /> {saving ? "Guardando…" : "Guardar punto"}</button>}
        {canWrite && tab === "acquisition" && <button className="save-config-button" onClick={saveAcquisition} disabled={saving || loading || !acquisitionForm || !acquisitionDirty}><IconDeviceFloppy size={16} /> {saving ? "Guardando…" : "Guardar adquisición"}</button>}
        {canWrite && tab === "channels" && <button className="save-config-button" onClick={saveChannels} disabled={saving || loading || !tabDirty}><IconDeviceFloppy size={16} /> {saving ? "Guardando…" : `Guardar${changedChannels.length ? ` (${changedChannels.length})` : ""}`}</button>}
      </div>
    </div>

    {loading && <div className="data-loading"><IconRefresh className="spin" size={18} /> Consultando configuración persistente…</div>}
    {error && <div className="data-error"><IconAlertTriangle size={18} /><div><strong>No se pudo cargar la configuración</strong><p>{error}</p></div><button className="ghost-button" onClick={refresh}>Reintentar</button></div>}
    {!loading && !error && data && <>
      {!data.validation.valid && <div className="validation-summary" role="alert"><IconAlertTriangle size={18} /><div><strong>Configuración pendiente de completar</strong><p>{data.validation.warnings.join(" · ")}</p></div></div>}

      {tab === "asset" && <div className="settings-content">
        <div className="settings-section-head"><span className="settings-icon"><IconBuilding size={20} /></span><div><h2>Identificación del punto de medición</h2><p>Nombre operativo y datos eléctricos usados en navegación, alarmas y reportes.</p></div></div>
        <div className="configuration-context-grid">
          <div className="form-grid">
            <label><span>Código estable</span><input value={data.asset.code} readOnly /></label>
            <label><span>Nombre operativo</span><input value={assetForm.name} disabled={!canWrite} onChange={(event) => setAssetForm({ ...assetForm, name: event.target.value })} /></label>
            <label><span>Área / ubicación interna</span><input value={assetForm.area} disabled={!canWrite} onChange={(event) => setAssetForm({ ...assetForm, area: event.target.value })} placeholder="Ej.: Sala eléctrica norte" /></label>
            <label><span>Tensión nominal</span><div className="input-unit"><input type="number" min="0.001" step="0.001" value={assetForm.nominalVoltageKv} disabled={!canWrite} onChange={(event) => setAssetForm({ ...assetForm, nominalVoltageKv: event.target.value })} /><b>kV</b></div></label>
            <label><span>Sitio</span><input value={`${data.asset.siteCode} · ${data.asset.siteName}`} readOnly /></label>
            <label><span>Zona horaria del sitio</span><input value={data.asset.siteTimezone} readOnly /></label>
          </div>
          <aside className="configuration-status-card"><span className={`configuration-status-dot status-${data.asset.state}`} /><small>Estado operacional</small><strong>{data.asset.state === "normal" ? "Normal" : data.asset.state === "offline" ? "Sin telemetría" : data.asset.state}</strong><p>El código y el sitio se administran en Estructura operacional para proteger las relaciones históricas.</p></aside>
        </div>
        <div className="configuration-note"><IconShieldCheck size={17} /><p><strong>Persistencia real.</strong> Los cambios quedan en PostgreSQL, generan auditoría y una versión técnica cuando existe un controlador asociado.</p></div>
      </div>}

      {tab === "acquisition" && <div className="settings-content acquisition-settings">
        <div className="settings-section-head"><span className="settings-icon"><IconPlugConnected size={20} /></span><div><h2>Gateway, controlador y perfil de lectura</h2><p>Parámetros que el gateway obtiene desde la API antes de consultar el CAM5.</p></div></div>
        {!data.controller || !acquisitionForm || !data.profile ? <div className="configuration-empty-inline"><IconAlertTriangle size={21} /><div><strong>Falta el controlador CAM5</strong><p>Créalo y asígnalo al punto desde Estructura operacional antes de definir la adquisición.</p></div></div> : <>
          <div className="acquisition-overview">
            <section className="system-config-grid">
              <section><h3><IconServer size={18} /> Enlace de campo</h3><div className="form-grid">
                <label><span>Nombre del controlador</span><input value={acquisitionForm.name} disabled={!canWrite} onChange={(event) => setAcquisitionForm({ ...acquisitionForm, name: event.target.value })} /></label>
                <label><span>Gateway asignado</span><select value={acquisitionForm.gatewayId} disabled={!canWrite} onChange={(event) => setAcquisitionForm({ ...acquisitionForm, gatewayId: event.target.value })}>{data.gateways.map((gateway) => <option key={gateway.id} value={gateway.id}>{gateway.code} · {gateway.name}</option>)}</select></label>
                <label><span>IP / host del CAM5</span><input value={acquisitionForm.host} disabled={!canWrite} onChange={(event) => setAcquisitionForm({ ...acquisitionForm, host: event.target.value })} /></label>
                <label><span>Puerto</span><input type="number" min="1" max="65535" value={acquisitionForm.port} disabled={!canWrite} onChange={(event) => setAcquisitionForm({ ...acquisitionForm, port: event.target.value })} /></label>
                <label><span>Unit ID</span><input type="number" min="0" max="247" value={acquisitionForm.unitId} disabled={!canWrite} onChange={(event) => setAcquisitionForm({ ...acquisitionForm, unitId: event.target.value })} /></label>
                <label><span>Timeout</span><div className="input-unit"><input type="number" min="100" value={acquisitionForm.timeoutMs} disabled={!canWrite} onChange={(event) => setAcquisitionForm({ ...acquisitionForm, timeoutMs: event.target.value })} /><b>ms</b></div></label>
                <label><span>Reintentos</span><input type="number" min="0" max="10" value={acquisitionForm.retries} disabled={!canWrite} onChange={(event) => setAcquisitionForm({ ...acquisitionForm, retries: event.target.value })} /></label>
                <label><span>Protocolo</span><input value="Modbus TCP · FC 03/04" readOnly /></label>
              </div></section>
              <section><h3><IconClock size={18} /> Datos e histórico</h3><div className="form-grid">
                <label><span>Dato atrasado después de</span><div className="input-unit"><input type="number" min="1" value={acquisitionForm.staleAfterSeconds} disabled={!canWrite} onChange={(event) => setAcquisitionForm({ ...acquisitionForm, staleAfterSeconds: event.target.value })} /><b>s</b></div></label>
                <label><span>Retención de datos crudos</span><div className="input-unit"><input type="number" min="1" value={acquisitionForm.rawRetentionDays} disabled={!canWrite} onChange={(event) => setAcquisitionForm({ ...acquisitionForm, rawRetentionDays: event.target.value })} /><b>días</b></div></label>
                <label><span>Retención de agregados</span><div className="input-unit"><input type="number" min="1" value={acquisitionForm.aggregateRetentionDays} disabled={!canWrite} onChange={(event) => setAcquisitionForm({ ...acquisitionForm, aggregateRetentionDays: event.target.value })} /><b>días</b></div></label>
                <label><span>Perfil</span><input value={`${data.profile.key} · ${data.profile.name}`} readOnly /></label>
              </div><div className="acquisition-diagnostic"><span className={data.controller.gatewayState === "online" ? "online" : "pending"}><IconServer size={16} /></span><div><strong>Gateway {data.controller.gatewayCode}: {data.controller.gatewayState}</strong><small>Último contacto: {age(data.controller.gatewayLastSeenAt)}</small></div></div><div className="acquisition-diagnostic"><span className={data.controller.lastReadAt ? "online" : "pending"}><IconActivity size={16} /></span><div><strong>Última lectura del controlador</strong><small>{formatDateTime(data.controller.lastReadAt)}</small></div></div></section>
            </section>
          </div>
          <div className="reading-ranges"><div className="settings-subhead"><div><span className="eyebrow">Perfil de lectura</span><h3>Bloques Modbus consultados por el gateway</h3></div><span>{acquisitionForm.ranges.filter((range) => range.enabled).length} activos</span></div>
            <div className="reading-ranges-table"><div className="reading-range-head"><span>Bloque</span><span>Inicio</span><span>Fin</span><span>Función</span><span>Intervalo</span><span>Estado</span></div>{acquisitionForm.ranges.map((range) => <div className="reading-range-row" key={range.id}><span><strong>{range.name}</strong><small>{Number(range.endRegister) - Number(range.startRegister) + 1} registros</small></span><input type="number" value={range.startRegister} disabled={!canWrite} onChange={(event) => updateRange(range.id, "startRegister", event.target.value)} /><input type="number" value={range.endRegister} disabled={!canWrite} onChange={(event) => updateRange(range.id, "endRegister", event.target.value)} /><select value={range.functionCode} disabled={!canWrite} onChange={(event) => updateRange(range.id, "functionCode", event.target.value)}><option value="3">03 · Holding</option><option value="4">04 · Input</option></select><div className="input-unit"><input type="number" min="500" value={range.intervalMs} disabled={!canWrite} onChange={(event) => updateRange(range.id, "intervalMs", event.target.value)} /><b>ms</b></div><button className={`channel-toggle ${range.enabled ? "on" : ""}`} disabled={!canWrite} onClick={() => updateRange(range.id, "enabled", !range.enabled)}><i />{range.enabled ? "Activo" : "Inactivo"}</button></div>)}</div>
          </div>
          <div className="modbus-address-note"><IconShieldCheck size={17} /><div><strong>Diagnóstico verificable, no simulado</strong><p>HoitLive Core no intenta abrir el puerto 502 desde Internet. El estado se determina con el último contacto del gateway y la última lectura reportada por el propio agente local.</p></div></div>
        </>}
      </div>}

      {tab === "channels" && <div className="settings-content channels-settings database-channel-settings">
        <div className="settings-section-head"><span className="settings-icon"><IconActivity size={20} /></span><div><h2>Canales y política de condición</h2><p>Señales habilitadas, umbrales, histéresis y persistencia antes de activar una alarma.</p></div></div>
        <div className="configuration-list-toolbar"><label className="search-field"><IconSearch size={17} /><input value={channelQuery} onChange={(event) => { setChannelQuery(event.target.value); channelPage.setPage(1); }} placeholder="Buscar canal, zona o registro…" /></label><label className="status-filter"><span>Canales</span><select value={channelState} onChange={(event) => { setChannelState(event.target.value); channelPage.setPage(1); }}><option value="all">Todos</option><option value="enabled">Activos</option><option value="disabled">Inactivos</option></select></label></div>
        <div className="channel-config-scroll"><div className="database-channel-table"><div className="database-channel-head"><span>Canal</span><span>Registro</span><span>Advertencia</span><span>Crítico</span><span>Histéresis</span><span>Activación</span><span>Recuperación</span><span>Atrasado</span><span>Estado</span></div>{channelPage.pageItems.map((channel) => { const draft = drafts[channel.id]; if (!draft) return null; return <div className={`database-channel-row ${changedChannels.some((item) => item.id === channel.id) ? "changed" : ""}`} key={channel.id}><span className="history-channel"><b className="sensor-code">{channel.code}</b><span><strong>{channel.name}</strong><small>{channel.zone ?? channel.metric}</small></span></span><span className="mono-cell">{channel.register}<small>{channel.reference}</small></span><label className="compact-input"><input type="number" step="0.1" value={draft.warningThreshold} disabled={!canWrite} onChange={(event) => updateChannel(channel.id, "warningThreshold", event.target.value)} /><b>{channel.unit}</b></label><label className="compact-input"><input type="number" step="0.1" value={draft.criticalThreshold} disabled={!canWrite} onChange={(event) => updateChannel(channel.id, "criticalThreshold", event.target.value)} /><b>{channel.unit}</b></label><label className="compact-input"><input type="number" min="0" step="0.1" value={draft.hysteresis} disabled={!canWrite} onChange={(event) => updateChannel(channel.id, "hysteresis", event.target.value)} /></label><label className="compact-input"><input type="number" min="1" max="100" value={draft.activationSamples} disabled={!canWrite} onChange={(event) => updateChannel(channel.id, "activationSamples", event.target.value)} /></label><label className="compact-input"><input type="number" min="1" max="100" value={draft.recoverySamples} disabled={!canWrite} onChange={(event) => updateChannel(channel.id, "recoverySamples", event.target.value)} /></label><label className="compact-input"><input type="number" min="1" value={draft.staleAfterSeconds} disabled={!canWrite} onChange={(event) => updateChannel(channel.id, "staleAfterSeconds", event.target.value)} /><b>s</b></label><button className={`channel-toggle ${draft.enabled ? "on" : ""}`} disabled={!canWrite} onClick={() => updateChannel(channel.id, "enabled", !draft.enabled)}><i />{draft.enabled ? "Activo" : "Inactivo"}</button></div>})}</div></div>
        {!channelPage.pageItems.length && <div className="configuration-empty-inline"><IconSearch size={21} /><div><strong>No hay canales con estos filtros</strong><p>Cambia el texto o el estado seleccionado.</p></div></div>}
        <Pagination page={channelPage.page} totalPages={channelPage.totalPages} total={channelPage.total} pageSize={channelPage.pageSize} onPageChange={channelPage.setPage} itemLabel="canales" />
      </div>}

      {tab === "registers" && <div className="settings-content register-settings database-register-settings">
        <div className="register-settings-head"><div className="settings-section-head"><span className="settings-icon"><IconBook2 size={20} /></span><div><h2>Mapa oficial de registros CAM5</h2><p>Catálogo de decodificación entregado al gateway; protegido contra modificaciones accidentales.</p></div></div><span className={`map-integrity ${data.validation.mapValid ? "valid" : "invalid"}`}>{data.validation.mapValid ? <IconCircleCheck size={16} /> : <IconAlertTriangle size={16} />}{data.validation.mapValid ? "Mapa íntegro" : "Revisar catálogo"}</span></div>
        <div className="register-map-summary"><article><small>Registros documentados</small><strong>{data.registers.length}</strong><span>Rango esperado 418–522</span></article><article><small>Modelo</small><strong>{data.controller?.modelCode ?? "—"}</strong><span>{data.controller?.modelName ?? "Sin controlador"}</span></article><article className={data.validation.mapValid ? "is-valid" : "has-issues"}><small>Versión documental</small><strong>{data.controller?.registerMapVersion ?? "—"}</strong><span>{data.validation.mapValid ? "Referencias validadas" : "Catálogo incompleto"}</span></article></div>
        <div className="configuration-list-toolbar"><label className="search-field"><IconSearch size={17} /><input value={registerQuery} onChange={(event) => { setRegisterQuery(event.target.value); registerPage.setPage(1); }} placeholder="Buscar registro o variable…" /></label><label className="status-filter"><span>Grupo</span><select value={registerGroup} onChange={(event) => { setRegisterGroup(event.target.value); registerPage.setPage(1); }}><option value="all">Todos</option>{registerGroups.map((group) => <option key={group}>{group}</option>)}</select></label></div>
        <div className="register-map-scroll"><div className="official-register-table"><div className="official-register-head"><span>Registro</span><span>Variable</span><span>Grupo</span><span>Tipo</span><span>Escala</span><span>Unidad</span><span>Rango válido</span><span>Error</span></div>{registerPage.pageItems.map((register) => <div className="official-register-row" key={register.id}><span><strong>{register.nativeRegister}</strong><small>{register.humanReference}</small></span><span><strong>{register.name}</strong><small>{register.metric}</small></span><span>{register.group}</span><span className="mono-cell">{register.dataType.toUpperCase()}</span><span className="mono-cell">{register.scaleNote ?? register.scaleFactor}</span><span>{register.unit || "—"}</span><span className="mono-cell">{register.minimumValue ?? "—"} → {register.maximumValue ?? "—"}</span><span className="mono-cell">{register.errorRawValue === null ? "—" : `0x${register.errorRawValue.toString(16).toUpperCase().padStart(4, "0")}`}</span></div>)}</div></div>
        <Pagination page={registerPage.page} totalPages={registerPage.totalPages} total={registerPage.total} pageSize={registerPage.pageSize} onPageChange={registerPage.setPage} itemLabel="registros" />
        <div className="configuration-note"><IconShieldCheck size={17} /><p><strong>Fuente de verdad protegida.</strong> Este mapa proviene del modelo CAM5 R1.6. Los ajustes operativos se realizan en los canales y el perfil de lectura, no alterando direcciones ni escalas del fabricante.</p></div>
      </div>}

      {tab === "versions" && <div className="settings-content version-settings">
        <div className="settings-section-head"><span className="settings-icon"><IconHistory size={20} /></span><div><h2>Versiones de configuración</h2><p>Cada cambio técnico genera un checksum y queda enlazado a la auditoría del usuario.</p></div></div>
        <div className="version-summary"><article><small>Versión vigente</small><strong>{data.snapshots[0] ? `v${data.snapshots[0].version}` : "Sin versión"}</strong><span>{data.snapshots[0] ? formatDateTime(data.snapshots[0].createdAt) : "Se crea con el primer cambio"}</span></article><article><small>Integridad</small><strong>{data.snapshots[0] ? "SHA-256" : "Pendiente"}</strong><span>{data.snapshots[0]?.checksumSha256.slice(0, 16) ?? "—"}{data.snapshots[0] ? "…" : ""}</span></article><article><small>Sincronización</small><strong>API gateway</strong><span>GET /api/v1/gateway/config</span></article></div>
        {data.snapshots.length ? <div className="version-list"><div className="version-list-head"><span>Versión</span><span>Sección</span><span>Tipo</span><span>Fecha</span><span>Checksum</span></div>{data.snapshots.map((snapshot, index) => <div className="version-list-row" key={snapshot.id}><span><b>v{snapshot.version}</b>{index === 0 && <i><IconCheck size={12} /> Vigente</i>}</span><span>{snapshot.section === "asset" ? "Punto" : snapshot.section === "acquisition" ? "Adquisición" : snapshot.section === "channels" ? "Canales" : snapshot.section}</span><span>{snapshot.kind === "manual" ? "Cambio manual" : snapshot.kind}</span><span>{formatDateTime(snapshot.createdAt)}</span><code title={snapshot.checksumSha256}>{snapshot.checksumSha256.slice(0, 12)}…</code></div>)}</div> : <div className="configuration-empty-inline"><IconHistory size={22} /><div><strong>Aún no hay versiones</strong><p>La primera versión se generará al guardar una configuración del controlador.</p></div></div>}
        <div className="modbus-address-note"><IconDatabase size={17} /><div><strong>Contrato de sincronización</strong><p>El gateway consulta la configuración vigente y recibe host, Unit ID, rangos, intervalos, escalas y catálogo. El backend sigue siendo la única fuente de verdad.</p></div></div>
      </div>}
    </>}
  </article>;
}
