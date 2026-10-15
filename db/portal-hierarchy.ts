import { count, eq, inArray } from "drizzle-orm";
import type { Cam5Database } from "./index";
import type { AuthenticatedPortalUser } from "./auth";
import { assets, clients, devices, deviceModels, gateways, sites } from "./schema";

export async function portalHierarchy(db: Cam5Database, user: AuthenticatedPortalUser) {
    const siteIds = user.sites.map((site) => site.id);
    const clientIds = [...new Set(user.clientScopes.map((client) => client.id))];
    const [clientBaseRows, siteBaseRows, pointCounts, gatewayCounts, controllerCounts, pointRows, gatewayRows, controllerRows, modelRows] = await Promise.all([
      clientIds.length
        ? db.select({ id: clients.id, code: clients.code, name: clients.name, legalName: clients.legalName, taxId: clients.taxId, contactEmail: clients.contactEmail, active: clients.active })
            .from(clients).where(inArray(clients.id, clientIds)).orderBy(clients.name)
        : Promise.resolve([]),
      siteIds.length
        ? db.select({
            id: sites.id,
            code: sites.code,
            name: sites.name,
            description: sites.description,
            timezone: sites.timezone,
            active: sites.active,
            clientId: clients.id,
            clientCode: clients.code,
            clientName: clients.name,
          }).from(sites)
            .innerJoin(clients, eq(clients.id, sites.clientId))
            .where(inArray(sites.id, siteIds))
            .orderBy(clients.name, sites.name)
        : Promise.resolve([]),

      db.select({ siteId: assets.siteId, value: count() }).from(assets).where(inArray(assets.siteId, siteIds)).groupBy(assets.siteId),
      db.select({ siteId: gateways.siteId, value: count() }).from(gateways).where(inArray(gateways.siteId, siteIds)).groupBy(gateways.siteId),
      db.select({ siteId: assets.siteId, value: count() }).from(devices).innerJoin(assets, eq(assets.id, devices.assetId)).where(inArray(assets.siteId, siteIds)).groupBy(assets.siteId),
      db.select({
        id: assets.id,
        siteId: assets.siteId,
        code: assets.code,
        name: assets.name,
        area: assets.area,
        type: assets.assetType,
        nominalVoltageKv: assets.nominalVoltageKv,
        state: assets.state,
        active: assets.active,
      }).from(assets).where(eq(assets.siteId, user.siteId)).orderBy(assets.code),
      db.select({
        id: gateways.id,
        siteId: gateways.siteId,
        code: gateways.code,
        name: gateways.name,
        serialNumber: gateways.serialNumber,
        softwareVersion: gateways.softwareVersion,
        state: gateways.state,
        active: gateways.active,
        lastSeenAt: gateways.lastSeenAt,
        ipAddress: gateways.ipAddress,
      }).from(gateways).where(eq(gateways.siteId, user.siteId)).orderBy(gateways.code),
      db.select({
        id: devices.id,
        pointId: devices.assetId,
        gatewayId: devices.gatewayId,
        code: devices.code,
        name: devices.name,
        model: deviceModels.name,
        serialNumber: devices.serialNumber,
        state: devices.state,
        active: devices.active,
        lastReadAt: devices.lastReadAt,
      }).from(devices)
        .innerJoin(assets, eq(assets.id, devices.assetId))
        .innerJoin(deviceModels, eq(deviceModels.id, devices.modelId))
        .where(eq(assets.siteId, user.siteId))
        .orderBy(devices.code),
      db.select({
        id: deviceModels.id,
        code: deviceModels.code,
        manufacturer: deviceModels.manufacturer,
        name: deviceModels.name,
        capabilities: deviceModels.capabilities,
      }).from(deviceModels).orderBy(deviceModels.manufacturer, deviceModels.name),
        ]);
    const clientRows = clientBaseRows.map((client) => {
      const scope = user.clientScopes.find((item) => item.id === client.id);
      return { ...client, roleKey: scope?.roleKey ?? "viewer", roleName: scope?.roleName ?? "Solo lectura" };
    });
    const managedSites = siteBaseRows.map((site) => {
      const scope = user.sites.find((item) => item.id === site.id);
      return { ...site, roleKey: scope?.roleKey ?? "viewer", roleName: scope?.roleName ?? "Solo lectura" };
    });

    const countFor = (rows: Array<{ siteId: string; value: number | bigint }>, siteId: string) => Number(rows.find((row) => row.siteId === siteId)?.value ?? 0);
    return {
      active: {
        clientId: user.clientId,
        clientCode: user.clientCode,
        clientName: user.clientName,
        siteId: user.siteId,
        siteCode: user.siteCode,
        siteName: user.siteName,
      },
      clients: clientRows,
      sites: managedSites.map((site) => ({
        ...site,
        pointCount: countFor(pointCounts, site.id),
        gatewayCount: countFor(gatewayCounts, site.id),
        controllerCount: countFor(controllerCounts, site.id),
      })),
      points: pointRows.map((point) => ({ ...point, nominalVoltageKv: point.nominalVoltageKv ? Number(point.nominalVoltageKv) : null })),
      gateways: gatewayRows.map((gateway) => ({ ...gateway, lastSeenAt: gateway.lastSeenAt?.toISOString() ?? null })),
      controllers: controllerRows.map((controller) => ({ ...controller, lastReadAt: controller.lastReadAt?.toISOString() ?? null })),
      deviceModels: modelRows,
    };
}
