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
