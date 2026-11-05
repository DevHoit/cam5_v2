import type { NextRequest } from "next/server";
import { auditLogs } from "../../../../../db/schema";
import { attemptLocalLogin, createPortalSession, LOGIN_LOCKOUT_MINUTES, normalizeEmail, resolvePortalSession, SESSION_COOKIE_NAME } from "../../../../../db/auth";
import { getDb } from "../../../../../db/index";
import { apiErrorResponse, ApiError, requestMetadata } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
    if (typeof body?.email !== "string" || typeof body.password !== "string") throw new ApiError(400, "Correo y contraseña son obligatorios.");
    const db = getDb();
    const metadata = requestMetadata(request);
    const attempt = await attemptLocalLogin(db, body.email, body.password);
    if (attempt.status !== "authenticated") {
      const locked = attempt.status === "locked" || attempt.lockedUntil !== null;
      await db.insert(auditLogs).values({
        actorUserId: attempt.userId,
        action: "auth.login",
        resourceType: "session",
        outcome: locked ? "denied" : "failed",
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        metadata: {
          email: normalizeEmail(body.email).slice(0, 320),
          reason: attempt.status === "locked" ? "account_locked" : attempt.userId ? "invalid_credentials" : "unknown_account",
          ...(attempt.status === "invalid" && attempt.userId ? { failedAttempts: attempt.failedAttempts } : {}),
          ...(attempt.status === "locked" ? { lockedUntil: attempt.lockedUntil.toISOString() } : attempt.lockedUntil ? { lockedUntil: attempt.lockedUntil.toISOString() } : {}),
        },
      }).catch((error: unknown) => console.error("No fue posible auditar el intento de ingreso", error));
      if (locked) {
        const lockedUntil = attempt.status === "locked" ? attempt.lockedUntil : attempt.lockedUntil!;
        const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
        return Response.json(
          { error: `La cuenta quedó bloqueada temporalmente por intentos fallidos. Intenta nuevamente en ${Math.ceil(retryAfterSeconds / 60)} min o recupera tu contraseña.`, lockedUntil: lockedUntil.toISOString(), lockoutMinutes: LOGIN_LOCKOUT_MINUTES },
          { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds) } },
        );
      }
      throw new ApiError(401, "Correo, contraseña o estado de usuario inválido.");
    }
    const userId = attempt.userId;

    const session = await createPortalSession(db, userId, metadata);
    const user = await resolvePortalSession(db, session.token);
    if (!user) throw new ApiError(403, "El usuario no tiene un perfil asignado para esta ubicación.");

    await db.insert(auditLogs).values({
      siteId: user.siteId,
      actorUserId: user.id,
      action: "auth.login",
      resourceType: "session",
      outcome: "success",
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });

    const response = Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
    response.headers.append("Set-Cookie", `${SESSION_COOKIE_NAME}=${session.token}; Path=/; HttpOnly; SameSite=Strict; Expires=${session.expiresAt.toUTCString()}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
