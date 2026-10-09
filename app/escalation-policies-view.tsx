"use client";

import { useEffect, useState } from "react";
import {
  IconAlertTriangle,
  IconBellRinging,
  IconCheck,
  IconPlus,
  IconRefresh,
  IconShieldCheck,
  IconTrash,
} from "@tabler/icons-react";

type NoticeTone = "success" | "info" | "warning";

type RecipientType = "user" | "role" | "on_call_group";
type Level = {
  id?: string;
  levelNumber: number;
  delaySeconds: number;
  recipientType: RecipientType;
  recipientRef: string;
  channels: string[];
  repeatCount: number;
};

type Policy = {
  id: string;
  name: string;
  enabled: boolean;
  attachedRules: number;
  levels: Level[];
  createdAt: string;
  updatedAt: string;
};

type EscalationResponse = {
  clientId: string;
  canManage: boolean;
  policies: Policy[];
  options: {
    users: Array<{ id: string; displayName: string; email: string; phoneE164: string | null }>;
    roles: Array<{ key: string; name: string }>;
    shifts: Array<{ id: string; name: string; active: boolean }>;
  };
};

type LevelDraft = {
  levelNumber: number;
  delayMinutes: string;
  recipientType: RecipientType;
  recipientRef: string;
  email: boolean;
  whatsapp: boolean;
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

function blankLevel(levelNumber = 1): LevelDraft {
  return {
    levelNumber,
    delayMinutes: levelNumber === 1 ? "0" : String((levelNumber - 1) * 5),
    recipientType: "on_call_group",
    recipientRef: "",
    email: true,
    whatsapp: false,
  };
}

function recipientTypeLabel(type: RecipientType) {
  if (type === "on_call_group") return "Turno on-call";
  if (type === "user") return "Usuario";
  return "Rol";
}

function levelSummary(level: Level) {
  const delay = Math.round(level.delaySeconds / 60);
  return `Nivel ${level.levelNumber} · ${delay === 0 ? "inmediato" : `${delay} min`} · ${recipientTypeLabel(level.recipientType)}`;
}

export function EscalationPoliciesView({
  canWrite,
  notify,
}: {
  canWrite: boolean;
  notify: (message: string, tone?: NoticeTone) => void;
}) {
  const [data, setData] = useState<EscalationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [levels, setLevels] = useState<LevelDraft[]>([blankLevel()]);

  useEffect(() => {
    let alive = true;
    void requestJson<EscalationResponse>("/api/v1/escalation-policies")
      .then((result) => { if (alive) setData(result); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : "No fue posible consultar las políticas."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reload]);

  const canManage = canWrite && (data?.canManage ?? false);

  const openCreate = () => {
    setEditingId(null);
    setName("");
    const first = blankLevel();
    const defaultShift = data?.options.shifts.find((shift) => shift.active)?.id ?? "";
    setLevels([{ ...first, recipientRef: defaultShift }]);
    setShowForm(true);
  };

  const openEdit = (policy: Policy) => {
    setEditingId(policy.id);
    setName(policy.name);
    setLevels(policy.levels.map((level) => ({
      levelNumber: level.levelNumber,
      delayMinutes: String(Math.round(level.delaySeconds / 60)),
      recipientType: level.recipientType,
      recipientRef: level.recipientRef,
      email: level.channels.includes("email"),
      whatsapp: level.channels.includes("whatsapp") || level.channels.includes("whatsapp_meta"),
    })));
    setShowForm(true);
  };

  const recipientOptions = (draft: LevelDraft) => {
    if (!data) return [];
    if (draft.recipientType === "user") return data.options.users.map((item) => ({ value: item.id, label: `${item.displayName} · ${item.email}` }));
    if (draft.recipientType === "role") return data.options.roles.map((item) => ({ value: item.key, label: item.name }));
    return data.options.shifts.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name }));
  };

  const updateLevel = (index: number, patch: Partial<LevelDraft>) => {
    setLevels((current) => current.map((level, levelIndex) => {
      if (levelIndex !== index) return level;
      const next = { ...level, ...patch };
      if (patch.recipientType) {
        const options = patch.recipientType === "user"
          ? data?.options.users.map((item) => item.id) ?? []
          : patch.recipientType === "role"
            ? data?.options.roles.map((item) => item.key) ?? []
            : data?.options.shifts.filter((item) => item.active).map((item) => item.id) ?? [];
        next.recipientRef = options[0] ?? "";
      }
      return next;
    }));
  };

  const addLevel = () => setLevels((current) => [...current, blankLevel(current.length + 1)]);
  const removeLevel = (index: number) => setLevels((current) => current.filter((_, levelIndex) => levelIndex !== index).map((level, levelIndex) => ({ ...level, levelNumber: levelIndex + 1 })));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    try {
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        name,
        levels: levels.map((level) => ({
          levelNumber: level.levelNumber,
          delaySeconds: Math.max(0, Number(level.delayMinutes) || 0) * 60,
          recipientType: level.recipientType,
          recipientRef: level.recipientRef,
          channels: [level.email ? "email" : "", level.whatsapp ? "whatsapp" : ""].filter(Boolean),
          repeatCount: 1,
        })),
      };
      await requestJson("/api/v1/escalation-policies", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      notify(editingId ? "Política de escalamiento actualizada." : "Política de escalamiento creada.");
      setShowForm(false);
      setReload((value) => value + 1);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "No fue posible guardar la política.", "warning");
    } finally {
      setSaving(false);
    }
  };

  const togglePolicy = async (policy: Policy) => {
    try {
      await requestJson("/api/v1/escalation-policies", {
        method: "PATCH",
        body: JSON.stringify({ id: policy.id, enabled: !policy.enabled }),
      });
      notify(policy.enabled ? "Política detenida." : "Política habilitada.");
      setReload((value) => value + 1);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "No fue posible cambiar la política.", "warning");
    }
  };

  return <div className="escalation-v6 escalation-workspace-v6" aria-label="Políticas de escalamiento">
    <section className="module-summary-grid">
      <article><span className="module-summary-icon blue"><IconBellRinging size={19} /></span><div><small>Políticas</small><strong>{data?.policies.length ?? 0}</strong><span>{data?.policies.filter((item) => item.enabled).length ?? 0} activas</span></div></article>
      <article><span className="module-summary-icon green"><IconShieldCheck size={19} /></span><div><small>Niveles configurados</small><strong>{data?.policies.reduce((total, item) => total + item.levels.length, 0) ?? 0}</strong><span>Secuencias de atención</span></div></article>
    </section>

    <article className="panel module-panel">
      <div className="module-toolbar">
        <div><h2>Políticas de escalamiento</h2><p>Define quién debe recibir una alerta y cuándo debe pasar al siguiente responsable si continúa sin reconocimiento.</p></div>
        <div className="configuration-actions">
          <button className="secondary-button" onClick={() => { setLoading(true); setError(""); setReload((value) => value + 1); }} disabled={loading}><IconRefresh className={loading ? "spin" : ""} size={16} /> Actualizar</button>
          {canManage && <button className="primary-button" onClick={openCreate}><IconPlus size={16} /> Nueva política</button>}
        </div>
      </div>

      {showForm && (
        <form className="ops-form-card escalation-form-v6" onSubmit={submit}>
          <div className="ops-form-card__header escalation-form-head-v6">
            <div>
              <h3>{editingId ? "Editar política de escalamiento" : "Nueva política de escalamiento"}</h3>
              <p>Configura la secuencia de atención desde el primer aviso hasta los responsables de respaldo.</p>
            </div>
            <button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button>
          </div>

          <div className="ops-form-card__body">
            <section className="ops-form-section">
              <div className="ops-form-section__title">
                <h4>Identificación</h4>
                <p>Usa un nombre que permita reconocer fácilmente cuándo debe utilizarse esta política.</p>
              </div>
              <div className="ops-form-grid">
                <label className="ops-field ops-field--full">
                  <span>Nombre de la política</span>
                  <input required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej.: Alarmas críticas 24x7" />
                </label>
              </div>
            </section>

            <section className="ops-form-section">
              <div className="ops-form-section__title escalation-levels-title-v6">
                <div>
                  <h4>Secuencia de escalamiento</h4>
                  <p>El nivel 1 se notifica primero. Los niveles siguientes se activan si la alarma sigue sin reconocimiento.</p>
                </div>
                <button type="button" className="secondary-button" onClick={addLevel} disabled={levels.length >= 10}><IconPlus size={15} /> Agregar nivel</button>
              </div>

              <div className="escalation-level-list-v6">
                {levels.map((level, index) => (
                  <article className="escalation-level-card-v6" key={level.levelNumber}>
                    <header>
                      <div className="escalation-level-number-v6">{level.levelNumber}</div>
                      <div><strong>Nivel {level.levelNumber}</strong><small>{Number(level.delayMinutes) === 0 ? "Notificación inmediata" : `Escala después de ${level.delayMinutes || "0"} minutos`}</small></div>
                      {levels.length > 1 && <button type="button" className="icon-danger-button" onClick={() => removeLevel(index)} aria-label={`Quitar nivel ${level.levelNumber}`}><IconTrash size={15} /></button>}
                    </header>

                    <div className="escalation-level-fields-v6">
                      <label className="ops-field">
                        <span>Espera antes de escalar</span>
                        <div className="escalation-delay-field-v6"><input type="number" min="0" max="10080" step="1" value={level.delayMinutes} onChange={(event) => updateLevel(index, { delayMinutes: event.target.value })} /><span>min</span></div>
                      </label>

                      <label className="ops-field">
                        <span>Tipo de destinatario</span>
                        <select value={level.recipientType} onChange={(event) => updateLevel(index, { recipientType: event.target.value as RecipientType })}>
                          <option value="on_call_group">Turno on-call</option>
                          <option value="user">Usuario</option>
                          <option value="role">Rol</option>
                        </select>
                      </label>

                      <label className="ops-field escalation-recipient-v6">
                        <span>Destinatario</span>
                        <select required value={level.recipientRef} onChange={(event) => updateLevel(index, { recipientRef: event.target.value })}>
                          <option value="">Seleccionar…</option>
                          {recipientOptions(level).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>

                      <fieldset className="escalation-channels-v6">
                        <legend>Canales</legend>
                        <label className={level.email ? "selected" : ""}><input type="checkbox" checked={level.email} onChange={(event) => updateLevel(index, { email: event.target.checked })} /><span>Email</span></label>
                        <label className={level.whatsapp ? "selected" : ""}><input type="checkbox" checked={level.whatsapp} onChange={(event) => updateLevel(index, { whatsapp: event.target.checked })} /><span>WhatsApp</span></label>
                      </fieldset>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <div className="ops-inline-note">
              <strong>La política sólo avanza mientras la alarma siga sin reconocimiento.</strong>
              <span>Al reconocer la alarma se detiene la secuencia pendiente. Cada nivel debe tener al menos un canal activo.</span>
            </div>
          </div>

          <div className="ops-form-card__footer">
            <button type="submit" className="primary-button" disabled={saving || !name.trim() || levels.some((level) => !level.recipientRef || (!level.email && !level.whatsapp))}>
              <IconCheck size={16} /> {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear política"}
            </button>
          </div>
        </form>
      )}

      {error && <div className="data-error"><IconAlertTriangle size={18} /><div><strong>No se pudieron cargar las políticas</strong><p>{error}</p></div></div>}
      {loading && <div className="data-loading"><IconRefresh className="spin" size={18} /> Consultando escalamiento…</div>}
      {!loading && !error && !showForm && <div className="module-table-wrap"><div className="module-table">
        <div className="module-table-head"><span>Política</span><span>Estado</span><span>Niveles</span><span>Reglas vinculadas</span><span>Secuencia</span><span>Acciones</span></div>
        {(data?.policies ?? []).map((policy) => <div className="module-table-row" key={policy.id}>
          <span><strong>{policy.name}</strong></span>
          <span><i className={`status-pill status-${policy.enabled ? "normal" : "offline"}`}>{policy.enabled ? "Activa" : "Inactiva"}</i></span>
          <span>{policy.levels.length}</span>
          <span>{policy.attachedRules}</span>
          <span className="escalation-sequence-v6">{policy.levels.map((level) => levelSummary(level)).join(" → ")}</span>
          <span className="row-actions">{canManage && <><button className="ghost-button" onClick={() => openEdit(policy)}>Editar</button><button className="ghost-button" onClick={() => void togglePolicy(policy)}>{policy.enabled ? "Desactivar" : "Activar"}</button></>}</span>
        </div>)}
        {!data?.policies.length && <div className="table-empty-state"><IconBellRinging size={21} /><div><strong>Sin políticas de escalamiento</strong><p>Crea una secuencia para definir quién recibe las alertas y cuándo deben escalarse.</p></div></div>}
      </div></div>}
    </article>
  </div>;
}
