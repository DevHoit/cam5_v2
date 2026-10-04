"use client";

import { useEffect, useMemo, useState } from "react";
import { IconAlertTriangle, IconClockHour4, IconRefresh, IconUsersGroup } from "@tabler/icons-react";

type NoticeTone = "success" | "info" | "warning";

type ShiftSchedule = {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validTo: string | null;
};

type Shift = {
  id: string;
  clientId: string;
  name: string;
  timezone: string;
  active: boolean;
  schedules: ShiftSchedule[];
};

type ShiftResponse = {
  clientId: string;
  canManage: boolean;
  shifts: Shift[];
};

type OnCallUser = {
  id: string;
  displayName: string;
  email: string;
  phoneE164: string | null;
};

type OnCallAssignment = {
  id: string;
  shiftId: string;
  shiftName: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhoneE164: string | null;
  startsAt: string;
  endsAt: string;
  priority: number;
};

type OnCallResponse = {
  clientId: string;
  canManage: boolean;
  users: OnCallUser[];
  assignments: OnCallAssignment[];
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "No fue posible completar la solicitud.");
  }
  return response.json() as Promise<T>;
}

const DAYS = [
  { id: 1, label: "Lun" },
  { id: 2, label: "Mar" },
  { id: 3, label: "Mié" },
  { id: 4, label: "Jue" },
  { id: 5, label: "Vie" },
  { id: 6, label: "Sáb" },
  { id: 0, label: "Dom" },
] as const;

function shortTime(value: string) {
  return value.slice(0, 5);
}

function scheduleLabel(schedule: ShiftSchedule) {
  const day = DAYS.find((item) => item.id === schedule.dayOfWeek)?.label ?? String(schedule.dayOfWeek);
  return `${day} ${shortTime(schedule.startTime)}–${shortTime(schedule.endTime)}`;
}

