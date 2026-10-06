"use client";

import { useEffect, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconDeviceDesktop,
  IconKey,
  IconRefresh,
  IconShieldCheck,
  IconUser,
} from "@tabler/icons-react";

type AccountResponse = {
  profile: {
    displayName: string;
    email: string;
    locale: string;
    timezone: string;
    roleName: string;
    lastLoginAt: string | null;
    createdAt: string;
    sites: Array<{ id: string; code: string; name: string; clientName: string; roleName: string }>;
  };
  sessions: Array<{
    id: string;
    current: boolean;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
  }>;
};

type ConfirmRequest = { title: string; detail: string; confirmLabel: string; tone?: "default" | "danger"; onConfirm: () => void };

async function accountRequest<T>(init?: RequestInit): Promise<T> {
  const response = await fetch("/api/v1/account", {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "No fue posible actualizar la cuenta.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function formatDateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Sin registro";
}

function deviceLabel(userAgent: string | null) {
  if (!userAgent) return "Dispositivo no identificado";
  const browser = userAgent.includes("Edg/") ? "Edge" : userAgent.includes("Chrome/") ? "Chrome" : userAgent.includes("Safari/") ? "Safari" : userAgent.includes("Firefox/") ? "Firefox" : "Navegador";
  const system = userAgent.includes("Mac OS X") ? "macOS" : userAgent.includes("Windows") ? "Windows" : userAgent.includes("Android") ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : "Sistema desconocido";
  return `${browser} · ${system}`;
}

export function AccountView({
  notify,
  confirm,
  onProfileUpdated,
}: {
  notify: (message: string, tone?: "success" | "info" | "warning") => void;
  confirm: (request: ConfirmRequest) => void;
  onProfileUpdated: (displayName: string) => void;
}) {
  const [data, setData] = useState<AccountResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [profile, setProfile] = useState({ displayName: "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirmation: "" });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await accountRequest<AccountResponse>();
      setData(result);
      setProfile({ displayName: result.profile.displayName });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la cuenta.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const result = await accountRequest<{ displayName: string }>({ method: "PATCH", body: JSON.stringify(profile) });
      onProfileUpdated(result.displayName);
      notify("Perfil actualizado y registrado en auditoría.");
      await load();
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : "No fue posible guardar el perfil.", "warning");
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (passwords.newPassword !== passwords.confirmation) {
      notify("La confirmación no coincide con la nueva contraseña.", "warning");
      return;
    }
    setSavingPassword(true);
    try {
      await accountRequest({ method: "PATCH", body: JSON.stringify({ ...profile, currentPassword: passwords.currentPassword, newPassword: passwords.newPassword }) });
      setPasswords({ currentPassword: "", newPassword: "", confirmation: "" });
      notify("Contraseña actualizada. Las demás sesiones fueron cerradas.");
      await load();
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : "No fue posible cambiar la contraseña.", "warning");
    } finally {
      setSavingPassword(false);
    }
  };

  const revokeSession = (session: AccountResponse["sessions"][number]) => confirm({
    title: "Cerrar sesión remota",
    detail: `${deviceLabel(session.userAgent)} dejará de tener acceso inmediatamente. Esta acción quedará auditada.`,
    confirmLabel: "Cerrar sesión",
    tone: "danger",
    onConfirm: async () => {
      try {
        await accountRequest({ method: "DELETE", body: JSON.stringify({ sessionId: session.id }) });
        notify("Sesión remota cerrada correctamente.");
        await load();
      } catch (revokeError) {
        notify(revokeError instanceof Error ? revokeError.message : "No fue posible cerrar la sesión.", "warning");
      }
    },
  });

  if (loading && !data) return <section className="panel account-state"><IconRefresh className="spin" size={24} /><div><h2>Cargando tu cuenta</h2><p>Consultando perfil, alcance y sesiones activas.</p></div></section>;
  if (error && !data) return <section className="panel account-state account-error"><IconAlertTriangle size={24} /><div><h2>No fue posible cargar tu cuenta</h2><p>{error}</p><button onClick={() => void load()}>Reintentar</button></div></section>;
  if (!data) return null;

  const initials = data.profile.displayName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const remoteSessions = data.sessions.filter((session) => !session.current).length;

  return <div className="account-v4 account-v5">
    <section className="account-commandbar-v5">
      <div><span>Cuenta personal</span><h1>Mi cuenta</h1><p>Administra tu identidad, credenciales y sesiones activas en HoitLive Core.</p></div>
    </section>

    <section className="account-overview-v5">
      <div className="account-identity-v5">
        <span className="account-avatar-v5">{initials}</span>
        <div><small>Usuario autenticado</small><strong>{data.profile.displayName}</strong><p>{data.profile.email}</p></div>
      </div>
      <div className="account-facts-v5">
        <span><small>Perfil</small><strong>{data.profile.roleName}</strong></span>
        <span><small>Alcance</small><strong>{data.profile.sites.length} {data.profile.sites.length === 1 ? "sitio" : "sitios"}</strong></span>
        <span><small>Sesiones</small><strong>{data.sessions.length} activa{data.sessions.length === 1 ? "" : "s"}</strong></span>
        <span><small>Último ingreso</small><strong>{formatDateTime(data.profile.lastLoginAt)}</strong></span>
      </div>
    </section>

    <div className="account-layout account-layout-v5">
      <section className="panel account-panel account-profile-v5">
        <header><span><IconUser size={21} /></span><div><span className="eyebrow">Identidad</span><h2>Perfil del portal</h2><p>Nombre visible y alcance asociado a tu cuenta.</p></div></header>
        <form className="account-form account-profile-form-v5" onSubmit={saveProfile}>
          <label className="account-field-wide-v5"><span>Nombre completo</span><input required minLength={3} value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></label>
          <label><span>Correo electrónico</span><input value={data.profile.email} disabled /><small>Lo modifica un administrador.</small></label>
          <label><span>Perfil</span><input value={data.profile.roleName} disabled /></label>
          <section className="account-scope-v5">
            <div><span>Alcance autorizado</span><small>{data.profile.sites.length} {data.profile.sites.length === 1 ? "sitio asignado" : "sitios asignados"}</small></div>
            <div>{data.profile.sites.map((site) => <span key={site.id}><strong>{site.name}</strong><small>{site.clientName} · {site.roleName}</small></span>)}</div>
          </section>
          <footer><span><IconCheck size={15} /> Los cambios quedan auditados</span><button className="primary-button" disabled={savingProfile}>{savingProfile ? <><IconRefresh className="spin" size={16} /> Guardando…</> : "Guardar perfil"}</button></footer>
        </form>
      </section>

      <section className="panel account-panel security-panel account-security-v5">
        <header><span><IconKey size={21} /></span><div><span className="eyebrow">Seguridad</span><h2>Cambiar contraseña</h2><p>La actualización invalida automáticamente las demás sesiones.</p></div></header>
        <form className="account-form account-security-form-v5" onSubmit={changePassword}>
          <label><span>Contraseña actual</span><input type="password" autoComplete="current-password" required value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></label>
          <label><span>Nueva contraseña</span><input type="password" autoComplete="new-password" required minLength={10} value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /><small>Mínimo 10 caracteres y diferente de la actual.</small></label>
          <label><span>Confirmar nueva contraseña</span><input type="password" autoComplete="new-password" required minLength={10} value={passwords.confirmation} onChange={(event) => setPasswords({ ...passwords, confirmation: event.target.value })} /></label>
          <div className="account-security-note-v5"><IconShieldCheck size={17} /><span><strong>Protección de sesión</strong><small>{remoteSessions ? `Se cerrarán ${remoteSessions} sesión${remoteSessions === 1 ? "" : "es"} remota${remoteSessions === 1 ? "" : "s"} al cambiar la contraseña.` : "No hay otras sesiones activas que cerrar."}</small></span></div>
          <footer><span><IconShieldCheck size={15} /> Verificación obligatoria</span><button className="primary-button" disabled={savingPassword}>{savingPassword ? <><IconRefresh className="spin" size={16} /> Actualizando…</> : "Cambiar contraseña"}</button></footer>
        </form>
      </section>
    </div>

    <section className="panel account-sessions account-sessions-v5">
      <header><span><IconDeviceDesktop size={21} /></span><div><span className="eyebrow">Control de acceso</span><h2>Sesiones activas</h2><p>Revisa dónde está abierta tu cuenta y cierra cualquier acceso que no reconozcas.</p></div><b>{data.sessions.length}</b></header>
      <div className="account-session-columns-v5"><span>Dispositivo</span><span>Última actividad</span><span>Expiración</span><span>Estado</span></div>
      <div className="account-session-list">{data.sessions.map((session) => <article key={session.id} className={session.current ? "current" : ""}>
        <span className="session-device"><IconDeviceDesktop size={20} /></span>
        <div className="account-session-identity-v5"><strong>{deviceLabel(session.userAgent)}</strong><small>IP {session.ipAddress || "no disponible"}</small></div>
        <time>{formatDateTime(session.lastSeenAt)}</time>
        <time>{formatDateTime(session.expiresAt)}</time>
        {session.current ? <i><IconShieldCheck size={14} /> Actual</i> : <button className="danger-button" onClick={() => revokeSession(session)}>Cerrar sesión</button>}
      </article>)}</div>
    </section>
  </div>;
}
