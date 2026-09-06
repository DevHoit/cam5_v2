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
      body: JSON.stringify({ from, to: recipients, subject: message.subject, text }),
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
