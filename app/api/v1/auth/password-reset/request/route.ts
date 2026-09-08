import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { sendPasswordResetEmail } from "../../../../../../db/auth-email";
import { createPasswordResetToken, hashSessionToken, normalizeEmail } from "../../../../../../db/auth";
import { getDb } from "../../../../../../db/index";
import { auditLogs, passwordResetTokens } from "../../../../../../db/schema";
import { requestMetadata } from "../../../_lib/auth";

export const dynamic = "force-dynamic";

const GENERIC_RESPONSE = "Si existe una cuenta activa con ese correo, recibirás un enlace para crear una nueva contraseña.";

export async function POST(request: NextRequest) {
  const metadata = requestMetadata(request);
  try {
    const body = await request.json().catch(() => null) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    if (email.includes("@")) {
      const db = getDb();
      const reset = await createPasswordResetToken(db, email, metadata.ipAddress);
      if (reset) {
        const appUrl = (process.env.APP_URL || "https://cam5v2.vercel.app").replace(/\/+$/, "");
        const resetUrl = `${appUrl}/?action=reset-password#token=${encodeURIComponent(reset.token)}`;
        try {
          const delivery = await sendPasswordResetEmail({ to: reset.email, displayName: reset.displayName, resetUrl });
          await db.insert(auditLogs).values({
            actorUserId: null,
            action: "auth.password_reset.request",
            resourceType: "user",
            resourceId: reset.userId,
            outcome: "success",
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            metadata: { providerMessageId: delivery.providerMessageId, expiresAt: reset.expiresAt.toISOString() },
          });
        } catch (error) {
          await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.tokenHash, hashSessionToken(reset.token)));
          await db.insert(auditLogs).values({
            actorUserId: null,
            action: "auth.password_reset.request",
            resourceType: "user",
            resourceId: reset.userId,
            outcome: "failed",
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            metadata: { error: error instanceof Error ? error.message.slice(0, 500) : "Error de envío" },
          });
          console.error("No fue posible enviar el correo de recuperación", error);
        }
      }
    }
  } catch (error) {
    console.error("No fue posible procesar la recuperación de contraseña", error);
  }
  return Response.json({ message: GENERIC_RESPONSE }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
