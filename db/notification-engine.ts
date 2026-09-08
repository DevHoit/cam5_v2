import { createHmac } from "node:crypto";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { Cam5Database } from "./index";
import {
  alarms,
  assets,
  channels,
  notificationDeliveries,
  notificationEndpoints,
  notificationPolicies,
  sites,
} from "./schema";

export type NotificationSeverity = "normal" | "warning" | "critical";
export type NotificationAlarmKind = "threshold" | "communication" | "data_quality";
export type NotificationEventType = "opened" | "escalated" | "reopened_automatically" | "resolved_automatically" | "repeat" | "test" | string;

type PolicyFilters = {
  alarmKinds?: NotificationAlarmKind[];
  assetIds?: string[];
  eventTypes?: string[];
  notifyOnRecovery?: boolean;
};

type EndpointConfiguration = {
  recipients?: string[];
  channel?: string;
  url?: string;
  destination?: string;
};

type DeliveryMessage = {
  subject: string;
  payload: Record<string, unknown>;
};

type EndpointTransport = {
  kind: "email" | "teams" | "webhook";
  configuration: Record<string, unknown>;
  secretReference: string | null;
};

type TransportResult = { providerMessageId: string | null; recipient: string };

const severityRank: Record<NotificationSeverity, number> = { normal: 0, warning: 1, critical: 2 };

function normalizedFilters(value: Record<string, unknown>): PolicyFilters {
  return value as PolicyFilters;
}

function normalizedConfiguration(value: Record<string, unknown>): EndpointConfiguration {
  return value as EndpointConfiguration;
}

function policyMatches(filters: PolicyFilters, event: { kind: NotificationAlarmKind; assetId: string; eventType: string }) {
  if (event.eventType.startsWith("resolved") && !filters.notifyOnRecovery) return false;
  if (filters.alarmKinds?.length && !filters.alarmKinds.includes(event.kind)) return false;
  if (filters.assetIds?.length && !filters.assetIds.includes(event.assetId)) return false;
  if (filters.eventTypes?.length && !filters.eventTypes.includes(event.eventType)) return false;
  return true;
}

function endpointRecipient(kind: EndpointTransport["kind"], configuration: EndpointConfiguration) {
  if (kind === "email") return (configuration.recipients ?? []).join(", ").slice(0, 320) || null;
  return (configuration.destination || configuration.channel || configuration.url || null)?.slice(0, 320) ?? null;
}

function eventLabel(eventType: string) {
  if (eventType === "opened") return "Nueva alarma";
  if (eventType === "escalated") return "Alarma escalada";
  if (eventType === "reopened_automatically") return "Alarma reabierta";
  if (eventType.startsWith("resolved")) return "Condición recuperada";
  if (eventType === "repeat") return "Alarma aún activa";
  return "Notificación de prueba";
}

