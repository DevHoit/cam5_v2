import type { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Cam5Database } from "../../../../../db/index";
import {
  alarmEvents,
  alarmRuleStates,
  alarms,
  assets,
  auditLogs,
  channels,
  userAssetScopes,
  userRoleAssignments,
  users,
} from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

async function requireAlarm(db: Cam5Database, id: string, siteId: string, userId: string) {
  const [target] = await db.select({
    id: alarms.id,
    siteId: alarms.siteId,
    assetId: alarms.assetId,
    channelId: alarms.channelId,
    ruleId: alarms.ruleId,
    code: alarms.code,
    kind: alarms.kind,
    severity: alarms.severity,
    status: alarms.status,
    title: alarms.title,
    detail: alarms.detail,
    triggerValue: alarms.triggerValue,
    thresholdValue: alarms.thresholdValue,
    assignedTo: alarms.assignedTo,
    openedAt: alarms.openedAt,
    lastObservedAt: alarms.lastObservedAt,
    acknowledgedAt: alarms.acknowledgedAt,
    resolvedAt: alarms.resolvedAt,
    closedAt: alarms.closedAt,
    occurrenceCount: alarms.occurrenceCount,
    context: alarms.context,
    assetCode: assets.code,
    assetName: assets.name,
    channelCode: channels.code,
    channelName: channels.name,
    unit: channels.unit,
  }).from(alarms)
    .innerJoin(assets, eq(assets.id, alarms.assetId))
    .leftJoin(channels, eq(channels.id, alarms.channelId))
    .where(and(eq(alarms.id, id), eq(alarms.siteId, siteId)))
    .limit(1);
  if (!target) throw new ApiError(404, "La alarma no existe.");
  const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, userId));
  if (scopes.length && !scopes.some((scope) => scope.assetId === target.assetId)) throw new ApiError(403, "No tienes acceso al punto de medición de esta alarma.");
  return target;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "alarms.read");
    const { id } = await context.params;
    const target = await requireAlarm(db, id, user.siteId, user.id);
    const eventActor = alias(users, "alarm_event_actor");
    const events = await db.select({
        id: alarmEvents.id,
        type: alarmEvents.eventType,
        note: alarmEvents.note,
        payload: alarmEvents.payload,
        createdAt: alarmEvents.createdAt,
        actorId: eventActor.id,
        actorName: eventActor.displayName,
      }).from(alarmEvents)
        .leftJoin(eventActor, eq(eventActor.id, alarmEvents.actorUserId))
        .where(eq(alarmEvents.alarmId, id))
        .orderBy(asc(alarmEvents.createdAt));
    return Response.json({
      item: {
        ...target,
        triggerValue: target.triggerValue === null ? null : Number(target.triggerValue),
        thresholdValue: target.thresholdValue === null ? null : Number(target.thresholdValue),
        openedAt: target.openedAt.toISOString(),
        lastObservedAt: target.lastObservedAt.toISOString(),
        acknowledgedAt: target.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: target.resolvedAt?.toISOString() ?? null,
        closedAt: target.closedAt?.toISOString() ?? null,
      },
      events: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString(), actorName: event.actorName ?? "Sistema" })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request);
    const { id } = await context.params;
    const target = await requireAlarm(db, id, user.siteId, user.id);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = typeof body?.action === "string" ? body.action : "";
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    const metadata = requestMetadata(request);

    const requirePermission = (permission: string) => {
      if (!user.permissions.includes(permission)) throw new ApiError(403, "No tienes permisos para realizar esta acción.");
    };

    await db.transaction(async (tx) => {
      let eventType = action;
      let eventPayload: Record<string, unknown> = {};
      let auditAfter: Record<string, unknown> = { action };

      if (action === "acknowledge") {
        requirePermission("alarms.acknowledge");
        if (target.status === "closed") throw new ApiError(409, "La alarma está cerrada. Reábrela antes de reconocerla.");
        if (target.status === "resolved") throw new ApiError(409, "La condición ya está atendida; puedes cerrarla o reabrirla.");
        await tx.update(alarms).set({ status: "acknowledged", acknowledgedAt: new Date(), acknowledgedBy: user.id }).where(eq(alarms.id, id));
        eventType = "acknowledged";
      } else if (action === "resolve") {
        requirePermission("alarms.close");
        if (target.status === "closed") throw new ApiError(409, "La alarma ya está cerrada.");
        await tx.update(alarms).set({ status: "resolved", resolvedAt: new Date(), resolvedBy: user.id }).where(eq(alarms.id, id));
        eventType = "resolved_manually";
      } else if (action === "close") {
        requirePermission("alarms.close");
        if (note.length < 3) throw new ApiError(400, "Agrega una nota de cierre para conservar la trazabilidad.");
        if (target.status === "closed") throw new ApiError(409, "La alarma ya está cerrada.");
        await tx.update(alarms).set({ status: "closed", closedAt: new Date(), closedBy: user.id }).where(eq(alarms.id, id));
        await tx.update(alarmRuleStates).set({ activeAlarmId: null, breachCount: 0, recoveryCount: 0, updatedAt: new Date() }).where(eq(alarmRuleStates.activeAlarmId, id));
        eventType = "closed";
      } else if (action === "reopen") {
        requirePermission("alarms.close");
        if (target.status !== "closed" && target.status !== "resolved") throw new ApiError(409, "Solo se pueden reabrir alarmas atendidas o cerradas.");
        await tx.update(alarms).set({ status: "open", resolvedAt: null, resolvedBy: null, closedAt: null, closedBy: null }).where(eq(alarms.id, id));
        if (target.ruleId) {
          await tx.insert(alarmRuleStates).values({
            ruleId: target.ruleId,
            activeAlarmId: id,
            currentSeverity: target.severity,
            currentKind: target.kind,
            breachCount: 0,
            recoveryCount: 0,
            updatedAt: new Date(),
          }).onConflictDoUpdate({
            target: alarmRuleStates.ruleId,
            set: { activeAlarmId: id, currentSeverity: target.severity, currentKind: target.kind, breachCount: 0, recoveryCount: 0, updatedAt: new Date() },
          });
        }
        eventType = "reopened_manually";
      } else if (action === "assign") {
        requirePermission("alarms.acknowledge");
        const assignedTo = typeof body?.assignedTo === "string" && body.assignedTo ? body.assignedTo : null;
        let assignedName = "Sin asignar";
        if (assignedTo) {
          const [assignee] = await tx.select({ id: users.id, name: users.displayName }).from(users)
            .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
            .where(and(eq(users.id, assignedTo), eq(users.status, "active"), eq(userRoleAssignments.siteId, user.siteId)))
            .limit(1);
          if (!assignee) throw new ApiError(400, "El responsable seleccionado no pertenece al sitio activo.");
          assignedName = assignee.name;
        }
        await tx.update(alarms).set({ assignedTo }).where(eq(alarms.id, id));
        eventType = assignedTo ? "assigned" : "unassigned";
        eventPayload = { assignedTo, assignedName };
        auditAfter = { action, assignedTo, assignedName };
      } else if (action === "add_note") {
        requirePermission("alarms.acknowledge");
        if (note.length < 3 || note.length > 2000) throw new ApiError(400, "La nota debe contener entre 3 y 2000 caracteres.");
        eventType = "note_added";
      } else {
        throw new ApiError(400, "La acción solicitada no es válida.");
      }

      await tx.insert(alarmEvents).values({ alarmId: id, eventType, actorUserId: user.id, note: note || null, payload: eventPayload });
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: `alarms.${action}`,
        resourceType: "alarm",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { status: target.status, assignedTo: target.assignedTo },
        after: auditAfter,
      });
    });

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
