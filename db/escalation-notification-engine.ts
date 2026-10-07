import { and, eq, isNull, or, sql } from "drizzle-orm";
import { publicAppUrl } from "./app-url";
import type { Cam5Database } from "./index";
import { resolveOnCallUser } from "./on-call-engine";
import {
  alarmEvents,
  alarms,
  assets,
  auditLogs,
  notificationDeliveries,
  notificationEndpoints,
  roles,
  shifts,
  sites,
  userClientAssignments,
  userRoleAssignments,
  users,
} from "./schema";
import type { EscalationExecutionContext } from "./escalation-engine";

type PersonalChannel = "email" | "whatsapp_meta";

function normalizeChannel(value: string): PersonalChannel {
  if (value === "email") return "email";
  if (value === "whatsapp" || value === "whatsapp_meta") return "whatsapp_meta";
  throw new Error(`Canal de escalamiento no soportado en V1: ${value}.`);
}

async function siteContext(db: Cam5Database, siteId: string) {
  const [row] = await db.select({
    siteId: sites.id,
    siteName: sites.name,
    clientId: sites.clientId,
  }).from(sites).where(eq(sites.id, siteId)).limit(1);
  if (!row) throw new Error("El sitio de la alarma no existe.");
  return row;
}

async function activeUser(db: Cam5Database, userId: string) {
  const [row] = await db.select({
    id: users.id,
    email: users.email,
    phoneE164: users.phoneE164,
    displayName: users.displayName,
    status: users.status,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row || row.status !== "active") throw new Error("El destinatario configurado no es un usuario activo.");
  return row;
}

async function assertUserWithinSiteScope(db: Cam5Database, userId: string, siteId: string, clientId: string) {
  const [globalAccess, siteAccess, clientAccess] = await Promise.all([
    db.select({ id: userRoleAssignments.id }).from(userRoleAssignments)
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .where(and(
        eq(userRoleAssignments.userId, userId),
        isNull(userRoleAssignments.siteId),
        eq(roles.key, "platform_admin"),
      )).limit(1),
    db.select({ id: userRoleAssignments.id }).from(userRoleAssignments)
      .where(and(
        eq(userRoleAssignments.userId, userId),
        eq(userRoleAssignments.siteId, siteId),
      )).limit(1),
    db.select({ id: userClientAssignments.id }).from(userClientAssignments)
      .where(and(
        eq(userClientAssignments.userId, userId),
        eq(userClientAssignments.clientId, clientId),
      )).limit(1),
  ]);
  if (!globalAccess.length && !siteAccess.length && !clientAccess.length) {
    throw new Error("El destinatario configurado está fuera del alcance del sitio de la alarma.");
  }
}

async function resolveRoleUsers(
  db: Cam5Database,
  roleKey: string,
  siteId: string,
  clientId: string,
) {
  const [role] = await db.select({ id: roles.id, key: roles.key }).from(roles).where(eq(roles.key, roleKey)).limit(1);
  if (!role) throw new Error(`El rol de escalamiento '${roleKey}' no existe.`);

  const [siteRows, clientRows, platformRows] = await Promise.all([
    db.select({ userId: userRoleAssignments.userId }).from(userRoleAssignments)
      .innerJoin(users, eq(users.id, userRoleAssignments.userId))
      .where(and(
        eq(userRoleAssignments.roleId, role.id),
        eq(userRoleAssignments.siteId, siteId),
        eq(users.status, "active"),
        or(isNull(userRoleAssignments.expiresAt), sqlNowBeforeExpiry()),
      )),
    db.select({ userId: userClientAssignments.userId }).from(userClientAssignments)
      .innerJoin(users, eq(users.id, userClientAssignments.userId))
      .where(and(
        eq(userClientAssignments.roleId, role.id),
        eq(userClientAssignments.clientId, clientId),
        eq(users.status, "active"),
      )),
    role.key === "platform_admin"
      ? db.select({ userId: userRoleAssignments.userId }).from(userRoleAssignments)
          .innerJoin(users, eq(users.id, userRoleAssignments.userId))
          .where(and(
            eq(userRoleAssignments.roleId, role.id),
            isNull(userRoleAssignments.siteId),
            eq(users.status, "active"),
          ))
      : Promise.resolve([]),
  ]);

  return [...new Set([...siteRows, ...clientRows, ...platformRows].map((row) => row.userId))];
}

function sqlNowBeforeExpiry() {
  // Drizzle expression kept in a helper to avoid resolving dates in application time.
  return or(isNull(userRoleAssignments.expiresAt), gtNow(userRoleAssignments.expiresAt));
}

function gtNow(column: typeof userRoleAssignments.expiresAt) {
  return sql`${column} > now()`;
}

async function resolveRecipientUserIds(
  db: Cam5Database,
  context: EscalationExecutionContext,
  at: Date,
) {
  const site = await siteContext(db, context.alarm.siteId);

  if (context.job.recipientType === "user") {
    const user = await activeUser(db, context.job.recipientRef);
    await assertUserWithinSiteScope(db, user.id, site.siteId, site.clientId);
    return [user.id];
  }

  if (context.job.recipientType === "role") {
    const ids = await resolveRoleUsers(db, context.job.recipientRef, site.siteId, site.clientId);
    if (!ids.length) throw new Error(`No hay usuarios activos para el rol '${context.job.recipientRef}' en el alcance de la alarma.`);
    return ids;
  }

  const [shift] = await db.select({ id: shifts.id, clientId: shifts.clientId })
    .from(shifts).where(eq(shifts.id, context.job.recipientRef)).limit(1);
  if (!shift || shift.clientId !== site.clientId) {
    throw new Error("El grupo on-call no pertenece al cliente de la alarma.");
  }
  const resolution = await resolveOnCallUser(db, shift.id, at);
  if (resolution.status !== "resolved") {
    throw new Error(`No fue posible resolver el on-call '${shift.id}': ${resolution.status}.`);
  }
  await assertUserWithinSiteScope(db, resolution.userId, site.siteId, site.clientId);
  return [resolution.userId];
}

async function endpointForChannel(db: Cam5Database, siteId: string, channel: PersonalChannel) {
  const rows = await db.select().from(notificationEndpoints).where(and(
    eq(notificationEndpoints.siteId, siteId),
    eq(notificationEndpoints.kind, channel),
    eq(notificationEndpoints.enabled, true),
  ));
  if (!rows.length) throw new Error(`No existe un endpoint ${channel} habilitado para el sitio.`);
  if (rows.length > 1) throw new Error(`Hay más de un endpoint ${channel} habilitado para el sitio; la ruta personal es ambigua.`);
  return rows[0];
}

function templateFor(severity: EscalationExecutionContext["alarm"]["severity"]) {
  if (severity === "critical") return "hoit_alarm_critical_es";
  if (severity === "warning") return "hoit_alarm_warning_es";
  return "hoit_alarm_escalated_es";
}

export async function queueEscalationNotifications(
  db: Cam5Database,
  context: EscalationExecutionContext,
  now = new Date(),
) {
  if (context.level.repeatCount > 1) {
    throw new Error("repeat_count > 1 requiere un intervalo de repetición que HOIT_SPEC v0.4 aún no define.");
  }
  if (!context.level.channels.length) throw new Error("El nivel de escalamiento no tiene canales configurados.");

  const userIds = await resolveRecipientUserIds(db, context, now);
  const usersById = new Map((await Promise.all(userIds.map((id) => activeUser(db, id)))).map((user) => [user.id, user]));
  const channels = [...new Set(context.level.channels.map(normalizeChannel))];
  const endpoints = new Map<PersonalChannel, Awaited<ReturnType<typeof endpointForChannel>>>();
  for (const channel of channels) endpoints.set(channel, await endpointForChannel(db, context.alarm.siteId, channel));

  const [alarmDetail] = await db.select({
    siteName: sites.name,
    assetCode: assets.code,
    assetName: assets.name,
    alarmCode: alarms.code,
    title: alarms.title,
    detail: alarms.detail,
    severity: alarms.severity,
    openedAt: alarms.openedAt,
  }).from(alarms)
    .innerJoin(sites, eq(sites.id, alarms.siteId))
    .innerJoin(assets, eq(assets.id, alarms.assetId))
    .where(eq(alarms.id, context.alarm.id))
    .limit(1);
  if (!alarmDetail) throw new Error("No fue posible cargar el detalle de la alarma para escalar.");

  const rows = [];
  for (const userId of userIds) {
    const user = usersById.get(userId);
    if (!user) continue;
    for (const channel of channels) {
      const endpoint = endpoints.get(channel)!;
      const recipient = channel === "email" ? user.email : user.phoneE164;
      if (!recipient) {
        throw new Error(`El usuario ${user.displayName} no tiene ${channel === "email" ? "correo" : "phone_e164"} configurado.`);
      }
      rows.push({
        endpointId: endpoint.id,
        alarmId: context.alarm.id,
        eventType: "escalated",
        subject: `Escalamiento nivel ${context.level.levelNumber} · ${context.alarm.code}`,
        payload: {
          eventType: "escalated",
          escalationJobId: context.job.id,
          escalationLevel: context.level.levelNumber,
          severity: alarmDetail.severity,
          alarmCode: alarmDetail.alarmCode,
          title: alarmDetail.title,
          detail: alarmDetail.detail,
          site: alarmDetail.siteName,
          asset: `${alarmDetail.assetCode} · ${alarmDetail.assetName}`,
          occurredAt: now.toISOString(),
          recipientName: user.displayName,
          portalUrl: `${publicAppUrl()}/?view=alarms&record=${encodeURIComponent(context.alarm.id)}`,
        },
        recipient,
        recipientUserId: user.id,
        provider: channel === "email" ? "resend" : "meta_whatsapp_cloud",
        templateName: channel === "whatsapp_meta" ? templateFor(context.alarm.severity) : null,
        status: "queued" as const,
        scheduledAt: now,
        nextAttemptAt: now,
        dedupeKey: `escalation-job:${context.job.id}:user:${user.id}:channel:${channel}`,
      });
    }
  }

  if (!rows.length) throw new Error("El escalamiento no resolvió entregas personales.");
  const inserted = await db.insert(notificationDeliveries).values(rows)
    .onConflictDoNothing({ target: notificationDeliveries.dedupeKey })
    .returning({ id: notificationDeliveries.id });

  const [event] = await db.insert(alarmEvents).values({
    alarmId: context.alarm.id,
    eventType: "escalated",
    payload: {
      escalationJobId: context.job.id,
      levelNumber: context.level.levelNumber,
      recipientType: context.job.recipientType,
      recipientRef: context.job.recipientRef,
      resolvedUserIds: userIds,
      channels,
      deliveryIds: inserted.map((item) => item.id),
    },
  }).returning({ id: alarmEvents.id });

  await db.insert(auditLogs).values({
    siteId: context.alarm.siteId,
    actorUserId: null,
    action: "alarm.escalate",
    resourceType: "alarm",
    resourceId: context.alarm.id,
    outcome: "success",
    metadata: {
      alarmEventId: event.id,
      escalationJobId: context.job.id,
      levelNumber: context.level.levelNumber,
      recipientType: context.job.recipientType,
      recipientRef: context.job.recipientRef,
      resolvedUserIds: userIds,
      channels,
      queuedDeliveries: inserted.length,
    },
  });

  return {
    resolvedRecipientUserId: userIds.length === 1 ? userIds[0] : null,
    resolvedRecipientUserIds: userIds,
    queuedDeliveries: inserted.length,
  };
}
