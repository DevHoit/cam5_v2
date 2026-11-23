import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { and, asc, count, desc, eq, exists, ilike, inArray, or, type SQL } from "drizzle-orm";
import { hashPassword, normalizeEmail } from "../../../../db/auth";
import { assertLicensesAvailable, isLicenseKind, loadClientLicenses, statusUsesLicense } from "../../../../db/licenses";
import {
  auditLogs,
  authIdentities,
  clients,
  roles,
  sites,
  userClientAssignments,
  userRoleAssignments,
  users,
} from "../../../../db/schema";
import { deliverInvitation } from "../_lib/invitations";
import { apiErrorResponse, ApiError, assertSitesOfClient, parsePage, requestMetadata, parseAccessExpiry, requireApiSession, wholeClientSites } from "../_lib/auth";

export const dynamic = "force-dynamic";

const VALID_ROLES = ["administrator", "engineer", "operator", "viewer"] as const;
const VALID_STATUSES = ["active", "suspended", "invited"] as const;

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "users.read");
    const { page, pageSize, offset } = parsePage(request);
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const requestedStatus = request.nextUrl.searchParams.get("status") || "all";
    // Alcance: el personal de HOIT ve todos los usuarios de la plataforma (y puede filtrar por cliente);
    // un usuario de un cliente ve solo los de su compañía, en todos sus sitios, sin el personal de HOIT.
    const platformScope = user.platformStaff;
    const requestedClientId = request.nextUrl.searchParams.get("clientId") || "";
    const clientId = platformScope ? (requestedClientId && requestedClientId !== "all" ? requestedClientId : null) : user.clientId;
    const belongsToClient = (id: string) => or(
      exists(db.select({ id: userClientAssignments.id }).from(userClientAssignments).where(and(eq(userClientAssignments.userId, users.id), eq(userClientAssignments.clientId, id)))),
      exists(db.select({ id: userRoleAssignments.id }).from(userRoleAssignments).innerJoin(sites, eq(sites.id, userRoleAssignments.siteId)).where(and(eq(userRoleAssignments.userId, users.id), eq(sites.clientId, id)))),
    )!;
    const scope: SQL[] = [];
    if (clientId) scope.push(belongsToClient(clientId));
    // El cliente no ve al personal de HOIT ni sus cuentas de prueba.
    if (!platformScope) scope.push(eq(users.platformStaff, false), eq(users.testAccount, false));
    const filters: SQL[] = [...scope];
    if (q) filters.push(or(ilike(users.displayName, `%${q}%`), ilike(users.email, `%${q}%`))!);
    if (VALID_STATUSES.includes(requestedStatus as typeof VALID_STATUSES[number])) filters.push(eq(users.status, requestedStatus as typeof VALID_STATUSES[number]));

    const [records, countRows, scopedUsers] = await Promise.all([
      db.select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        status: users.status,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        mustChangePassword: authIdentities.mustChangePassword,
        platformStaff: users.platformStaff,
        testAccount: users.testAccount,
        accessExpiresAt: users.accessExpiresAt,
      })
        .from(users)
        .leftJoin(authIdentities, and(eq(authIdentities.userId, users.id), eq(authIdentities.provider, "local")))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(users.createdAt), asc(users.id))
        .limit(pageSize)
        .offset(offset),
      db.select({ total: count() }).from(users).where(filters.length ? and(...filters) : undefined),
      db.select({ id: users.id, status: users.status }).from(users).where(scope.length ? and(...scope) : undefined),
    ]);

    // Rol y licencia de cada usuario en su(s) cliente(s): se muestra el del cliente en contexto.
    const contextClientId = clientId ?? user.clientId;
    const summaryIds = scopedUsers.map((row) => row.id);
    const recordIds = records.map((record) => record.id);
    const assignmentIds = [...new Set([...summaryIds, ...recordIds])];
    const [clientRows, siteRoleRows] = assignmentIds.length ? await Promise.all([
      db.select({ userId: userClientAssignments.userId, clientId: clients.id, clientName: clients.name, roleKey: roles.key, roleName: roles.name, licenseKind: userClientAssignments.licenseKind, allSites: userClientAssignments.allSites })
        .from(userClientAssignments)
        .innerJoin(clients, eq(clients.id, userClientAssignments.clientId))
        .innerJoin(roles, eq(roles.id, userClientAssignments.roleId))
        .where(inArray(userClientAssignments.userId, assignmentIds))
        .orderBy(asc(clients.name)),
      db.select({ userId: userRoleAssignments.userId, siteId: userRoleAssignments.siteId, roleKey: roles.key, roleName: roles.name })
        .from(userRoleAssignments)
        .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
        .where(inArray(userRoleAssignments.userId, assignmentIds)),
    ]) : [[], []];
    const roleOf = (userId: string) => {
      const own = clientRows.filter((row) => row.userId === userId);
      const inContext = own.find((row) => row.clientId === contextClientId);
      const siteRole = siteRoleRows.find((row) => row.userId === userId && row.siteId === user.siteId) ?? siteRoleRows.find((row) => row.userId === userId);
      const chosen = inContext ?? own[0] ?? siteRole;
      // Licencia: la del cliente en contexto; en la vista de toda la plataforma, la del cliente del usuario.
      // Solo queda sin licencia quien no tiene asignación a ningún cliente (o al cliente filtrado).
      const licensed = inContext ?? (clientId ? undefined : own[0]);
      return { key: (chosen?.roleKey ?? "viewer") as typeof VALID_ROLES[number], name: chosen?.roleName ?? "Solo lectura", licenseKind: licensed?.licenseKind ?? null, allSites: Boolean(licensed?.allSites) };
    };

    // Clientes donde quien consulta puede dar acceso a todo el cliente: HOIT en cualquiera con sitios; los demás,
    // solo si administran todos los sitios de ese cliente.
    const siteRows = await db.select({ id: sites.id, clientId: sites.clientId }).from(sites);
    const administeredSiteIds = new Set(user.sites.filter((site) => site.roleKey === "administrator").map((site) => site.id));
    const wholeClientIds = [...new Set(siteRows.map((site) => site.clientId))]
      .filter((id) => user.platformStaff || siteRows.filter((site) => site.clientId === id).every((site) => administeredSiteIds.has(site.id)));
    const total = Number(countRows[0]?.total ?? 0);
    const [licenses] = await loadClientLicenses(db, [contextClientId]);
    const manageableSiteIds = new Set(user.sites.filter((site) => site.roleKey === "administrator").map((site) => site.id));
    return Response.json({
      items: records.map((record) => {
        const role = roleOf(record.id);
        return {
          id: record.id,
          displayName: record.displayName,
          email: record.email,
          status: record.status,
          lastLoginAt: record.lastLoginAt?.toISOString() ?? null,
          createdAt: record.createdAt.toISOString(),
          mustChangePassword: record.mustChangePassword ?? false,
          role: { key: role.key, name: role.name },
          platformStaff: record.platformStaff,
          testAccount: record.testAccount,
          accessExpiresAt: record.accessExpiresAt?.toISOString() ?? null,
          licenseKind: role.licenseKind,
          allSites: role.allSites,
          clients: clientRows.filter((row) => row.userId === record.id).map((row) => ({ id: row.clientId, name: row.clientName })),
          siteIds: [...new Set(siteRoleRows.filter((row) => row.userId === record.id && row.siteId && manageableSiteIds.has(row.siteId)).map((row) => row.siteId!))],
        };
      }),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      summary: {
        total: scopedUsers.length,
        active: scopedUsers.filter((row) => row.status === "active").length,
        administrators: scopedUsers.filter((row) => roleOf(row.id).key === "administrator").length,
        invited: scopedUsers.filter((row) => row.status === "invited").length,
      },
      licenses: licenses ?? null,
      canAssignPartnerLicense: user.platformStaff,
      wholeClientIds,
      scope: platformScope ? "platform" : "client",
      clientFilter: platformScope ? clientId : user.clientId,
      // Clientes con sus licencias: el personal de HOIT elige a cuál pertenece cada usuario y qué licencia ocupa.
      clients: platformScope
        ? (await loadClientLicenses(db, (await db.select({ id: clients.id }).from(clients)).map((row) => row.id)))
          .map((item) => ({ id: item.clientId, name: item.clientName, ...item })).sort((left, right) => left.name.localeCompare(right.name, "es"))
        : licenses ? [{ id: licenses.clientId, name: licenses.clientName, ...licenses }] : [],
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
    // Acceso inicial: invitación por correo (el usuario crea su contraseña) o contraseña temporal definida por el admin.
    const invite = body?.accessMode === "invite";
    const status = invite ? "invited" : typeof body?.status === "string" ? body.status : "active";
    // Solo el personal de HOIT asigna licencias de integrador; el resto crea usuarios del propio cliente.
    const licenseKind = body?.licenseKind === undefined ? "client" : body.licenseKind;
    if (!isLicenseKind(licenseKind)) throw new ApiError(400, "El tipo de licencia no es válido.");
    if (licenseKind === "partner" && !actor.platformStaff) throw new ApiError(403, "Solo el personal de HOIT puede asignar licencias de integrador.");
    // Cuenta de prueba de HOIT: no ocupa licencia, el cliente no la ve y puede tener fecha de término.
    const testAccount = body?.testAccount === true;
    const platformStaff = body?.platformStaff === true;
    if (platformStaff && !actor.platformStaff) throw new ApiError(403, "Solo el personal de HOIT puede crear cuentas del personal de HOIT.");
    if (platformStaff && testAccount) throw new ApiError(400, "Una cuenta es del personal de HOIT o de prueba, no ambas.");
    const accessExpiresAt = parseAccessExpiry(body?.accessExpiresAt);
    if ((testAccount || accessExpiresAt) && !actor.platformStaff) throw new ApiError(403, "Solo el personal de HOIT puede crear cuentas de prueba o con fecha de término.");
    // Acceso a todo el cliente: todos sus sitios, también los que se creen después.
    const allSites = !platformStaff && body?.allSites === true;
    const wholeClient = allSites ? await wholeClientSites(db, actor, body?.clientId) : null;
    const requestedSiteIds = wholeClient ? wholeClient.map((site) => site.id) : Array.isArray(body?.siteIds)
      ? [...new Set(body.siteIds.filter((siteId): siteId is string => typeof siteId === "string"))]
      : [actor.siteId];
    if (displayName.length < 3 || !email.includes("@")) throw new ApiError(400, "Nombre y correo válido son obligatorios.");
    if (!VALID_ROLES.includes(roleKey as typeof VALID_ROLES[number])) throw new ApiError(400, "El perfil seleccionado no es válido.");
    if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) throw new ApiError(400, "El estado seleccionado no es válido.");
    if (!requestedSiteIds.length) throw new ApiError(400, "Selecciona al menos un sitio para el usuario.");
    const selectedSites = wholeClient ?? actor.sites.filter((site) => site.roleKey === "administrator" && requestedSiteIds.includes(site.id));
    if (selectedSites.length !== requestedSiteIds.length) throw new ApiError(403, "Uno o más sitios seleccionados están fuera de tu alcance.");
    if (!platformStaff) assertSitesOfClient(selectedSites, body?.clientId);
    // Invitado: contraseña aleatoria que nadie conoce (la cuenta no entra hasta crear la suya con el enlace).
    const passwordHash = invite ? await hashPassword(randomBytes(24).toString("base64url")) : await hashPassword(password).catch((error: unknown) => { throw new ApiError(400, error instanceof Error ? error.message : "Contraseña inválida."); });

    const created = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(ilike(users.email, email)).limit(1);
      if (existing) throw new ApiError(409, "Ya existe un usuario con ese correo.");
      const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
      if (!role) throw new ApiError(400, "El perfil seleccionado no existe en la base.");
      const [newUser] = await tx.insert(users).values({ email, displayName, status: status as typeof VALID_STATUSES[number], platformStaff, testAccount, accessExpiresAt }).returning();
      await tx.insert(authIdentities).values({ userId: newUser.id, provider: "local", providerSubject: email, passwordHash, mustChangePassword: !invite });
      const selectedClientIds = [...new Set(selectedSites.map((site) => site.clientId))];
      if (!testAccount && !platformStaff && statusUsesLicense(status)) await assertLicensesAvailable(tx, selectedClientIds.map((clientId) => ({ clientId, kind: licenseKind })));
      await tx.insert(userClientAssignments).values(selectedClientIds.map((clientId) => ({ userId: newUser.id, clientId, roleId: role.id, grantedBy: actor.id, licenseKind, allSites })));
      await tx.insert(userRoleAssignments).values(requestedSiteIds.map((siteId) => ({ userId: newUser.id, roleId: role.id, siteId, grantedBy: actor.id }))).onConflictDoNothing();
      const metadata = requestMetadata(request);
      await tx.insert(auditLogs).values({
        siteId: actor.siteId,
        actorUserId: actor.id,
        action: "users.create",
        resourceType: "user",
        resourceId: newUser.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        after: { email, displayName, status, role: roleKey, siteIds: requestedSiteIds, licenseKind, allSites, platformStaff, testAccount, accessExpiresAt },
      });
      return { ...newUser, role: { key: role.key, name: role.name } };
    });

    const invitation = invite ? await deliverInvitation(db, actor, created.id, requestMetadata(request)) : null;
    return Response.json({
      invitation,
      id: created.id,
      displayName: created.displayName,
      email: created.email,
      status: created.status,
      lastLoginAt: created.lastLoginAt?.toISOString() ?? null,
      createdAt: created.createdAt.toISOString(),
      mustChangePassword: !invite,
      role: created.role,
      siteIds: requestedSiteIds,
      licenseKind,
      platformStaff,
      testAccount,
      accessExpiresAt: accessExpiresAt?.toISOString() ?? null,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
