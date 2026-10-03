import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { clients, roles, sites, userClientAssignments, userRoleAssignments } from "./schema";
import type { PortalRoleKey } from "./access-control";

export type PortalScopeRole = {
  roleId: string;
  roleKey: PortalRoleKey;
  roleName: string;
};

export type PortalSiteScopeRecord = PortalScopeRole & {
  siteId: string;
  siteCode: string;
  siteName: string;
  clientId: string;
  clientCode: string;
  clientName: string;
};

export type PortalClientScopeRecord = PortalScopeRole & {
  clientId: string;
  clientCode: string;
  clientName: string;
};

const ROLE_RANK: Record<PortalRoleKey, number> = {
  platform_admin: 60,
  client_admin: 50,
  site_admin: 40,
  engineer: 30,
  operator: 20,
  viewer: 10,
};

function roleKey(value: string): PortalRoleKey | null {
  // Transitional compatibility: deployments can receive the new application
  // before migration 0023 is executed against the shared database. Legacy
  // administrator assignments were always site-scoped, so interpret them as
  // site_admin until the migration rewrites and removes that role.
  if (value === "administrator") return "site_admin";
  return ["platform_admin", "client_admin", "site_admin", "engineer", "operator", "viewer"].includes(value)
    ? value as PortalRoleKey
    : null;
}

export async function resolveUserAccessScopes(db: Cam5Database, userId: string, now = new Date()) {
  const [globalRows, clientRows, explicitRows] = await Promise.all([
    db.select({
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
    }).from(userRoleAssignments)
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .where(and(
        eq(userRoleAssignments.userId, userId),
        isNull(userRoleAssignments.siteId),
        eq(roles.key, "platform_admin"),
        or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, now)),
      )),
    db.select({
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      clientId: clients.id,
      clientCode: clients.code,
      clientName: clients.name,
    }).from(userClientAssignments)
      .innerJoin(roles, eq(roles.id, userClientAssignments.roleId))
      .innerJoin(clients, eq(clients.id, userClientAssignments.clientId))
      .where(and(
        eq(userClientAssignments.userId, userId),
        eq(roles.key, "client_admin"),
        eq(clients.active, true),
      )),
    db.select({
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      siteId: sites.id,
      siteCode: sites.code,
      siteName: sites.name,
      clientId: clients.id,
      clientCode: clients.code,
      clientName: clients.name,
    }).from(userRoleAssignments)
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .innerJoin(sites, eq(sites.id, userRoleAssignments.siteId))
      .innerJoin(clients, eq(clients.id, sites.clientId))
      .where(and(
        eq(userRoleAssignments.userId, userId),
        eq(sites.active, true),
        eq(clients.active, true),
        or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, now)),
      )),
  ]);

  const global = globalRows.map((row) => ({ ...row, roleKey: roleKey(row.roleKey) })).find((row) => row.roleKey === "platform_admin") ?? null;
  const siteMap = new Map<string, PortalSiteScopeRecord>();
  const clientMap = new Map<string, PortalClientScopeRecord>();

  const assignSite = (scope: PortalSiteScopeRecord) => {
    const current = siteMap.get(scope.siteId);
    if (!current || ROLE_RANK[scope.roleKey] > ROLE_RANK[current.roleKey]) siteMap.set(scope.siteId, scope);
  };
  const assignClient = (scope: PortalClientScopeRecord) => {
    const current = clientMap.get(scope.clientId);
    if (!current || ROLE_RANK[scope.roleKey] > ROLE_RANK[current.roleKey]) clientMap.set(scope.clientId, scope);
  };

  if (global?.roleKey) {
    const [allSites, allClients] = await Promise.all([
      db.select({
        siteId: sites.id,
        siteCode: sites.code,
        siteName: sites.name,
        clientId: clients.id,
        clientCode: clients.code,
        clientName: clients.name,
      }).from(sites).innerJoin(clients, eq(clients.id, sites.clientId))
        .where(and(eq(sites.active, true), eq(clients.active, true)))
        .orderBy(clients.name, sites.name),
      db.select({
        clientId: clients.id,
        clientCode: clients.code,
        clientName: clients.name,
      }).from(clients).where(eq(clients.active, true)).orderBy(clients.name),
    ]);
    for (const client of allClients) assignClient({ ...client, roleId: global.roleId, roleKey: global.roleKey, roleName: global.roleName });
    for (const site of allSites) assignSite({ ...site, roleId: global.roleId, roleKey: global.roleKey, roleName: global.roleName });
  } else {
    const validClientRows = clientRows.flatMap((row) => {
      const key = roleKey(row.roleKey);
      return key === "client_admin" ? [{ ...row, roleKey: key }] : [];
    });
    for (const row of validClientRows) assignClient(row);
    if (validClientRows.length) {
      const clientIds = validClientRows.map((row) => row.clientId);
      const inheritedSites = await db.select({
        siteId: sites.id,
        siteCode: sites.code,
        siteName: sites.name,
        clientId: clients.id,
        clientCode: clients.code,
        clientName: clients.name,
      }).from(sites).innerJoin(clients, eq(clients.id, sites.clientId))
        .where(and(inArray(sites.clientId, clientIds), eq(sites.active, true), eq(clients.active, true)))
        .orderBy(clients.name, sites.name);
      for (const site of inheritedSites) {
        const clientScope = clientMap.get(site.clientId);
        if (clientScope) assignSite({ ...site, roleId: clientScope.roleId, roleKey: clientScope.roleKey, roleName: clientScope.roleName });
      }
    }
  }

  for (const row of explicitRows) {
    const key = roleKey(row.roleKey);
    if (!key || key === "platform_admin" || key === "client_admin") continue;
    assignSite({ ...row, roleKey: key });
    if (!clientMap.has(row.clientId)) {
      assignClient({
        clientId: row.clientId,
        clientCode: row.clientCode,
        clientName: row.clientName,
        roleId: row.roleId,
        roleKey: key,
        roleName: row.roleName,
      });
    }
  }

  return {
    platformAdmin: Boolean(global),
    sites: [...siteMap.values()],
    clients: [...clientMap.values()],
  };
}

export function roleCanManageSites(roleKey: PortalRoleKey) {
  return roleKey === "platform_admin" || roleKey === "client_admin" || roleKey === "site_admin";
}

export function roleCanManageClients(roleKey: PortalRoleKey) {
  return roleKey === "platform_admin" || roleKey === "client_admin";
}
