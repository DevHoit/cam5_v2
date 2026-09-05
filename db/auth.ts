import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Cam5Database } from "./index";
import {
  authIdentities,
  authSessions,
  clients,
  permissions,
  rolePermissions,
  roles,
  sites,
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
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
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
    ));

  await db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, session.sessionId));

  return {
    id: session.userId,
    email: session.email,
    displayName: session.displayName,
    status: session.status,
    roleKey: selected.roleKey as AuthenticatedPortalUser["roleKey"],
    roleName: selected.roleName as AuthenticatedPortalUser["roleName"],
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
