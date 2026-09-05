import type { NextRequest } from "next/server";
import { and, asc, between, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import {
  alarms,
  assets,
  auditLogs,
  channels,
  readings,
  users,
} from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

function parsePeriod(request: NextRequest) {
  const now = new Date();
  const fallbackFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const from = new Date(request.nextUrl.searchParams.get("from") || fallbackFrom.toISOString());
  const to = new Date(request.nextUrl.searchParams.get("to") || now.toISOString());
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new ApiError(400, "El rango de fechas no es válido.");
  return { from, to };
}

export async function GET(request: NextRequest) {
  try {
    const tab = request.nextUrl.searchParams.get("tab") || "measurements";
    if (!(["measurements", "alarms", "audit"] as const).includes(tab as "measurements")) throw new ApiError(400, "El tipo de histórico no es válido.");
    const requiredPermission = tab === "audit" ? "audit.read" : tab === "alarms" ? "alarms.read" : "history.read";
    const { db, user } = await requireApiSession(request, requiredPermission);
    const { page, pageSize, offset } = parsePage(request);
    const { from, to } = parsePeriod(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const channel = request.nextUrl.searchParams.get("channel") || "all";

    if (tab === "measurements") {
      const filters: SQL[] = [eq(assets.siteId, user.siteId), eq(channels.enabled, true)];
      if (channel !== "all") filters.push(eq(channels.code, channel));
      if (q) filters.push(or(ilike(channels.code, `%${q}%`), ilike(channels.name, `%${q}%`), ilike(channels.zone, `%${q}%`))!);
      const where = and(...filters);
      const [items, totals] = await Promise.all([
        db.select({
          id: channels.id,
          code: channels.code,
          name: channels.name,
          zone: channels.zone,
          unit: channels.unit,
          lastRecordedAt: sql<Date | null>`max(${readings.recordedAt})`,
          lastValue: sql<string | null>`(array_agg(${readings.value} order by ${readings.recordedAt} desc) filter (where ${readings.id} is not null))[1]`,
          averageValue: sql<string | null>`avg(${readings.value})`,
          minimumValue: sql<string | null>`min(${readings.value})`,
          maximumValue: sql<string | null>`max(${readings.value})`,
          validSamples: sql<number>`count(${readings.id}) filter (where ${readings.quality} = 'good')`,
          totalSamples: count(readings.id),
        })
          .from(channels)
          .innerJoin(assets, eq(assets.id, channels.assetId))
          .leftJoin(readings, and(eq(readings.channelId, channels.id), between(readings.recordedAt, from, to)))
          .where(where)
          .groupBy(channels.id)
          .orderBy(asc(channels.displayOrder))
          .limit(pageSize)
          .offset(offset),
        db.select({ total: count() }).from(channels).innerJoin(assets, eq(assets.id, channels.assetId)).where(where),
      ]);
      const total = Number(totals[0]?.total ?? 0);
      return Response.json({
        items: items.map((item) => ({
          ...item,
          lastRecordedAt: item.lastRecordedAt?.toISOString() ?? null,
          qualityPercent: Number(item.totalSamples) ? Math.round(Number(item.validSamples) / Number(item.totalSamples) * 10_000) / 100 : null,
          totalSamples: Number(item.totalSamples),
        })),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        from: from.toISOString(),
        to: to.toISOString(),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (tab === "alarms") {
      const filters: SQL[] = [eq(alarms.siteId, user.siteId), between(alarms.openedAt, from, to)];
      if (q) filters.push(or(ilike(alarms.code, `%${q}%`), ilike(alarms.title, `%${q}%`), ilike(alarms.detail, `%${q}%`))!);
      const where = and(...filters);
      const [items, totals] = await Promise.all([
        db.select({
          id: alarms.id,
          code: alarms.code,
          openedAt: alarms.openedAt,
          severity: alarms.severity,
          status: alarms.status,
          title: alarms.title,
          detail: alarms.detail,
          triggerValue: alarms.triggerValue,
          channelCode: channels.code,
          unit: channels.unit,
        }).from(alarms)
          .leftJoin(channels, eq(channels.id, alarms.channelId))
          .where(where)
          .orderBy(desc(alarms.openedAt))
          .limit(pageSize)
          .offset(offset),
        db.select({ total: count() }).from(alarms).where(where),
      ]);
      const total = Number(totals[0]?.total ?? 0);
      return Response.json({
        items: items.map((item) => ({ ...item, openedAt: item.openedAt.toISOString() })),
        page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), from: from.toISOString(), to: to.toISOString(),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const filters: SQL[] = [eq(auditLogs.siteId, user.siteId), between(auditLogs.createdAt, from, to)];
    if (q) filters.push(or(ilike(auditLogs.action, `%${q}%`), ilike(auditLogs.resourceType, `%${q}%`), ilike(auditLogs.resourceId, `%${q}%`))!);
    const where = and(...filters);
    const [items, totals] = await Promise.all([
      db.select({
        id: auditLogs.id,
        createdAt: auditLogs.createdAt,
        actor: users.displayName,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        outcome: auditLogs.outcome,
        metadata: auditLogs.metadata,
      }).from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ total: count() }).from(auditLogs).where(where),
    ]);
    const total = Number(totals[0]?.total ?? 0);
    return Response.json({
      items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), actor: item.actor ?? "Sistema" })),
      page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), from: from.toISOString(), to: to.toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
