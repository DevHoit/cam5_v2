"use client";

import { useMemo, useState } from "react";
import {
  IconBuilding,
  IconBuildingFactory2,
  IconCircleCheck,
  IconEdit,
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
  const activeClients = clients.filter((client) => client.active);
  const activeSites = sites.filter((site) => site.active);
  const totalAssets = sites.reduce((sum, site) => sum + site.pointCount, 0);
  const totalDevices = sites.reduce((sum, site) => sum + site.controllerCount, 0);
  const grouped = useMemo(() => clients.map((client) => ({ client, sites: sites.filter((site) => site.clientId === client.id) })), [clients, sites]);

  const createClient = () => setEditor({ kind: "client", code: "", name: "", legalName: "", taxId: "", contactEmail: "", active: true });
  const createSite = () => setEditor({ kind: "site", clientId: activeClientId, code: "", name: "", description: "", timezone: "America/Santiago", active: true });
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
      setEditor(null);
      await onReload();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "No fue posible guardar los cambios.", "warning");
    } finally {
      setSaving(false);
    }
  };

  return <div className="organization-admin-v3">
    <section className="admin-commandbar">
      <div><h1>Organización</h1><p>Clientes, sitios y alcance estructural de la plataforma.</p></div>
      <div className="admin-command-actions">
        {canManageSites && <button onClick={createSite}><IconPlus size={14} /> Nuevo sitio</button>}
        {canManageClients && <button className="primary" onClick={createClient}><IconPlus size={14} /> Nuevo cliente</button>}
      </div>
    </section>

    <section className="admin-status-strip">
      <article><span><IconBuilding size={17} /></span><div><small>Clientes</small><strong>{activeClients.length}</strong><p>{clients.length} registrados</p></div></article>
      <article><span><IconBuildingFactory2 size={17} /></span><div><small>Sitios</small><strong>{activeSites.length}</strong><p>{sites.length} registrados</p></div></article>
      <article><span><IconCircleCheck size={17} /></span><div><small>Activos</small><strong>{totalAssets}</strong><p>distribuidos en la organización</p></div></article>
      <article><span><IconShieldCheck size={17} /></span><div><small>Dispositivos</small><strong>{totalDevices}</strong><p>asociados a los sitios</p></div></article>
    </section>

    <section className="organization-list-v3">
      {grouped.map(({ client, sites: clientSites }) => <article className={`organization-client ${client.active ? "" : "inactive"}`} key={client.id}>
        <header>
          <span className="organization-client-icon"><IconBuilding size={18} /></span>
          <div><small>{client.code}</small><strong>{client.name}</strong><p>{client.legalName || client.contactEmail || "Sin datos corporativos adicionales"}</p></div>
          <span className={`organization-state ${client.active ? "active" : "inactive"}`}>{client.active ? "Activo" : "Inactivo"}</span>
          {canManageClients && <button onClick={() => editClient(client)} aria-label={`Editar ${client.name}`}><IconEdit size={14} /> Editar</button>}
        </header>
        <div className="organization-sites">
          {clientSites.map((site) => <article className={`organization-site ${site.id === activeSiteId ? "current" : ""} ${site.active ? "" : "inactive"}`} key={site.id}>
            <span><IconBuildingFactory2 size={16} /></span>
            <div><small>{site.code}</small><strong>{site.name}</strong><p>{site.description || site.timezone}</p></div>
            <div className="organization-site-facts"><span><b>{site.pointCount}</b> activos</span><span><b>{site.gatewayCount}</b> gateways</span><span><b>{site.controllerCount}</b> dispositivos</span></div>
            <i className={`organization-state ${site.active ? "active" : "inactive"}`}>{site.active ? "Activo" : "Inactivo"}</i>
            {canManageSites && ["platform_admin", "client_admin"].includes(site.roleKey) && <button onClick={() => editSite(site)} aria-label={`Editar sitio ${site.name}`}><IconEdit size={14} /></button>}
          </article>)}
          {!clientSites.length && <div className="organization-empty-sites"><span>Sin sitios registrados para este cliente.</span>{canManageSites && <button onClick={() => setEditor({ kind: "site", clientId: client.id, code: "", name: "", description: "", timezone: "America/Santiago", active: true })}>Crear sitio</button>}</div>}
        </div>
      </article>)}
      {!grouped.length && <div className="organization-empty"><IconBuilding size={22} /><div><strong>Sin clientes disponibles</strong><p>La organización aún no tiene entidades administrables para este usuario.</p></div></div>}
    </section>

    {editor && <div className="admin-editor-backdrop" role="presentation" onMouseDown={() => !saving && setEditor(null)}>
      <form className="admin-editor-dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><h2>{editor.id ? "Editar" : "Crear"} {editor.kind === "client" ? "cliente" : "sitio"}</h2><p>{editor.kind === "client" ? "Entidad organizacional de nivel cliente." : "Sitio operacional asociado a un cliente."}</p></div><button type="button" onClick={() => setEditor(null)} disabled={saving} aria-label="Cerrar"><IconX size={17} /></button></header>
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
        <footer><button type="button" onClick={() => setEditor(null)} disabled={saving}>Cancelar</button><button className="primary" type="submit" disabled={saving}>{saving ? <><IconRefresh className="spin" size={14} /> Guardando</> : "Guardar"}</button></footer>
      </form>
    </div>}
  </div>;
}
