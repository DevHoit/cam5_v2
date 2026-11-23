import type { NextRequest } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { passwordResetTokens } from "../../../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../../../_lib/auth";
import { assertCanInvite, deliverInvitation } from "../../../_lib/invitations";

export const dynamic = "force-dynamic";

/** Reenvía la invitación por correo a un usuario que todavía no crea su contraseña. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user: actor } = await requireApiSession(request, "users.manage");
    const { id } = await context.params;
    await assertCanInvite(db, actor, id);
    const [recent] = await db.select({ id: passwordResetTokens.id }).from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, id), eq(passwordResetTokens.purpose, "invite"), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.createdAt, new Date(Date.now() - 60_000)))).limit(1);
    if (recent) throw new ApiError(429, "Ya se envió una invitación hace menos de un minuto.");
    const invitation = await deliverInvitation(db, actor, id, requestMetadata(request));
    if (!invitation.sent) throw new ApiError(502, `No se pudo enviar la invitación: ${invitation.error}`);
    return Response.json({ invitation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
