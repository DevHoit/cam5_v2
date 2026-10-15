import type { NextRequest } from "next/server";
import { and, asc, count, eq, gt, inArray, isNull, or } from "drizzle-orm";
import {
  auditLogs,
  escalationLevels,
  escalationPolicies,
  roles,
  rules,
  shifts,
  sites,
  userClientAssignments,
  userRoleAssignments,
  users,
} from "../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

type RecipientType = "user" | "role" | "on_call_group";
type LevelInput = {
  levelNumber: number;
  delaySeconds: number;
  recipientType: RecipientType;
  recipientRef: string;
  channels: string[];
  repeatCount: number;
};

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

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new ApiError(400, `${label} debe ser un entero entre ${minimum} y ${maximum}.`);
  return parsed;
}

function canManageClient(user: Awaited<ReturnType<typeof requireApiSession>>["user"]) {
  return user.clientScopes.some((scope) =>
    scope.id === user.clientId && (scope.roleKey === "platform_admin" || scope.roleKey === "client_admin")
  );
}

async function eligibleUserIds(db: Awaited<ReturnType<typeof requireApiSession>>["db"], clientId: string) {
  const clientSiteIds = (await db.select({ id: sites.id }).from(sites).where(eq(sites.clientId, clientId))).map((row) => row.id);
  const [clientRows, siteRows, platformRows] = await Promise.all([
    db.select({ userId: userClientAssignments.userId }).from(userClientAssignments)
      .innerJoin(users, eq(users.id, userClientAssignments.userId))
      .where(and(eq(userClientAssignments.clientId, clientId), eq(users.status, "active"))),
    clientSiteIds.length
      ? db.select({ userId: userRoleAssignments.userId }).from(userRoleAssignments)
          .innerJoin(users, eq(users.id, userRoleAssignments.userId))
          .where(and(inArray(userRoleAssignments.siteId, clientSiteIds), eq(users.status, "active")))
      : Promise.resolve([]),
    db.select({ userId: userRoleAssignments.userId }).from(userRoleAssignments)
      .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
      .innerJoin(users, eq(users.id, userRoleAssignments.userId))
      .where(and(
        eq(roles.key, "platform_admin"),
        isNull(userRoleAssignments.siteId),
        eq(users.status, "active"),
        or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, new Date())),
      )),
  ]);
  return [...new Set([...clientRows, ...siteRows, ...platformRows].map((row) => row.userId))];
}

async function parseLevels(
  db: Awaited<ReturnType<typeof requireApiSession>>["db"],
  clientId: string,
  value: unknown,
): Promise<LevelInput[]> {
  if (!Array.isArray(value) || !value.length) throw new ApiError(400, "La política debe contener al menos un nivel.");
  if (value.length > 10) throw new ApiError(400, "Una política admite como máximo 10 niveles.");
  const userIds = await eligibleUserIds(db, clientId);
  const clientShifts = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.clientId, clientId));
  const shiftIds = new Set(clientShifts.map((row) => row.id));
  const roleRows = await db.select({ key: roles.key }).from(roles);
  const roleKeys = new Set(roleRows.map((row) => row.key));
  const numbers = new Set<number>();

  const levels: LevelInput[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const row = bodyObject(value[index]);
    const levelNumber = integer(row.levelNumber, `levels[${index}].levelNumber`, 1, 10);
    if (numbers.has(levelNumber)) throw new ApiError(400, "Los números de nivel no pueden repetirse.");
    numbers.add(levelNumber);
    const delaySeconds = integer(row.delaySeconds ?? 0, `levels[${index}].delaySeconds`, 0, 604800);
    const recipientType = row.recipientType;
    if (!["user", "role", "on_call_group"].includes(String(recipientType))) throw new ApiError(400, `levels[${index}].recipientType no es válido.`);
    const recipientRef = requiredText(row.recipientRef, `levels[${index}].recipientRef`);
    if (recipientType === "user" && !userIds.includes(recipientRef)) throw new ApiError(403, "El usuario destinatario está fuera del alcance del cliente.");
    if (recipientType === "role" && !roleKeys.has(recipientRef)) throw new ApiError(400, "El rol destinatario no existe.");
    if (recipientType === "on_call_group" && !shiftIds.has(recipientRef)) throw new ApiError(403, "El turno on-call no pertenece al cliente activo.");
    if (!Array.isArray(row.channels) || !row.channels.length) throw new ApiError(400, "Cada nivel debe tener al menos un canal.");
    const channels = [...new Set(row.channels.map(String).map((item) => item === "whatsapp_meta" ? "whatsapp" : item))];
    if (channels.some((channel) => !["email", "whatsapp"].includes(channel))) throw new ApiError(400, "V1 sólo admite email y whatsapp como canales personales de escalamiento.");
    const repeatCount = integer(row.repeatCount ?? 1, `levels[${index}].repeatCount`, 1, 1);
    levels.push({ levelNumber, delaySeconds, recipientType: recipientType as RecipientType, recipientRef, channels, repeatCount });
  }
  return levels.sort((a, b) => a.levelNumber - b.levelNumber);
}

