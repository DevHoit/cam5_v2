import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { auditLogs, notificationEndpoints, notificationPolicies } from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";
import { parseEndpointBody } from "../../_lib/notifications";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.write");
    const { id } = await context.params;
    const [current] = await db.select().from(notificationEndpoints).where(and(eq(notificationEndpoints.id, id), eq(notificationEndpoints.siteId, user.siteId))).limit(1);
    if (!current) throw new ApiError(404, "El canal no existe.");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron cambios.");
    const values = parseEndpointBody(body, current);
    const metadata = requestMetadata(request);
    const updated = await db.transaction(async (tx) => {
      const [item] = await tx.update(notificationEndpoints).set({ ...values, verifiedAt: values.enabled && current.enabled && current.kind === values.kind ? current.verifiedAt : null, updatedAt: new Date() }).where(eq(notificationEndpoints.id, id)).returning();
      if (!item.enabled) await tx.update(notificationPolicies).set({ active: false, updatedAt: new Date() }).where(eq(notificationPolicies.endpointId, item.id));
      await tx.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "notification_endpoints.update", resourceType: "notification_endpoint", resourceId: id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, before: current, after: item });
      return item;
    });
    return Response.json({ item: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString(), verifiedAt: updated.verifiedAt?.toISOString() ?? null } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.write");
    const { id } = await context.params;
    const [current] = await db.select().from(notificationEndpoints).where(and(eq(notificationEndpoints.id, id), eq(notificationEndpoints.siteId, user.siteId))).limit(1);
    if (!current) throw new ApiError(404, "El canal no existe.");
    const metadata = requestMetadata(request);
    await db.transaction(async (tx) => {
      await tx.update(notificationEndpoints).set({ enabled: false, updatedAt: new Date() }).where(eq(notificationEndpoints.id, id));
      await tx.update(notificationPolicies).set({ active: false, updatedAt: new Date() }).where(eq(notificationPolicies.endpointId, id));
      await tx.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "notification_endpoints.archive", resourceType: "notification_endpoint", resourceId: id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, before: current, after: { enabled: false } });
    });
    return Response.json({ archived: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
