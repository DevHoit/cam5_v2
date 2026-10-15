import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { alarms, assets, userAssetScopes } from "./schema";

async function authorizedAlarms(db: Cam5Database, userId: string, siteId: string): Promise<SQL[]> {
  const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, userId));
  const filters = [eq(alarms.siteId, siteId), eq(assets.siteId, siteId), eq(assets.active, true)];
  if (scopes.length) filters.push(inArray(alarms.assetId, scopes.map((scope) => scope.assetId)));
  return filters;
}

/** Site-wide counts, independent of pagination, search and the selected asset. */
export async function siteAlarmSummary(db: Cam5Database, userId: string, siteId: string) {
  const filters = await authorizedAlarms(db, userId, siteId);
  const [row] = await db.select({
    critical: sql<number>`count(*) filter (where ${alarms.severity} = 'critical' and ${alarms.status} in ('open', 'acknowledged'))`,
    warning: sql<number>`count(*) filter (where ${alarms.severity} = 'warning' and ${alarms.status} in ('open', 'acknowledged'))`,
    unacknowledgedCritical: sql<number>`count(*) filter (where ${alarms.severity} = 'critical' and ${alarms.status} = 'open')`,
  }).from(alarms).innerJoin(assets, eq(assets.id, alarms.assetId)).where(and(...filters));
  return { critical: Number(row?.critical ?? 0), warning: Number(row?.warning ?? 0), unacknowledgedCritical: Number(row?.unacknowledgedCritical ?? 0) };
}

export async function searchSiteCriticalAlarms(db: Cam5Database, userId: string, siteId: string, query: string) {
  const filters = await authorizedAlarms(db, userId, siteId);
  filters.push(eq(alarms.severity, "critical"), inArray(alarms.status, ["open", "acknowledged"]));
  // Treat search characters literally, rather than SQL wildcard operators.
  const term = `%${query.trim().slice(0, 120).replace(/[\\%_]/g, "\\$&")}%`;
  if (query.trim()) filters.push(or(ilike(alarms.code, term), ilike(alarms.title, term), ilike(assets.name, term), ilike(assets.code, term))!);
  const where = and(...filters);
  const [items, totals] = await Promise.all([
    db.select({ id: alarms.id, code: alarms.code, title: alarms.title, assetId: alarms.assetId, assetName: assets.name })
      .from(alarms).innerJoin(assets, eq(assets.id, alarms.assetId)).where(where).orderBy(desc(alarms.openedAt), alarms.id).limit(20),
    db.select({ total: count() }).from(alarms).innerJoin(assets, eq(assets.id, alarms.assetId)).where(where),
  ]);
  return { items, total: Number(totals[0]?.total ?? 0) };
}
