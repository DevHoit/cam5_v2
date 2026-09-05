import type { NextRequest } from "next/server";
import { and, count, eq, ilike } from "drizzle-orm";
import { hashPassword, normalizeEmail } from "../../../../../db/auth";
import {
  auditLogs,
  authIdentities,
  roles,
  userRoleAssignments,
  users,
} from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

const VALID_ROLES = ["administrator", "engineer", "operator", "viewer"] as const;
const VALID_STATUSES = ["active", "suspended", "invited"] as const;

async function getTarget(db: Awaited<ReturnType<typeof requireApiSession>>["db"], id: string) {
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
    .where(eq(users.id, id))
    .limit(1);
  if (!target) throw new ApiError(404, "El usuario no existe.");
  return target;
}

async function assertAdministratorRemains(db: Awaited<ReturnType<typeof requireApiSession>>["db"], targetRole?: string | null) {
  if (targetRole !== "administrator") return;
  const [result] = await db.select({ value: count() }).from(users)
    .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .where(and(eq(users.status, "active"), eq(roles.key, "administrator")));
  if (Number(result?.value ?? 0) <= 1) throw new ApiError(409, "Debe permanecer al menos un administrador activo.");
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user: actor } = await requireApiSession(request, "users.manage");
    const { id } = await context.params;
    const target = await getTarget(db, id);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron cambios.");
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : target.displayName;
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : target.email;
    const status = typeof body.status === "string" ? body.status : target.status;
    const roleKey = typeof body.role === "string" ? body.role : target.roleKey ?? "viewer";
    const password = typeof body.password === "string" ? body.password : "";
    if (displayName.length < 3 || !email.includes("@")) throw new ApiError(400, "Nombre y correo válido son obligatorios.");
    if (!VALID_ROLES.includes(roleKey as typeof VALID_ROLES[number])) throw new ApiError(400, "El perfil seleccionado no es válido.");
    if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) throw new ApiError(400, "El estado seleccionado no es válido.");
    if (actor.id === id && status !== "active") throw new ApiError(409, "No puedes suspender tu propia cuenta.");
    if (target.roleKey === "administrator" && (roleKey !== "administrator" || status !== "active")) await assertAdministratorRemains(db, target.roleKey);
    const passwordHash = password ? await hashPassword(password).catch((error: unknown) => { throw new ApiError(400, error instanceof Error ? error.message : "Contraseña inválida."); }) : null;

    const updated = await db.transaction(async (tx) => {
      const [duplicate] = await tx.select({ id: users.id }).from(users).where(ilike(users.email, email)).limit(1);
      if (duplicate && duplicate.id !== id) throw new ApiError(409, "Ya existe un usuario con ese correo.");
      const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
      if (!role) throw new ApiError(400, "El perfil seleccionado no existe.");
      const [record] = await tx.update(users).set({ displayName, email, status: status as typeof VALID_STATUSES[number], updatedAt: new Date() }).where(eq(users.id, id)).returning();
      await tx.update(authIdentities).set({ providerSubject: email, ...(passwordHash ? { passwordHash } : {}), updatedAt: new Date() }).where(and(eq(authIdentities.userId, id), eq(authIdentities.provider, "local")));
      await tx.delete(userRoleAssignments).where(and(eq(userRoleAssignments.userId, id), eq(userRoleAssignments.siteId, actor.siteId)));
      await tx.insert(userRoleAssignments).values({ userId: id, roleId: role.id, siteId: actor.siteId, grantedBy: actor.id });
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
        after: { email, displayName, status, role: roleKey, passwordChanged: Boolean(passwordHash) },
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
    const target = await getTarget(db, id);
    await assertAdministratorRemains(db, target.roleKey);
    const metadata = requestMetadata(request);
    await db.transaction(async (tx) => {
      await tx.insert(auditLogs).values({
        siteId: actor.siteId,
        actorUserId: actor.id,
        action: "users.delete",
        resourceType: "user",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { email: target.email, displayName: target.displayName, status: target.status, role: target.roleKey },
      });
      await tx.delete(users).where(eq(users.id, id));
    });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
