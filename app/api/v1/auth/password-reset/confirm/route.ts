import type { NextRequest } from "next/server";
import { consumePasswordResetToken } from "../../../../../../db/auth";
import { getDb } from "../../../../../../db/index";
import { auditLogs } from "../../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as { token?: unknown; newPassword?: unknown; confirmation?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
    const confirmation = typeof body?.confirmation === "string" ? body.confirmation : "";
    if (!token || !newPassword || !confirmation) throw new ApiError(400, "Completa todos los campos.");
    if (newPassword !== confirmation) throw new ApiError(400, "Las contraseñas no coinciden.");
    const db = getDb();
    const result = await consumePasswordResetToken(db, token, newPassword).catch((error: unknown) => {
      throw new ApiError(400, error instanceof Error ? error.message : "La contraseña no cumple los requisitos.");
    });
    if (!result) throw new ApiError(400, "El enlace no es válido, ya fue utilizado o expiró.");
    const metadata = requestMetadata(request);
    await db.insert(auditLogs).values({
      actorUserId: result.userId,
      action: "auth.password_reset.complete",
      resourceType: "user",
      resourceId: result.userId,
      outcome: "success",
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
      metadata: { sessionsRevoked: true },
    });
    return Response.json({ message: "Contraseña actualizada. Ya puedes iniciar sesión." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
