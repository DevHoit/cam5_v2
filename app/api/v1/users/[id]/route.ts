import type { NextRequest } from "next/server";
import { and, count, eq, ilike, inArray, isNull } from "drizzle-orm";
import { hashPassword, normalizeEmail } from "../../../../../db/auth";
import type { PortalRoleKey } from "../../../../../db/access-control";
import {
  auditLogs,
  authIdentities,
  authSessions,
  roles,
  userClientAssignments,
  userRoleAssignments,
  users,
} from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

const VALID_ROLES = ["platform_admin", "client_admin", "site_admin", "engineer", "operator", "viewer"] as const;
const VALID_STATUSES = ["active", "suspended", "invited"] as const;

function isRole(value: string): value is PortalRoleKey {
  return VALID_ROLES.includes(value as typeof VALID_ROLES[number]);
}

function actorScope(user: Awaited<ReturnType<typeof requireApiSession>>["user"]) {
  const manageableSites = user.sites.filter((site) => ["platform_admin", "client_admin", "site_admin"].includes(site.roleKey));
  const manageableClients = user.clientScopes.filter((client) => ["platform_admin", "client_admin"].includes(client.roleKey));
  return {
    siteIds: manageableSites.map((site) => site.id),
    clientIds: manageableClients.map((client) => client.id),
    platformAdmin: user.roleKey === "platform_admin" || user.clientScopes.some((client) => client.roleKey === "platform_admin"),
  };
}

async function assertTargetInScope(
  db: Awaited<ReturnType<typeof requireApiSession>>["db"],
  actor: Awaited<ReturnType<typeof requireApiSession>>["user"],
  targetId: string,
) {
  const scope = actorScope(actor);
  if (scope.platformAdmin) return scope;
  const [siteHit, clientHit] = await Promise.all([
    scope.siteIds.length
      ? db.select({ id: userRoleAssignments.id }).from(userRoleAssignments)
          .where(and(eq(userRoleAssignments.userId, targetId), inArray(userRoleAssignments.siteId, scope.siteIds))).limit(1)
      : Promise.resolve([]),
    scope.clientIds.length
      ? db.select({ id: userClientAssignments.id }).from(userClientAssignments)
          .where(and(eq(userClientAssignments.userId, targetId), inArray(userClientAssignments.clientId, scope.clientIds))).limit(1)
      : Promise.resolve([]),
  ]);
  if (!siteHit.length && !clientHit.length) throw new ApiError(404, "El usuario no existe dentro de tu alcance.");
  return scope;
}