async function listPolicies(db: Awaited<ReturnType<typeof requireApiSession>>["db"], clientId: string) {
  const policyRows = await db.select({
    id: escalationPolicies.id,
    name: escalationPolicies.name,
    enabled: escalationPolicies.enabled,
    createdAt: escalationPolicies.createdAt,
    updatedAt: escalationPolicies.updatedAt,
  }).from(escalationPolicies).where(eq(escalationPolicies.clientId, clientId)).orderBy(asc(escalationPolicies.name));
  const ids = policyRows.map((row) => row.id);
  const [levelRows, usageRows] = await Promise.all([
    ids.length ? db.select().from(escalationLevels).where(inArray(escalationLevels.policyId, ids)).orderBy(asc(escalationLevels.levelNumber)) : Promise.resolve([]),
    ids.length ? db.select({ policyId: rules.escalationPolicyId, value: count() }).from(rules)
      .where(inArray(rules.escalationPolicyId, ids)).groupBy(rules.escalationPolicyId) : Promise.resolve([]),
  ]);
  return policyRows.map((policy) => ({
    ...policy,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
    attachedRules: Number(usageRows.find((row) => row.policyId === policy.id)?.value ?? 0),
    levels: levelRows.filter((level) => level.policyId === policy.id),
  }));
}

async function options(db: Awaited<ReturnType<typeof requireApiSession>>["db"], clientId: string) {
  const ids = await eligibleUserIds(db, clientId);
  const [people, roleRows, shiftRows] = await Promise.all([
    ids.length
      ? db.select({ id: users.id, displayName: users.displayName, email: users.email, phoneE164: users.phoneE164 })
          .from(users).where(inArray(users.id, ids)).orderBy(asc(users.displayName))
      : Promise.resolve([]),
    db.select({ key: roles.key, name: roles.name }).from(roles).orderBy(roles.name),
    db.select({ id: shifts.id, name: shifts.name, active: shifts.active }).from(shifts)
      .where(eq(shifts.clientId, clientId)).orderBy(asc(shifts.name)),
  ]);
  return { users: people, roles: roleRows, shifts: shiftRows };
}

export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.read");
    const [policies, recipientOptions] = await Promise.all([listPolicies(db, user.clientId), options(db, user.clientId)]);
    return Response.json({
      clientId: user.clientId,
      canManage: canManageClient(user) && user.permissions.includes("notifications.write"),
      policies,
      options: recipientOptions,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.write");
    if (!canManageClient(user)) throw new ApiError(403, "Sólo un Administrador HOIT o Administrador de cliente puede crear políticas de escalamiento.");
    const body = bodyObject(await request.json().catch(() => null));
    const name = requiredText(body.name, "El nombre");
    const levels = await parseLevels(db, user.clientId, body.levels);
    const metadata = requestMetadata(request);

    const created = await db.transaction(async (tx) => {
      const [policy] = await tx.insert(escalationPolicies).values({
        clientId: user.clientId,
        name,
        enabled: body.enabled !== false,
      }).returning();
      await tx.insert(escalationLevels).values(levels.map((level) => ({ policyId: policy.id, ...level })));
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "escalation_policy.create",
        resourceType: "escalation_policy",
        resourceId: policy.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        after: { ...policy, levels },
      });
      return policy;
    });

    const policy = (await listPolicies(db, user.clientId)).find((item) => item.id === created.id);
    return Response.json({ policy }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, "notifications.write");
    if (!canManageClient(user)) throw new ApiError(403, "Sólo un Administrador HOIT o Administrador de cliente puede modificar políticas de escalamiento.");
    const body = bodyObject(await request.json().catch(() => null));
    const id = requiredText(body.id, "El identificador", 80);
    const [current] = await db.select().from(escalationPolicies)
      .where(and(eq(escalationPolicies.id, id), eq(escalationPolicies.clientId, user.clientId)))
      .limit(1);
    if (!current) throw new ApiError(404, "La política no existe dentro del cliente activo.");
    const name = body.name === undefined ? current.name : requiredText(body.name, "El nombre");
    const enabled = typeof body.enabled === "boolean" ? body.enabled : current.enabled;
    const levels = body.levels === undefined ? null : await parseLevels(db, user.clientId, body.levels);
    const metadata = requestMetadata(request);
    const beforeLevels = await db.select().from(escalationLevels).where(eq(escalationLevels.policyId, id));

    await db.transaction(async (tx) => {
      const [updated] = await tx.update(escalationPolicies).set({ name, enabled, updatedAt: new Date() })
        .where(eq(escalationPolicies.id, id)).returning();
      if (levels) {
        await tx.delete(escalationLevels).where(eq(escalationLevels.policyId, id));
        await tx.insert(escalationLevels).values(levels.map((level) => ({ policyId: id, ...level })));
      }
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "escalation_policy.update",
        resourceType: "escalation_policy",
        resourceId: id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { ...current, levels: beforeLevels },
        after: { ...updated, levels: levels ?? beforeLevels },
      });
    });

    const policy = (await listPolicies(db, user.clientId)).find((item) => item.id === id);
    return Response.json({ policy }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
