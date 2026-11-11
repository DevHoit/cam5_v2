import type { NextRequest } from "next/server";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { getDb, type Cam5Database } from "../../../../db/index";
import { resolvePortalSession, SESSION_COOKIE_NAME, type AuthenticatedPortalUser } from "../../../../db/auth";
import type { PortalPermission } from "../../../../db/access-control";
import { permissions, rolePermissions, userAssetScopes, userClientAssignments, userRoleAssignments } from "../../../../db/schema";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireApiSession(
  request: NextRequest,
  permission?: PortalPermission,
  options: { allowPasswordChangeRequired?: boolean } = {},
): Promise<{ db: ReturnType<typeof getDb>; user: AuthenticatedPortalUser; token: string }> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new ApiError(401, "Debes iniciar sesión.");
  const db = getDb();
  const user = await resolvePortalSession(db, token);
  if (!user) throw new ApiError(401, "La sesión expiró o ya no es válida.");
  if (user.mustChangePassword && !options.allowPasswordChangeRequired) throw new ApiError(428, "Debes cambiar tu contraseña temporal antes de continuar.");
  if (permission && !user.permissions.includes(permission)) throw new ApiError(403, "No tienes permisos para realizar esta acción.");
  return { db, user, token };
}

/**
 * Permisos del usuario en un sitio concreto. `user.permissions` solo describe el sitio
 * activo: cualquier operación sobre otro sitio debe validar los permisos de ese sitio,
 * o un usuario con más rol en el sitio activo podría escribir donde solo es lector.
 */
export async function sitePermissionsFor(db: Cam5Database, user: AuthenticatedPortalUser, siteId: string): Promise<string[]> {
  if (siteId === user.siteId) return user.permissions;
  const now = new Date();
  const rows = await db.select({ code: permissions.code })
    .from(userRoleAssignments)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoleAssignments.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(
      eq(userRoleAssignments.userId, user.id),
      eq(userRoleAssignments.siteId, siteId),
      or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, now)),
    ));
  return [...new Set(rows.map((row) => row.code))];
}

export async function requireSitePermission(db: Cam5Database, user: AuthenticatedPortalUser, siteId: string, permission: PortalPermission) {
  const granted = await sitePermissionsFor(db, user, siteId);
  if (!granted.includes(permission)) throw new ApiError(403, "No tienes permisos para realizar esta acción en el sitio indicado.");
}

/** Exige que el rol del usuario en el cliente (no en el sitio activo) otorgue el permiso. */
export async function requireClientPermission(db: Cam5Database, userId: string, clientId: string, permission: PortalPermission) {
  const [row] = await db.select({ id: userClientAssignments.id })
    .from(userClientAssignments)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userClientAssignments.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(userClientAssignments.userId, userId), eq(userClientAssignments.clientId, clientId), eq(permissions.code, permission)))
    .limit(1);
  if (!row) throw new ApiError(403, "No tienes permisos sobre el cliente indicado.");
}

/** Si el usuario tiene alcance limitado a ciertos puntos, exige que el punto esté dentro de él. */
export async function requireAssetInScope(db: Cam5Database, userId: string, assetId: string | null) {
  const scopes = await db.select({ assetId: userAssetScopes.assetId }).from(userAssetScopes).where(eq(userAssetScopes.userId, userId));
  if (!scopes.length) return;
  if (!assetId || !scopes.some((scope) => scope.assetId === assetId)) {
    throw new ApiError(403, "Tu acceso está limitado a puntos de medición específicos.");
  }
}

/**
 * Indica si el usuario objetivo tiene algún acceso (sitio, rol global o cliente) que el actor
 * no administra. En ese caso el actor no debe cambiar datos globales de la cuenta (correo,
 * nombre, estado ni contraseña).
 */
export async function userHasAccessOutsideAdministration(db: Cam5Database, actor: AuthenticatedPortalUser, targetUserId: string): Promise<boolean> {
  const administered = actor.sites.filter((site) => site.roleKey === "administrator");
  const siteIds = new Set(administered.map((site) => site.id));
  const clientIds = new Set(administered.map((site) => site.clientId));
  const [siteScopes, clientScopes] = await Promise.all([
    db.select({ siteId: userRoleAssignments.siteId }).from(userRoleAssignments).where(eq(userRoleAssignments.userId, targetUserId)),
    db.select({ clientId: userClientAssignments.clientId }).from(userClientAssignments).where(eq(userClientAssignments.userId, targetUserId)),
  ]);
  return siteScopes.some((scope) => !scope.siteId || !siteIds.has(scope.siteId))
    || clientScopes.some((scope) => !clientIds.has(scope.clientId));
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  if (typeof error === "object" && error && "code" in error && error.code === "23505") {
    return Response.json({ error: "Ya existe un elemento con ese código o identificador en el mismo nivel." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  if (typeof error === "object" && error && "code" in error && error.code === "23503") {
    return Response.json({ error: "El elemento está relacionado con otros registros y no puede modificarse de esa forma." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  console.error("CAM5 API error", error);
  return Response.json({ error: "No fue posible completar la solicitud." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export function requestMetadata(request: NextRequest) {
  return {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: request.headers.get("user-agent"),
  };
}

export function parsePage(request: NextRequest) {
  const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(5, Number.parseInt(request.nextUrl.searchParams.get("pageSize") || "10", 10) || 10));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
