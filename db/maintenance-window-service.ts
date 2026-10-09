import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { areas, assets, devices, maintenanceWindows, sites } from "./schema";

export const MAINTENANCE_SCOPE_TYPES = ["tenant", "site", "area", "asset", "device"] as const;
export type MaintenanceScopeType = (typeof MAINTENANCE_SCOPE_TYPES)[number];

export async function resolveMaintenanceScope(
  db: Cam5Database,
  input: { clientId: string; siteId: string; scopeType: MaintenanceScopeType; scopeId: string },
) {
  if (input.scopeType === "tenant") {
    if (input.scopeId !== input.clientId) return null;
    return { clientId: input.clientId, siteId: input.siteId, scopeType: input.scopeType, scopeId: input.scopeId };
  }

  if (input.scopeType === "site") {
    const [site] = await db.select({ id: sites.id, clientId: sites.clientId }).from(sites)
      .where(and(eq(sites.id, input.scopeId), eq(sites.id, input.siteId), eq(sites.clientId, input.clientId)))
      .limit(1);
    return site ? { clientId: site.clientId, siteId: site.id, scopeType: input.scopeType, scopeId: site.id } : null;
  }

  if (input.scopeType === "area") {
    const [area] = await db.select({ id: areas.id, clientId: areas.clientId, siteId: areas.siteId }).from(areas)
      .where(and(
        eq(areas.id, input.scopeId),
        eq(areas.clientId, input.clientId),
        eq(areas.siteId, input.siteId),
      ))
      .limit(1);
    return area ? { clientId: area.clientId, siteId: area.siteId, scopeType: input.scopeType, scopeId: area.id } : null;
  }

  if (input.scopeType === "asset") {
    const [asset] = await db.select({ id: assets.id, siteId: assets.siteId, clientId: sites.clientId }).from(assets)
      .innerJoin(sites, eq(sites.id, assets.siteId))
      .where(and(
        eq(assets.id, input.scopeId),
        eq(assets.siteId, input.siteId),
        eq(sites.clientId, input.clientId),
      ))
      .limit(1);
    return asset ? { clientId: asset.clientId, siteId: asset.siteId, scopeType: input.scopeType, scopeId: asset.id } : null;
  }

  const [device] = await db.select({
    id: devices.id,
    siteId: assets.siteId,
    clientId: sites.clientId,
  }).from(devices)
    .innerJoin(assets, eq(assets.id, devices.assetId))
    .innerJoin(sites, eq(sites.id, assets.siteId))
    .where(and(
      eq(devices.id, input.scopeId),
      eq(assets.siteId, input.siteId),
      eq(sites.clientId, input.clientId),
    ))
    .limit(1);
  return device ? { clientId: device.clientId, siteId: device.siteId, scopeType: input.scopeType, scopeId: device.id } : null;
}

export async function listMaintenanceWindowsForSite(
  db: Cam5Database,
  input: { clientId: string; siteId: string },
) {
  const [areaRows, assetRows, deviceRows] = await Promise.all([
    db.select({ id: areas.id }).from(areas)
      .where(and(eq(areas.clientId, input.clientId), eq(areas.siteId, input.siteId))),
    db.select({ id: assets.id }).from(assets).where(eq(assets.siteId, input.siteId)),
    db.select({ id: devices.id }).from(devices)
      .innerJoin(assets, eq(assets.id, devices.assetId))
      .where(eq(assets.siteId, input.siteId)),
  ]);

  const areaIds = areaRows.map((row) => row.id);
  const assetIds = assetRows.map((row) => row.id);
  const deviceIds = deviceRows.map((row) => row.id);
  const scopePredicates = [
    and(eq(maintenanceWindows.scopeType, "tenant"), eq(maintenanceWindows.scopeId, input.clientId)),
    and(eq(maintenanceWindows.scopeType, "site"), eq(maintenanceWindows.scopeId, input.siteId)),
    ...(areaIds.length
      ? [and(eq(maintenanceWindows.scopeType, "area"), inArray(maintenanceWindows.scopeId, areaIds))]
      : []),
    ...(assetIds.length
      ? [and(eq(maintenanceWindows.scopeType, "asset"), inArray(maintenanceWindows.scopeId, assetIds))]
      : []),
    ...(deviceIds.length
      ? [and(eq(maintenanceWindows.scopeType, "device"), inArray(maintenanceWindows.scopeId, deviceIds))]
      : []),
  ];

  return db.select().from(maintenanceWindows)
    .where(and(
      eq(maintenanceWindows.clientId, input.clientId),
      or(...scopePredicates),
    ))
    .orderBy(desc(maintenanceWindows.startsAt), desc(maintenanceWindows.createdAt));
}

export function maintenanceWindowStatus(
  window: Pick<typeof maintenanceWindows.$inferSelect, "startsAt" | "endsAt" | "cancelledAt">,
  at = new Date(),
) {
  if (window.cancelledAt) return "cancelled" as const;
  if (window.endsAt <= at) return "expired" as const;
  if (window.startsAt <= at) return "active" as const;
  return "scheduled" as const;
}