export async function queueAlarmNotifications(
  db: Cam5Database,
  input: {
    siteId: string;
    alarmId: string;
    alarmEventId?: number | null;
    severity: NotificationSeverity;
    kind: NotificationAlarmKind;
    eventType: NotificationEventType;
    occurredAt?: Date;
  },
) {
  if (input.severity === "normal") return 0;
  const [alarm] = await db.select({
    id: alarms.id,
    code: alarms.code,
    title: alarms.title,
    detail: alarms.detail,
    assetId: alarms.assetId,
    assetCode: assets.code,
    assetName: assets.name,
    channelCode: channels.code,
    channelName: channels.name,
    siteName: sites.name,
    siteTimezone: sites.timezone,
  }).from(alarms)
    .innerJoin(assets, eq(assets.id, alarms.assetId))
    .innerJoin(sites, eq(sites.id, alarms.siteId))
    .leftJoin(channels, eq(channels.id, alarms.channelId))
    .where(and(eq(alarms.id, input.alarmId), eq(alarms.siteId, input.siteId)))
    .limit(1);
  if (!alarm) return 0;

  const policies = await db.select({
    id: notificationPolicies.id,
    endpointId: notificationPolicies.endpointId,
    minimumSeverity: notificationPolicies.minimumSeverity,
    escalationDelayMinutes: notificationPolicies.escalationDelayMinutes,
    filters: notificationPolicies.filters,
    endpointKind: notificationEndpoints.kind,
    endpointConfiguration: notificationEndpoints.configuration,
  }).from(notificationPolicies)
    .innerJoin(notificationEndpoints, eq(notificationEndpoints.id, notificationPolicies.endpointId))
    .where(and(
      eq(notificationPolicies.siteId, input.siteId),
      eq(notificationPolicies.active, true),
      eq(notificationEndpoints.enabled, true),
    ));

  const occurredAt = input.occurredAt ?? new Date();
  const eligible = policies.filter((policy) => (
    severityRank[input.severity] >= severityRank[policy.minimumSeverity]
    && policyMatches(normalizedFilters(policy.filters), { kind: input.kind, assetId: alarm.assetId, eventType: input.eventType })
  ));
  if (!eligible.length) return 0;

  const label = eventLabel(input.eventType);
  const values = eligible.map((policy) => {
    const scheduledAt = new Date(occurredAt.getTime() + policy.escalationDelayMinutes * 60_000);
    const configuration = normalizedConfiguration(policy.endpointConfiguration);
    return {
      endpointId: policy.endpointId,
      policyId: policy.id,
      alarmId: alarm.id,
      alarmEventId: input.alarmEventId ?? null,
      eventType: input.eventType,
      subject: `${label} · ${alarm.code}`,
      payload: {
        eventType: input.eventType,
        severity: input.severity,
        kind: input.kind,
        alarmCode: alarm.code,
        title: alarm.title,
        detail: alarm.detail,
        site: alarm.siteName,
        timezone: alarm.siteTimezone,
        asset: `${alarm.assetCode} · ${alarm.assetName}`,
        channel: alarm.channelCode ? `${alarm.channelCode} · ${alarm.channelName}` : null,
        occurredAt: occurredAt.toISOString(),
        portalUrl: `${process.env.APP_URL || "https://cam5v2.vercel.app"}/?view=alarms&record=${encodeURIComponent(alarm.id)}`,
      },
      recipient: endpointRecipient(policy.endpointKind, configuration),
      scheduledAt,
      nextAttemptAt: scheduledAt,
      dedupeKey: input.alarmEventId
        ? `alarm-event:${input.alarmEventId}:policy:${policy.id}`
        : `${input.eventType}:alarm:${alarm.id}:policy:${policy.id}:${Math.floor(occurredAt.getTime() / 60_000)}`,
    };
  });
  const inserted = await db.insert(notificationDeliveries).values(values).onConflictDoNothing({ target: notificationDeliveries.dedupeKey }).returning({ id: notificationDeliveries.id });
  return inserted.length;
}

