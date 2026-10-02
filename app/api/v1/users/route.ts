import type { NextRequest } from "next/server";
import { and, countDistinct, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { hashPassword, normalizeEmail } from "../../../../db/auth";
import type { PortalRoleKey } from "../../../../db/access-control";
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

const VALID_ROLES = ["platform_admin", "client_admin", "site_admin", "engineer", "operator", "viewer"] as const;
const VALID_STATUSES = ["active", "suspended", "invited"] as const;
const ROLE_RANK: Record<PortalRoleKey, number> = {
  platform_admin: 60,
  client_admin: 50,
  site_admin: 40,
  engineer: 30,
  operator: 20,
  viewer: 10,
};

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

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "users.read");
    const { page, pageSize, offset } = parsePage(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const requestedStatus = request.nextUrl.searchParams.get("status") || "all";
    const scope = actorScope(user);

    let candidateIds: string[] = [];
    if (scope.platformAdmin) {
      candidateIds = (await db.select({ id: users.id }).from(users)).map((row) => row.id);
    } else {
      const [siteRows, clientRows] = await Promise.all([
        scope.siteIds.length
          ? db.select({ userId: userRoleAssignments.userId }).from(userRoleAssignments)
              .where(inArray(userRoleAssignments.siteId, scope.siteIds))
          : Promise.resolve([]),
        scope.clientIds.length
          ? db.select({ userId: userClientAssignments.userId }).from(userClientAssignments)
              .where(inArray(userClientAssignments.clientId, scope.clientIds))
          : Promise.resolve([]),
      ]);
      candidateIds = [...new Set([...siteRows.map((row) => row.userId), ...clientRows.map((row) => row.userId)])];
    }

    if (!candidateIds.length) {
      return Response.json({
        items: [], page, pageSize, total: 0, totalPages: 1,
        summary: { total: 0, active: 0, administrators: 0, invited: 0 },
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const filters: SQL[] = [inArray(users.id, candidateIds)];
    if (q) filters.push(or(ilike(users.displayName, `%${q}%`), ilike(users.email, `%${q}%`))!);
    if (VALID_STATUSES.includes(requestedStatus as typeof VALID_STATUSES[number])) {
      filters.push(eq(users.status, requestedStatus as typeof VALID_STATUSES[number]));
    }
    const where = and(...filters);

    const [records, countRows, summaryRows] = await Promise.all([
      db.select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        status: users.status,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        mustChangePassword: authIdentities.mustChangePassword,
      }).from(users)
        .leftJoin(authIdentities, and(eq(authIdentities.userId, users.id), eq(authIdentities.provider, "local")))
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ total: countDistinct(users.id) }).from(users).where(where),
      db.select({ id: users.id, status: users.status }).from(users).where(inArray(users.id, candidateIds)),
    ]);

    const recordIds = records.map((record) => record.id);
    const [globalAssignments, clientAssignments, siteAssignments] = recordIds.length ? await Promise.all([
      db.select({
        userId: userRoleAssignments.userId,
        roleKey: roles.key,
        roleName: roles.name,
      }).from(userRoleAssignments)
        .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
        .where(and(inArray(userRoleAssignments.userId, recordIds), isNull(userRoleAssignments.siteId), eq(roles.key, "platform_admin"))),
      db.select({
        userId: userClientAssignments.userId,
        clientId: userClientAssignments.clientId,
        roleKey: roles.key,
        roleName: roles.name,
      }).from(userClientAssignments)
        .innerJoin(roles, eq(roles.id, userClientAssignments.roleId))
        .where(and(
          inArray(userClientAssignments.userId, recordIds),
          scope.platformAdmin || !scope.clientIds.length ? undefined : inArray(userClientAssignments.clientId, scope.clientIds),
        )),
      db.select({
        userId: userRoleAssignments.userId,
        siteId: userRoleAssignments.siteId,
        roleKey: roles.key,
        roleName: roles.name,
      }).from(userRoleAssignments)
        .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
        .where(and(
          inArray(userRoleAssignments.userId, recordIds),
          scope.platformAdmin || !scope.siteIds.length ? undefined : inArray(userRoleAssignments.siteId, scope.siteIds),
        )),
    ]) : [[], [], []];

    const items = records.map((record) => {
      const assignments: Array<{ roleKey: PortalRoleKey; roleName: string; scopeType: "platform" | "client" | "site"; clientId: string | null; siteIds: string[] }> = [];
      for (const item of globalAssignments.filter((row) => row.userId === record.id)) {
        if (isRole(item.roleKey)) assignments.push({ roleKey: item.roleKey, roleName: item.roleName, scopeType: "platform", clientId: null, siteIds: [] });
      }
      for (const item of clientAssignments.filter((row) => row.userId === record.id)) {
        if (isRole(item.roleKey)) assignments.push({ roleKey: item.roleKey, roleName: item.roleName, scopeType: "client", clientId: item.clientId, siteIds: [] });
      }
      const userSites = siteAssignments.filter((row) => row.userId === record.id && row.siteId);
      const siteRole = userSites
        .filter((row) => isRole(row.roleKey))
        .sort((left, right) => ROLE_RANK[right.roleKey as PortalRoleKey] - ROLE_RANK[left.roleKey as PortalRoleKey])[0];
      if (siteRole && isRole(siteRole.roleKey)) {
        assignments.push({
          roleKey: siteRole.roleKey,
          roleName: siteRole.roleName,
          scopeType: "site",
          clientId: null,
          siteIds: [...new Set(userSites.filter((row) => row.roleKey === siteRole.roleKey).map((row) => row.siteId).filter((id): id is string => Boolean(id)))],
        });
      }
      const primary = assignments.sort((left, right) => ROLE_RANK[right.roleKey] - ROLE_RANK[left.roleKey])[0]
        ?? { roleKey: "viewer" as const, roleName: "Solo lectura", scopeType: "site" as const, clientId: null, siteIds: [] };
      return {
        ...record,
        lastLoginAt: record.lastLoginAt?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(),
        mustChangePassword: record.mustChangePassword ?? false,
        role: { key: primary.roleKey, name: primary.roleName },
        scopeType: primary.scopeType,
        clientId: primary.clientId,
        siteIds: primary.siteIds,
      };
    });

    const administratorIds = new Set<string>();
    for (const item of [...globalAssignments, ...clientAssignments, ...siteAssignments]) {
      if (["platform_admin", "client_admin", "site_admin"].includes(item.roleKey)) administratorIds.add(item.userId);
    }

    const total = Number(countRows[0]?.total ?? 0);
    return Response.json({
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      summary: {
        total: summaryRows.length,
        active: summaryRows.filter((row) => row.status === "active").length,
        administrators: administratorIds.size,
        invited: summaryRows.filter((row) => row.status === "invited").length,
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
    const scope = actorScope(actor);

    if (displayName.length < 3 || !email.includes("@")) throw new ApiError(400, "Nombre y correo válido son obligatorios.");
    if (!isRole(roleKey)) throw new ApiError(400, "El perfil seleccionado no es válido.");
    if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) throw new ApiError(400, "El estado seleccionado no es válido.");

    const requestedSiteIds = Array.isArray(body?.siteIds)
      ? [...new Set(body.siteIds.filter((siteId): siteId is string => typeof siteId === "string"))]
      : [];
    const requestedClientId = typeof body?.clientId === "string" ? body.clientId : actor.clientId;

    if (roleKey === "platform_admin" && !scope.platformAdmin) throw new ApiError(403, "Sólo un Administrador HOIT puede otorgar alcance de plataforma.");
    if (roleKey === "client_admin") {
      if (!scope.clientIds.includes(requestedClientId) && !scope.platformAdmin) throw new ApiError(403, "No administras el cliente indicado.");
    } else if (roleKey !== "platform_admin") {
      if (!requestedSiteIds.length) throw new ApiError(400, "Selecciona al menos un sitio para el usuario.");
      if (!requestedSiteIds.every((siteId) => scope.siteIds.includes(siteId))) throw new ApiError(403, "Uno o más sitios seleccionados están fuera de tu alcance.");
    }

    const passwordHash = await hashPassword(password).catch((error: unknown) => {
      throw new ApiError(400, error instanceof Error ? error.message : "Contraseña inválida.");
    });

    const created = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(ilike(users.email, email)).limit(1);
      if (existing) throw new ApiError(409, "Ya existe un usuario con ese correo.");
      const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
      if (!role) throw new ApiError(400, "El perfil seleccionado no existe en la base.");

      const [newUser] = await tx.insert(users).values({
        email,
        displayName,
        status: status as typeof VALID_STATUSES[number],
      }).returning();
      await tx.insert(authIdentities).values({
        userId: newUser.id,
        provider: "local",
        providerSubject: email,
        passwordHash,
        mustChangePassword: true,
      });

      if (roleKey === "platform_admin") {
        await tx.insert(userRoleAssignments).values({ userId: newUser.id, roleId: role.id, siteId: null, grantedBy: actor.id });
      } else if (roleKey === "client_admin") {
        await tx.insert(userClientAssignments).values({ userId: newUser.id, clientId: requestedClientId, roleId: role.id, grantedBy: actor.id });
      } else {
        await tx.insert(userRoleAssignments).values(requestedSiteIds.map((siteId) => ({
          userId: newUser.id,
          roleId: role.id,
          siteId,
          grantedBy: actor.id,
        })));
      }

      const metadata = requestMetadata(request);
      await tx.insert(auditLogs).values({
        siteId: actor.siteId,
        actorUserId: actor.id,
        action: "users.create",
        resourceType: "user",
        resourceId: newUser.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        after: {
          email,
          displayName,
          status,
          role: roleKey,
          scopeType: roleKey === "platform_admin" ? "platform" : roleKey === "client_admin" ? "client" : "site",
          clientId: roleKey === "client_admin" ? requestedClientId : null,
          siteIds: roleKey !== "platform_admin" && roleKey !== "client_admin" ? requestedSiteIds : [],
        },
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
      mustChangePassword: true,
      role: created.role,
      scopeType: roleKey === "platform_admin" ? "platform" : roleKey === "client_admin" ? "client" : "site",
      clientId: roleKey === "client_admin" ? requestedClientId : null,
      siteIds: roleKey !== "platform_admin" && roleKey !== "client_admin" ? requestedSiteIds : [],
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
