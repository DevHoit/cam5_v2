import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { permissions, rolePermissions, roles, userAssetScopes, userRoleAssignments, users } from "./schema";
import type { PortalPermission } from "./access-control";

export type PortalAccess = {
  allowed: boolean;
  roles: string[];
  permissions: PortalPermission[];
  assetRestricted: boolean;
  assetAllowed: boolean;
};

export async function resolvePortalAccess(
  db: Cam5Database,
  userId: string,
  siteId: string,
  requestedPermission: PortalPermission,
  assetId?: string,
): Promise<PortalAccess> {
  const [user] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.status !== "active") {
    return { allowed: false, roles: [], permissions: [], assetRestricted: false, assetAllowed: false };
  }

  const accessRows = await db
    .select({ role: roles.key, permission: permissions.code })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(
      eq(userRoleAssignments.userId, userId),
      or(eq(userRoleAssignments.siteId, siteId), isNull(userRoleAssignments.siteId)),
      or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, new Date())),
    ));

  const roleKeys = [...new Set(accessRows.map((row) => row.role))];
  const permissionCodes = [...new Set(accessRows.map((row) => row.permission))] as PortalPermission[];
  const scopes = await db
    .select({ assetId: userAssetScopes.assetId })
    .from(userAssetScopes)
    .where(eq(userAssetScopes.userId, userId));
  const assetRestricted = scopes.length > 0;
  const assetAllowed = !assetId || !assetRestricted || scopes.some((scope) => scope.assetId === assetId);

  return {
    allowed: permissionCodes.includes(requestedPermission) && assetAllowed,
    roles: roleKeys,
    permissions: permissionCodes,
    assetRestricted,
    assetAllowed,
  };
}

export async function requirePortalPermission(
  db: Cam5Database,
  userId: string,
  siteId: string,
  permission: PortalPermission,
  assetId?: string,
): Promise<PortalAccess> {
  const access = await resolvePortalAccess(db, userId, siteId, permission, assetId);
  if (!access.allowed) throw new Error(`Acceso denegado: falta el permiso ${permission}.`);
  return access;
}
