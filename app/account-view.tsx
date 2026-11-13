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
  return value ? new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "Sin registro";
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
  const [showAllSessions, setShowAllSessions] = useState(false);

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

  const otherSessions = data ? data.sessions.filter((session) => !session.current).length : 0;
  const revokeOtherSessions = () => confirm({
    title: "Cerrar las demás sesiones",
    detail: `Se cerrarán ${otherSessions} ${otherSessions === 1 ? "sesión" : "sesiones"} en otros dispositivos o navegadores. Esta sesión seguirá abierta y la acción quedará auditada.`,
    confirmLabel: "Cerrar las demás",
    tone: "danger",
    onConfirm: async () => {
      try {
        const result = await accountRequest<{ revoked: number }>({ method: "DELETE", body: JSON.stringify({ scope: "others" }) });
        notify(`${result.revoked} ${result.revoked === 1 ? "sesión cerrada" : "sesiones cerradas"}. Solo esta sesión sigue activa.`);
        await load();
      } catch (revokeError) {
        notify(revokeError instanceof Error ? revokeError.message : "No fue posible cerrar las sesiones.", "warning");
      }
    },
  });

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

  return <>
    <section className="module-summary-strip" aria-label="Resumen de la cuenta">
      <span><IconUser size={15} aria-hidden="true" /><strong>{data.profile.roleName}</strong> · {data.profile.email}</span>
      <span><IconClock size={15} aria-hidden="true" />Último ingreso: <strong>{formatDateTime(data.profile.lastLoginAt)}</strong></span>
      <span><IconShieldCheck size={15} aria-hidden="true" /><strong>{data.sessions.length}</strong> {data.sessions.length === 1 ? "sesión activa" : "sesiones activas"}</span>
    </section>

    <div className="account-layout">
      <section className="panel account-panel">
        <header><span><IconUser size={21} /></span><div><span className="eyebrow">Datos personales</span><h2>Perfil del portal</h2><p>Estos datos identifican tus acciones dentro de la trazabilidad.</p></div></header>
        <form className="account-form" onSubmit={saveProfile}>
          <label><span>Nombre completo</span><input required minLength={3} value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></label>
          <label><span>Correo electrónico</span><input value={data.profile.email} disabled /><small>El correo de acceso lo modifica un administrador.</small></label>
          <label><span>Perfil en el sitio activo</span><input value={data.profile.roleName} disabled /></label>
          <label><span>Alcance autorizado</span><input value={`${data.profile.sites.length} ${data.profile.sites.length === 1 ? "sitio" : "sitios"}`} disabled /><small>{data.profile.sites.map((site) => `${site.clientName} · ${site.name}`).join(" · ")}</small></label>
          <footer><span><IconCheck size={15} /> Los cambios quedan auditados</span><button className="primary-button" disabled={savingProfile}>{savingProfile ? <><IconRefresh className="spin" size={16} /> Guardando…</> : "Guardar perfil"}</button></footer>
        </form>
      </section>

      <section className="panel account-panel security-panel">
        <header><span><IconKey size={21} /></span><div><span className="eyebrow">Credenciales</span><h2>Cambiar contraseña</h2><p>Al guardar se cerrarán todas las demás sesiones activas.</p></div></header>
        <form className="account-form" onSubmit={changePassword}>
          <label><span>Contraseña actual</span><input type="password" autoComplete="current-password" required value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></label>
          <label><span>Nueva contraseña</span><input type="password" autoComplete="new-password" required minLength={10} value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /><small>Mínimo 10 caracteres y diferente de la actual.</small></label>
          <label><span>Confirmar nueva contraseña</span><input type="password" autoComplete="new-password" required minLength={10} value={passwords.confirmation} onChange={(event) => setPasswords({ ...passwords, confirmation: event.target.value })} /></label>
          <footer><span><IconShieldCheck size={15} /> Verificación obligatoria</span><button className="primary-button" disabled={savingPassword}>{savingPassword ? <><IconRefresh className="spin" size={16} /> Actualizando…</> : "Cambiar contraseña"}</button></footer>
        </form>
      </section>
    </div>

    <section className="panel account-sessions">
      <header><span><IconDeviceDesktop size={21} aria-hidden="true" /></span><div><span className="eyebrow">Control de acceso</span><h2>Sesiones activas</h2><p>Revisa dónde está abierta tu cuenta y cierra cualquier acceso que no reconozcas.</p></div>{otherSessions > 0 && <button type="button" className="danger-button account-revoke-others" onClick={revokeOtherSessions}>Cerrar las demás ({otherSessions})</button>}</header>
      <div className="account-session-table" role="table" aria-label="Sesiones activas">
        <div className="account-session-head" role="row"><span role="columnheader">Dispositivo</span><span role="columnheader">IP</span><span role="columnheader">Última actividad</span><span role="columnheader">Expira</span><span role="columnheader"><span className="sr-only">Acción</span></span></div>
        {(showAllSessions ? data.sessions : data.sessions.slice(0, 5)).map((session) => <div key={session.id} role="row" className={`account-session-row ${session.current ? "current" : ""}`}>
          <span role="cell" className="account-session-device"><IconDeviceDesktop size={16} aria-hidden="true" /><strong>{deviceLabel(session.userAgent)}</strong>{session.current && <i>Esta sesión</i>}</span>
          <span role="cell">{session.ipAddress || "No disponible"}</span>
          <span role="cell">{formatDateTime(session.lastSeenAt)}</span>
          <span role="cell">{formatDateTime(session.expiresAt)}</span>
          <span role="cell">{session.current ? <small className="account-session-safe"><IconShieldCheck size={14} aria-hidden="true" /> Actual</small> : <button className="ghost-button" onClick={() => revokeSession(session)} aria-label={`Cerrar sesión de ${deviceLabel(session.userAgent)}, última actividad ${formatDateTime(session.lastSeenAt)}`}>Cerrar</button>}</span>
        </div>)}
      </div>
      {data.sessions.length > 5 && <button type="button" className="account-sessions-toggle" onClick={() => setShowAllSessions((value) => !value)}>{showAllSessions ? "Mostrar solo las 5 más recientes" : `Mostrar todas (${data.sessions.length})`}</button>}
    </section>
  </>;
}
