import type { NextRequest } from "next/server";
import { and, asc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import {
  auditLogs,
  onCallAssignments,
  roles,
  shifts,
  sites,
  userClientAssignments,
  userRoleAssignments,
  users,
} from "../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "El cuerpo no es válido.");
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string, maximum = 160) {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, `${label} es obligatorio.`);
  const normalized = value.trim();
  if (normalized.length > maximum) throw new ApiError(400, `${label} es demasiado largo.`);
  return normalized;
}

function timestamp(value: unknown, label: string) {
  if (typeof value !== "string") throw new ApiError(400, `${label} debe usar fecha ISO 8601.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ApiError(400, `${label} no es una fecha válida.`);
  return parsed;
}

function priority(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) throw new ApiError(400, "La prioridad debe ser un entero entre 0 y 100.");
  return parsed;
}

function canManageClient(user: Awaited<ReturnType<typeof requireApiSession>>["user"]) {
  return user.clientScopes.some((scope) =>
    scope.id === user.clientId && (scope.roleKey === "platform_admin" || scope.roleKey === "client_admin")
  );
}

async function clientShift(db: Awaited<ReturnType<typeof requireApiSession>>["db"], clientId: string, shiftId: string) {
  const [shift] = await db.select().from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.clientId, clientId)))
    .limit(1);
  if (!shift) throw new ApiError(404, "El turno no existe dentro del cliente activo.");
  return shift;
}

async function eligibleUsers(db: Awaited<ReturnType<typeof requireApiSession>>["db"], clientId: string) {
  const clientSiteIds = (await db.select({ id: sites.id }).from(sites).where(eq(sites.clientId, clientId))).map((row) => row.id);
  const [clientRows, siteRows, platformRows] = await Promise.all([
    db.select({ userId: userClientAssignments.userId })
      .from(userClientAssignments)
      .innerJoin(users, eq(users.id, userClientAssignments.userId))
      .where(and(eq(userClientAssignments.clientId, clientId), eq(users.status, "active"))),
    clientSiteIds.length
      ? db.select({ userId: userRoleAssignments.userId })
          .from(userRoleAssignments)
          .innerJoin(users, eq(users.id, userRoleAssignments.userId))
          .where(and(inArray(userRoleAssignments.siteId, clientSiteIds), eq(users.status, "active")))
      : Promise.resolve([]),
    db.select({ userId: userRoleAssignments.userId })
      .from(userRoleAssignments)
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .innerJoin(users, eq(users.id, userRoleAssignments.userId))
      .where(and(
        eq(roles.key, "platform_admin"),
        isNull(userRoleAssignments.siteId),
        eq(users.status, "active"),
        or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, new Date())),
      )),
  ]);

  const ids = [...new Set([...clientRows, ...siteRows, ...platformRows].map((row) => row.userId))];
  if (!ids.length) return [];
  return db.select({
    id: users.id,
    displayName: users.displayName,
    email: users.email,
    phoneE164: users.phoneE164,
  }).from(users).where(inArray(users.id, ids)).orderBy(asc(users.displayName));
}

async function assertEligibleUser(
  db: Awaited<ReturnType<typeof requireApiSession>>["db"],
  clientId: string,
  userId: string,
) {
  const eligible = await eligibleUsers(db, clientId);
  const user = eligible.find((item) => item.id === userId);
  if (!user) throw new ApiError(403, "El usuario no está activo o no pertenece al alcance del cliente.");
  return user;
}

async function assertNoAmbiguousOverlap(
  db: Awaited<ReturnType<typeof requireApiSession>>["db"],
  input: { shiftId: string; startsAt: Date; endsAt: Date; priority: number; excludeId?: string },
) {
  const overlapping = await db.select({ id: onCallAssignments.id, userId: onCallAssignments.userId })
    .from(onCallAssignments)
    .where(and(
      eq(onCallAssignments.shiftId, input.shiftId),
      eq(onCallAssignments.priority, input.priority),
      lt(onCallAssignments.startsAt, input.endsAt),
      gt(onCallAssignments.endsAt, input.startsAt),
    ));
  const conflict = overlapping.find((row) => row.id !== input.excludeId);
  if (conflict) throw new ApiError(409, "Existe otra asignación superpuesta con la misma prioridad en este turno. Cambia el período o la prioridad.");
}

async function listAssignments(db: Awaited<ReturnType<typeof requireApiSession>>["db"], clientId: string) {
  return db.select({
    id: onCallAssignments.id,
    shiftId: shifts.id,
    shiftName: shifts.name,
    userId: users.id,
    userName: users.displayName,
    userEmail: users.email,
    userPhoneE164: users.phoneE164,
    startsAt: onCallAssignments.startsAt,
    endsAt: onCallAssignments.endsAt,
    priority: onCallAssignments.priority,
  }).from(onCallAssignments)
    .innerJoin(shifts, eq(shifts.id, onCallAssignments.shiftId))
    .innerJoin(users, eq(users.id, onCallAssignments.userId))
    .where(eq(shifts.clientId, clientId))
    .orderBy(asc(shifts.name), asc(onCallAssignments.priority), asc(onCallAssignments.startsAt));
}

function serializeAssignment(row: Awaited<ReturnType<typeof listAssignments>>[number]) {
  return {
    ...row,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "settings.read");
    const [assignments, candidates] = await Promise.all([
      listAssignments(db, user.clientId),
      eligibleUsers(db, user.clientId),
    ]);
    return Response.json({
      clientId: user.clientId,
      canManage: canManageClient(user),
      users: candidates,
      assignments: assignments.map(serializeAssignment),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "users.manage");
    if (!canManageClient(user)) throw new ApiError(403, "Sólo un Administrador HOIT o Administrador de cliente puede asignar on-call.");
    const body = bodyObject(await request.json().catch(() => null));
    const shiftId = requiredText(body.shiftId, "El turno", 80);
    const userId = requiredText(body.userId, "El usuario", 80);
    await clientShift(db, user.clientId, shiftId);
    await assertEligibleUser(db, user.clientId, userId);
    const startsAt = timestamp(body.startsAt, "startsAt");
    const endsAt = timestamp(body.endsAt, "endsAt");
    if (endsAt <= startsAt) throw new ApiError(400, "endsAt debe ser posterior a startsAt.");
    const parsedPriority = priority(body.priority ?? 0);
    await assertNoAmbiguousOverlap(db, { shiftId, startsAt, endsAt, priority: parsedPriority });
    const metadata = requestMetadata(request);

    const [created] = await db.transaction(async (tx) => {
      const rows = await tx.insert(onCallAssignments).values({
        shiftId,
        userId,
        startsAt,
        endsAt,
        priority: parsedPriority,
      }).returning();
      const row = rows[0];
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "on_call_assignment.create",
        resourceType: "on_call_assignment",
        resourceId: row.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        after: row,
      });
      return rows;
    });

    const row = (await listAssignments(db, user.clientId)).find((item) => item.id === created.id);
    return Response.json({ assignment: row ? serializeAssignment(row) : null }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "users.manage");
    if (!canManageClient(user)) throw new ApiError(403, "Sólo un Administrador HOIT o Administrador de cliente puede modificar on-call.");
    const body = bodyObject(await request.json().catch(() => null));
    const id = requiredText(body.id, "El identificador", 80);
    const [current] = await db.select({
      id: onCallAssignments.id,
      shiftId: onCallAssignments.shiftId,
      userId: onCallAssignments.userId,
      startsAt: onCallAssignments.startsAt,
      endsAt: onCallAssignments.endsAt,
      priority: onCallAssignments.priority,
      clientId: shifts.clientId,
    }).from(onCallAssignments)
      .innerJoin(shifts, eq(shifts.id, onCallAssignments.shiftId))
      .where(and(eq(onCallAssignments.id, id), eq(shifts.clientId, user.clientId)))
      .limit(1);
    if (!current) throw new ApiError(404, "La asignación no existe dentro del cliente activo.");

    const shiftId = typeof body.shiftId === "string" ? body.shiftId : current.shiftId;
    const userId = typeof body.userId === "string" ? body.userId : current.userId;
    await clientShift(db, user.clientId, shiftId);
    await assertEligibleUser(db, user.clientId, userId);
    const startsAt = body.startsAt === undefined ? current.startsAt : timestamp(body.startsAt, "startsAt");
    const endsAt = body.endsAt === undefined ? current.endsAt : timestamp(body.endsAt, "endsAt");
    if (endsAt <= startsAt) throw new ApiError(400, "endsAt debe ser posterior a startsAt.");
    const parsedPriority = body.priority === undefined ? current.priority : priority(body.priority);
    await assertNoAmbiguousOverlap(db, { shiftId, startsAt, endsAt, priority: parsedPriority, excludeId: id });
    const metadata = requestMetadata(request);

    const [updated] = await db.transaction(async (tx) => {
      const rows = await tx.update(onCallAssignments).set({
        shiftId,
        userId,
        startsAt,
        endsAt,
        priority: parsedPriority,
      }).where(eq(onCallAssignments.id, id)).returning();
      const row = rows[0];
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "on_call_assignment.update",
        resourceType: "on_call_assignment",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: current,
        after: row,
      });
      return rows;
    });

    const row = (await listAssignments(db, user.clientId)).find((item) => item.id === updated.id);
    return Response.json({ assignment: row ? serializeAssignment(row) : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "users.manage");
    if (!canManageClient(user)) throw new ApiError(403, "Sólo un Administrador HOIT o Administrador de cliente puede quitar asignaciones on-call.");
    const body = bodyObject(await request.json().catch(() => null));
    const id = requiredText(body.id, "El identificador", 80);
    const [current] = await db.select({
      id: onCallAssignments.id,
      shiftId: onCallAssignments.shiftId,
      userId: onCallAssignments.userId,
      startsAt: onCallAssignments.startsAt,
      endsAt: onCallAssignments.endsAt,
      priority: onCallAssignments.priority,
      clientId: shifts.clientId,
    }).from(onCallAssignments)
      .innerJoin(shifts, eq(shifts.id, onCallAssignments.shiftId))
      .where(and(eq(onCallAssignments.id, id), eq(shifts.clientId, user.clientId)))
      .limit(1);
    if (!current) throw new ApiError(404, "La asignación no existe dentro del cliente activo.");
    const metadata = requestMetadata(request);

    await db.transaction(async (tx) => {
      await tx.delete(onCallAssignments).where(eq(onCallAssignments.id, id));
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "on_call_assignment.delete",
        resourceType: "on_call_assignment",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: current,
      });
    });

    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