export async function queueRepeatingNotifications(db: Cam5Database, now = new Date()) {
  const rows = await db.select({
    alarmId: alarms.id,
    siteId: alarms.siteId,
    assetId: alarms.assetId,
    severity: alarms.severity,
    kind: alarms.kind,
    openedAt: alarms.openedAt,
    policyId: notificationPolicies.id,
    endpointId: notificationPolicies.endpointId,
    intervalMinutes: notificationPolicies.repeatIntervalMinutes,
    minimumSeverity: notificationPolicies.minimumSeverity,
    filters: notificationPolicies.filters,
    endpointKind: notificationEndpoints.kind,
    endpointConfiguration: notificationEndpoints.configuration,
    code: alarms.code,
    title: alarms.title,
    detail: alarms.detail,
    assetCode: assets.code,
    assetName: assets.name,
    siteName: sites.name,
    siteTimezone: sites.timezone,
  }).from(alarms)
    .innerJoin(assets, eq(assets.id, alarms.assetId))
    .innerJoin(sites, eq(sites.id, alarms.siteId))
    .innerJoin(notificationPolicies, eq(notificationPolicies.siteId, alarms.siteId))
    .innerJoin(notificationEndpoints, eq(notificationEndpoints.id, notificationPolicies.endpointId))
    .where(and(
      inArray(alarms.status, ["open", "acknowledged"]),
      eq(notificationPolicies.active, true),
      eq(notificationEndpoints.enabled, true),
      sql`${notificationPolicies.repeatIntervalMinutes} is not null`,
    ));

  const values = rows.flatMap((row) => {
    const interval = row.intervalMinutes;
    if (!interval || now.getTime() < row.openedAt.getTime() + interval * 60_000) return [];
    if (severityRank[row.severity] < severityRank[row.minimumSeverity]) return [];
    if (!policyMatches(normalizedFilters(row.filters), { kind: row.kind as NotificationAlarmKind, assetId: row.assetId, eventType: "repeat" })) return [];
    const bucket = Math.floor((now.getTime() - row.openedAt.getTime()) / (interval * 60_000));
    const configuration = normalizedConfiguration(row.endpointConfiguration);
    return [{
      endpointId: row.endpointId,
      policyId: row.policyId,
      alarmId: row.alarmId,
      eventType: "repeat",
      subject: `Alarma aún activa · ${row.code}`,
      payload: {
        eventType: "repeat",
        severity: row.severity,
        kind: row.kind,
        alarmCode: row.code,
        title: row.title,
        detail: row.detail,
        site: row.siteName,
        timezone: row.siteTimezone,
        asset: `${row.assetCode} · ${row.assetName}`,
        occurredAt: now.toISOString(),
        portalUrl: `${process.env.APP_URL || "https://cam5v2.vercel.app"}/?view=alarms&record=${encodeURIComponent(row.alarmId)}`,
      },
      recipient: endpointRecipient(row.endpointKind, configuration),
      scheduledAt: now,
      nextAttemptAt: now,
      dedupeKey: `repeat:alarm:${row.alarmId}:policy:${row.policyId}:bucket:${bucket}`,
    }];
  });
  if (!values.length) return 0;
  const inserted = await db.insert(notificationDeliveries).values(values).onConflictDoNothing({ target: notificationDeliveries.dedupeKey }).returning({ id: notificationDeliveries.id });
  return inserted.length;
}

