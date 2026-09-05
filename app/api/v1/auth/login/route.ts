import type { NextRequest } from "next/server";
import { auditLogs } from "../../../../../db/schema";
import { authenticateLocalUser, createPortalSession, resolvePortalSession, SESSION_COOKIE_NAME } from "../../../../../db/auth";
import { getDb } from "../../../../../db/index";
import { apiErrorResponse, ApiError, requestMetadata } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
    if (typeof body?.email !== "string" || typeof body.password !== "string") throw new ApiError(400, "Correo y contraseña son obligatorios.");
    const db = getDb();
    const userId = await authenticateLocalUser(db, body.email, body.password);
    if (!userId) throw new ApiError(401, "Correo, contraseña o estado de usuario inválido.");

    const metadata = requestMetadata(request);
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
