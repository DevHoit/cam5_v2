import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Cam5Database } from "./index";
import {
  authIdentities,
  authSessions,
  permissions,
  rolePermissions,
  roles,
  userRoleAssignments,
  users,
} from "./schema";

const scrypt = promisify(nodeScrypt);
const PASSWORD_KEY_LENGTH = 64;
const SESSION_HOURS = 12;

export const SESSION_COOKIE_NAME = "cam5_session";

export type AuthenticatedPortalUser = {
  id: string;
  email: string;
  displayName: string;
  status: "invited" | "active" | "suspended";
  roleKey: "administrator" | "engineer" | "operator" | "viewer";
  roleName: "Administrador" | "Ingeniero" | "Operador" | "Solo lectura";
  siteId: string;
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

export async function createPortalSession(
  db: Cam5Database,
  userId: string,
  metadata: { ipAddress?: string | null; userAgent?: string | null } = {},
) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await db.insert(authSessions).values({
    userId,
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

export async function resolvePortalSession(db: Cam5Database, token: string): Promise<AuthenticatedPortalUser | null> {
  const now = new Date();
  const [session] = await db
    .select({
      sessionId: authSessions.id,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      roleKey: roles.key,
      roleName: roles.name,
      siteId: userRoleAssignments.siteId,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoleAssignments.roleId))
    .where(and(
      eq(authSessions.tokenHash, hashSessionToken(token)),
      isNull(authSessions.revokedAt),
      gt(authSessions.expiresAt, now),
      eq(users.status, "active"),
      or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, now)),
    ))
    .limit(1);

  if (!session?.siteId) return null;

  const permissionRows = await db
    .select({ code: permissions.code })
    .from(userRoleAssignments)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoleAssignments.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(
      eq(userRoleAssignments.userId, session.userId),
      eq(userRoleAssignments.siteId, session.siteId),
    ));

  await db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, session.sessionId));

  return {
    id: session.userId,
    email: session.email,
    displayName: session.displayName,
    status: session.status,
    roleKey: session.roleKey as AuthenticatedPortalUser["roleKey"],
    roleName: session.roleName as AuthenticatedPortalUser["roleName"],
    siteId: session.siteId,
    permissions: [...new Set(permissionRows.map((row) => row.code))],
  };
}
