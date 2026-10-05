"use client";

import { useMemo, useState } from "react";
import {
  IconBuilding,
  IconBuildingFactory2,
  IconChevronRight,
  IconCircleCheck,
  IconEdit,
  IconMapPin,
  IconPlus,
  IconRefresh,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";

type RoleKey = "platform_admin" | "client_admin" | "site_admin" | "engineer" | "operator" | "viewer";
type Client = { id: string; code: string; name: string; legalName: string | null; taxId: string | null; contactEmail: string | null; active: boolean; roleKey: RoleKey };
type Site = { id: string; code: string; name: string; clientId: string; clientCode: string; clientName: string; description: string | null; timezone: string; active: boolean; pointCount: number; gatewayCount: number; controllerCount: number; roleKey: RoleKey };

type Editor =
  | { kind: "client"; id?: string; code: string; name: string; legalName: string; taxId: string; contactEmail: string; active: boolean }
  | { kind: "site"; id?: string; clientId: string; code: string; name: string; description: string; timezone: string; active: boolean };

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible completar la solicitud.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function OrganizationAdminView({
  clients,
  sites,
  activeClientId,
  activeSiteId,
  canManageClients,
  canManageSites,
  onReload,
  notify,
}: {
  clients: Client[];
  sites: Site[];
  activeClientId: string;
  activeSiteId: string;
  canManageClients: boolean;
  canManageSites: boolean;
  onReload: () => Promise<void>;
  notify: (message: string, tone?: "success" | "info" | "warning") => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState(activeClientId || clients[0]?.id || "");

  const activeClients = clients.filter((client) => client.active);
  const activeSites = sites.filter((site) => site.active);
  const totalAssets = sites.reduce((sum, site) => sum + site.pointCount, 0);
  const totalDevices = sites.reduce((sum, site) => sum + site.controllerCount, 0);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId)
      ?? clients.find((client) => client.id === activeClientId)
      ?? clients[0],
    [activeClientId, clients, selectedClientId],
  );
  const selectedSites = useMemo(
    () => selectedClient ? sites.filter((site) => site.clientId === selectedClient.id) : [],
    [selectedClient, sites],
  );

  const createClient = () => setEditor({ kind: "client", code: "", name: "", legalName: "", taxId: "", contactEmail: "", active: true });
  const createSite = (clientId = selectedClient?.id || activeClientId) => setEditor({ kind: "site", clientId, code: "", name: "", description: "", timezone: "America/Santiago", active: true });
  const editClient = (client: Client) => setEditor({ kind: "client", id: client.id, code: client.code, name: client.name, legalName: client.legalName ?? "", taxId: client.taxId ?? "", contactEmail: client.contactEmail ?? "", active: client.active });
  const editSite = (site: Site) => setEditor({ kind: "site", id: site.id, clientId: site.clientId, code: site.code, name: site.name, description: site.description ?? "", timezone: site.timezone, active: site.active });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    try {
      if (editor.kind === "client") {
        const body = editor.id
          ? { resource: "client", id: editor.id, name: editor.name, legalName: editor.legalName, taxId: editor.taxId, contactEmail: editor.contactEmail, active: editor.active }
          : { resource: "client", code: editor.code, name: editor.name, legalName: editor.legalName, taxId: editor.taxId, contactEmail: editor.contactEmail };
        await requestJson("/api/v1/hierarchy", { method: editor.id ? "PATCH" : "POST", body: JSON.stringify(body) });
      } else {
        const body = editor.id
          ? { resource: "site", id: editor.id, name: editor.name, description: editor.description, timezone: editor.timezone, active: editor.active }
          : { resource: "site", clientId: editor.clientId, code: editor.code, name: editor.name, description: editor.description, timezone: editor.timezone };
        await requestJson("/api/v1/hierarchy", { method: editor.id ? "PATCH" : "POST", body: JSON.stringify(body) });
      }
      notify(editor.id ? "Organización actualizada." : editor.kind === "client" ? "Cliente creado." : "Sitio creado.");
      if (!editor.id && editor.kind === "site") setSelectedClientId(editor.clientId);
      setEditor(null);
      await onReload();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "No fue posible guardar los cambios.", "warning");
    } finally {
      setSaving(false);
    }
  };

  return <div className="organization-admin-v4">
    <section className="admin-commandbar">
      <div><h1>Organización</h1><p>Administra la estructura de clientes y sitios que utiliza HoitLive.</p></div>
      <div className="admin-command-actions">
        {canManageSites && selectedClient && <button onClick={() => createSite()}><IconPlus size={16} /> Nuevo sitio</button>}
        {canManageClients && <button className="primary" onClick={createClient}><IconPlus size={16} /> Nuevo cliente</button>}
      </div>
    </section>

    <section className="admin-status-strip organization-status-strip">
      <article><span><IconBuilding size={19} /></span><div><small>Clientes activos</small><strong>{activeClients.length}</strong><p>{clients.length} registrados</p></div></article>
      <article><span><IconBuildingFactory2 size={19} /></span><div><small>Sitios activos</small><strong>{activeSites.length}</strong><p>{sites.length} registrados</p></div></article>
      <article><span><IconCircleCheck size={19} /></span><div><small>Activos</small><strong>{totalAssets}</strong><p>equipos o instalaciones supervisadas</p></div></article>
      <article><span><IconShieldCheck size={19} /></span><div><small>Dispositivos</small><strong>{totalDevices}</strong><p>fuentes de telemetría</p></div></article>
    </section>

    <section className="organization-hierarchy-guide">
      <span><IconBuilding size={17} /></span><div><strong>Cómo se organiza la plataforma</strong><p>Un <b>cliente</b> contiene uno o más <b>sitios</b>. Dentro de cada sitio se crean los activos, gateways y dispositivos que serán supervisados.</p></div>
      <div className="organization-hierarchy-flow"><b>Cliente</b><IconChevronRight size={15} /><b>Sitio</b><IconChevronRight size={15} /><span>Activos · Gateways · Dispositivos</span></div>
    </section>

    <section className="organization-workspace">
      <aside className="organization-client-panel">
        <header><div><h2>Clientes</h2><p>Selecciona un cliente para ver sus sitios.</p></div><span>{clients.length}</span></header>
        <div className="organization-client-list">
          {clients.map((client) => {
            const count = sites.filter((site) => site.clientId === client.id).length;
            const selected = selectedClient?.id === client.id;
            return <button key={client.id} className={`organization-client-row ${selected ? "selected" : ""} ${client.active ? "" : "inactive"}`} onClick={() => setSelectedClientId(client.id)}>
              <span className="organization-client-row-icon"><IconBuilding size={18} /></span>
              <span className="organization-client-row-copy"><small>{client.code}</small><strong>{client.name}</strong><em>{count} {count === 1 ? "sitio" : "sitios"}</em></span>
              <i className={`organization-state ${client.active ? "active" : "inactive"}`}>{client.active ? "Activo" : "Inactivo"}</i>
              <IconChevronRight className="organization-client-arrow" size={16} />
            </button>;
          })}
          {!clients.length && <div className="organization-empty compact"><IconBuilding size={22} /><div><strong>Sin clientes</strong><p>Crea el primer cliente para comenzar a estructurar la plataforma.</p></div></div>}
        </div>
      </aside>

      <div className="organization-site-panel">
        {selectedClient ? <>
          <header className="organization-selected-client">
            <span className="organization-selected-icon"><IconBuilding size={21} /></span>
            <div><small>{selectedClient.code}</small><h2>{selectedClient.name}</h2><p>{selectedClient.legalName || selectedClient.contactEmail || "Sin información corporativa adicional"}</p></div>
            <span className={`organization-state ${selectedClient.active ? "active" : "inactive"}`}>{selectedClient.active ? "Cliente activo" : "Cliente inactivo"}</span>
            {canManageClients && <button onClick={() => editClient(selectedClient)}><IconEdit size={15} /> Editar cliente</button>}
          </header>

          <div className="organization-sites-header">
            <div><h3>Sitios operacionales</h3><p>Cada sitio agrupa los activos, gateways y dispositivos de una ubicación operacional.</p></div>
            <span>{selectedSites.length} {selectedSites.length === 1 ? "sitio" : "sitios"}</span>
          </div>

          <div className="organization-site-grid">
            {selectedSites.map((site) => <article className={`organization-site-card ${site.id === activeSiteId ? "current" : ""} ${site.active ? "" : "inactive"}`} key={site.id}>
              <header>
                <span><IconMapPin size={18} /></span>
                <div><small>{site.code}</small><strong>{site.name}</strong></div>
                {site.id === activeSiteId && <i className="organization-current-site">Sitio actual</i>}
              </header>
              <p>{site.description || `Zona horaria: ${site.timezone}`}</p>
              <div className="organization-site-stats">
                <span><b>{site.pointCount}</b><small>Activos</small></span>
                <span><b>{site.gatewayCount}</b><small>Gateways</small></span>
                <span><b>{site.controllerCount}</b><small>Dispositivos</small></span>
              </div>
              <footer>
                <span className={`organization-state ${site.active ? "active" : "inactive"}`}>{site.active ? "Activo" : "Inactivo"}</span>
                {canManageSites && ["platform_admin", "client_admin"].includes(site.roleKey) && <button onClick={() => editSite(site)}><IconEdit size={14} /> Editar sitio</button>}
              </footer>
            </article>)}
            {!selectedSites.length && <div className="organization-empty-site-card"><IconBuildingFactory2 size={26} /><div><strong>Este cliente aún no tiene sitios</strong><p>Los activos y dispositivos se organizan dentro de un sitio operacional.</p></div>{canManageSites && <button onClick={() => createSite(selectedClient.id)}><IconPlus size={15} /> Crear primer sitio</button>}</div>}
          </div>
        </> : <div className="organization-empty"><IconBuilding size={24} /><div><strong>Selecciona un cliente</strong><p>Elige un cliente para revisar y administrar sus sitios.</p></div></div>}
      </div>
    </section>

    {editor && <div className="admin-editor-backdrop" role="presentation" onMouseDown={() => !saving && setEditor(null)}>
      <form className="admin-editor-dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><h2>{editor.id ? "Editar" : "Crear"} {editor.kind === "client" ? "cliente" : "sitio"}</h2><p>{editor.kind === "client" ? "Entidad principal que agrupa uno o más sitios." : "Ubicación operacional asociada a un cliente."}</p></div><button type="button" onClick={() => setEditor(null)} disabled={saving} aria-label="Cerrar"><IconX size={18} /></button></header>
        {!editor.id && editor.kind === "site" && <label><span>Cliente</span><select value={editor.clientId} onChange={(event) => setEditor({ ...editor, clientId: event.target.value })}>{activeClients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.code}</option>)}</select></label>}
        {!editor.id && <label><span>Código</span><input required value={editor.code} onChange={(event) => setEditor({ ...editor, code: event.target.value.toUpperCase() })} placeholder={editor.kind === "client" ? "CLIENTE-01" : "SITIO-01"} /></label>}
        <label><span>Nombre</span><input required minLength={2} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
        {editor.kind === "client" ? <>
          <label><span>Razón social</span><input value={editor.legalName} onChange={(event) => setEditor({ ...editor, legalName: event.target.value })} /></label>
          <label><span>RUT / identificador fiscal</span><input value={editor.taxId} onChange={(event) => setEditor({ ...editor, taxId: event.target.value })} /></label>
          <label><span>Correo de contacto</span><input type="email" value={editor.contactEmail} onChange={(event) => setEditor({ ...editor, contactEmail: event.target.value })} /></label>
        </> : <>
          <label><span>Zona horaria</span><input required value={editor.timezone} onChange={(event) => setEditor({ ...editor, timezone: event.target.value })} /></label>
          <label><span>Descripción</span><textarea value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label>
        </>}
        {editor.id && <label className="admin-active-toggle"><input type="checkbox" checked={editor.active} onChange={(event) => setEditor({ ...editor, active: event.target.checked })} /><span><strong>Entidad activa</strong><small>Desactivar conserva la trazabilidad histórica.</small></span></label>}
        <footer><button type="button" onClick={() => setEditor(null)} disabled={saving}>Cancelar</button><button className="primary" type="submit" disabled={saving}>{saving ? <><IconRefresh className="spin" size={15} /> Guardando</> : "Guardar"}</button></footer>
      </form>
    </div>}
  </div>;
}
