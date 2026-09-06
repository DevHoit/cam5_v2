import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { processNotificationDelivery } from "../../../../../../db/notification-engine";
import { auditLogs, notificationDeliveries, notificationEndpoints } from "../../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.write");
    const rawId = (await context.params).id;
    const id = Number.parseInt(rawId, 10);
    if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(400, "La entrega no es válida.");
    const [current] = await db.select({ id: notificationDeliveries.id, status: notificationDeliveries.status, endpointId: notificationDeliveries.endpointId }).from(notificationDeliveries)
      .innerJoin(notificationEndpoints, eq(notificationEndpoints.id, notificationDeliveries.endpointId))
      .where(and(eq(notificationDeliveries.id, id), eq(notificationEndpoints.siteId, user.siteId))).limit(1);
    if (!current) throw new ApiError(404, "La entrega no existe.");
    if (current.status !== "failed") throw new ApiError(400, "Solo se pueden reintentar entregas fallidas.");
    const now = new Date();
    await db.update(notificationDeliveries).set({ status: "queued", attemptCount: 0, errorMessage: null, providerMessageId: null, sentAt: null, scheduledAt: now, nextAttemptAt: now, updatedAt: now }).where(eq(notificationDeliveries.id, id));
    const result = await processNotificationDelivery(db, id, { now });
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "notification_deliveries.retry", resourceType: "notification_delivery", resourceId: String(id), outcome: result.status === "delivered" ? "success" : "failed", ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, before: { status: current.status }, after: { status: result.status }, metadata: { error: result.error } });
    return Response.json({ ok: result.status === "delivered", status: result.status, error: result.error }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
