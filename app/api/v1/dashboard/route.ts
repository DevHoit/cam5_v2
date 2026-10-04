import type { NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  alarms,
  assets,
  devices,
  gateways,
  maintenanceWindows,
  sites,
} from "../../../../db/schema";
import { apiErrorResponse, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "overview.read");
    const now = new Date();
    const clientSiteIds = user.sites
      .filter((site) => site.clientId === user.clientId)
      .map((site) => site.id);

    const [siteRows, assetRows, gatewayRows, deviceRows, alarmRows, maintenanceRows] = await Promise.all([
      clientSiteIds.length
        ? db.select({
            id: sites.id,
            code: sites.code,
            name: sites.name,
          }).from(sites)
            .where(and(inArray(sites.id, clientSiteIds), eq(sites.active, true)))
            .orderBy(sites.name)
        : Promise.resolve([]),
      clientSiteIds.length
        ? db.select({
            id: assets.id,
            siteId: assets.siteId,
            code: assets.code,
            name: assets.name,
            area: assets.area,
            assetType: assets.assetType,
            state: assets.state,
            active: assets.active,
          }).from(assets)
            .where(and(inArray(assets.siteId, clientSiteIds), eq(assets.active, true)))
            .orderBy(assets.code)
        : Promise.resolve([]),
      clientSiteIds.length
        ? db.select({
            id: gateways.id,
            siteId: gateways.siteId,
            state: gateways.state,
            active: gateways.active,
          }).from(gateways)
            .where(and(inArray(gateways.siteId, clientSiteIds), eq(gateways.active, true)))
        : Promise.resolve([]),
      clientSiteIds.length
        ? db.select({
            id: devices.id,
            siteId: assets.siteId,
            assetId: devices.assetId,
            state: devices.state,
            active: devices.active,
            lastReadAt: devices.lastReadAt,
          }).from(devices)
            .innerJoin(assets, eq(assets.id, devices.assetId))
            .where(and(inArray(assets.siteId, clientSiteIds), eq(devices.active, true)))
        : Promise.resolve([]),
      clientSiteIds.length
        ? db.select({
            id: alarms.id,
            siteId: alarms.siteId,
            assetId: alarms.assetId,
            code: alarms.code,
            severity: alarms.severity,
            status: alarms.status,
            title: alarms.title,
            openedAt: alarms.openedAt,
            assetCode: assets.code,
            assetName: assets.name,
          }).from(alarms)
            .innerJoin(assets, eq(assets.id, alarms.assetId))
            .where(and(
              inArray(alarms.siteId, clientSiteIds),
              inArray(alarms.status, ["open", "acknowledged"]),
            ))
            .orderBy(desc(alarms.openedAt))
            .limit(100)
        : Promise.resolve([]),
      db.select({
        id: maintenanceWindows.id,
        scopeType: maintenanceWindows.scopeType,
        scopeId: maintenanceWindows.scopeId,
        startsAt: maintenanceWindows.startsAt,
        endsAt: maintenanceWindows.endsAt,
        cancelledAt: maintenanceWindows.cancelledAt,
      }).from(maintenanceWindows)
        .where(eq(maintenanceWindows.clientId, user.clientId)),
    ]);

    const activeMaintenance = maintenanceRows.filter((item) =>
      !item.cancelledAt && item.startsAt <= now && item.endsAt > now
    ).length;
    const scheduledMaintenance = maintenanceRows.filter((item) =>
      !item.cancelledAt && item.startsAt > now
    ).length;

    const critical = alarmRows.filter((item) => item.severity === "critical").length;
    const warning = alarmRows.filter((item) => item.severity === "warning").length;
    const unhealthyGateways = gatewayRows.filter((item) => item.state !== "online").length;
    const unhealthyDevices = deviceRows.filter((item) => !["active", "online", "normal"].includes(item.state)).length;
    const healthyAssets = assetRows.filter((item) => item.state === "normal").length;

    const sitesSummary = siteRows.map((site) => {
      const siteAssets = assetRows.filter((item) => item.siteId === site.id);
      const siteAlarms = alarmRows.filter((item) => item.siteId === site.id);
      const siteGateways = gatewayRows.filter((item) => item.siteId === site.id);
      const siteDevices = deviceRows.filter((item) => item.siteId === site.id);
      const normal = siteAssets.filter((item) => item.state === "normal").length;
      return {
        id: site.id,
        code: site.code,
        name: site.name,
        assets: siteAssets.length,
        normalAssets: normal,
        criticalAlarms: siteAlarms.filter((item) => item.severity === "critical").length,
        warningAlarms: siteAlarms.filter((item) => item.severity === "warning").length,
        gatewaysOnline: siteGateways.filter((item) => item.state === "online").length,
        gatewaysTotal: siteGateways.length,
        devicesOnline: siteDevices.filter((item) => ["active", "online", "normal"].includes(item.state)).length,
        devicesTotal: siteDevices.length,
        healthPercent: siteAssets.length ? Math.round(normal / siteAssets.length * 100) : 100,
      };
    });

    const assetAlarmScore = new Map<string, { critical: number; warning: number; latestAt: Date }>();
    for (const alarm of alarmRows) {
      const current = assetAlarmScore.get(alarm.assetId) ?? { critical: 0, warning: 0, latestAt: alarm.openedAt };
      if (alarm.severity === "critical") current.critical += 1;
      if (alarm.severity === "warning") current.warning += 1;
      if (alarm.openedAt > current.latestAt) current.latestAt = alarm.openedAt;
      assetAlarmScore.set(alarm.assetId, current);
    }

    const priorityAssets = assetRows
      .map((asset) => {
        const score = assetAlarmScore.get(asset.id) ?? { critical: 0, warning: 0, latestAt: new Date(0) };
        return {
          id: asset.id,
          siteId: asset.siteId,
          code: asset.code,
          name: asset.name,
          area: asset.area,
          assetType: asset.assetType,
          state: asset.state,
          criticalAlarms: score.critical,
          warningAlarms: score.warning,
          latestAlarmAt: score.latestAt.getTime() ? score.latestAt.toISOString() : null,
          score: score.critical * 100 + score.warning * 10 + (asset.state === "offline" ? 5 : 0),
        };
      })
      .filter((asset) => asset.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 8)
      .map(({ score: _score, ...asset }) => asset);

    return Response.json({
      generatedAt: now.toISOString(),
      client: { id: user.clientId, code: user.clientCode, name: user.clientName },
      activeSiteId: user.siteId,
      summary: {
        sites: siteRows.length,
        assets: assetRows.length,
        healthyAssets,
        devices: deviceRows.length,
        gateways: gatewayRows.length,
        critical,
        warning,
        unhealthyGateways,
        unhealthyDevices,
        activeMaintenance,
        scheduledMaintenance,
      },
      sites: sitesSummary,
      priorityAssets,
      priorityAlarms: alarmRows.slice(0, 8).map((alarm) => ({
        ...alarm,
        openedAt: alarm.openedAt.toISOString(),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
