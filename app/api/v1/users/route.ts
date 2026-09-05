import type { NextRequest } from "next/server";
import { and, countDistinct, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { hashPassword, normalizeEmail } from "../../../../db/auth";
import {
  auditLogs,
  authIdentities,
  roles,
  userClientAssignments,
  userRoleAssignments,
  users,
} from "../../../../db/schema";
import { apiErrorResponse, ApiError, parsePage, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

const VALID_ROLES = ["administrator", "engineer", "operator", "viewer"] as const;
const VALID_STATUSES = ["active", "suspended", "invited"] as const;

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "users.read");
    const { page, pageSize, offset } = parsePage(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const requestedStatus = request.nextUrl.searchParams.get("status") || "all";
    const filters: SQL[] = [eq(userRoleAssignments.siteId, user.siteId)];
    if (q) filters.push(or(ilike(users.displayName, `%${q}%`), ilike(users.email, `%${q}%`))!);
    if (VALID_STATUSES.includes(requestedStatus as typeof VALID_STATUSES[number])) filters.push(eq(users.status, requestedStatus as typeof VALID_STATUSES[number]));
    const where = filters.length ? and(...filters) : undefined;

    const [records, countRows, summaryRows] = await Promise.all([
      db.select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        status: users.status,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        roleKey: roles.key,
        roleName: roles.name,
      })
        .from(users)
        .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ total: countDistinct(users.id) }).from(users).innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id)).where(where),
      db.select({ id: users.id, status: users.status, roleKey: roles.key })
        .from(users)
        .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
        .where(eq(userRoleAssignments.siteId, user.siteId)),
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    const uniqueSummary = [...new Map(summaryRows.map((row) => [row.id, row])).values()];
    const recordIds = records.map((record) => record.id);
    const manageableSiteIds = user.sites.filter((site) => site.roleKey === "administrator").map((site) => site.id);
    const scopeRows = recordIds.length && manageableSiteIds.length ? await db.select({ userId: userRoleAssignments.userId, siteId: userRoleAssignments.siteId })
      .from(userRoleAssignments)
      .where(and(
        inArray(userRoleAssignments.userId, recordIds),
        inArray(userRoleAssignments.siteId, manageableSiteIds),
      )) : [];
    return Response.json({
      items: records.map((record) => ({
        id: record.id,
        displayName: record.displayName,
        email: record.email,
        status: record.status,
        lastLoginAt: record.lastLoginAt?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(),
        role: { key: record.roleKey ?? "viewer", name: record.roleName ?? "Solo lectura" },
        siteIds: [...new Set(scopeRows.filter((scope) => scope.userId === record.id).map((scope) => scope.siteId).filter((siteId): siteId is string => Boolean(siteId)))],
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      summary: {
        total: uniqueSummary.length,
        active: uniqueSummary.filter((row) => row.status === "active").length,
        administrators: uniqueSummary.filter((row) => row.roleKey === "administrator").length,
        invited: uniqueSummary.filter((row) => row.status === "invited").length,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user: actor } = await requireApiSession(request, "users.manage");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const roleKey = typeof body?.role === "string" ? body.role : "viewer";
    const status = typeof body?.status === "string" ? body.status : "active";
    const requestedSiteIds = Array.isArray(body?.siteIds)
      ? [...new Set(body.siteIds.filter((siteId): siteId is string => typeof siteId === "string"))]
      : [actor.siteId];
    if (displayName.length < 3 || !email.includes("@")) throw new ApiError(400, "Nombre y correo válido son obligatorios.");
    if (!VALID_ROLES.includes(roleKey as typeof VALID_ROLES[number])) throw new ApiError(400, "El perfil seleccionado no es válido.");
    if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) throw new ApiError(400, "El estado seleccionado no es válido.");
    if (!requestedSiteIds.length) throw new ApiError(400, "Selecciona al menos un sitio para el usuario.");
    const selectedSites = actor.sites.filter((site) => site.roleKey === "administrator" && requestedSiteIds.includes(site.id));
    if (selectedSites.length !== requestedSiteIds.length) throw new ApiError(403, "Uno o más sitios seleccionados están fuera de tu alcance.");
    const passwordHash = await hashPassword(password).catch((error: unknown) => { throw new ApiError(400, error instanceof Error ? error.message : "Contraseña inválida."); });

    const created = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(ilike(users.email, email)).limit(1);
      if (existing) throw new ApiError(409, "Ya existe un usuario con ese correo.");
      const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
      if (!role) throw new ApiError(400, "El perfil seleccionado no existe en la base.");
      const [newUser] = await tx.insert(users).values({ email, displayName, status: status as typeof VALID_STATUSES[number] }).returning();
      await tx.insert(authIdentities).values({ userId: newUser.id, provider: "local", providerSubject: email, passwordHash });
      const selectedClientIds = [...new Set(selectedSites.map((site) => site.clientId))];
      await tx.insert(userClientAssignments).values(selectedClientIds.map((clientId) => ({ userId: newUser.id, clientId, roleId: role.id, grantedBy: actor.id })));
      await tx.insert(userRoleAssignments).values(requestedSiteIds.map((siteId) => ({ userId: newUser.id, roleId: role.id, siteId, grantedBy: actor.id })));
      const metadata = requestMetadata(request);
      await tx.insert(auditLogs).values({
        siteId: actor.siteId,
        actorUserId: actor.id,
        action: "users.create",
        resourceType: "user",
        resourceId: newUser.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        after: { email, displayName, status, role: roleKey, siteIds: requestedSiteIds },
      });
      return { ...newUser, role: { key: role.key, name: role.name } };
    });

    return Response.json({
      id: created.id,
      displayName: created.displayName,
      email: created.email,
      status: created.status,
      lastLoginAt: created.lastLoginAt?.toISOString() ?? null,
      createdAt: created.createdAt.toISOString(),
      role: created.role,
      siteIds: requestedSiteIds,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