function requiredEnvironmentValue(name: string, environment: NodeJS.ProcessEnv) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Falta configurar la variable segura ${name}.`);
  return value;
}

function messageText(message: DeliveryMessage) {
  const payload = message.payload;
  return [
    message.subject,
    String(payload.title || ""),
    String(payload.detail || ""),
    `Sitio: ${String(payload.site || "—")}`,
    `Punto: ${String(payload.asset || "—")}`,
    payload.channel ? `Canal: ${String(payload.channel)}` : "",
    `Severidad: ${String(payload.severity || "—")}`,
    `Fecha: ${String(payload.occurredAt || "—")}`,
    String(payload.portalUrl || ""),
  ].filter(Boolean).join("\n");
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function payloadText(payload: Record<string, unknown>, key: string, fallback = "—") {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function emailDate(payload: Record<string, unknown>) {
  const raw = payloadText(payload, "occurredAt");
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const timezone = payloadText(payload, "timezone", "America/Santiago");
  try {
    return `${new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(date)} · ${timezone}`;
  } catch {
    return date.toISOString();
  }
}

function emailPresentation(payload: Record<string, unknown>) {
  const eventType = payloadText(payload, "eventType", "test");
  if (eventType.startsWith("resolved")) return { label: "Condición recuperada", accent: "#059669", soft: "#ecfdf5", ink: "#065f46" };
  if (eventType === "test") return { label: "Prueba del canal", accent: "#0284c7", soft: "#f0f9ff", ink: "#075985" };
  const severity = payloadText(payload, "severity", "normal");
  if (severity === "critical") return { label: "Alarma crítica", accent: "#dc2626", soft: "#fef2f2", ink: "#991b1b" };
  if (severity === "warning") return { label: "Advertencia", accent: "#d97706", soft: "#fffbeb", ink: "#92400e" };
  return { label: "Evento operacional", accent: "#0284c7", soft: "#f0f9ff", ink: "#075985" };
}

function alarmKindLabel(value: string) {
  if (value === "threshold") return "Umbral de medición";
  if (value === "communication") return "Comunicación";
  if (value === "data_quality") return "Calidad de datos";
  return "Evento del sistema";
}

function safePortalUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function notificationEmailHtml(message: DeliveryMessage) {
  const payload = message.payload;
  const presentation = emailPresentation(payload);
  const title = payloadText(payload, "title", message.subject);
  const detail = payloadText(payload, "detail", "Revisa el evento y confirma su condición en el portal.");
  const code = payloadText(payload, "alarmCode", "EVENTO");
  const site = payloadText(payload, "site");
  const asset = payloadText(payload, "asset");
  const channel = payloadText(payload, "channel", "Evento general del punto");
  const kind = alarmKindLabel(payloadText(payload, "kind"));
  const occurredAt = emailDate(payload);
  const portalUrl = safePortalUrl(payload.portalUrl);
  const preheader = `${presentation.label}: ${title} · ${site}`;

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>${escapeHtml(message.subject)}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-shell { width: 100% !important; }
      .email-pad { padding-left: 22px !important; padding-right: 22px !important; }
      .metric-cell { display: block !important; width: 100% !important; border-right: 0 !important; }
      .metric-cell + .metric-cell { border-top: 1px solid #e4e4e7 !important; }
      .cta { display: block !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;color:#18181b;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f5f7;">
    <tr><td align="center" style="padding:32px 14px;">
      <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(24,24,27,.07);">
        <tr><td class="email-pad" style="padding:22px 30px;background:#0a0b0d;border-bottom:3px solid #0284c7;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td width="48" valign="middle"><div style="width:40px;height:40px;line-height:40px;text-align:center;border-radius:10px;background:#17191c;border:1px solid #34373d;color:#7dd3fc;font-size:13px;font-weight:800;letter-spacing:.04em;">HL</div></td>
            <td valign="middle" style="padding-left:12px;"><div style="color:#fafafa;font-size:19px;font-weight:800;letter-spacing:-.03em;">HoitLive <span style="color:#8b8d94;font-weight:500;">Core</span></div><div style="margin-top:3px;color:#71717a;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Monitoreo de condición eléctrica</div></td>
            <td align="right" valign="middle"><span style="display:inline-block;padding:6px 9px;border:1px solid #34373d;border-radius:7px;color:#a1a1aa;font-size:11px;font-weight:700;">${escapeHtml(code)}</span></td>
          </tr></table>
        </td></tr>
        <tr><td class="email-pad" style="padding:30px 30px 22px;">
          <span style="display:inline-block;padding:7px 11px;border-radius:999px;background:${presentation.soft};color:${presentation.ink};font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;"><span style="color:${presentation.accent};">●</span>&nbsp;&nbsp;${escapeHtml(presentation.label)}</span>
          <h1 style="margin:17px 0 9px;color:#18181b;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-.035em;">${escapeHtml(title)}</h1>
          <p style="margin:0;color:#52525b;font-size:15px;line-height:1.65;">${escapeHtml(detail)}</p>
        </td></tr>
        <tr><td class="email-pad" style="padding:0 30px 24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid #e4e4e7;border-radius:12px;border-collapse:separate;overflow:hidden;">
            <tr>
              <td class="metric-cell" width="50%" valign="top" style="padding:16px 18px;border-right:1px solid #e4e4e7;"><div style="color:#71717a;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;">Sitio</div><div style="margin-top:5px;color:#27272a;font-size:14px;font-weight:700;line-height:1.4;">${escapeHtml(site)}</div></td>
              <td class="metric-cell" width="50%" valign="top" style="padding:16px 18px;"><div style="color:#71717a;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;">Punto de medición</div><div style="margin-top:5px;color:#27272a;font-size:14px;font-weight:700;line-height:1.4;">${escapeHtml(asset)}</div></td>
            </tr>
            <tr>
              <td class="metric-cell" width="50%" valign="top" style="padding:16px 18px;border-top:1px solid #e4e4e7;border-right:1px solid #e4e4e7;"><div style="color:#71717a;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;">Canal</div><div style="margin-top:5px;color:#27272a;font-size:14px;font-weight:700;line-height:1.4;">${escapeHtml(channel)}</div></td>
              <td class="metric-cell" width="50%" valign="top" style="padding:16px 18px;border-top:1px solid #e4e4e7;"><div style="color:#71717a;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;">Tipo de evento</div><div style="margin-top:5px;color:#27272a;font-size:14px;font-weight:700;line-height:1.4;">${escapeHtml(kind)}</div></td>
            </tr>
          </table>
        </td></tr>
        <tr><td class="email-pad" style="padding:0 30px 28px;">
          <div style="padding:13px 15px;border-left:3px solid ${presentation.accent};background:#fafafa;color:#52525b;font-size:13px;line-height:1.5;"><strong style="color:#27272a;">Registrado:</strong> ${escapeHtml(occurredAt)}</div>
          ${portalUrl ? `<div style="padding-top:22px;"><a class="cta" href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:13px 19px;border-radius:9px;background:#0284c7;color:#ffffff;text-decoration:none;font-size:14px;font-weight:750;">Ver evento en HoitLive Core&nbsp;&nbsp;→</a></div>` : ""}
        </td></tr>
        <tr><td class="email-pad" style="padding:18px 30px;background:#fafafa;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px;line-height:1.55;">Notificación automática de HoitLive Core. La información operacional y la trazabilidad del evento se mantienen en el portal.</td></tr>
      </table>
      <div style="padding:16px 10px 0;color:#a1a1aa;font-size:11px;line-height:1.5;">HoitLive Core · Supervisión de activos críticos</div>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendNotification(
  endpoint: EndpointTransport,
  message: DeliveryMessage,
  options: { fetchImpl?: typeof fetch; environment?: NodeJS.ProcessEnv } = {},
): Promise<TransportResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const environment = options.environment ?? process.env;
  const configuration = normalizedConfiguration(endpoint.configuration);
  const text = messageText(message);

  if (endpoint.kind === "email") {
    const recipients = configuration.recipients?.filter((recipient) => recipient.trim()) ?? [];
    if (!recipients.length) throw new Error("El canal de correo no tiene destinatarios.");
    const apiKey = requiredEnvironmentValue("RESEND_API_KEY", environment);
    const from = requiredEnvironmentValue("NOTIFICATION_FROM_EMAIL", environment);
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: recipients, subject: message.subject, text, html: notificationEmailHtml(message) }),
    });
    const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok) throw new Error(result.message || `El proveedor de correo respondió ${response.status}.`);
    return { providerMessageId: result.id ?? null, recipient: recipients.join(", ").slice(0, 320) };
  }

  if (endpoint.kind === "teams") {
    if (!endpoint.secretReference) throw new Error("El canal de Teams no tiene una referencia segura al webhook.");
    const url = requiredEnvironmentValue(endpoint.secretReference, environment);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard", version: "1.4", body: [{ type: "TextBlock", weight: "Bolder", text: message.subject }, { type: "TextBlock", wrap: true, text }] } }] }),
    });
    if (!response.ok) throw new Error(`Microsoft Teams respondió ${response.status}.`);
    return { providerMessageId: response.headers.get("request-id"), recipient: configuration.channel || configuration.destination || "Microsoft Teams" };
  }

  const url = configuration.url?.trim();
  if (!url) throw new Error("El webhook no tiene una URL configurada.");
  const body = JSON.stringify({ subject: message.subject, ...message.payload });
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "HoitLive-Core-Notifications/1.0" };
  if (endpoint.secretReference) {
    const secret = requiredEnvironmentValue(endpoint.secretReference, environment);
    headers["X-HoitLive-Signature"] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  }
  const response = await fetchImpl(url, { method: "POST", headers, body });
  if (!response.ok) throw new Error(`El webhook respondió ${response.status}.`);
  return { providerMessageId: response.headers.get("x-request-id"), recipient: configuration.destination || url };
}

