import type { NextRequest } from "next/server";
import { and, count, eq, ilike, inArray } from "drizzle-orm";
import { hashPassword, normalizeEmail } from "../../../../../db/auth";
import {
  auditLogs,
  authIdentities,
  roles,
  sites,
  userClientAssignments,
  userRoleAssignments,
  users,
} from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

const VALID_ROLES = ["administrator", "engineer", "operator", "viewer"] as const;
const VALID_STATUSES = ["active", "suspended", "invited"] as const;

async function getTarget(db: Awaited<ReturnType<typeof requireApiSession>>["db"], id: string, siteId: string) {
  const [target] = await db.select({
    id: users.id,
    displayName: users.displayName,
    email: users.email,
    status: users.status,
    roleKey: roles.key,
    roleName: roles.name,
  }).from(users)
    .leftJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .where(and(eq(users.id, id), eq(userRoleAssignments.siteId, siteId)))
    .limit(1);
  if (!target) throw new ApiError(404, "El usuario no existe.");
  return target;
}

async function assertAdministratorRemains(db: Awaited<ReturnType<typeof requireApiSession>>["db"], siteId: string, targetRole?: string | null) {
  if (targetRole !== "administrator") return;
  const [result] = await db.select({ value: count() }).from(users)
    .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .where(and(eq(users.status, "active"), eq(roles.key, "administrator"), eq(userRoleAssignments.siteId, siteId)));
  if (Number(result?.value ?? 0) <= 1) throw new ApiError(409, "Debe permanecer al menos un administrador activo.");
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user: actor } = await requireApiSession(request, "users.manage");
    const { id } = await context.params;
    const target = await getTarget(db, id, actor.siteId);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron cambios.");
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : target.displayName;
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : target.email;
    const status = typeof body.status === "string" ? body.status : target.status;
    const roleKey = typeof body.role === "string" ? body.role : target.roleKey ?? "viewer";
    const password = typeof body.password === "string" ? body.password : "";
    const actorSiteIds = actor.sites.filter((site) => site.roleKey === "administrator").map((site) => site.id);
    const currentScopeRows = await db.select({ siteId: userRoleAssignments.siteId, roleKey: roles.key })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .where(and(eq(userRoleAssignments.userId, id), inArray(userRoleAssignments.siteId, actorSiteIds)));
    const currentSiteIds = [...new Set(currentScopeRows.map((scope) => scope.siteId).filter((siteId): siteId is string => Boolean(siteId)))];
    const requestedSiteIds = Array.isArray(body.siteIds)
      ? [...new Set(body.siteIds.filter((siteId): siteId is string => typeof siteId === "string"))]
      : currentSiteIds;
    if (displayName.length < 3 || !email.includes("@")) throw new ApiError(400, "Nombre y correo válido son obligatorios.");
    if (!VALID_ROLES.includes(roleKey as typeof VALID_ROLES[number])) throw new ApiError(400, "El perfil seleccionado no es válido.");
    if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) throw new ApiError(400, "El estado seleccionado no es válido.");
    if (!requestedSiteIds.length) throw new ApiError(400, "Selecciona al menos un sitio para el usuario.");
    const selectedSites = actor.sites.filter((site) => site.roleKey === "administrator" && requestedSiteIds.includes(site.id));
    if (selectedSites.length !== requestedSiteIds.length) throw new ApiError(403, "Uno o más sitios seleccionados están fuera de tu alcance.");
    if (actor.id === id && status !== "active") throw new ApiError(409, "No puedes suspender tu propia cuenta.");
    if (actor.id === id && !requestedSiteIds.includes(actor.siteId)) throw new ApiError(409, "No puedes retirar tu propio acceso al sitio activo.");
    const adminSitesAtRisk = currentScopeRows
      .filter((scope) => scope.roleKey === "administrator" && (roleKey !== "administrator" || status !== "active" || !requestedSiteIds.includes(scope.siteId ?? "")))
      .map((scope) => scope.siteId)
      .filter((siteId): siteId is string => Boolean(siteId));
    for (const siteId of adminSitesAtRisk) await assertAdministratorRemains(db, siteId, "administrator");
    const passwordHash = password ? await hashPassword(password).catch((error: unknown) => { throw new ApiError(400, error instanceof Error ? error.message : "Contraseña inválida."); }) : null;

    const updated = await db.transaction(async (tx) => {
      const [duplicate] = await tx.select({ id: users.id }).from(users).where(ilike(users.email, email)).limit(1);
      if (duplicate && duplicate.id !== id) throw new ApiError(409, "Ya existe un usuario con ese correo.");
      const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
      if (!role) throw new ApiError(400, "El perfil seleccionado no existe.");
      const [record] = await tx.update(users).set({ displayName, email, status: status as typeof VALID_STATUSES[number], updatedAt: new Date() }).where(eq(users.id, id)).returning();
      await tx.update(authIdentities).set({ providerSubject: email, ...(passwordHash ? { passwordHash } : {}), updatedAt: new Date() }).where(and(eq(authIdentities.userId, id), eq(authIdentities.provider, "local")));
      await tx.delete(userRoleAssignments).where(and(eq(userRoleAssignments.userId, id), inArray(userRoleAssignments.siteId, actorSiteIds)));
      await tx.insert(userRoleAssignments).values(requestedSiteIds.map((siteId) => ({ userId: id, roleId: role.id, siteId, grantedBy: actor.id })));
      const actorClientIds = [...new Set(actor.sites.filter((site) => site.roleKey === "administrator").map((site) => site.clientId))];
      const selectedClientIds = [...new Set(selectedSites.map((site) => site.clientId))];
      for (const clientId of actorClientIds) {
        if (selectedClientIds.includes(clientId)) {
          await tx.insert(userClientAssignments).values({ userId: id, clientId, roleId: role.id, grantedBy: actor.id })
            .onConflictDoUpdate({ target: [userClientAssignments.userId, userClientAssignments.clientId], set: { roleId: role.id, grantedBy: actor.id, grantedAt: new Date() } });
        } else {
          const [remainingInClient] = await tx.select({ value: count() }).from(userRoleAssignments)
            .innerJoin(sites, eq(sites.id, userRoleAssignments.siteId))
            .where(and(eq(userRoleAssignments.userId, id), eq(sites.clientId, clientId)));
          if (Number(remainingInClient?.value ?? 0) === 0) {
            await tx.delete(userClientAssignments).where(and(eq(userClientAssignments.userId, id), eq(userClientAssignments.clientId, clientId)));
          }
        }
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
        before: { email: target.email, displayName: target.displayName, status: target.status, role: target.roleKey },
        after: { email, displayName, status, role: roleKey, siteIds: requestedSiteIds, passwordChanged: Boolean(passwordHash) },
      });
      return { ...record, role: { key: role.key, name: role.name } };
    });

    return Response.json({
      id: updated.id,
      displayName: updated.displayName,
      email: updated.email,
      status: updated.status,
      lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      role: updated.role,
      siteIds: requestedSiteIds,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user: actor } = await requireApiSession(request, "users.manage");
    const { id } = await context.params;
    if (actor.id === id) throw new ApiError(409, "No puedes eliminar tu propia cuenta.");
    const target = await getTarget(db, id, actor.siteId);
    await assertAdministratorRemains(db, actor.siteId, target.roleKey);
    const metadata = requestMetadata(request);
    await db.transaction(async (tx) => {
      await tx.insert(auditLogs).values({
        siteId: actor.siteId,
        actorUserId: actor.id,
        action: "users.site_access.remove",
        resourceType: "user",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { email: target.email, displayName: target.displayName, status: target.status, role: target.roleKey, siteId: actor.siteId },
      });
      await tx.delete(userRoleAssignments).where(and(eq(userRoleAssignments.userId, id), eq(userRoleAssignments.siteId, actor.siteId)));
      const [remainingInClient] = await tx.select({ value: count() }).from(userRoleAssignments)
        .innerJoin(sites, eq(sites.id, userRoleAssignments.siteId))
        .where(and(eq(userRoleAssignments.userId, id), eq(sites.clientId, actor.clientId)));
      if (Number(remainingInClient?.value ?? 0) === 0) {
        await tx.delete(userClientAssignments).where(and(eq(userClientAssignments.userId, id), eq(userClientAssignments.clientId, actor.clientId)));
      }
      const [remaining] = await tx.select({ value: count() }).from(userRoleAssignments).where(eq(userRoleAssignments.userId, id));
      if (Number(remaining?.value ?? 0) === 0) await tx.delete(users).where(eq(users.id, id));
    });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