export function ShiftsView({
  canManageClient,
  notify,
}: {
  canManageClient: boolean;
  notify: (message: string, tone?: NoticeTone) => void;
}) {
  const [data, setData] = useState<ShiftResponse | null>(null);
  const [onCall, setOnCall] = useState<OnCallResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [form, setForm] = useState({
    name: "",
    timezone: "America/Santiago",
    startTime: "08:00",
    endTime: "20:00",
    days: [1, 2, 3, 4, 5] as number[],
  });
  const [assignmentForm, setAssignmentForm] = useState({
    shiftId: "",
    userId: "",
    startsAt: "",
    endsAt: "",
    priority: "0",
  });

  useEffect(() => {
    let alive = true;
    void Promise.all([
      requestJson<ShiftResponse>("/api/v1/shifts"),
      requestJson<OnCallResponse>("/api/v1/on-call-assignments"),
    ])
      .then(([shiftResult, onCallResult]) => {
        if (!alive) return;
        setData(shiftResult);
        setOnCall(onCallResult);
        setAssignmentForm((current) => ({
          ...current,
          shiftId: current.shiftId || shiftResult.shifts[0]?.id || "",
          userId: current.userId || onCallResult.users[0]?.id || "",
        }));
      })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "No fue posible consultar turnos y guardias."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reload]);

  const canManage = canManageClient && (data?.canManage ?? true);
  const activeCount = data?.shifts.filter((shift) => shift.active).length ?? 0;
  const scheduleCount = useMemo(() => data?.shifts.reduce((total, shift) => total + shift.schedules.length, 0) ?? 0, [data]);

  const toggleDay = (day: number) => setForm((current) => ({
    ...current,
    days: current.days.includes(day) ? current.days.filter((item) => item !== day) : [...current.days, day],
  }));

  const createShift = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    try {
      await requestJson("/api/v1/shifts", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          timezone: form.timezone,
          schedules: form.days.map((dayOfWeek) => ({
            dayOfWeek,
            startTime: form.startTime,
            endTime: form.endTime,
            validFrom: null,
            validTo: null,
          })),
        }),
      });
      notify("Turno creado para el cliente activo.");
      setForm((current) => ({ ...current, name: "" }));
      setReload((value) => value + 1);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "No fue posible crear el turno.", "warning");
    } finally {
      setSaving(false);
    }
  };

  const createAssignment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    try {
      await requestJson("/api/v1/on-call-assignments", {
        method: "POST",
        body: JSON.stringify({
          shiftId: assignmentForm.shiftId,
          userId: assignmentForm.userId,
          startsAt: new Date(assignmentForm.startsAt).toISOString(),
          endsAt: new Date(assignmentForm.endsAt).toISOString(),
          priority: Number(assignmentForm.priority),
        }),
      });
      notify("Guardia on-call asignada.");
      setAssignmentForm((current) => ({ ...current, startsAt: "", endsAt: "", priority: "0" }));
      setReload((value) => value + 1);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "No fue posible asignar la guardia.", "warning");
    } finally {
      setSaving(false);
    }
  };

  const removeAssignment = async (assignment: OnCallAssignment) => {
    try {
      await requestJson("/api/v1/on-call-assignments", {
        method: "DELETE",
        body: JSON.stringify({ id: assignment.id }),
      });
      notify("Asignación on-call eliminada.");
      setReload((value) => value + 1);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "No fue posible quitar la guardia.", "warning");
    }
  };

  const toggleShift = async (shift: Shift) => {
    try {
      await requestJson("/api/v1/shifts", {
        method: "PATCH",
        body: JSON.stringify({ id: shift.id, active: !shift.active }),
      });
      notify(shift.active ? "Turno desactivado." : "Turno activado.");
      setReload((value) => value + 1);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "No fue posible actualizar el turno.", "warning");
    }
  };

  return <>
    <section className="module-summary-grid">
      <article><span className="module-summary-icon blue"><IconUsersGroup size={19} /></span><div><small>Turnos activos</small><strong>{activeCount}</strong><span>Grupos on-call</span></div></article>
      <article><span className="module-summary-icon amber"><IconClockHour4 size={19} /></span><div><small>Tramos semanales</small><strong>{scheduleCount}</strong><span>Horarios configurados</span></div></article>
    </section>

    <article className="panel module-panel">
      <div className="module-toolbar">
        <div><span className="eyebrow">Operación</span><h2>Turnos on-call</h2><p>Los turnos definen cuándo puede resolverse un grupo on-call y qué persona queda responsable en cada período.</p></div>
        <button className="secondary-button" onClick={() => { setLoading(true); setError(""); setReload((value) => value + 1); }} disabled={loading}><IconRefresh className={loading ? "spin" : ""} size={16} /> Actualizar</button>
      </div>

      {canManage && <form className="hierarchy-create-form" onSubmit={createShift}>
        <div className="hierarchy-form-heading"><span className="eyebrow">Nuevo turno</span><h3>Definir horario semanal</h3></div>
        <label><span>Nombre</span><input required minLength={2} maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ej.: Técnico 24x7 / Turno día" /></label>
        <label><span>Zona horaria</span><input required value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></label>
        <label><span>Inicio</span><input type="time" required value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} /></label>
        <label><span>Término</span><input type="time" required value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} /></label>
        <fieldset className="user-site-access"><legend>Días</legend><div>{DAYS.map((day) => <label key={day.id} className={form.days.includes(day.id) ? "selected" : ""}><input type="checkbox" checked={form.days.includes(day.id)} onChange={() => toggleDay(day.id)} /><span><strong>{day.label}</strong></span></label>)}</div></fieldset>
        <button className="primary-button" type="submit" disabled={saving || !form.name.trim() || !form.days.length || form.startTime === form.endTime}>{saving ? "Guardando…" : "Crear turno"}</button>
      </form>}

      {canManage && <form className="hierarchy-create-form" onSubmit={createAssignment}>
        <div className="hierarchy-form-heading"><span className="eyebrow">Guardia on-call</span><h3>Asignar persona a turno</h3></div>
        <label><span>Turno</span><select required value={assignmentForm.shiftId} onChange={(event) => setAssignmentForm({ ...assignmentForm, shiftId: event.target.value })}>
          <option value="">Seleccionar…</option>
          {(data?.shifts ?? []).filter((shift) => shift.active).map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
        </select></label>
        <label><span>Usuario</span><select required value={assignmentForm.userId} onChange={(event) => setAssignmentForm({ ...assignmentForm, userId: event.target.value })}>
          <option value="">Seleccionar…</option>
          {(onCall?.users ?? []).map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.email}</option>)}
        </select></label>
        <label><span>Desde</span><input type="datetime-local" required value={assignmentForm.startsAt} onChange={(event) => setAssignmentForm({ ...assignmentForm, startsAt: event.target.value })} /></label>
        <label><span>Hasta</span><input type="datetime-local" required value={assignmentForm.endsAt} onChange={(event) => setAssignmentForm({ ...assignmentForm, endsAt: event.target.value })} /></label>
        <label><span>Prioridad</span><input type="number" min="0" max="100" step="1" required value={assignmentForm.priority} onChange={(event) => setAssignmentForm({ ...assignmentForm, priority: event.target.value })} /><small>0 es la prioridad más alta. Si hay respaldo, usa 1, 2, etc.</small></label>
        <button className="primary-button" type="submit" disabled={saving || !assignmentForm.shiftId || !assignmentForm.userId || !assignmentForm.startsAt || !assignmentForm.endsAt}>{saving ? "Guardando…" : "Asignar guardia"}</button>
      </form>}

      <div className="module-table-wrap"><div className="module-table">
        <div className="module-table-head"><span>Turno</span><span>Responsable</span><span>Vigencia</span><span>Prioridad</span><span>Acción</span></div>
        {(onCall?.assignments ?? []).map((assignment) => <div className="module-table-row" key={assignment.id}>
          <span><strong>{assignment.shiftName}</strong></span>
          <span><strong>{assignment.userName}</strong><small>{assignment.userEmail}</small></span>
          <span><strong>{new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(assignment.startsAt))}</strong><small> hasta {new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(assignment.endsAt))}</small></span>
          <span><i className="site-count-chip">{assignment.priority}</i></span>
          <span>{canManage && <button className="ghost-button" onClick={() => void removeAssignment(assignment)}>Quitar</button>}</span>
        </div>)}
        {!onCall?.assignments.length && <div className="table-empty-state"><IconUsersGroup size={21} /><div><strong>Sin guardias asignadas</strong><p>Define quién atiende cada turno y su período de vigencia.</p></div></div>}
      </div></div>

      {error && <div className="data-error"><IconAlertTriangle size={18} /><div><strong>No se pudieron consultar los turnos</strong><p>{error}</p></div></div>}
      {loading && <div className="data-loading"><IconRefresh className="spin" size={18} /> Consultando turnos…</div>}
      {!loading && !error && <div className="module-table-wrap"><div className="module-table">
        <div className="module-table-head"><span>Turno</span><span>Zona horaria</span><span>Horario</span><span>Estado</span><span>Acción</span></div>
        {(data?.shifts ?? []).map((shift) => <div className="module-table-row" key={shift.id}>
          <span><strong>{shift.name}</strong></span>
          <span>{shift.timezone}</span>
          <span>{shift.schedules.length ? shift.schedules.map(scheduleLabel).join(" · ") : "Sin tramos"}</span>
          <span><i className={`status-pill status-${shift.active ? "normal" : "offline"}`}>{shift.active ? "Activo" : "Inactivo"}</i></span>
          <span>{canManage && <button className="ghost-button" onClick={() => void toggleShift(shift)}>{shift.active ? "Desactivar" : "Activar"}</button>}</span>
        </div>)}
        {!data?.shifts.length && <div className="table-empty-state"><IconUsersGroup size={21} /><div><strong>Sin turnos configurados</strong><p>Crea el primer horario on-call del cliente.</p></div></div>}
      </div></div>}
    </article>
  </>;
}
