import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { auditLogs, notificationEndpoints, notificationPolicies } from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";
import { parsePolicyBody } from "../../_lib/notifications";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.write");
    const { id } = await context.params;
    const [current] = await db.select().from(notificationPolicies).where(and(eq(notificationPolicies.id, id), eq(notificationPolicies.siteId, user.siteId))).limit(1);
    if (!current) throw new ApiError(404, "La regla no existe.");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron cambios.");
    const values = parsePolicyBody(body, current);
    const [endpoint] = await db.select({ id: notificationEndpoints.id, enabled: notificationEndpoints.enabled }).from(notificationEndpoints).where(and(eq(notificationEndpoints.id, values.endpointId), eq(notificationEndpoints.siteId, user.siteId))).limit(1);
    if (!endpoint) throw new ApiError(400, "El canal seleccionado no pertenece al sitio activo.");
    if (values.active && !endpoint.enabled) throw new ApiError(400, "Activa el canal antes de habilitar esta regla.");
    const metadata = requestMetadata(request);
    const updated = await db.transaction(async (tx) => {
      const [item] = await tx.update(notificationPolicies).set({ ...values, updatedAt: new Date() }).where(eq(notificationPolicies.id, id)).returning();
      await tx.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "notification_policies.update", resourceType: "notification_policy", resourceId: id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, before: current, after: item });
      return item;
    });
    return Response.json({ item: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.write");
    const { id } = await context.params;
    const [current] = await db.select().from(notificationPolicies).where(and(eq(notificationPolicies.id, id), eq(notificationPolicies.siteId, user.siteId))).limit(1);
    if (!current) throw new ApiError(404, "La regla no existe.");
    const metadata = requestMetadata(request);
    await db.transaction(async (tx) => {
      await tx.delete(notificationPolicies).where(eq(notificationPolicies.id, id));
      await tx.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "notification_policies.delete", resourceType: "notification_policy", resourceId: id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, before: current });
    });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