export function retryDelayMinutes(attempt: number) {
  return Math.min(60, 5 * 2 ** Math.max(0, attempt - 1));
}

export async function processNotificationDelivery(
  db: Cam5Database,
  deliveryId: number,
  options: { now?: Date; fetchImpl?: typeof fetch; environment?: NodeJS.ProcessEnv } = {},
) {
  const now = options.now ?? new Date();
  const [candidate] = await db.select({
    id: notificationDeliveries.id,
    subject: notificationDeliveries.subject,
    payload: notificationDeliveries.payload,
    attemptCount: notificationDeliveries.attemptCount,
    maxAttempts: notificationDeliveries.maxAttempts,
    kind: notificationEndpoints.kind,
    configuration: notificationEndpoints.configuration,
    secretReference: notificationEndpoints.secretReference,
  }).from(notificationDeliveries)
    .innerJoin(notificationEndpoints, eq(notificationEndpoints.id, notificationDeliveries.endpointId))
    .where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationEndpoints.enabled, true)))
    .limit(1);
  if (!candidate) return { status: "missing" as const, error: "La entrega o su canal ya no están disponibles." };
  const [claimed] = await db.update(notificationDeliveries).set({ status: "sending", lastAttemptAt: now, updatedAt: now })
    .where(and(eq(notificationDeliveries.id, candidate.id), or(eq(notificationDeliveries.status, "queued"), eq(notificationDeliveries.status, "failed"))))
    .returning({ id: notificationDeliveries.id });
  if (!claimed) return { status: "skipped" as const, error: "La entrega ya está siendo procesada o finalizó." };
  const nextAttempt = candidate.attemptCount + 1;
  try {
    const result = await sendNotification({ kind: candidate.kind, configuration: candidate.configuration, secretReference: candidate.secretReference }, { subject: candidate.subject, payload: candidate.payload }, options);
    await db.update(notificationDeliveries).set({ status: "delivered", attemptCount: nextAttempt, providerMessageId: result.providerMessageId, recipient: result.recipient.slice(0, 320), errorMessage: null, sentAt: now, updatedAt: now }).where(eq(notificationDeliveries.id, candidate.id));
    return { status: "delivered" as const, error: null };
  } catch (error) {
    const exhausted = nextAttempt >= candidate.maxAttempts;
    const nextAttemptAt = exhausted ? now : new Date(now.getTime() + retryDelayMinutes(nextAttempt) * 60_000);
    const message = error instanceof Error ? error.message.slice(0, 2000) : "Error de entrega desconocido.";
    await db.update(notificationDeliveries).set({ status: "failed", attemptCount: nextAttempt, errorMessage: message, nextAttemptAt, updatedAt: now }).where(eq(notificationDeliveries.id, candidate.id));
    return { status: "failed" as const, error: message };
  }
}

