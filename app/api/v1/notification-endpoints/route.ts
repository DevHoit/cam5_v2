import type { NextRequest } from "next/server";
import { and, count, desc, eq, ilike, type SQL } from "drizzle-orm";
import { auditLogs, notificationEndpoints } from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requestMetadata, requireApiSession } from "../_lib/auth";
import { NOTIFICATION_KINDS, parseEndpointBody } from "../_lib/notifications";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.read");
    const { page, pageSize, offset } = parsePage(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const kind = request.nextUrl.searchParams.get("kind") || "all";
    const enabled = request.nextUrl.searchParams.get("enabled") || "all";
    if (kind !== "all" && !NOTIFICATION_KINDS.includes(kind as (typeof NOTIFICATION_KINDS)[number])) throw new ApiError(400, "El filtro de canal no es válido.");
    if (!["all", "true", "false"].includes(enabled)) throw new ApiError(400, "El filtro de estado no es válido.");
    const filters: SQL[] = [eq(notificationEndpoints.siteId, user.siteId)];
    if (q) filters.push(ilike(notificationEndpoints.name, `%${q}%`));
    if (kind !== "all") filters.push(eq(notificationEndpoints.kind, kind as (typeof NOTIFICATION_KINDS)[number]));
    if (enabled !== "all") filters.push(eq(notificationEndpoints.enabled, enabled === "true"));
    const where = and(...filters);
    const [items, totalRows] = await Promise.all([
      db.select().from(notificationEndpoints).where(where).orderBy(desc(notificationEndpoints.enabled), notificationEndpoints.name).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(notificationEndpoints).where(where),
    ]);
    const total = Number(totalRows[0]?.total ?? 0);
    return Response.json({
      items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), verifiedAt: item.verifiedAt?.toISOString() ?? null })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.write");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibió la configuración del canal.");
    const values = parseEndpointBody(body);
    const metadata = requestMetadata(request);
    const created = await db.transaction(async (tx) => {
      const [item] = await tx.insert(notificationEndpoints).values({ siteId: user.siteId, ...values }).returning();
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "notification_endpoints.create",
        resourceType: "notification_endpoint",
        resourceId: item.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        after: { name: item.name, kind: item.kind, configuration: item.configuration, secretReference: item.secretReference, enabled: item.enabled },
      });
      return item;
    });
    return Response.json({ item: { ...created, createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString(), verifiedAt: null } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
