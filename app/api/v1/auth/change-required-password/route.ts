import type { NextRequest } from "next/server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { hashPassword, hashSessionToken, resolvePortalSession, verifyPassword } from "../../../../../db/auth";
import { auditLogs, authIdentities, authSessions } from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { db, user, token } = await requireApiSession(request, undefined, { allowPasswordChangeRequired: true });
    if (!user.mustChangePassword) throw new ApiError(409, "La cuenta no tiene un cambio de contraseña pendiente.");
    const body = await request.json().catch(() => null) as { currentPassword?: unknown; newPassword?: unknown; confirmation?: unknown } | null;
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
    const confirmation = typeof body?.confirmation === "string" ? body.confirmation : "";
    if (!currentPassword || !newPassword || !confirmation) throw new ApiError(400, "Completa todos los campos.");
    if (newPassword !== confirmation) throw new ApiError(400, "Las contraseñas no coinciden.");
    const [identity] = await db.select({ passwordHash: authIdentities.passwordHash }).from(authIdentities)
      .where(and(eq(authIdentities.userId, user.id), eq(authIdentities.provider, "local")))
      .limit(1);
    if (!identity?.passwordHash || !await verifyPassword(currentPassword, identity.passwordHash)) throw new ApiError(403, "La contraseña temporal no es correcta.");
    if (await verifyPassword(newPassword, identity.passwordHash)) throw new ApiError(400, "La nueva contraseña debe ser diferente de la temporal.");
    const passwordHash = await hashPassword(newPassword).catch((error: unknown) => {
      throw new ApiError(400, error instanceof Error ? error.message : "La contraseña no cumple los requisitos.");
    });
    const now = new Date();
    const metadata = requestMetadata(request);
    await db.transaction(async (tx) => {
      await tx.update(authIdentities).set({ passwordHash, mustChangePassword: false, updatedAt: now })
        .where(and(eq(authIdentities.userId, user.id), eq(authIdentities.provider, "local")));
      await tx.update(authSessions).set({ revokedAt: now }).where(and(
        eq(authSessions.userId, user.id),
        ne(authSessions.tokenHash, hashSessionToken(token)),
        isNull(authSessions.revokedAt),
      ));
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "auth.required_password_change.complete",
        resourceType: "user",
        resourceId: user.id,
        outcome: "success",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        metadata: { otherSessionsRevoked: true },
      });
    });
    const refreshedUser = await resolvePortalSession(db, token);
    if (!refreshedUser) throw new ApiError(401, "La sesión ya no es válida.");
    return Response.json({ user: refreshedUser }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
