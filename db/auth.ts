import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { resolveUserAccessScopes } from "./access-scope";
import type { PortalRoleKey } from "./access-control";
import {
  authIdentities,
  authSessions,
  permissions,
  passwordResetTokens,
  rolePermissions,
  roles,
  userRoleAssignments,
  users,
} from "./schema";

const scrypt = promisify(nodeScrypt);
const PASSWORD_KEY_LENGTH = 64;
const SESSION_HOURS = 12;
export const PASSWORD_RESET_MINUTES = 30;

export const SESSION_COOKIE_NAME = "cam5_session";

export type AuthenticatedPortalUser = {
  id: string;
  email: string;
  displayName: string;
  status: "invited" | "active" | "suspended";
  roleKey: PortalRoleKey;
  roleName: string;
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
    roleKey: PortalRoleKey;
    roleName: string;
  }>;
  clientScopes: Array<{
    id: string;
    code: string;
    name: string;
    roleKey: PortalRoleKey;
    roleName: string;
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
    await tx.update(authIdentities).set({ passwordHash, mustChangePassword: false, updatedAt: now })
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
  const scopes = await resolveUserAccessScopes(db, userId);
  const initialScope = scopes.sites[0] ?? null;
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

export async function authenticateLocalUser(db: Cam5Database, email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  const [identity] = await db
    .select({
      userId: users.id,
      status: users.status,
      passwordHash: authIdentities.passwordHash,
    })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(and(
      eq(authIdentities.provider, "local"),
      eq(authIdentities.providerSubject, normalizedEmail),
    ))
    .limit(1);

  if (!identity?.passwordHash || identity.status !== "active") return null;
  if (!await verifyPassword(password, identity.passwordHash)) return null;

  await db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, identity.userId));
  return identity.userId;
}

export async function revokePortalSession(db: Cam5Database, token: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.tokenHash, hashSessionToken(token)), isNull(authSessions.revokedAt)));
}

export async function switchPortalSessionSite(db: Cam5Database, token: string, siteId: string): Promise<AuthenticatedPortalUser | null> {
  const tokenHash = hashSessionToken(token);
  const [session] = await db.select({
    id: authSessions.id,
    userId: authSessions.userId,
  }).from(authSessions).where(and(
    eq(authSessions.tokenHash, tokenHash),
    isNull(authSessions.revokedAt),
    gt(authSessions.expiresAt, new Date()),
  )).limit(1);
  if (!session) return null;

  const scopes = await resolveUserAccessScopes(db, session.userId);
  if (!scopes.sites.some((scope) => scope.siteId === siteId)) return null;
  await db.update(authSessions).set({ activeSiteId: siteId, lastSeenAt: new Date() }).where(eq(authSessions.id, session.id));
  return resolvePortalSession(db, token);
}

export async function resolvePortalSession(db: Cam5Database, token: string): Promise<AuthenticatedPortalUser | null> {
  const now = new Date();
  const [session] = await db
    .select({
      sessionId: authSessions.id,
      activeSiteId: authSessions.activeSiteId,
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

  const scopes = await resolveUserAccessScopes(db, session.userId, now);
  if (!scopes.sites.length) return null;

  const selected = scopes.sites.find((scope) => scope.siteId === session.activeSiteId) ?? scopes.sites[0];
  if (selected.siteId !== session.activeSiteId) {
    await db.update(authSessions).set({ activeSiteId: selected.siteId }).where(eq(authSessions.id, session.sessionId));
  }

  const permissionRows = await db
    .select({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, selected.roleId));

  await db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, session.sessionId));

  return {
    id: session.userId,
    email: session.email,
    displayName: session.displayName,
    status: session.status,
    roleKey: selected.roleKey,
    roleName: selected.roleName,
    mustChangePassword: session.mustChangePassword ?? false,
    clientId: selected.clientId,
    clientCode: selected.clientCode,
    clientName: selected.clientName,
    siteId: selected.siteId,
    siteCode: selected.siteCode,
    siteName: selected.siteName,
    sites: scopes.sites.map((scope) => ({
      id: scope.siteId,
      code: scope.siteCode,
      name: scope.siteName,
      clientId: scope.clientId,
      clientCode: scope.clientCode,
      clientName: scope.clientName,
      roleKey: scope.roleKey,
      roleName: scope.roleName,
    })),
    clientScopes: scopes.clients.map((scope) => ({
      id: scope.clientId,
      code: scope.clientCode,
      name: scope.clientName,
      roleKey: scope.roleKey,
      roleName: scope.roleName,
    })),
    permissions: [...new Set(permissionRows.map((row) => row.code))],
  };
}
