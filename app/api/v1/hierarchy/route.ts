import type { NextRequest } from "next/server";
import { and, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import {
  alarms,
  assets,
  auditLogs,
  clients,
  deviceModels,
  devices,
  gatewayApiCredentials,
  gateways,
  ingestionBatches,
  readingProfiles,
  roles,
  sites,
  userClientAssignments,
  userRoleAssignments,
  workOrders,
} from "../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

type ResourceType = "client" | "site" | "point" | "gateway" | "controller";

function textField(body: Record<string, unknown>, field: string, label: string, minimum = 2) {
  const value = typeof body[field] === "string" ? body[field].trim() : "";
  if (value.length < minimum) throw new ApiError(400, `${label} es obligatorio.`);
  return value;
}

function optionalText(body: Record<string, unknown>, field: string) {
  return typeof body[field] === "string" && body[field].trim() ? body[field].trim() : null;
}

function requirePermission(permissions: string[], permission: string) {
  if (!permissions.includes(permission)) throw new ApiError(403, "No tienes permisos para realizar esta acción.");
}

function assertSiteAccess(siteIds: string[], siteId: string) {
  if (!siteIds.includes(siteId)) throw new ApiError(403, "No tienes acceso al sitio indicado.");
}

function parseResource(body: Record<string, unknown>) {
  const resource = body.resource;
  if (!(["client", "site", "point", "gateway", "controller"] as const).includes(resource as ResourceType)) {
    throw new ApiError(400, "El tipo de elemento no es válido.");
  }
  return resource as ResourceType;
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "assets.read");
    const now = new Date();
    const [clientRows, siteMembershipRows] = await Promise.all([
      db.select({ id: clients.id, code: clients.code, name: clients.name, legalName: clients.legalName, taxId: clients.taxId, contactEmail: clients.contactEmail, active: clients.active, roleKey: roles.key, roleName: roles.name })
        .from(userClientAssignments)
        .innerJoin(clients, eq(clients.id, userClientAssignments.clientId))
        .innerJoin(roles, eq(roles.id, userClientAssignments.roleId))
        .where(eq(userClientAssignments.userId, user.id))
        .orderBy(clients.name),
      db.select({
        id: sites.id,
        code: sites.code,
        name: sites.name,
        description: sites.description,
        timezone: sites.timezone,
        active: sites.active,
        clientId: clients.id,
        clientCode: clients.code,
        clientName: clients.name,
        roleKey: roles.key,
        roleName: roles.name,
      }).from(userRoleAssignments)
        .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
        .innerJoin(sites, eq(sites.id, userRoleAssignments.siteId))
        .innerJoin(clients, eq(clients.id, sites.clientId))
        .where(and(eq(userRoleAssignments.userId, user.id), or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, now))))
        .orderBy(sites.name, desc(sql<number>`case ${roles.key} when 'administrator' then 4 when 'engineer' then 3 when 'operator' then 2 else 1 end`)),
    ]);
    const managedSites = siteMembershipRows.filter((site, index, rows) => rows.findIndex((candidate) => candidate.id === site.id) === index);
    const siteIds = managedSites.map((site) => site.id);
    const [pointCounts, gatewayCounts, controllerCounts, pointRows, gatewayRows, controllerRows] = await Promise.all([
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
        protocol: devices.protocol,
        host: devices.host,
        port: devices.port,
        unitId: devices.unitId,
        lastReadAt: devices.lastReadAt,
      }).from(devices)
        .innerJoin(assets, eq(assets.id, devices.assetId))
        .innerJoin(deviceModels, eq(deviceModels.id, devices.modelId))
        .where(eq(assets.siteId, user.siteId))
        .orderBy(devices.code),
    ]);

    const countFor = (rows: Array<{ siteId: string; value: number | bigint }>, siteId: string) => Number(rows.find((row) => row.siteId === siteId)?.value ?? 0);
    return Response.json({
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
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron datos.");
    const resource = parseResource(body);
    const code = textField(body, "code", "El código").toUpperCase();
    const name = textField(body, "name", "El nombre");
    const siteIds = user.sites.map((site) => site.id);
    const metadata = requestMetadata(request);

    const created = await db.transaction(async (tx) => {
      let record: Record<string, unknown>;
      if (resource === "client") {
        requirePermission(user.permissions, "users.manage");
        const [row] = await tx.insert(clients).values({
          code,
          name,
          legalName: optionalText(body, "legalName"),
          taxId: optionalText(body, "taxId"),
          contactEmail: optionalText(body, "contactEmail"),
        }).returning();
        const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, user.roleKey)).limit(1);
        if (!role) throw new ApiError(409, "No fue posible asignar el acceso al cliente.");
        await tx.insert(userClientAssignments).values({ userId: user.id, clientId: row.id, roleId: role.id, grantedBy: user.id });
        record = row;
      } else if (resource === "site") {
        requirePermission(user.permissions, "users.manage");
        const clientId = textField(body, "clientId", "El cliente");
        const [membership] = await tx.select({ id: userClientAssignments.id }).from(userClientAssignments)
          .innerJoin(clients, eq(clients.id, userClientAssignments.clientId))
          .where(and(eq(userClientAssignments.userId, user.id), eq(userClientAssignments.clientId, clientId), eq(clients.active, true))).limit(1);
        if (!membership) throw new ApiError(403, "No tienes acceso al cliente indicado.");
        const [row] = await tx.insert(sites).values({
          clientId,
          code,
          name,
          timezone: optionalText(body, "timezone") ?? "America/Santiago",
          description: optionalText(body, "description"),
        }).returning();
        const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, user.roleKey)).limit(1);
        if (!role) throw new ApiError(409, "No fue posible asignar el acceso al nuevo sitio.");
        await tx.insert(userRoleAssignments).values({ userId: user.id, roleId: role.id, siteId: row.id, grantedBy: user.id });
        record = row;
      } else if (resource === "point") {
        requirePermission(user.permissions, "assets.write");
        const siteId = typeof body.siteId === "string" ? body.siteId : user.siteId;
        assertSiteAccess(siteIds, siteId);
        const [row] = await tx.insert(assets).values({
          siteId,
          code,
          name,
          area: optionalText(body, "area"),
          assetType: optionalText(body, "type") ?? "switchgear_cabinet",
          nominalVoltageKv: typeof body.nominalVoltageKv === "number" ? String(body.nominalVoltageKv) : null,
          state: "offline",
        }).returning();
        record = row;
      } else if (resource === "gateway") {
        requirePermission(user.permissions, "settings.write");
        const siteId = typeof body.siteId === "string" ? body.siteId : user.siteId;
        assertSiteAccess(siteIds, siteId);
        const [row] = await tx.insert(gateways).values({
          siteId,
          code,
          name,
          ipAddress: optionalText(body, "ipAddress"),
          serialNumber: optionalText(body, "serialNumber"),
          softwareVersion: optionalText(body, "softwareVersion"),
          state: "pending",
        }).returning();
        record = row;
      } else {
        requirePermission(user.permissions, "settings.write");
        const pointId = textField(body, "pointId", "El punto de medición");
        const gatewayId = textField(body, "gatewayId", "El gateway");
        const [[point], [gateway], [model], [profile]] = await Promise.all([
          tx.select({ id: assets.id, siteId: assets.siteId }).from(assets).where(and(eq(assets.id, pointId), eq(assets.active, true))).limit(1),
          tx.select({ id: gateways.id, siteId: gateways.siteId }).from(gateways).where(and(eq(gateways.id, gatewayId), eq(gateways.active, true))).limit(1),
          tx.select({ id: deviceModels.id }).from(deviceModels).where(eq(deviceModels.code, "CAM5-TPH-XDCW")).limit(1),
          tx.select({ id: readingProfiles.id }).from(readingProfiles).where(eq(readingProfiles.key, "cam5-balanced-v1")).limit(1),
        ]);
        if (!point || !gateway || point.siteId !== gateway.siteId) throw new ApiError(400, "El punto y el gateway deben pertenecer al mismo sitio.");
        assertSiteAccess(siteIds, point.siteId);
        if (!model) throw new ApiError(409, "El modelo CAM5 no está configurado.");
        const host = textField(body, "host", "La dirección del controlador");
        const [row] = await tx.insert(devices).values({
          assetId: point.id,
          gatewayId: gateway.id,
          modelId: model.id,
          readingProfileId: profile?.id ?? null,
          code,
          name,
          host,
          port: typeof body.port === "number" ? body.port : 502,
          unitId: typeof body.unitId === "number" ? body.unitId : 1,
          state: "commissioning",
        }).returning();
        record = row;
      }

      await tx.insert(auditLogs).values({
        siteId: resource === "client" ? user.siteId : typeof record.siteId === "string" ? record.siteId : user.siteId,
        actorUserId: user.id,
        action: `hierarchy.${resource}.create`,
        resourceType: resource,
        resourceId: String(record.id),
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        after: record,
      });
      return record;
    });

    return Response.json({ item: created }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron cambios.");
    const resource = parseResource(body);
    const id = textField(body, "id", "El identificador");
    const metadata = requestMetadata(request);
    const siteIds = user.sites.map((site) => site.id);

    const updated = await db.transaction(async (tx) => {
      let record: Record<string, unknown> | undefined;
      if (resource === "client") {
        requirePermission(user.permissions, "users.manage");
        const [membership] = await tx.select({ id: userClientAssignments.id }).from(userClientAssignments)
          .where(and(eq(userClientAssignments.userId, user.id), eq(userClientAssignments.clientId, id))).limit(1);
        if (!membership) throw new ApiError(403, "No tienes acceso al cliente indicado.");
        if (body.active === false && id === user.clientId) throw new ApiError(409, "Cambia primero a otro cliente antes de desactivar el contexto activo.");
        [record] = await tx.update(clients).set({
          ...(typeof body.name === "string" ? { name: textField(body, "name", "El nombre") } : {}),
          ...(typeof body.legalName === "string" ? { legalName: optionalText(body, "legalName") } : {}),
          ...(typeof body.taxId === "string" ? { taxId: optionalText(body, "taxId") } : {}),
          ...(typeof body.contactEmail === "string" ? { contactEmail: optionalText(body, "contactEmail") } : {}),
          ...(typeof body.active === "boolean" ? { active: body.active } : {}),
          updatedAt: new Date(),
        }).where(eq(clients.id, id)).returning();
      } else if (resource === "site") {
        requirePermission(user.permissions, "users.manage");
        const [membership] = await tx.select({ id: userRoleAssignments.id }).from(userRoleAssignments)
          .where(and(eq(userRoleAssignments.userId, user.id), eq(userRoleAssignments.siteId, id), or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, new Date())))).limit(1);
        if (!membership) throw new ApiError(403, "No tienes acceso al sitio indicado.");
        if (body.active === false && id === user.siteId) throw new ApiError(409, "Cambia primero a otro sitio antes de desactivar el contexto activo.");
        [record] = await tx.update(sites).set({
          ...(typeof body.name === "string" ? { name: textField(body, "name", "El nombre") } : {}),
          ...(typeof body.description === "string" ? { description: optionalText(body, "description") } : {}),
          ...(typeof body.timezone === "string" ? { timezone: textField(body, "timezone", "La zona horaria") } : {}),
          ...(typeof body.active === "boolean" ? { active: body.active } : {}),
          updatedAt: new Date(),
        }).where(eq(sites.id, id)).returning();
      } else if (resource === "point") {
        requirePermission(user.permissions, "assets.write");
        const [current] = await tx.select({ siteId: assets.siteId }).from(assets).where(eq(assets.id, id)).limit(1);
        if (!current) throw new ApiError(404, "El punto de medición no existe.");
        assertSiteAccess(siteIds, current.siteId);
        [record] = await tx.update(assets).set({
          ...(typeof body.name === "string" ? { name: textField(body, "name", "El nombre") } : {}),
          ...(typeof body.area === "string" ? { area: optionalText(body, "area") } : {}),
          ...(typeof body.nominalVoltageKv === "number" || body.nominalVoltageKv === null ? { nominalVoltageKv: body.nominalVoltageKv === null ? null : String(body.nominalVoltageKv) } : {}),
          ...(typeof body.active === "boolean" ? { active: body.active, state: body.active ? "offline" : "maintenance" } : {}),
          updatedAt: new Date(),
        }).where(eq(assets.id, id)).returning();
      } else if (resource === "gateway") {
        requirePermission(user.permissions, "settings.write");
        const [current] = await tx.select({ siteId: gateways.siteId }).from(gateways).where(eq(gateways.id, id)).limit(1);
        if (!current) throw new ApiError(404, "El gateway no existe.");
        assertSiteAccess(siteIds, current.siteId);
        [record] = await tx.update(gateways).set({
          ...(typeof body.name === "string" ? { name: textField(body, "name", "El nombre") } : {}),
          ...(typeof body.ipAddress === "string" ? { ipAddress: optionalText(body, "ipAddress") } : {}),
          ...(typeof body.serialNumber === "string" ? { serialNumber: optionalText(body, "serialNumber") } : {}),
          ...(typeof body.active === "boolean" ? { active: body.active, state: body.active ? "pending" : "offline" } : {}),
          updatedAt: new Date(),
        }).where(eq(gateways.id, id)).returning();
      } else {
        requirePermission(user.permissions, "settings.write");
        const [current] = await tx.select({ siteId: assets.siteId }).from(devices).innerJoin(assets, eq(assets.id, devices.assetId)).where(eq(devices.id, id)).limit(1);
        if (!current) throw new ApiError(404, "El controlador no existe.");
        assertSiteAccess(siteIds, current.siteId);
        [record] = await tx.update(devices).set({
          ...(typeof body.name === "string" ? { name: textField(body, "name", "El nombre") } : {}),
          ...(typeof body.host === "string" ? { host: textField(body, "host", "La dirección del controlador") } : {}),
          ...(typeof body.port === "number" ? { port: body.port } : {}),
          ...(typeof body.unitId === "number" ? { unitId: body.unitId } : {}),
          ...(typeof body.active === "boolean" ? { active: body.active, state: body.active ? "commissioning" : "decommissioned" } : {}),
          updatedAt: new Date(),
        }).where(eq(devices.id, id)).returning();
      }
      if (!record) throw new ApiError(404, "El elemento no existe.");
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: `hierarchy.${resource}.update`,
        resourceType: resource,
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        after: record,
      });
      return record;
    });
    return Response.json({ item: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibió el elemento a eliminar.");
    const resource = parseResource(body);
    const id = textField(body, "id", "El identificador");
    const metadata = requestMetadata(request);
    const siteIds = user.sites.map((site) => site.id);

    await db.transaction(async (tx) => {
      let record: Record<string, unknown> | undefined;
      if (resource === "client") {
        requirePermission(user.permissions, "users.manage");
        const [membership] = await tx.select({ id: userClientAssignments.id }).from(userClientAssignments)
          .where(and(eq(userClientAssignments.userId, user.id), eq(userClientAssignments.clientId, id))).limit(1);
        if (!membership) throw new ApiError(403, "No tienes acceso al cliente indicado.");
        const [dependencies] = await tx.select({ value: count() }).from(sites).where(eq(sites.clientId, id));
        if (Number(dependencies.value)) throw new ApiError(409, "El cliente conserva sitios. Desactívalo o elimina primero sus sitios vacíos.");
        [record] = await tx.delete(clients).where(eq(clients.id, id)).returning();
      } else if (resource === "site") {
        requirePermission(user.permissions, "users.manage");
        if (id === user.siteId) throw new ApiError(409, "Cambia primero a otro sitio antes de eliminar el contexto activo.");
        const [membership] = await tx.select({ id: userRoleAssignments.id }).from(userRoleAssignments)
          .where(and(eq(userRoleAssignments.userId, user.id), eq(userRoleAssignments.siteId, id), or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, new Date())))).limit(1);
        if (!membership) throw new ApiError(403, "No tienes acceso al sitio indicado.");
        const [[pointCount], [gatewayCount], [auditCount]] = await Promise.all([
          tx.select({ value: count() }).from(assets).where(eq(assets.siteId, id)),
          tx.select({ value: count() }).from(gateways).where(eq(gateways.siteId, id)),
          tx.select({ value: count() }).from(auditLogs).where(eq(auditLogs.siteId, id)),
        ]);
        if (Number(pointCount.value) || Number(gatewayCount.value) || Number(auditCount.value)) throw new ApiError(409, "El sitio conserva puntos, gateways o auditoría. Desactívalo para preservar su trazabilidad.");
        [record] = await tx.delete(sites).where(eq(sites.id, id)).returning();
      } else if (resource === "point") {
        requirePermission(user.permissions, "assets.write");
        const [current] = await tx.select().from(assets).where(eq(assets.id, id)).limit(1);
        if (!current) throw new ApiError(404, "El punto de medición no existe.");
        assertSiteAccess(siteIds, current.siteId);
        const [[deviceCount], [alarmCount], [orderCount]] = await Promise.all([
          tx.select({ value: count() }).from(devices).where(eq(devices.assetId, id)),
          tx.select({ value: count() }).from(alarms).where(eq(alarms.assetId, id)),
          tx.select({ value: count() }).from(workOrders).where(eq(workOrders.assetId, id)),
        ]);
        if (Number(deviceCount.value) || Number(alarmCount.value) || Number(orderCount.value)) throw new ApiError(409, "El punto conserva controladores, alarmas u órdenes. Desactívalo para preservar su trazabilidad.");
        [record] = await tx.delete(assets).where(eq(assets.id, id)).returning();
      } else if (resource === "gateway") {
        requirePermission(user.permissions, "settings.write");
        const [current] = await tx.select().from(gateways).where(eq(gateways.id, id)).limit(1);
        if (!current) throw new ApiError(404, "El gateway no existe.");
        assertSiteAccess(siteIds, current.siteId);
        const [[deviceCount], [credentialCount]] = await Promise.all([
          tx.select({ value: count() }).from(devices).where(eq(devices.gatewayId, id)),
          tx.select({ value: count() }).from(gatewayApiCredentials).where(eq(gatewayApiCredentials.gatewayId, id)),
        ]);
        if (Number(deviceCount.value) || Number(credentialCount.value)) throw new ApiError(409, "El gateway conserva controladores o credenciales. Desactívalo para preservar la comunicación y auditoría.");
        [record] = await tx.delete(gateways).where(eq(gateways.id, id)).returning();
      } else {
        requirePermission(user.permissions, "settings.write");
        const [current] = await tx.select({ id: devices.id, siteId: assets.siteId }).from(devices).innerJoin(assets, eq(assets.id, devices.assetId)).where(eq(devices.id, id)).limit(1);
        if (!current) throw new ApiError(404, "El controlador no existe.");
        assertSiteAccess(siteIds, current.siteId);
        const [historyCount] = await tx.select({ value: count() }).from(ingestionBatches).where(eq(ingestionBatches.deviceId, id));
        if (Number(historyCount.value)) throw new ApiError(409, "El controlador conserva telemetría. Desactívalo para mantener el histórico.");
        [record] = await tx.delete(devices).where(eq(devices.id, id)).returning();
      }
      if (!record) throw new ApiError(404, "El elemento no existe.");
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: `hierarchy.${resource}.delete`,
        resourceType: resource,
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: record,
      });
    });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
