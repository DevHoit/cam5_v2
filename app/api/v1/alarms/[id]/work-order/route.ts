import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  alarmEvents,
  alarms,
  assets,
  auditLogs,
  userRoleAssignments,
  users,
  workOrderAlarms,
  workOrders,
} from "../../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

function workOrderCode(now: Date) {
  const stamp = now.toISOString().slice(2, 10).replaceAll("-", "");
  return `OT-${stamp}-${now.getTime().toString(36).toUpperCase().slice(-6)}-${crypto.randomUUID().slice(0, 3).toUpperCase()}`;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "maintenance.write");
    const { id } = await context.params;
    const [alarm] = await db.select({
      id: alarms.id,
      siteId: alarms.siteId,
      assetId: alarms.assetId,
      code: alarms.code,
      severity: alarms.severity,
      title: alarms.title,
      detail: alarms.detail,
      assignedTo: alarms.assignedTo,
      assetCode: assets.code,
    }).from(alarms)
      .innerJoin(assets, eq(assets.id, alarms.assetId))
      .where(and(eq(alarms.id, id), eq(alarms.siteId, user.siteId)))
      .limit(1);
    if (!alarm) throw new ApiError(404, "La alarma no existe.");
    const [existing] = await db.select({ id: workOrders.id, code: workOrders.code, title: workOrders.title, status: workOrders.status, priority: workOrders.priority })
      .from(workOrderAlarms)
      .innerJoin(workOrders, eq(workOrders.id, workOrderAlarms.workOrderId))
      .where(eq(workOrderAlarms.alarmId, id))
      .limit(1);
    if (existing) return Response.json({ item: existing, existing: true }, { headers: { "Cache-Control": "no-store" } });

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const assignedTo = typeof body.assignedTo === "string" && body.assignedTo ? body.assignedTo : alarm.assignedTo;
    if (assignedTo) {
      const [assignee] = await db.select({ id: users.id }).from(users)
        .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
        .where(and(eq(users.id, assignedTo), eq(users.status, "active"), eq(userRoleAssignments.siteId, user.siteId)))
        .limit(1);
      if (!assignee) throw new ApiError(400, "El responsable seleccionado no pertenece al sitio activo.");
    }

    const now = new Date();
    const dueAt = new Date(now.getTime() + (alarm.severity === "critical" ? 8 : 24) * 60 * 60 * 1000);
    const metadata = requestMetadata(request);
    const created = await db.transaction(async (tx) => {
      const [order] = await tx.insert(workOrders).values({
        siteId: user.siteId,
        assetId: alarm.assetId,
        code: workOrderCode(now),
        title: `Atender ${alarm.title}`,
        description: `${alarm.detail || alarm.code}\n\nGenerada desde la alarma ${alarm.code} del punto ${alarm.assetCode}.`,
        priority: alarm.severity === "critical" ? "critical" : alarm.severity === "warning" ? "high" : "normal",
        status: "pending",
        assignedTo: assignedTo || null,
        createdBy: user.id,
        dueAt,
      }).returning();
      await tx.insert(workOrderAlarms).values({ workOrderId: order.id, alarmId: id });
      await tx.insert(alarmEvents).values({ alarmId: id, eventType: "work_order_created", actorUserId: user.id, payload: { workOrderId: order.id, workOrderCode: order.code } });
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "alarms.work_order.create",
        resourceType: "work_order",
        resourceId: order.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        after: { code: order.code, alarmId: id, assignedTo: assignedTo || null },
      });
      return order;
    });

    return Response.json({
      item: {
        id: created.id,
        code: created.code,
        title: created.title,
        status: created.status,
        priority: created.priority,
        dueAt: created.dueAt?.toISOString() ?? null,
      },
      existing: false,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