async function assertLastAdminProtection(
  db: Awaited<ReturnType<typeof requireApiSession>>["db"],
  targetId: string,
  scope: ReturnType<typeof actorScope>,
  proposal?: {
    status: string;
    roleKey: PortalRoleKey;
    requestedClientId: string;
    requestedSiteIds: string[];
  },
) {
  const [platformRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, "platform_admin")).limit(1);
  if (platformRole && scope.platformAdmin) {
    const [targetGlobal] = await db.select({ id: userRoleAssignments.id }).from(userRoleAssignments)
      .where(and(eq(userRoleAssignments.userId, targetId), eq(userRoleAssignments.roleId, platformRole.id), isNull(userRoleAssignments.siteId))).limit(1);
    const removesPlatformAdmin = !proposal || proposal.status !== "active" || proposal.roleKey !== "platform_admin";
    if (targetGlobal && removesPlatformAdmin) {
      const [remaining] = await db.select({ value: count() }).from(userRoleAssignments)
        .innerJoin(users, eq(users.id, userRoleAssignments.userId))
        .where(and(eq(userRoleAssignments.roleId, platformRole.id), isNull(userRoleAssignments.siteId), eq(users.status, "active")));
      if (Number(remaining?.value ?? 0) <= 1) throw new ApiError(409, "Debe permanecer al menos un Administrador HOIT activo.");
    }
  }

  const [clientRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, "client_admin")).limit(1);
  if (clientRole && scope.clientIds.length) {
    const targetClients = await db.select({ clientId: userClientAssignments.clientId }).from(userClientAssignments)
      .where(and(eq(userClientAssignments.userId, targetId), eq(userClientAssignments.roleId, clientRole.id), inArray(userClientAssignments.clientId, scope.clientIds)));
    for (const { clientId } of targetClients) {
      const removesClientAdmin = !proposal
        || proposal.status !== "active"
        || proposal.roleKey !== "client_admin"
        || proposal.requestedClientId !== clientId;
      if (!removesClientAdmin) continue;
      const [remaining] = await db.select({ value: count() }).from(userClientAssignments)
        .innerJoin(users, eq(users.id, userClientAssignments.userId))
        .where(and(eq(userClientAssignments.clientId, clientId), eq(userClientAssignments.roleId, clientRole.id), eq(users.status, "active")));
      if (Number(remaining?.value ?? 0) <= 1) throw new ApiError(409, "Debe permanecer al menos un Administrador de cliente activo.");
    }
  }

  const [siteRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, "site_admin")).limit(1);
  if (siteRole && scope.siteIds.length) {
    const targetSites = await db.select({ siteId: userRoleAssignments.siteId }).from(userRoleAssignments)
      .where(and(eq(userRoleAssignments.userId, targetId), eq(userRoleAssignments.roleId, siteRole.id), inArray(userRoleAssignments.siteId, scope.siteIds)));
    for (const { siteId } of targetSites) {
      if (!siteId) continue;
      const removesSiteAdmin = !proposal
        || proposal.status !== "active"
        || proposal.roleKey !== "site_admin"
        || !proposal.requestedSiteIds.includes(siteId);
      if (!removesSiteAdmin) continue;
      const [remaining] = await db.select({ value: count() }).from(userRoleAssignments)
        .innerJoin(users, eq(users.id, userRoleAssignments.userId))
        .where(and(eq(userRoleAssignments.siteId, siteId), eq(userRoleAssignments.roleId, siteRole.id), eq(users.status, "active")));
      if (Number(remaining?.value ?? 0) <= 1) throw new ApiError(409, "Debe permanecer al menos un Administrador de sitio activo.");
    }
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user: actor } = await requireApiSession(request, "users.manage");
    const { id } = await context.params;
    const scope = await assertTargetInScope(db, actor, id);
    const [target] = await db.select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      phoneE164: users.phoneE164,
      status: users.status,
      mustChangePassword: authIdentities.mustChangePassword,
    }).from(users)
      .leftJoin(authIdentities, and(eq(authIdentities.userId, users.id), eq(authIdentities.provider, "local")))
      .where(eq(users.id, id)).limit(1);
    if (!target) throw new ApiError(404, "El usuario no existe.");

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron cambios.");
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : target.displayName;
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : target.email;
    const status = typeof body.status === "string" ? body.status : target.status;
    const roleKey = typeof body.role === "string" ? body.role : "";
    const password = typeof body.password === "string" ? body.password : "";
    const phoneE164 = (() => { const value = body.phoneE164; if (value === null || value === undefined || value === "") return target.phoneE164; if (typeof value !== "string" || !/^\\+[1-9][0-9]{7,14}$/.test(value.trim())) throw new ApiError(400, "El teléfono debe estar en formato E.164, por ejemplo +56912345678."); return value.trim(); })();
    if (displayName.length < 3 || !email.includes("@")) throw new ApiError(400, "Nombre y correo válido son obligatorios.");
    if (!isRole(roleKey)) throw new ApiError(400, "El perfil seleccionado no es válido.");
    if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) throw new ApiError(400, "El estado seleccionado no es válido.");

    const requestedSiteIds = Array.isArray(body.siteIds)
      ? [...new Set(body.siteIds.filter((siteId): siteId is string => typeof siteId === "string"))]
      : [];
    const requestedClientId = typeof body.clientId === "string" ? body.clientId : actor.clientId;

    if (roleKey === "platform_admin" && !scope.platformAdmin) throw new ApiError(403, "Sólo un Administrador HOIT puede otorgar alcance de plataforma.");
    if (roleKey === "client_admin") {
      if (!scope.clientIds.includes(requestedClientId) && !scope.platformAdmin) throw new ApiError(403, "No administras el cliente indicado.");
    } else if (roleKey !== "platform_admin") {
      if (!requestedSiteIds.length) throw new ApiError(400, "Selecciona al menos un sitio para el usuario.");
      if (!requestedSiteIds.every((siteId) => scope.siteIds.includes(siteId))) throw new ApiError(403, "Uno o más sitios seleccionados están fuera de tu alcance.");
    }

    if (actor.id === id) {
      if (status !== "active") throw new ApiError(409, "No puedes suspender tu propia cuenta.");
      if (password) throw new ApiError(409, "Cambia tu propia contraseña desde Mi cuenta.");
      const currentRole = actor.roleKey;
      const changingOwnScope = roleKey !== currentRole
        || (roleKey !== "platform_admin" && roleKey !== "client_admin" && !requestedSiteIds.includes(actor.siteId))
        || (roleKey === "client_admin" && requestedClientId !== actor.clientId);
      if (changingOwnScope) throw new ApiError(409, "No puedes modificar tu propio rol o alcance administrativo.");
    }

    await assertLastAdminProtection(db, id, scope, {
      status,
      roleKey,
      requestedClientId,
      requestedSiteIds,
    });
    const passwordHash = password ? await hashPassword(password).catch((error: unknown) => {
      throw new ApiError(400, error instanceof Error ? error.message : "Contraseña inválida.");
    }) : null;

    const updated = await db.transaction(async (tx) => {
      const [duplicate] = await tx.select({ id: users.id }).from(users).where(ilike(users.email, email)).limit(1);
      if (duplicate && duplicate.id !== id) throw new ApiError(409, "Ya existe un usuario con ese correo.");
      const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
      if (!role) throw new ApiError(400, "El perfil seleccionado no existe.");

      const [record] = await tx.update(users).set({
        displayName,
        email,
        phoneE164,
        status: status as typeof VALID_STATUSES[number],
        updatedAt: new Date(),
      }).where(eq(users.id, id)).returning();

      await tx.update(authIdentities).set({
        providerSubject: email,
        ...(passwordHash ? { passwordHash, mustChangePassword: true } : {}),
        updatedAt: new Date(),
      }).where(and(eq(authIdentities.userId, id), eq(authIdentities.provider, "local")));

      if (passwordHash || status !== "active") {
        await tx.update(authSessions).set({ revokedAt: new Date() })
          .where(and(eq(authSessions.userId, id), isNull(authSessions.revokedAt)));
      }

      if (scope.platformAdmin) {
        await tx.delete(userRoleAssignments).where(eq(userRoleAssignments.userId, id));
        await tx.delete(userClientAssignments).where(eq(userClientAssignments.userId, id));
      } else {
        if (scope.siteIds.length) {
          await tx.delete(userRoleAssignments).where(and(eq(userRoleAssignments.userId, id), inArray(userRoleAssignments.siteId, scope.siteIds)));
        }
        if (scope.clientIds.length) {
          await tx.delete(userClientAssignments).where(and(eq(userClientAssignments.userId, id), inArray(userClientAssignments.clientId, scope.clientIds)));
        }
      }

      if (roleKey === "platform_admin") {
        await tx.insert(userRoleAssignments).values({ userId: id, roleId: role.id, siteId: null, grantedBy: actor.id });
      } else if (roleKey === "client_admin") {
        await tx.insert(userClientAssignments).values({ userId: id, clientId: requestedClientId, roleId: role.id, grantedBy: actor.id });
      } else {
        await tx.insert(userRoleAssignments).values(requestedSiteIds.map((siteId) => ({
          userId: id,
          roleId: role.id,
          siteId,
          grantedBy: actor.id,
        })));
      }

      const metadata = requestMetadata(request);
      await tx.insert(auditLogs).values({
        siteId: actor.siteId,
        actorUserId: actor.id,
        action: "users.update",
        resourceType: "user",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { email: target.email, phoneE164: target.phoneE164, displayName: target.displayName, status: target.status },
        after: {
          email,
          phoneE164,
          displayName,
          status,
          role: roleKey,
          scopeType: roleKey === "platform_admin" ? "platform" : roleKey === "client_admin" ? "client" : "site",
          clientId: roleKey === "client_admin" ? requestedClientId : null,
          siteIds: roleKey !== "platform_admin" && roleKey !== "client_admin" ? requestedSiteIds : [],
          passwordChanged: Boolean(passwordHash),
        },
      });
      return { ...record, role: { key: role.key, name: role.name } };
    });

    return Response.json({
      id: updated.id,
      displayName: updated.displayName,
      email: updated.email,
      phoneE164: updated.phoneE164,
      status: updated.status,
      lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      mustChangePassword: passwordHash ? true : target.mustChangePassword ?? false,
      role: updated.role,
      scopeType: roleKey === "platform_admin" ? "platform" : roleKey === "client_admin" ? "client" : "site",
      clientId: roleKey === "client_admin" ? requestedClientId : null,
      siteIds: roleKey !== "platform_admin" && roleKey !== "client_admin" ? requestedSiteIds : [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user: actor } = await requireApiSession(request, "users.manage");
    const { id } = await context.params;
    if (actor.id === id) throw new ApiError(409, "No puedes quitar tu propio acceso.");
    const scope = await assertTargetInScope(db, actor, id);
    const [target] = await db.select({
      email: users.email,
      displayName: users.displayName,
      status: users.status,
    }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) throw new ApiError(404, "El usuario no existe.");

    await assertLastAdminProtection(db, id, scope);
    const metadata = requestMetadata(request);
    await db.transaction(async (tx) => {
      await tx.insert(auditLogs).values({
        siteId: actor.siteId,
        actorUserId: actor.id,
        action: "users.scope.remove",
        resourceType: "user",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { ...target, managedSiteIds: scope.siteIds, managedClientIds: scope.clientIds, platformScope: scope.platformAdmin },
      });

      if (scope.platformAdmin) {
        await tx.delete(userRoleAssignments).where(eq(userRoleAssignments.userId, id));
        await tx.delete(userClientAssignments).where(eq(userClientAssignments.userId, id));
      } else {
        if (scope.siteIds.length) {
          await tx.delete(userRoleAssignments).where(and(eq(userRoleAssignments.userId, id), inArray(userRoleAssignments.siteId, scope.siteIds)));
        }
        if (scope.clientIds.length) {
          await tx.delete(userClientAssignments).where(and(eq(userClientAssignments.userId, id), inArray(userClientAssignments.clientId, scope.clientIds)));
        }
      }

      const [[siteRemaining], [clientRemaining]] = await Promise.all([
        tx.select({ value: count() }).from(userRoleAssignments).where(eq(userRoleAssignments.userId, id)),
        tx.select({ value: count() }).from(userClientAssignments).where(eq(userClientAssignments.userId, id)),
      ]);
      if (Number(siteRemaining?.value ?? 0) === 0 && Number(clientRemaining?.value ?? 0) === 0) {
        await tx.delete(users).where(eq(users.id, id));
      } else {
        await tx.update(authSessions).set({ revokedAt: new Date() })
          .where(and(eq(authSessions.userId, id), isNull(authSessions.revokedAt)));
      }
    });

    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
