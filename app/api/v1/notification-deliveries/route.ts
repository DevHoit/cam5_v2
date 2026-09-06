import type { NextRequest } from "next/server";
import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { alarms, notificationDeliveries, notificationEndpoints, notificationPolicies } from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requireApiSession } from "../_lib/auth";
import { NOTIFICATION_KINDS } from "../_lib/notifications";

export const dynamic = "force-dynamic";

function optionalDate(value: string | null, endOfDay = false) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : value;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) throw new ApiError(400, "El rango de fechas no es válido.");
  return date;
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.read");
    const { page, pageSize, offset } = parsePage(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const status = request.nextUrl.searchParams.get("status") || "all";
    const kind = request.nextUrl.searchParams.get("kind") || "all";
    const from = optionalDate(request.nextUrl.searchParams.get("from"));
    const to = optionalDate(request.nextUrl.searchParams.get("to"), true);
    if (!["all", "queued", "sending", "delivered", "failed"].includes(status)) throw new ApiError(400, "El filtro de entrega no es válido.");
    if (kind !== "all" && !NOTIFICATION_KINDS.includes(kind as (typeof NOTIFICATION_KINDS)[number])) throw new ApiError(400, "El filtro de canal no es válido.");
    if (from && to && from > to) throw new ApiError(400, "La fecha inicial debe ser anterior a la final.");
    const filters: SQL[] = [eq(notificationEndpoints.siteId, user.siteId)];
    if (q) filters.push(or(ilike(notificationDeliveries.subject, `%${q}%`), ilike(notificationDeliveries.recipient, `%${q}%`), ilike(alarms.code, `%${q}%`))!);
    if (status !== "all") filters.push(eq(notificationDeliveries.status, status));
    if (kind !== "all") filters.push(eq(notificationEndpoints.kind, kind as (typeof NOTIFICATION_KINDS)[number]));
    if (from) filters.push(gte(notificationDeliveries.queuedAt, from));
    if (to) filters.push(lte(notificationDeliveries.queuedAt, to));
    const where = and(...filters);
    const projection = {
      id: notificationDeliveries.id,
      subject: notificationDeliveries.subject,
      eventType: notificationDeliveries.eventType,
      recipient: notificationDeliveries.recipient,
      status: notificationDeliveries.status,
      attemptCount: notificationDeliveries.attemptCount,
      maxAttempts: notificationDeliveries.maxAttempts,
      providerMessageId: notificationDeliveries.providerMessageId,
      errorMessage: notificationDeliveries.errorMessage,
      queuedAt: notificationDeliveries.queuedAt,
      scheduledAt: notificationDeliveries.scheduledAt,
      nextAttemptAt: notificationDeliveries.nextAttemptAt,
      lastAttemptAt: notificationDeliveries.lastAttemptAt,
      sentAt: notificationDeliveries.sentAt,
      endpointId: notificationEndpoints.id,
      endpointName: notificationEndpoints.name,
      endpointKind: notificationEndpoints.kind,
      policyName: notificationPolicies.name,
      alarmId: alarms.id,
      alarmCode: alarms.code,
    };
    const [items, totalRows] = await Promise.all([
      db.select(projection).from(notificationDeliveries)
        .innerJoin(notificationEndpoints, eq(notificationEndpoints.id, notificationDeliveries.endpointId))
        .leftJoin(notificationPolicies, eq(notificationPolicies.id, notificationDeliveries.policyId))
        .leftJoin(alarms, eq(alarms.id, notificationDeliveries.alarmId))
        .where(where).orderBy(desc(notificationDeliveries.queuedAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(notificationDeliveries)
        .innerJoin(notificationEndpoints, eq(notificationEndpoints.id, notificationDeliveries.endpointId))
        .leftJoin(alarms, eq(alarms.id, notificationDeliveries.alarmId))
        .where(where),
    ]);
    const total = Number(totalRows[0]?.total ?? 0);
    const iso = (value: Date | null) => value?.toISOString() ?? null;
    return Response.json({ items: items.map((item) => ({ ...item, queuedAt: item.queuedAt.toISOString(), scheduledAt: item.scheduledAt.toISOString(), nextAttemptAt: item.nextAttemptAt.toISOString(), lastAttemptAt: iso(item.lastAttemptAt), sentAt: iso(item.sentAt) })), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
