"use client";

import { useEffect, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconCopy,
  IconDownload,
  IconKey,
  IconPlus,
  IconRefresh,
  IconRotate,
  IconRouter,
  IconSearch,
  IconShieldCheck,
  IconTrash,
} from "@tabler/icons-react";
import { Pagination } from "./pagination";

type NoticeTone = "success" | "info" | "warning";
type ConfirmRequest = { title: string; detail: string; confirmLabel: string; tone?: "default" | "danger"; onConfirm: () => void };
type Gateway = { id: string; code: string; name: string; state: string; active: boolean; lastSeenAt: string | null; softwareVersion: string | null; ipAddress: string | null; activeCredentials: number };
type Credential = { id: string; name: string; tokenPrefix: string; gateway: { id: string; code: string; name: string }; status: "active" | "unused" | "revoked" | "expired"; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };
type ProvisioningResponse = {
  gateways: Gateway[];
  items: Credential[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: { gateways: number; onlineGateways: number; activeCredentials: number; usedCredentials: number };
  serverTime: string;
};
type SecretResponse = { credential: Credential; token: string; rotatedCredentialId: string | null; endpoints: { configuration: string; ingestion: string } };

async function requestProvisioning<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible completar la operación.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function formatDateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Nunca";
}

function relativeAge(value: string | null) {
  if (!value) return "Nunca";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000));
  if (seconds < 60) return `Hace ${seconds} s`;
  if (seconds < 3_600) return `Hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `Hace ${Math.round(seconds / 3_600)} h`;
  return `Hace ${Math.round(seconds / 86_400)} d`;
}

function statusLabel(status: Credential["status"]) {
  if (status === "active") return "En uso";
  if (status === "unused") return "Sin usar";
  if (status === "expired") return "Expirada";
  return "Revocada";
}

function downloadText(filename: string, content: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function GatewayProvisioningView({
  canWrite,
  notify,
  confirm,
}: {
  canWrite: boolean;
  notify: (message: string, tone?: NoticeTone) => void;
  confirm: (request: ConfirmRequest) => void;
}) {
  const [data, setData] = useState<ProvisioningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [gatewayId, setGatewayId] = useState("all");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ gatewayId: "", name: "Agente de adquisición principal", validityDays: "365" });
  const [secret, setSecret] = useState<SecretResponse | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "8", status, gatewayId });
        if (query.trim()) params.set("q", query.trim());
        const result = await requestProvisioning<ProvisioningResponse>(`/api/v1/gateway-credentials?${params}`);
        if (!active) return;
        setData(result);
        setForm((current) => ({ ...current, gatewayId: current.gatewayId || result.gateways.find((gateway) => gateway.active)?.id || "" }));
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "No fue posible cargar los gateways.");
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [gatewayId, page, query, reload, status]);

  const createCredential = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await requestProvisioning<SecretResponse>("/api/v1/gateway-credentials", {
        method: "POST",
        body: JSON.stringify({ ...form, validityDays: Number(form.validityDays) }),
      });
      setSecret(result);
      setShowForm(false);
      setReload((current) => current + 1);
      notify("Credencial creada. Descárgala ahora: el token no volverá a mostrarse.", "info");
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : "No fue posible crear la credencial.", "warning");
    } finally {
      setSaving(false);
    }
  };

  const rotateCredential = (credential: Credential) => confirm({
    title: `Rotar ${credential.name}`,
    detail: "Se creará un token nuevo y el anterior dejará de funcionar inmediatamente. Actualiza el gateway con el archivo descargado después de confirmar.",
    confirmLabel: "Rotar credencial",
    tone: "danger",
    onConfirm: async () => {
      setSaving(true);
      try {
        const result = await requestProvisioning<SecretResponse>("/api/v1/gateway-credentials", {
          method: "POST",
          body: JSON.stringify({ gatewayId: credential.gateway.id, name: `${credential.name.slice(0, 108)} · rotada`, validityDays: 365, rotateCredentialId: credential.id }),
        });
        setSecret(result);
        setReload((current) => current + 1);
        notify("Credencial rotada. Instala el nuevo token en el gateway.", "info");
      } catch (rotateError) {
        notify(rotateError instanceof Error ? rotateError.message : "No fue posible rotar la credencial.", "warning");
      } finally {
        setSaving(false);
      }
    },
  });

  const revokeCredential = (credential: Credential) => confirm({
    title: `Revocar ${credential.name}`,
    detail: "El gateway o proceso que use esta credencial perderá acceso a configuración e ingestión. La telemetría histórica se conserva.",
    confirmLabel: "Revocar credencial",
    tone: "danger",
    onConfirm: async () => {
      try {
        await requestProvisioning(`/api/v1/gateway-credentials/${encodeURIComponent(credential.id)}`, { method: "DELETE" });
        setReload((current) => current + 1);
        notify("Credencial revocada y registrada en auditoría.");
      } catch (revokeError) {
        notify(revokeError instanceof Error ? revokeError.message : "No fue posible revocar la credencial.", "warning");
      }
    },
  });

  const environmentFile = (value: SecretResponse) => {
    const base = `${window.location.origin}/api/v1`;
    return [
      "# HoitLive Core · configuración privada del gateway",
      "# Guarda este archivo con permisos de lectura limitados al servicio.",
      `CAM5_API_BASE=${base}`,
      `CAM5_GATEWAY_TOKEN=${value.token}`,
      "CAM5_RUN_ONCE=0",
      "",
    ].join("\n");
  };

  const downloadEnvironment = (value: SecretResponse) => downloadText(`hoitlive-${value.credential.gateway.code.toLowerCase()}.env`, environmentFile(value));
  const downloadTemplate = (gateway: Gateway) => downloadText(`hoitlive-${gateway.code.toLowerCase()}-plantilla.env`, [
    "# HoitLive Core · plantilla de configuración",
    `CAM5_API_BASE=${window.location.origin}/api/v1`,
    "CAM5_GATEWAY_TOKEN=PEGAR_TOKEN_GENERADO_EN_EL_PORTAL",
    "CAM5_RUN_ONCE=1",
    "",
  ].join("\n"));
  const copyToken = async () => {
    if (!secret) return;
    await navigator.clipboard?.writeText(secret.token);
    setCopied(true);
    notify("Token copiado al portapapeles.", "info");
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (loading && !data) return <section className="panel provisioning-state"><IconRefresh className="spin" size={24} /><div><h2>Cargando provisionamiento</h2><p>Consultando gateways y credenciales registradas.</p></div></section>;
  if (error && !data) return <section className="panel provisioning-state provisioning-error"><IconAlertTriangle size={24} /><div><h2>No fue posible cargar el módulo</h2><p>{error}</p><button onClick={() => setReload((current) => current + 1)}>Reintentar</button></div></section>;
  if (!data) return null;

  return <>
    <section className="module-summary-grid provisioning-summary-grid">
      <article><span className="module-summary-icon blue"><IconRouter size={19} /></span><div><small>Gateways del sitio</small><strong>{data.summary.gateways}</strong><span>{data.summary.onlineGateways} en línea</span></div></article>
      <article><span className="module-summary-icon green"><IconKey size={19} /></span><div><small>Credenciales vigentes</small><strong>{data.summary.activeCredentials}</strong><span>{data.summary.usedCredentials} verificadas por uso</span></div></article>
      <article><span className="module-summary-icon amber"><IconClock size={19} /></span><div><small>Última comprobación</small><strong>{formatDateTime(data.serverTime)}</strong><span>Estado consultado en PostgreSQL</span></div></article>
    </section>

    {secret && <section className="panel credential-reveal" role="status">
      <span className="credential-reveal-icon"><IconShieldCheck size={24} /></span>
      <div><span className="eyebrow">Se muestra una sola vez</span><h2>Instala la nueva credencial en {secret.credential.gateway.code}</h2><p>Descarga el archivo privado o copia el token antes de cerrar esta sección.</p><code>{secret.token}</code><small>HoitLive Core conserva únicamente el hash SHA-256; este valor no puede recuperarse después.</small></div>
      <div className="credential-reveal-actions"><button className="primary-button" onClick={() => downloadEnvironment(secret)}><IconDownload size={16} /> Descargar .env</button><button className="secondary-button" onClick={() => void copyToken()}>{copied ? <IconCheck size={16} /> : <IconCopy size={16} />}{copied ? "Copiado" : "Copiar token"}</button><button className="ghost-button" onClick={() => setSecret(null)}>Ya lo guardé</button></div>
    </section>}

    <section className="panel provisioning-guide">
      <header><span><IconRouter size={22} /></span><div><span className="eyebrow">Puesta en servicio</span><h2>Conectar el gateway a HoitLive Core</h2><p>El portal entrega la identidad; el gateway descarga su configuración y comienza a publicar telemetría.</p></div>{canWrite && <button className="primary-button" onClick={() => setShowForm((current) => !current)}><IconPlus size={16} />{showForm ? "Cancelar" : "Nueva credencial"}</button>}</header>
      <div className="provisioning-steps"><article><b>1</b><div><strong>Genera una credencial</strong><p>Selecciona el gateway y define la vigencia del token.</p></div></article><article><b>2</b><div><strong>Instala el archivo privado</strong><p>Carga las variables en el servicio local, nunca en GitHub.</p></div></article><article><b>3</b><div><strong>Ejecuta una lectura</strong><p>El primer GET de configuración valida el token; la primera ingestión deja el gateway en línea.</p></div></article></div>
      {showForm && <form className="provisioning-form" onSubmit={createCredential}><label><span>Gateway</span><select required value={form.gatewayId} onChange={(event) => setForm({ ...form, gatewayId: event.target.value })}><option value="">Seleccionar…</option>{data.gateways.filter((gateway) => gateway.active).map((gateway) => <option key={gateway.id} value={gateway.id}>{gateway.code} · {gateway.name}</option>)}</select></label><label><span>Nombre de la credencial</span><input required minLength={3} maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label><span>Vigencia</span><select value={form.validityDays} onChange={(event) => setForm({ ...form, validityDays: event.target.value })}><option value="30">30 días</option><option value="90">90 días</option><option value="365">1 año</option><option value="730">2 años</option></select></label><button className="primary-button" disabled={saving || !form.gatewayId}>{saving ? <><IconRefresh className="spin" size={16} /> Generando…</> : <><IconKey size={16} /> Generar token</>}</button></form>}
      {!canWrite && <div className="provisioning-readonly"><IconShieldCheck size={16} /> Tu perfil puede revisar el estado, pero no administrar credenciales.</div>}
    </section>

    <section className="panel provisioning-inventory">
      <header><div><span className="eyebrow">Inventario seguro</span><h2>Credenciales del sitio</h2></div><button className="secondary-button" onClick={() => setReload((current) => current + 1)} disabled={loading}><IconRefresh className={loading ? "spin" : ""} size={16} /> Verificar ahora</button></header>
      <div className="provisioning-toolbar"><label className="search-field"><IconSearch size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar nombre, prefijo o gateway…" /></label><label><span>Gateway</span><select value={gatewayId} onChange={(event) => { setGatewayId(event.target.value); setPage(1); }}><option value="all">Todos</option>{data.gateways.map((gateway) => <option key={gateway.id} value={gateway.id}>{gateway.code}</option>)}</select></label><label><span>Estado</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">Todos</option><option value="active">En uso</option><option value="unused">Sin usar</option><option value="expired">Expiradas</option><option value="revoked">Revocadas</option></select></label></div>
      <div className="module-table-wrap"><div className="provisioning-table"><div className="module-table-head"><span>Credencial</span><span>Gateway</span><span>Estado</span><span>Último uso</span><span>Vigencia</span><span>Acciones</span></div>{data.items.map((credential) => <div className="module-table-row" key={credential.id}><span className="credential-identity"><IconKey size={17} /><span><strong>{credential.name}</strong><code>{credential.tokenPrefix}</code></span></span><span><strong>{credential.gateway.code}</strong><small>{credential.gateway.name}</small></span><span><i className={`credential-status status-${credential.status}`}>{credential.status === "active" ? <IconCircleCheck size={13} /> : credential.status === "unused" ? <IconClock size={13} /> : <IconAlertTriangle size={13} />}{statusLabel(credential.status)}</i></span><span><strong>{relativeAge(credential.lastUsedAt)}</strong><small>{formatDateTime(credential.lastUsedAt)}</small></span><span><strong>{formatDateTime(credential.expiresAt)}</strong><small>Creada {formatDateTime(credential.createdAt)}</small></span><span className="credential-actions"><button className="ghost-button" onClick={() => downloadTemplate(data.gateways.find((gateway) => gateway.id === credential.gateway.id)!)}><IconDownload size={14} /> Plantilla</button>{canWrite && (credential.status === "active" || credential.status === "unused") && <><button className="ghost-button" disabled={saving} onClick={() => rotateCredential(credential)}><IconRotate size={14} /> Rotar</button><button className="icon-danger-button" onClick={() => revokeCredential(credential)} aria-label={`Revocar ${credential.name}`}><IconTrash size={14} /></button></>}</span></div>)}{!data.items.length && <div className="provisioning-empty"><IconKey size={23} /><div><strong>No hay credenciales con estos filtros</strong><p>Genera la primera credencial o ajusta la búsqueda.</p></div></div>}</div></div>
      <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPageChange={setPage} itemLabel="credenciales" />
      <footer><IconShieldCheck size={15} /><span>Los tokens completos solo aparecen al crearlos. La base almacena hashes, prefijos, uso, expiración y revocación.</span></footer>
    </section>
  </>;
}
