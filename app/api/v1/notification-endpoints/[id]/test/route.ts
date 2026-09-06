import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { processNotificationDelivery } from "../../../../../../db/notification-engine";
import { auditLogs, notificationDeliveries, notificationEndpoints } from "../../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.write");
    const { id } = await context.params;
    const [endpoint] = await db.select().from(notificationEndpoints).where(and(eq(notificationEndpoints.id, id), eq(notificationEndpoints.siteId, user.siteId))).limit(1);
    if (!endpoint) throw new ApiError(404, "El canal no existe.");
    if (!endpoint.enabled) throw new ApiError(400, "Activa el canal antes de probarlo.");
    const now = new Date();
    const [delivery] = await db.insert(notificationDeliveries).values({
      endpointId: endpoint.id,
      eventType: "test",
      subject: "Prueba de notificaciones · HoitLive Core",
      payload: { eventType: "test", severity: "normal", title: "Canal configurado correctamente", detail: "Este mensaje verifica la conexión del canal de notificaciones.", site: user.siteName, occurredAt: now.toISOString(), portalUrl: process.env.APP_URL || "https://cam5v2.vercel.app" },
      queuedAt: now,
      scheduledAt: now,
      nextAttemptAt: now,
      dedupeKey: `test:${endpoint.id}:${crypto.randomUUID()}`,
    }).returning({ id: notificationDeliveries.id });
    const result = await processNotificationDelivery(db, delivery.id, { now });
    if (result.status === "delivered") await db.update(notificationEndpoints).set({ verifiedAt: now, updatedAt: now }).where(eq(notificationEndpoints.id, endpoint.id));
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "notification_endpoints.test", resourceType: "notification_endpoint", resourceId: endpoint.id, outcome: result.status === "delivered" ? "success" : "failed", ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, metadata: { deliveryId: delivery.id, result: result.status, error: result.error } });
    return Response.json({ ok: result.status === "delivered", deliveryId: delivery.id, status: result.status, error: result.error }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
