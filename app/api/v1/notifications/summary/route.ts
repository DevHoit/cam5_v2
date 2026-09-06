import type { NextRequest } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { notificationDeliveries, notificationEndpoints, notificationPolicies } from "../../../../../db/schema";
import { apiErrorResponse, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.read");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [endpointRows, policyRows, deliveryRows] = await Promise.all([
      db.select({ total: sql<number>`count(*)`, active: sql<number>`count(*) filter (where ${notificationEndpoints.enabled} = true)`, verified: sql<number>`count(*) filter (where ${notificationEndpoints.verifiedAt} is not null)` }).from(notificationEndpoints).where(eq(notificationEndpoints.siteId, user.siteId)),
      db.select({ total: sql<number>`count(*)`, active: sql<number>`count(*) filter (where ${notificationPolicies.active} = true)` }).from(notificationPolicies).where(eq(notificationPolicies.siteId, user.siteId)),
      db.select({
        total24h: sql<number>`count(*)`,
        delivered24h: sql<number>`count(*) filter (where ${notificationDeliveries.status} = 'delivered')`,
        failed24h: sql<number>`count(*) filter (where ${notificationDeliveries.status} = 'failed')`,
        pending24h: sql<number>`count(*) filter (where ${notificationDeliveries.status} in ('queued', 'sending'))`,
      }).from(notificationDeliveries).innerJoin(notificationEndpoints, eq(notificationEndpoints.id, notificationDeliveries.endpointId)).where(and(eq(notificationEndpoints.siteId, user.siteId), gte(notificationDeliveries.queuedAt, since))),
    ]);
    const total24h = Number(deliveryRows[0]?.total24h ?? 0);
    const delivered24h = Number(deliveryRows[0]?.delivered24h ?? 0);
    return Response.json({
      endpoints: { total: Number(endpointRows[0]?.total ?? 0), active: Number(endpointRows[0]?.active ?? 0), verified: Number(endpointRows[0]?.verified ?? 0) },
      policies: { total: Number(policyRows[0]?.total ?? 0), active: Number(policyRows[0]?.active ?? 0) },
      deliveries: { total24h, delivered24h, failed24h: Number(deliveryRows[0]?.failed24h ?? 0), pending24h: Number(deliveryRows[0]?.pending24h ?? 0), successRate: total24h ? Math.round(delivered24h / total24h * 100) : null },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
