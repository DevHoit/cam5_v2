import type { NextRequest } from "next/server";
import { and, count, desc, eq, ilike, type SQL } from "drizzle-orm";
import { auditLogs, notificationEndpoints, notificationPolicies } from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requestMetadata, requireApiSession } from "../_lib/auth";
import { parsePolicyBody } from "../_lib/notifications";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.read");
    const { page, pageSize, offset } = parsePage(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const active = request.nextUrl.searchParams.get("active") || "all";
    if (!["all", "true", "false"].includes(active)) throw new ApiError(400, "El filtro de estado no es válido.");
    const filters: SQL[] = [eq(notificationPolicies.siteId, user.siteId)];
    if (q) filters.push(ilike(notificationPolicies.name, `%${q}%`));
    if (active !== "all") filters.push(eq(notificationPolicies.active, active === "true"));
    const where = and(...filters);
    const projection = {
      id: notificationPolicies.id,
      name: notificationPolicies.name,
      endpointId: notificationPolicies.endpointId,
      endpointName: notificationEndpoints.name,
      endpointKind: notificationEndpoints.kind,
      endpointEnabled: notificationEndpoints.enabled,
      minimumSeverity: notificationPolicies.minimumSeverity,
      escalationDelayMinutes: notificationPolicies.escalationDelayMinutes,
      repeatIntervalMinutes: notificationPolicies.repeatIntervalMinutes,
      active: notificationPolicies.active,
      filters: notificationPolicies.filters,
      createdAt: notificationPolicies.createdAt,
      updatedAt: notificationPolicies.updatedAt,
    };
    const [items, totalRows] = await Promise.all([
      db.select(projection).from(notificationPolicies).innerJoin(notificationEndpoints, eq(notificationEndpoints.id, notificationPolicies.endpointId)).where(where).orderBy(desc(notificationPolicies.active), notificationPolicies.name).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(notificationPolicies).where(where),
    ]);
    const total = Number(totalRows[0]?.total ?? 0);
    return Response.json({ items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.write");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibió la regla de notificación.");
    const values = parsePolicyBody(body);
    const [endpoint] = await db.select({ id: notificationEndpoints.id, enabled: notificationEndpoints.enabled }).from(notificationEndpoints).where(and(eq(notificationEndpoints.id, values.endpointId), eq(notificationEndpoints.siteId, user.siteId))).limit(1);
    if (!endpoint) throw new ApiError(400, "El canal seleccionado no pertenece al sitio activo.");
    if (values.active && !endpoint.enabled) throw new ApiError(400, "Activa el canal antes de habilitar esta regla.");
    const metadata = requestMetadata(request);
    const created = await db.transaction(async (tx) => {
      const [item] = await tx.insert(notificationPolicies).values({ siteId: user.siteId, ...values }).returning();
      await tx.insert(auditLogs).values({ siteId: user.siteId, actorUserId: user.id, action: "notification_policies.create", resourceType: "notification_policy", resourceId: item.id, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, after: item });
      return item;
    });
    return Response.json({ item: { ...created, createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString() } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
