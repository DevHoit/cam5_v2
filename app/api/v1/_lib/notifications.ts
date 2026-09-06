import { ApiError } from "./auth";

export const NOTIFICATION_KINDS = ["email", "teams", "webhook"] as const;
export const NOTIFICATION_SEVERITIES = ["warning", "critical"] as const;
export const NOTIFICATION_ALARM_KINDS = ["threshold", "communication", "data_quality"] as const;

type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

function requiredText(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string" || value.trim().length < 2 || value.trim().length > maximum) throw new ApiError(400, `${label} no es válido.`);
  return value.trim();
}

function optionalSecretReference(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{2,127}$/.test(value.trim())) throw new ApiError(400, "La referencia secreta debe ser el nombre de una variable de entorno en mayúsculas.");
  return value.trim();
}

function httpsUrl(value: unknown, label: string) {
  if (typeof value !== "string") throw new ApiError(400, `${label} no es válida.`);
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new ApiError(400, `${label} debe ser una URL HTTPS válida.`);
  }
}

export function parseEndpointBody(body: Record<string, unknown>, current?: { kind: NotificationKind; configuration: Record<string, unknown>; secretReference: string | null; name: string; enabled: boolean }) {
  const kindValue = body.kind ?? current?.kind;
  if (!NOTIFICATION_KINDS.includes(kindValue as NotificationKind)) throw new ApiError(400, "El tipo de canal no es válido.");
  const kind = kindValue as NotificationKind;
  const name = requiredText(body.name ?? current?.name, "El nombre del canal", 160);
  const enabled = typeof body.enabled === "boolean" ? body.enabled : current?.enabled ?? true;
  const submitted = body.configuration && typeof body.configuration === "object" && !Array.isArray(body.configuration)
    ? body.configuration as Record<string, unknown>
    : current?.configuration ?? {};
  const secretReference = optionalSecretReference(body.secretReference === undefined ? current?.secretReference : body.secretReference);

  if (kind === "email") {
    const recipients = Array.isArray(submitted.recipients) ? submitted.recipients : [];
    if (!recipients.length || recipients.length > 20) throw new ApiError(400, "Configura entre 1 y 20 destinatarios de correo.");
    const normalized = [...new Set(recipients.map((recipient) => String(recipient).trim().toLowerCase()))];
    if (normalized.some((recipient) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))) throw new ApiError(400, "Hay una dirección de correo no válida.");
    return { name, kind, enabled, configuration: { recipients: normalized }, secretReference: null };
  }

  if (kind === "teams") {
    const channel = requiredText(submitted.channel, "El nombre del canal de Teams", 160);
    if (!secretReference) throw new ApiError(400, "Teams requiere la variable de entorno que contiene su webhook.");
    return { name, kind, enabled, configuration: { channel }, secretReference };
  }

  const url = httpsUrl(submitted.url, "La URL del webhook");
  const destination = typeof submitted.destination === "string" && submitted.destination.trim() ? submitted.destination.trim().slice(0, 160) : new URL(url).hostname;
  return { name, kind, enabled, configuration: { url, destination }, secretReference };
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new ApiError(400, `${label} no es válido.`);
  return parsed;
}

export function parsePolicyBody(body: Record<string, unknown>, current?: { name: string; endpointId: string; minimumSeverity: "normal" | "warning" | "critical"; escalationDelayMinutes: number; repeatIntervalMinutes: number | null; active: boolean; filters: Record<string, unknown> }) {
  const name = requiredText(body.name ?? current?.name, "El nombre de la regla", 160);
  const endpointId = typeof (body.endpointId ?? current?.endpointId) === "string" ? String(body.endpointId ?? current?.endpointId) : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(endpointId)) throw new ApiError(400, "Selecciona un canal válido.");
  const severityValue = body.minimumSeverity ?? current?.minimumSeverity;
  if (!NOTIFICATION_SEVERITIES.includes(severityValue as (typeof NOTIFICATION_SEVERITIES)[number])) throw new ApiError(400, "La severidad mínima no es válida.");
  const minimumSeverity = severityValue as "warning" | "critical";
  const escalationDelayMinutes = integer(body.escalationDelayMinutes ?? current?.escalationDelayMinutes ?? 0, "La espera", 0, 1_440);
  const repeatValue = body.repeatIntervalMinutes === undefined ? current?.repeatIntervalMinutes : body.repeatIntervalMinutes;
  const repeatIntervalMinutes = repeatValue === null || repeatValue === "" || repeatValue === undefined ? null : integer(repeatValue, "El intervalo de repetición", 5, 10_080);
  const active = typeof body.active === "boolean" ? body.active : current?.active ?? true;
  const submittedFilters = body.filters && typeof body.filters === "object" && !Array.isArray(body.filters) ? body.filters as Record<string, unknown> : current?.filters ?? {};
  const alarmKinds = Array.isArray(submittedFilters.alarmKinds)
    ? [...new Set(submittedFilters.alarmKinds.map(String))].filter((kind) => NOTIFICATION_ALARM_KINDS.includes(kind as (typeof NOTIFICATION_ALARM_KINDS)[number]))
    : [];
  const notifyOnRecovery = submittedFilters.notifyOnRecovery === true;
  return { name, endpointId, minimumSeverity, escalationDelayMinutes, repeatIntervalMinutes, active, filters: { alarmKinds, notifyOnRecovery } };
}
