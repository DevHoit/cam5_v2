import type { NextRequest } from "next/server";
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { evaluateStaleCommunications } from "../../../../db/alarm-engine";
import {
  alarms,
  assets,
  channels,
  userAssetScopes,
  userRoleAssignments,
  users,
} from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["open", "acknowledged", "resolved", "closed"] as const;
const VALID_SEVERITIES = ["normal", "warning", "critical"] as const;
const VALID_KINDS = ["threshold", "communication", "data_quality"] as const;

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "alarms.read");
    const { page, pageSize, offset } = parsePage(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const status = request.nextUrl.searchParams.get("status") || "all";
    const severity = request.nextUrl.searchParams.get("severity") || "all";
    const kind = request.nextUrl.searchParams.get("kind") || "all";
    const assetId = request.nextUrl.searchParams.get("assetId") || "";
    if (status !== "all" && status !== "active" && !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) throw new ApiError(400, "El estado indicado no es válido.");
    if (severity !== "all" && !VALID_SEVERITIES.includes(severity as typeof VALID_SEVERITIES[number])) throw new ApiError(400, "La severidad indicada no es válida.");
    if (kind !== "all" && !VALID_KINDS.includes(kind as typeof VALID_KINDS[number])) throw new ApiError(400, "El origen indicado no es válido.");

    await evaluateStaleCommunications(db, user.siteId).catch((error: unknown) => console.error("No fue posible revisar comunicaciones atrasadas", error));
    const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, user.id));
    const allowedAssetIds = scopes.map((scope) => scope.assetId);
    const baseFilters: SQL[] = [eq(alarms.siteId, user.siteId)];
    if (allowedAssetIds.length) baseFilters.push(inArray(alarms.assetId, allowedAssetIds));
    if (assetId) {
      if (allowedAssetIds.length && !allowedAssetIds.includes(assetId)) throw new ApiError(403, "No tienes acceso al punto de medición indicado.");
      baseFilters.push(eq(alarms.assetId, assetId));
    }
    const filters = [...baseFilters];
    if (status === "active") filters.push(inArray(alarms.status, ["open", "acknowledged"]));
    else if (VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) filters.push(eq(alarms.status, status as typeof VALID_STATUSES[number]));
    if (VALID_SEVERITIES.includes(severity as typeof VALID_SEVERITIES[number])) filters.push(eq(alarms.severity, severity as typeof VALID_SEVERITIES[number]));
    if (VALID_KINDS.includes(kind as typeof VALID_KINDS[number])) filters.push(eq(alarms.kind, kind));
    if (q) filters.push(or(
      ilike(alarms.code, `%${q}%`),
      ilike(alarms.title, `%${q}%`),
      ilike(alarms.detail, `%${q}%`),
      ilike(assets.code, `%${q}%`),
      ilike(assets.name, `%${q}%`),
      ilike(channels.code, `%${q}%`),
    )!);
    const where = and(...filters);
    const assignedUser = alias(users, "alarm_assigned_user");

    const [records, totals, summaryRows, assignees] = await Promise.all([
      db.select({
        id: alarms.id,
        code: alarms.code,
        kind: alarms.kind,
        severity: alarms.severity,
        status: alarms.status,
        title: alarms.title,
        detail: alarms.detail,
        triggerValue: alarms.triggerValue,
        thresholdValue: alarms.thresholdValue,
        openedAt: alarms.openedAt,
        lastObservedAt: alarms.lastObservedAt,
        acknowledgedAt: alarms.acknowledgedAt,
        resolvedAt: alarms.resolvedAt,
        closedAt: alarms.closedAt,
        occurrenceCount: alarms.occurrenceCount,
        assignedToId: alarms.assignedTo,
        assignedToName: assignedUser.displayName,
        assetId: assets.id,
        assetCode: assets.code,
        assetName: assets.name,
        channelId: channels.id,
        channelCode: channels.code,
        channelName: channels.name,
        unit: channels.unit,
      }).from(alarms)
        .innerJoin(assets, eq(assets.id, alarms.assetId))
        .leftJoin(channels, eq(channels.id, alarms.channelId))
        .leftJoin(assignedUser, eq(assignedUser.id, alarms.assignedTo))
        .where(where)
        .orderBy(desc(alarms.openedAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ total: count() }).from(alarms)
        .innerJoin(assets, eq(assets.id, alarms.assetId))
        .leftJoin(channels, eq(channels.id, alarms.channelId))
        .where(where),
      db.select({
        critical: sql<number>`count(*) filter (where ${alarms.severity} = 'critical' and ${alarms.status} in ('open', 'acknowledged'))`,
        warning: sql<number>`count(*) filter (where ${alarms.severity} = 'warning' and ${alarms.status} in ('open', 'acknowledged'))`,
        resolved: sql<number>`count(*) filter (where ${alarms.status} = 'resolved')`,
        unassigned: sql<number>`count(*) filter (where ${alarms.status} in ('open', 'acknowledged') and ${alarms.assignedTo} is null)`,
        mttaMinutes: sql<number>`coalesce(avg(extract(epoch from (${alarms.acknowledgedAt} - ${alarms.openedAt})) / 60) filter (where ${alarms.acknowledgedAt} is not null), 0)`,
      }).from(alarms).where(and(...baseFilters)),
      db.selectDistinct({ id: users.id, name: users.displayName }).from(users)
        .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
        .where(and(eq(userRoleAssignments.siteId, user.siteId), eq(users.status, "active")))
        .orderBy(users.displayName),
    ]);

    const total = Number(totals[0]?.total ?? 0);
    const summary = summaryRows[0];
    return Response.json({
      items: records.map((record) => ({
        ...record,
        triggerValue: record.triggerValue === null ? null : Number(record.triggerValue),
        thresholdValue: record.thresholdValue === null ? null : Number(record.thresholdValue),
        openedAt: record.openedAt.toISOString(),
        lastObservedAt: record.lastObservedAt.toISOString(),
        acknowledgedAt: record.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: record.resolvedAt?.toISOString() ?? null,
        closedAt: record.closedAt?.toISOString() ?? null,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      summary: {
        critical: Number(summary?.critical ?? 0),
        warning: Number(summary?.warning ?? 0),
        resolved: Number(summary?.resolved ?? 0),
        unassigned: Number(summary?.unassigned ?? 0),
        mttaMinutes: Math.round(Number(summary?.mttaMinutes ?? 0) * 10) / 10,
      },
      assignees,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
