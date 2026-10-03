import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { resolveUserAccessScopes } from "./access-scope";
import { PORTAL_ROLES, type PortalRoleKey } from "./access-control";
import {
  alarmEvents,
  alarmTransitions,
  alarms,
  auditLogs,
  escalationJobs,
  notificationDeliveries,
  notificationProviderEvents,
  userAssetScopes,
  users,
} from "./schema";

type MetaStatus = "sent" | "delivered" | "read" | "failed";

type MetaWebhookValue = {
  statuses?: Array<{
    id?: string;
    status?: string;
    timestamp?: string;
    recipient_id?: string;
    errors?: Array<{ code?: number; title?: string; message?: string }>;
  }>;
  messages?: Array<{
    id?: string;
    from?: string;
    timestamp?: string;
    type?: string;
    context?: { id?: string };
    button?: { payload?: string; text?: string };
    interactive?: {
      type?: string;
      button_reply?: { id?: string; title?: string };
    };
  }>;
};

type MetaWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: MetaWebhookValue }>;
  }>;
};

function e164(value: string | undefined | null) {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}

function safeEqualHex(actual: string, expected: string) {
  try {
    const a = Buffer.from(actual, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyMetaWebhookSignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqualHex(signature.slice(7), expected);
}

function roleCanAcknowledge(roleKey: PortalRoleKey) {
  return Boolean(PORTAL_ROLES.find((role) => role.key === roleKey)?.permissions.includes("alarms.acknowledge"));
}

async function userCanAcknowledgeAlarm(
  db: Cam5Database,
  userId: string,
  alarm: { siteId: string; assetId: string },
  now: Date,
) {
  const scopes = await resolveUserAccessScopes(db, userId, now);
  const siteScope = scopes.sites.find((site) => site.siteId === alarm.siteId);
  if (!siteScope || !roleCanAcknowledge(siteScope.roleKey)) return false;

  const assetScopes = await db.select({ assetId: userAssetScopes.assetId })
    .from(userAssetScopes)
    .where(eq(userAssetScopes.userId, userId));
  return !assetScopes.length || assetScopes.some((scope) => scope.assetId === alarm.assetId);
}

function statusRank(status: string) {
  if (status === "queued") return 0;
  if (status === "sending") return 1;
  if (status === "sent") return 2;
  if (status === "delivered") return 3;
  if (status === "read") return 4;
  return -1;
}

async function persistProviderEvent(
  db: Cam5Database,
  input: {
    eventKey: string;
    eventType: string;
    providerMessageId?: string | null;
    phoneE164?: string | null;
    payload: Record<string, unknown>;
  },
) {
  const [created] = await db.insert(notificationProviderEvents).values({
    provider: "meta_whatsapp_cloud",
    eventKey: input.eventKey,
    eventType: input.eventType,
    providerMessageId: input.providerMessageId ?? null,
    phoneE164: input.phoneE164 ?? null,
    payload: input.payload,
  }).onConflictDoNothing({
    target: [notificationProviderEvents.provider, notificationProviderEvents.eventKey],
  }).returning();
  return created ?? null;
}

async function markProviderEvent(
  db: Cam5Database,
  id: number,
  outcome: string,
  now: Date,
  errorMessage: string | null = null,
) {
  await db.update(notificationProviderEvents).set({
    outcome,
    errorMessage,
    processedAt: now,
  }).where(eq(notificationProviderEvents.id, id));
}

async function processStatus(
  db: Cam5Database,
  status: NonNullable<MetaWebhookValue["statuses"]>[number],
  now: Date,
) {
  const messageId = status.id?.trim();
  const state = status.status as MetaStatus | undefined;
  if (!messageId || !state || !["sent", "delivered", "read", "failed"].includes(state)) {
    return { processed: 0, duplicate: 0, rejected: 1 };
  }
  const eventKey = `status:${messageId}:${state}:${status.timestamp ?? ""}`;
  const event = await persistProviderEvent(db, {
    eventKey,
    eventType: `status.${state}`,
    providerMessageId: messageId,
    phoneE164: e164(status.recipient_id),
    payload: status as unknown as Record<string, unknown>,
  });
  if (!event) return { processed: 0, duplicate: 1, rejected: 0 };

  const [delivery] = await db.select().from(notificationDeliveries).where(and(
    eq(notificationDeliveries.provider, "meta_whatsapp_cloud"),
    eq(notificationDeliveries.providerMessageId, messageId),
  )).limit(1);
  if (!delivery) {
    await markProviderEvent(db, event.id, "unmatched", now, "No existe una notificación correlacionada.");
    return { processed: 0, duplicate: 0, rejected: 1 };
  }

  if (state === "failed") {
    const firstError = status.errors?.[0];
    await db.update(notificationDeliveries).set({
      status: "failed",
      failedAt: now,
      errorCode: firstError?.code ? String(firstError.code) : null,
      errorMessage: firstError?.message || firstError?.title || "Meta informó falla de entrega.",
      updatedAt: now,
    }).where(eq(notificationDeliveries.id, delivery.id));
  } else if (statusRank(state) >= statusRank(delivery.status)) {
    await db.update(notificationDeliveries).set({
      status: state,
      sentAt: delivery.sentAt ?? (state === "sent" ? now : delivery.sentAt),
      deliveredAt: state === "delivered" || state === "read" ? delivery.deliveredAt ?? now : delivery.deliveredAt,
      readAt: state === "read" ? delivery.readAt ?? now : delivery.readAt,
      errorCode: null,
      errorMessage: null,
      updatedAt: now,
    }).where(eq(notificationDeliveries.id, delivery.id));
  }

  await markProviderEvent(db, event.id, "processed", now);
  return { processed: 1, duplicate: 0, rejected: 0 };
}

function quickReplyValue(message: NonNullable<MetaWebhookValue["messages"]>[number]) {
  if (message.type === "button") return message.button?.payload || message.button?.text || "";
  if (message.type === "interactive" && message.interactive?.type === "button_reply") {
    return message.interactive.button_reply.id || message.interactive.button_reply.title || "";
  }
  return "";
}

async function processAckMessage(
  db: Cam5Database,
  message: NonNullable<MetaWebhookValue["messages"]>[number],
  now: Date,
) {
  const messageId = message.id?.trim();
  const phone = e164(message.from);
  const reply = quickReplyValue(message).trim().toUpperCase();
  const contextMessageId = message.context?.id?.trim();

  if (!messageId || !phone || reply !== "ACK" || !contextMessageId) {
    return { processed: 0, duplicate: 0, rejected: 1 };
  }

  const event = await persistProviderEvent(db, {
    eventKey: `message:${messageId}`,
    eventType: "message.ack",
    providerMessageId: messageId,
    phoneE164: phone,
    payload: message as unknown as Record<string, unknown>,
  });
  if (!event) return { processed: 0, duplicate: 1, rejected: 0 };

  const [delivery] = await db.select({
    id: notificationDeliveries.id,
    alarmId: notificationDeliveries.alarmId,
    recipientUserId: notificationDeliveries.recipientUserId,
    recipient: notificationDeliveries.recipient,
  }).from(notificationDeliveries).where(and(
    eq(notificationDeliveries.provider, "meta_whatsapp_cloud"),
    eq(notificationDeliveries.providerMessageId, contextMessageId),
  )).limit(1);

  if (!delivery?.alarmId || !delivery.recipientUserId || delivery.recipient !== phone) {
    await markProviderEvent(db, event.id, "rejected", now, "ACK sin correlación válida con destinatario y alarma.");
    return { processed: 0, duplicate: 0, rejected: 1 };
  }

  const [[user], [alarm]] = await Promise.all([
    db.select({ id: users.id, phoneE164: users.phoneE164, status: users.status })
      .from(users).where(eq(users.id, delivery.recipientUserId)).limit(1),
    db.select({
      id: alarms.id,
      siteId: alarms.siteId,
      assetId: alarms.assetId,
      status: alarms.status,
      acknowledgedAt: alarms.acknowledgedAt,
      acknowledgedBy: alarms.acknowledgedBy,
    }).from(alarms).where(eq(alarms.id, delivery.alarmId)).limit(1),
  ]);

  if (!user || user.status !== "active" || user.phoneE164 !== phone || !alarm) {
    await markProviderEvent(db, event.id, "rejected", now, "El teléfono no pertenece a un usuario activo correlacionado.");
    return { processed: 0, duplicate: 0, rejected: 1 };
  }

  if (!(await userCanAcknowledgeAlarm(db, user.id, alarm, now))) {
    await markProviderEvent(db, event.id, "rejected", now, "El usuario ya no posee permisos para reconocer esta alarma.");
    return { processed: 0, duplicate: 0, rejected: 1 };
  }

  if (alarm.status === "acknowledged") {
    await db.update(notificationDeliveries).set({ ackAt: delivery.id ? now : null, updatedAt: now })
      .where(eq(notificationDeliveries.id, delivery.id));
    await markProviderEvent(db, event.id, "already_acknowledged", now);
    return { processed: 1, duplicate: 0, rejected: 0 };
  }
  if (alarm.status !== "open") {
    await markProviderEvent(db, event.id, "rejected", now, `La alarma está en estado ${alarm.status}.`);
    return { processed: 0, duplicate: 0, rejected: 1 };
  }

  await db.transaction(async (tx) => {
    const [changed] = await tx.update(alarms).set({
      status: "acknowledged",
      acknowledgedAt: now,
      acknowledgedBy: user.id,
    }).where(and(eq(alarms.id, alarm.id), eq(alarms.status, "open"))).returning({ id: alarms.id });

    if (!changed) throw new Error("La alarma cambió de estado mientras se procesaba el ACK.");

    await tx.update(escalationJobs).set({
      status: "cancelled",
      completedAt: now,
      updatedAt: now,
    }).where(and(
      eq(escalationJobs.alarmId, alarm.id),
      inArray(escalationJobs.status, ["pending", "processing"]),
    ));

    await tx.update(notificationDeliveries).set({
      ackAt: now,
      updatedAt: now,
    }).where(eq(notificationDeliveries.id, delivery.id));

    await tx.insert(alarmTransitions).values({
      alarmId: alarm.id,
      fromStatus: "open",
      toStatus: "acknowledged",
      actorUserId: user.id,
      source: "whatsapp_meta",
      sourceRef: messageId,
      note: "ACK recibido mediante Quick Reply de WhatsApp.",
      metadata: {
        providerMessageId: contextMessageId,
        notificationDeliveryId: delivery.id,
        phoneE164: phone,
      },
    });

    await tx.insert(alarmEvents).values({
      alarmId: alarm.id,
      eventType: "acknowledged",
      actorUserId: user.id,
      note: "ACK recibido mediante WhatsApp.",
      payload: {
        source: "whatsapp_meta",
        providerMessageId: contextMessageId,
        notificationDeliveryId: delivery.id,
      },
    });

    await tx.insert(auditLogs).values({
      siteId: alarm.siteId,
      actorUserId: user.id,
      action: "alarms.acknowledge.whatsapp",
      resourceType: "alarm",
      resourceId: alarm.id,
      before: { status: "open" },
      after: { status: "acknowledged" },
      metadata: {
        providerEventId: event.id,
        providerMessageId: contextMessageId,
        notificationDeliveryId: delivery.id,
        phoneE164: phone,
      },
    });
  });

  await markProviderEvent(db, event.id, "processed", now);
  return { processed: 1, duplicate: 0, rejected: 0 };
}

export async function processMetaWhatsAppWebhook(
  db: Cam5Database,
  body: MetaWebhookBody,
  now = new Date(),
) {
  if (body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) {
    throw new Error("Payload de webhook Meta no válido.");
  }

  const totals = { processed: 0, duplicate: 0, rejected: 0 };
  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" || !change.value) continue;
      for (const status of change.value.statuses ?? []) {
        const result = await processStatus(db, status, now);
        totals.processed += result.processed;
        totals.duplicate += result.duplicate;
        totals.rejected += result.rejected;
      }
      for (const message of change.value.messages ?? []) {
        const result = await processAckMessage(db, message, now);
        totals.processed += result.processed;
        totals.duplicate += result.duplicate;
        totals.rejected += result.rejected;
      }
    }
  }
  return totals;
}
