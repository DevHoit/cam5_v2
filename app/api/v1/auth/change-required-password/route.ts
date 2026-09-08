import type { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword, SESSION_COOKIE_NAME, verifyPassword } from "../../../../../db/auth";
import { auditLogs, authIdentities, authSessions } from "../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireApiSession(request, undefined, { allowPasswordChangeRequired: true });
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
      await tx.update(authSessions).set({ revokedAt: now })
        .where(and(eq(authSessions.userId, user.id), isNull(authSessions.revokedAt)));
      await tx.insert(auditLogs).values({
        siteId: user.siteId,
        actorUserId: user.id,
        action: "auth.required_password_change.complete",
        resourceType: "user",
        resourceId: user.id,
        outcome: "success",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        metadata: { allSessionsRevoked: true, loginRequired: true },
      });
    });
    const response = Response.json(
      { message: "Contraseña actualizada. Inicia sesión nuevamente con tu nueva contraseña." },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.headers.append("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
