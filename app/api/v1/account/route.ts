import type { NextRequest } from "next/server";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { hashPassword, hashSessionToken, verifyPassword } from "../../../../db/auth";
import { auditLogs, authIdentities, authSessions, users } from "../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { db, user, token } = await requireApiSession(request);
    const tokenHash = hashSessionToken(token);
    const [profile, sessionRows] = await Promise.all([
      db.select({
        displayName: users.displayName,
        email: users.email,
        locale: users.locale,
        timezone: users.timezone,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      }).from(users).where(eq(users.id, user.id)).limit(1),
      db.select({
        id: authSessions.id,
        tokenHash: authSessions.tokenHash,
        ipAddress: authSessions.ipAddress,
        userAgent: authSessions.userAgent,
        createdAt: authSessions.createdAt,
        lastSeenAt: authSessions.lastSeenAt,
        expiresAt: authSessions.expiresAt,
      }).from(authSessions)
        .where(and(
          eq(authSessions.userId, user.id),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date()),
        ))
        .orderBy(desc(authSessions.lastSeenAt)),
    ]);
    const record = profile[0];
    if (!record) throw new ApiError(404, "La cuenta ya no existe.");
    return Response.json({
      profile: {
        ...record,
        lastLoginAt: record.lastLoginAt?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(),
        roleName: user.roleName,
        sites: user.sites.map((site) => ({ id: site.id, code: site.code, name: site.name, clientName: site.clientName, roleName: site.roleName })),
      },
      sessions: sessionRows.map((session) => ({
        id: session.id,
        current: session.tokenHash === tokenHash,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { db, user, token } = await requireApiSession(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "No se recibieron cambios.");
    const [current] = await db.select({
      displayName: users.displayName,
      passwordHash: authIdentities.passwordHash,
    }).from(users)
      .innerJoin(authIdentities, and(eq(authIdentities.userId, users.id), eq(authIdentities.provider, "local")))
      .where(eq(users.id, user.id))
      .limit(1);
    if (!current?.passwordHash) throw new ApiError(409, "La cuenta no utiliza autenticación local.");

    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : current.displayName;
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (displayName.length < 3) throw new ApiError(400, "El nombre debe tener al menos 3 caracteres.");
    let passwordHash: string | null = null;
    if (newPassword) {
      if (!currentPassword || !await verifyPassword(currentPassword, current.passwordHash)) throw new ApiError(403, "La contraseña actual no es correcta.");
      if (await verifyPassword(newPassword, current.passwordHash)) throw new ApiError(400, "La nueva contraseña debe ser diferente de la actual.");
      passwordHash = await hashPassword(newPassword).catch((error: unknown) => { throw new ApiError(400, error instanceof Error ? error.message : "Contraseña inválida."); });
    }

    const metadata = requestMetadata(request);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ displayName, updatedAt: new Date() }).where(eq(users.id, user.id));
      if (passwordHash) {
        await tx.update(authIdentities).set({ passwordHash, updatedAt: new Date() }).where(and(eq(authIdentities.userId, user.id), eq(authIdentities.provider, "local")));
        await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(
          eq(authSessions.userId, user.id),
          ne(authSessions.tokenHash, hashSessionToken(token)),
          isNull(authSessions.revokedAt),
        ));
      }
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: passwordHash ? "account.profile_and_password.update" : "account.profile.update",
        resourceType: "user",
        resourceId: user.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        before: { displayName: current.displayName },
        after: { displayName, passwordChanged: Boolean(passwordHash), otherSessionsRevoked: Boolean(passwordHash) },
      });
    });
    return Response.json({ displayName, otherSessionsRevoked: Boolean(passwordHash) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { db, user, token } = await requireApiSession(request);
    const body = await request.json().catch(() => null) as { sessionId?: unknown } | null;
    if (typeof body?.sessionId !== "string" || !body.sessionId) throw new ApiError(400, "Debes seleccionar una sesión.");
    const currentTokenHash = hashSessionToken(token);
    const [target] = await db.select({ id: authSessions.id, tokenHash: authSessions.tokenHash }).from(authSessions)
      .where(and(eq(authSessions.id, body.sessionId), eq(authSessions.userId, user.id), isNull(authSessions.revokedAt)))
      .limit(1);
    if (!target) throw new ApiError(404, "La sesión ya no está activa.");
    if (target.tokenHash === currentTokenHash) throw new ApiError(409, "Cierra la sesión actual usando el botón Cerrar sesión.");
    const metadata = requestMetadata(request);
    await db.transaction(async (tx) => {
      await tx.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.id, target.id));
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "account.session.revoke",
        resourceType: "auth_session",
        resourceId: target.id,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      });
    });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