export async function processNotificationQueue(
  db: Cam5Database,
  options: { now?: Date; limit?: number; fetchImpl?: typeof fetch; environment?: NodeJS.ProcessEnv; includeRepeats?: boolean } = {},
) {
  const now = options.now ?? new Date();
  const staleSendingBefore = new Date(now.getTime() - 10 * 60_000);
  const recoveredRows = await db.update(notificationDeliveries).set({ status: "failed", errorMessage: "El proceso anterior se interrumpió; la entrega volvió a la cola.", nextAttemptAt: now, updatedAt: now })
    .where(and(eq(notificationDeliveries.status, "sending"), or(lte(notificationDeliveries.lastAttemptAt, staleSendingBefore), sql`${notificationDeliveries.lastAttemptAt} is null`)))
    .returning({ id: notificationDeliveries.id });
  const repeated = options.includeRepeats === false ? 0 : await queueRepeatingNotifications(db, now);
  const candidates = await db.select({
    id: notificationDeliveries.id,
    endpointId: notificationDeliveries.endpointId,
    subject: notificationDeliveries.subject,
    payload: notificationDeliveries.payload,
    attemptCount: notificationDeliveries.attemptCount,
    maxAttempts: notificationDeliveries.maxAttempts,
    kind: notificationEndpoints.kind,
    configuration: notificationEndpoints.configuration,
    secretReference: notificationEndpoints.secretReference,
  }).from(notificationDeliveries)
    .innerJoin(notificationEndpoints, eq(notificationEndpoints.id, notificationDeliveries.endpointId))
    .where(and(
      inArray(notificationDeliveries.status, ["queued", "failed"]),
      lte(notificationDeliveries.scheduledAt, now),
      lte(notificationDeliveries.nextAttemptAt, now),
      sql`${notificationDeliveries.attemptCount} < ${notificationDeliveries.maxAttempts}`,
      eq(notificationEndpoints.enabled, true),
    ))
    .orderBy(notificationDeliveries.nextAttemptAt)
    .limit(Math.min(100, Math.max(1, options.limit ?? 25)));

  let delivered = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const result = await processNotificationDelivery(db, candidate.id, { ...options, now });
    if (result.status === "delivered") delivered += 1;
    if (result.status === "failed") failed += 1;
  }
  return { recovered: recoveredRows.length, repeated, processed: candidates.length, delivered, failed };
}
