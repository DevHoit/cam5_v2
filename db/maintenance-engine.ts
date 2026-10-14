import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { assets, maintenanceWindows, sites } from "./schema";

export type MaintenanceScopeType = "tenant" | "site" | "area" | "asset" | "device";

export async function activeMaintenanceWindows(
  db: Cam5Database,
  input: {
    siteId: string;
    assetId?: string | null;
    deviceId?: string | null;
    at?: Date;
  },
) {
  const at = input.at ?? new Date();
  const [site] = await db.select({ clientId: sites.clientId })
    .from(sites)
    .where(eq(sites.id, input.siteId))
    .limit(1);
  if (!site) return [];

  const [asset] = input.assetId
    ? await db.select({ siteId: assets.siteId, areaId: assets.areaId })
      .from(assets)
      .where(eq(assets.id, input.assetId))
      .limit(1)
    : [];

  if (asset && asset.siteId !== input.siteId) return [];

  const scopes = [
    and(eq(maintenanceWindows.scopeType, "tenant"), eq(maintenanceWindows.scopeId, site.clientId)),
    and(eq(maintenanceWindows.scopeType, "site"), eq(maintenanceWindows.scopeId, input.siteId)),
    ...(asset?.areaId
      ? [and(eq(maintenanceWindows.scopeType, "area"), eq(maintenanceWindows.scopeId, asset.areaId))]
      : []),
    ...(input.assetId
      ? [and(eq(maintenanceWindows.scopeType, "asset"), eq(maintenanceWindows.scopeId, input.assetId))]
      : []),
    ...(input.deviceId
      ? [and(eq(maintenanceWindows.scopeType, "device"), eq(maintenanceWindows.scopeId, input.deviceId))]
      : []),
  ];

  return db.select({
    id: maintenanceWindows.id,
    scopeType: maintenanceWindows.scopeType,
    scopeId: maintenanceWindows.scopeId,
    reason: maintenanceWindows.reason,
    startsAt: maintenanceWindows.startsAt,
    endsAt: maintenanceWindows.endsAt,
  }).from(maintenanceWindows)
    .where(and(
      eq(maintenanceWindows.clientId, site.clientId),
      lte(maintenanceWindows.startsAt, at),
      gt(maintenanceWindows.endsAt, at),
      isNull(maintenanceWindows.cancelledAt),
      or(...scopes),
    ))
    .orderBy(maintenanceWindows.startsAt);
}

export async function isMaintenanceActive(
  db: Cam5Database,
  input: {
    siteId: string;
    assetId?: string | null;
    deviceId?: string | null;
    at?: Date;
  },
) {
  return (await activeMaintenanceWindows(db, input)).length > 0;
}

export async function batchIsMaintenanceActive(
  db: Cam5Database,
  targets: Array<{
    siteId: string;
    assetId?: string | null;
    deviceId?: string | null;
  }>,
  at = new Date(),
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (!targets.length) return result;

  const siteIds = [...new Set(targets.map((t) => t.siteId))];
  const siteRows = await db.select({ id: sites.id, clientId: sites.clientId })
    .from(sites)
    .where(or(...siteIds.map((id) => eq(sites.id, id))));

  const clientBySite = new Map(siteRows.map((s) => [s.id, s.clientId]));
  const clientIds = [...new Set(siteRows.map((s) => s.clientId))];

  if (!clientIds.length) {
    for (const t of targets) {
      result.set(`${t.siteId}:${t.assetId ?? ""}:${t.deviceId ?? ""}`, false);
    }
    return result;
  }

  const activeWindows = await db.select({
    id: maintenanceWindows.id,
    clientId: maintenanceWindows.clientId,
    scopeType: maintenanceWindows.scopeType,
    scopeId: maintenanceWindows.scopeId,
  }).from(maintenanceWindows)
    .where(and(
      or(...clientIds.map((id) => eq(maintenanceWindows.clientId, id))),
      lte(maintenanceWindows.startsAt, at),
      gt(maintenanceWindows.endsAt, at),
      isNull(maintenanceWindows.cancelledAt),
    ));

  const assetIds = [...new Set(targets.map((t) => t.assetId).filter(Boolean) as string[])];
  const assetRows = assetIds.length
    ? await db.select({ id: assets.id, areaId: assets.areaId })
      .from(assets)
      .where(or(...assetIds.map((id) => eq(assets.id, id))))
    : [];
  const areaByAsset = new Map(assetRows.map((a) => [a.id, a.areaId]));

  for (const t of targets) {
    const clientId = clientBySite.get(t.siteId);
    const areaId = t.assetId ? areaByAsset.get(t.assetId) : null;
    const key = `${t.siteId}:${t.assetId ?? ""}:${t.deviceId ?? ""}`;

    if (!clientId) {
      result.set(key, false);
      continue;
    }

    const isActive = activeWindows.some((w) => {
      if (w.clientId !== clientId) return false;
      if (w.scopeType === "tenant" && w.scopeId === clientId) return true;
      if (w.scopeType === "site" && w.scopeId === t.siteId) return true;
      if (w.scopeType === "area" && areaId && w.scopeId === areaId) return true;
      if (w.scopeType === "asset" && t.assetId && w.scopeId === t.assetId) return true;
      if (w.scopeType === "device" && t.deviceId && w.scopeId === t.deviceId) return true;
      return false;
    });

    result.set(key, isActive);
  }

  return result;
}
