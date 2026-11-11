import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Cam5Database } from "./index";
import {
  authIdentities,
  authSessions,
  clients,
  permissions,
  passwordResetTokens,
  rolePermissions,
  roles,
  sites,
  userRoleAssignments,
  users,
} from "./schema";

const scrypt = promisify(nodeScrypt);
const PASSWORD_KEY_LENGTH = 64;
const SESSION_HOURS = 12;
export const PASSWORD_RESET_MINUTES = 30;
/** Intentos fallidos permitidos dentro de la ventana antes de bloquear la cuenta. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
/** Ventana de conteo de intentos fallidos y duración del bloqueo temporal. */
export const LOGIN_LOCKOUT_MINUTES = 15;
// Hash ficticio para que un correo inexistente tarde lo mismo que uno real.
const DUMMY_PASSWORD_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(PASSWORD_KEY_LENGTH * 2)}`;

export const SESSION_COOKIE_NAME = "cam5_session";
/** Intervalo mínimo entre actualizaciones de "última actividad" de sesiones y credenciales. */
export const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

export type AuthenticatedPortalUser = {
  id: string;
  email: string;
  displayName: string;
  status: "invited" | "active" | "suspended";
  roleKey: "administrator" | "engineer" | "operator" | "viewer";
  roleName: "Administrador" | "Ingeniero" | "Operador" | "Solo lectura";
  mustChangePassword: boolean;
  clientId: string;
  clientCode: string;
  clientName: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  sites: Array<{
    id: string;
    code: string;
    name: string;
    clientId: string;
    clientCode: string;
    clientName: string;
    roleKey: AuthenticatedPortalUser["roleKey"];
    roleName: AuthenticatedPortalUser["roleName"];
  }>;
  permissions: string[];
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10) throw new Error("La contraseña debe tener al menos 10 caracteres.");
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, PASSWORD_KEY_LENGTH) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, expectedHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== PASSWORD_KEY_LENGTH) return false;
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return timingSafeEqual(expected, actual);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createPasswordResetToken(
  db: Cam5Database,
  email: string,
  requestedIp?: string | null,
  now = new Date(),
) {
  const normalizedEmail = normalizeEmail(email);
  const [target] = await db.select({
    userId: users.id,
    email: users.email,
    displayName: users.displayName,
  }).from(users)
    .innerJoin(authIdentities, and(eq(authIdentities.userId, users.id), eq(authIdentities.provider, "local")))
    .where(and(eq(authIdentities.providerSubject, normalizedEmail), eq(users.status, "active")))
    .limit(1);
  if (!target) return null;

  const throttleAfter = new Date(now.getTime() - 60_000);
  const [recent] = await db.select({ id: passwordResetTokens.id }).from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.userId, target.userId), gt(passwordResetTokens.createdAt, throttleAfter)))
    .limit(1);
  if (recent) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_MINUTES * 60_000);
  await db.transaction(async (tx) => {
    await tx.update(passwordResetTokens).set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, target.userId), isNull(passwordResetTokens.usedAt)));
    await tx.insert(passwordResetTokens).values({
      userId: target.userId,
      tokenHash: hashSessionToken(token),
      requestedIp: requestedIp || null,
      expiresAt,
      createdAt: now,
    });
  });
  return { ...target, token, expiresAt };
}

export async function consumePasswordResetToken(
  db: Cam5Database,
  token: string,
  newPassword: string,
  now = new Date(),
) {
  const tokenHash = hashSessionToken(token);
  const [candidate] = await db.select({
    id: passwordResetTokens.id,
    userId: passwordResetTokens.userId,
    passwordHash: authIdentities.passwordHash,
  }).from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .innerJoin(authIdentities, and(eq(authIdentities.userId, users.id), eq(authIdentities.provider, "local")))
    .where(and(
      eq(passwordResetTokens.tokenHash, tokenHash),
      isNull(passwordResetTokens.usedAt),
      gt(passwordResetTokens.expiresAt, now),
      eq(users.status, "active"),
    ))
    .limit(1);
  if (!candidate?.passwordHash) return null;
  if (await verifyPassword(newPassword, candidate.passwordHash)) throw new Error("La nueva contraseña debe ser diferente de la anterior.");
  const passwordHash = await hashPassword(newPassword);

  return db.transaction(async (tx) => {
    const [claimed] = await tx.update(passwordResetTokens).set({ usedAt: now })
      .where(and(eq(passwordResetTokens.id, candidate.id), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, now)))
      .returning({ id: passwordResetTokens.id });
    if (!claimed) return null;
    await tx.update(authIdentities).set({ passwordHash, mustChangePassword: false, failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null, updatedAt: now })
      .where(and(eq(authIdentities.userId, candidate.userId), eq(authIdentities.provider, "local")));
    await tx.update(authSessions).set({ revokedAt: now })
      .where(and(eq(authSessions.userId, candidate.userId), isNull(authSessions.revokedAt)));
    await tx.update(passwordResetTokens).set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, candidate.userId), isNull(passwordResetTokens.usedAt)));
    return { userId: candidate.userId };
  });
}

export async function createPortalSession(
  db: Cam5Database,
  userId: string,
  metadata: { ipAddress?: string | null; userAgent?: string | null } = {},
) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  const [initialScope] = await db
    .select({ siteId: userRoleAssignments.siteId })
    .from(userRoleAssignments)
    .innerJoin(sites, eq(sites.id, userRoleAssignments.siteId))
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .where(and(
      eq(userRoleAssignments.userId, userId),
      eq(sites.active, true),
      eq(clients.active, true),
      or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, new Date())),
    ))
    .limit(1);
  await db.insert(authSessions).values({
    userId,
    activeSiteId: initialScope?.siteId ?? null,
    tokenHash: hashSessionToken(token),
    expiresAt,
    ipAddress: metadata.ipAddress || null,
    userAgent: metadata.userAgent || null,
  });
  return { token, expiresAt };
}

export type LocalLoginResult =
  | { status: "authenticated"; userId: string }
  | { status: "invalid"; userId: string | null; failedAttempts: number; lockedUntil: Date | null }
  | { status: "locked"; userId: string; lockedUntil: Date };

export async function attemptLocalLogin(db: Cam5Database, email: string, password: string, now = new Date()): Promise<LocalLoginResult> {
  const normalizedEmail = normalizeEmail(email);
  const [identity] = await db
    .select({
      identityId: authIdentities.id,
      userId: users.id,
      status: users.status,
      passwordHash: authIdentities.passwordHash,
      lockedUntil: authIdentities.lockedUntil,
    })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(and(
      eq(authIdentities.provider, "local"),
      eq(authIdentities.providerSubject, normalizedEmail),
    ))
    .limit(1);

  if (!identity?.passwordHash) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return { status: "invalid", userId: null, failedAttempts: 0, lockedUntil: null };
  }
  if (identity.lockedUntil && identity.lockedUntil > now) {
    return { status: "locked", userId: identity.userId, lockedUntil: identity.lockedUntil };
  }

  const validPassword = await verifyPassword(password, identity.passwordHash);
  if (validPassword && identity.status === "active") {
    await db.update(authIdentities).set({ failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null }).where(eq(authIdentities.id, identity.identityId));
    await db.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, identity.userId));
    return { status: "authenticated", userId: identity.userId };
  }

  // El conteo se reinicia si el último fallo quedó fuera de la ventana o si ya terminó un bloqueo anterior.
  const windowStart = new Date(now.getTime() - LOGIN_LOCKOUT_MINUTES * 60_000);
  const lockedUntil = new Date(now.getTime() + LOGIN_LOCKOUT_MINUTES * 60_000);
  const nextCount = sql<number>`(case
    when ${authIdentities.lastFailedLoginAt} is null
      or ${authIdentities.lastFailedLoginAt} < ${windowStart.toISOString()}::timestamptz
      or (${authIdentities.lockedUntil} is not null and ${authIdentities.lockedUntil} <= ${now.toISOString()}::timestamptz)
    then 1 else ${authIdentities.failedLoginCount} + 1 end)`;
  const [updated] = await db.update(authIdentities).set({
    failedLoginCount: nextCount,
    lastFailedLoginAt: now,
    lockedUntil: sql`(case when ${nextCount} >= ${MAX_FAILED_LOGIN_ATTEMPTS} then ${lockedUntil.toISOString()}::timestamptz else null end)`,
  }).where(eq(authIdentities.id, identity.identityId))
    .returning({ failedLoginCount: authIdentities.failedLoginCount, lockedUntil: authIdentities.lockedUntil });
  return { status: "invalid", userId: identity.userId, failedAttempts: updated?.failedLoginCount ?? 0, lockedUntil: updated?.lockedUntil ?? null };
}

export async function authenticateLocalUser(db: Cam5Database, email: string, password: string) {
  const result = await attemptLocalLogin(db, email, password);
  return result.status === "authenticated" ? result.userId : null;
}

export async function revokePortalSession(db: Cam5Database, token: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.tokenHash, hashSessionToken(token)), isNull(authSessions.revokedAt)));
}

export async function switchPortalSessionSite(db: Cam5Database, token: string, siteId: string): Promise<AuthenticatedPortalUser | null> {
  const tokenHash = hashSessionToken(token);
  const [allowed] = await db
    .select({ sessionId: authSessions.id })
    .from(authSessions)
    .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, authSessions.userId))
    .innerJoin(sites, eq(sites.id, userRoleAssignments.siteId))
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .where(and(
      eq(authSessions.tokenHash, tokenHash),
      isNull(authSessions.revokedAt),
      gt(authSessions.expiresAt, new Date()),
      eq(userRoleAssignments.siteId, siteId),
      eq(sites.active, true),
      eq(clients.active, true),
      or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, new Date())),
    ))
    .limit(1);
  if (!allowed) return null;
  await db.update(authSessions).set({ activeSiteId: siteId, lastSeenAt: new Date() }).where(eq(authSessions.id, allowed.sessionId));
  return resolvePortalSession(db, token);
}

export async function resolvePortalSession(db: Cam5Database, token: string): Promise<AuthenticatedPortalUser | null> {
  const now = new Date();
  const [session] = await db
    .select({
      sessionId: authSessions.id,
      activeSiteId: authSessions.activeSiteId,
      lastSeenAt: authSessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      mustChangePassword: authIdentities.mustChangePassword,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .leftJoin(authIdentities, and(eq(authIdentities.userId, users.id), eq(authIdentities.provider, "local")))
    .where(and(
      eq(authSessions.tokenHash, hashSessionToken(token)),
      isNull(authSessions.revokedAt),
      gt(authSessions.expiresAt, now),
      eq(users.status, "active"),
    ))
    .limit(1);

  if (!session) return null;

  const assignmentRows = await db
    .select({
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      siteId: sites.id,
      siteCode: sites.code,
      siteName: sites.name,
      clientId: clients.id,
      clientCode: clients.code,
      clientName: clients.name,
    })
    .from(userRoleAssignments)
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .innerJoin(sites, eq(sites.id, userRoleAssignments.siteId))
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .where(and(
      eq(userRoleAssignments.userId, session.userId),
      eq(sites.active, true),
      eq(clients.active, true),
      or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, now)),
    ))
    .orderBy(
      sites.name,
      desc(sql<number>`case ${roles.key} when 'administrator' then 4 when 'engineer' then 3 when 'operator' then 2 else 1 end`),
    );

  const bestAssignmentBySite = new Map<string, (typeof assignmentRows)[number]>();
  for (const assignment of assignmentRows) {
    if (!bestAssignmentBySite.has(assignment.siteId)) bestAssignmentBySite.set(assignment.siteId, assignment);
  }
  const availableSites = [...bestAssignmentBySite.values()];
  if (!availableSites.length) return null;
  const selected = availableSites.find((assignment) => assignment.siteId === session.activeSiteId) ?? availableSites[0];
  if (selected.siteId !== session.activeSiteId) {
    await db.update(authSessions).set({ activeSiteId: selected.siteId }).where(eq(authSessions.id, session.sessionId));
  }

  const permissionRows = await db
    .select({ code: permissions.code })
    .from(userRoleAssignments)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoleAssignments.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(
      eq(userRoleAssignments.userId, session.userId),
      eq(userRoleAssignments.siteId, selected.siteId),
      or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, now)),
    ));

  // Basta con una precisión de un minuto: evita escribir en cada llamada a la API.
  if (!session.lastSeenAt || now.getTime() - session.lastSeenAt.getTime() >= ACTIVITY_WRITE_INTERVAL_MS) {
    await db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, session.sessionId));
  }

  return {
    id: session.userId,
    email: session.email,
    displayName: session.displayName,
    status: session.status,
    roleKey: selected.roleKey as AuthenticatedPortalUser["roleKey"],
    roleName: selected.roleName as AuthenticatedPortalUser["roleName"],
    mustChangePassword: session.mustChangePassword ?? false,
    clientId: selected.clientId,
    clientCode: selected.clientCode,
    clientName: selected.clientName,
    siteId: selected.siteId,
    siteCode: selected.siteCode,
    siteName: selected.siteName,
    sites: availableSites.map((scope) => ({
      id: scope.siteId,
      code: scope.siteCode,
      name: scope.siteName,
      clientId: scope.clientId,
      clientCode: scope.clientCode,
      clientName: scope.clientName,
      roleKey: scope.roleKey as AuthenticatedPortalUser["roleKey"],
      roleName: scope.roleName as AuthenticatedPortalUser["roleName"],
    })),
    permissions: [...new Set(permissionRows.map((row) => row.code))],
  };
}
