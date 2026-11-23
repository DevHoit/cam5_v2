import { and, asc, eq, inArray } from "drizzle-orm";
import { appBaseUrl } from "../../../../db/app-url";
import { createInvitationToken, hashSessionToken } from "../../../../db/auth";
import { sendInvitationEmail } from "../../../../db/auth-email";
import type { Cam5Database } from "../../../../db/index";
import { auditLogs, clients, passwordResetTokens, userClientAssignments, userRoleAssignments, users } from "../../../../db/schema";
import { ApiError, type requireApiSession } from "./auth";

type Actor = Awaited<ReturnType<typeof requireApiSession>>["user"];

/**
 * Envía (o reenvía) la invitación de un usuario invitado. Si el correo falla, el enlace se anula y se informa:
 * el usuario queda creado y se puede reenviar después.
 */
export async function deliverInvitation(db: Cam5Database, actor: Actor, userId: string, metadata: { ipAddress: string | null; userAgent: string | null }) {
  const invitation = await createInvitationToken(db, userId, metadata.ipAddress);
  if (!invitation) throw new ApiError(409, "Solo se puede invitar a un usuario en estado invitado.");
  const [client] = await db.select({ name: clients.name }).from(userClientAssignments)
    .innerJoin(clients, eq(clients.id, userClientAssignments.clientId))
    .where(eq(userClientAssignments.userId, userId)).orderBy(asc(clients.name)).limit(1);
  const inviteUrl = `${appBaseUrl()}/?action=accept-invite#token=${encodeURIComponent(invitation.token)}`;
  try {
    const delivery = await sendInvitationEmail({ to: invitation.email, displayName: invitation.displayName, inviteUrl, invitedBy: actor.displayName, clientName: client?.name ?? null });
    await db.insert(auditLogs).values({ siteId: actor.siteId, actorUserId: actor.id, action: "users.invitation.send", resourceType: "user", resourceId: userId, outcome: "success", ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, metadata: { providerMessageId: delivery.providerMessageId, expiresAt: invitation.expiresAt.toISOString() } });
    return { sent: true as const, email: invitation.email, expiresAt: invitation.expiresAt.toISOString() };
  } catch (error) {
    await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.tokenHash, hashSessionToken(invitation.token)));
    const message = error instanceof Error ? error.message.slice(0, 300) : "Error de envío";
    await db.insert(auditLogs).values({ siteId: actor.siteId, actorUserId: actor.id, action: "users.invitation.send", resourceType: "user", resourceId: userId, outcome: "failed", ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, metadata: { error: message } });
    console.error("No fue posible enviar la invitación", error);
    return { sent: false as const, email: invitation.email, error: message };
  }
}

/** El actor puede reenviar la invitación: HOIT, o quien administra algún sitio del usuario (nunca a HOIT ni a sus cuentas de prueba). */
export async function assertCanInvite(db: Cam5Database, actor: Actor, userId: string) {
  const [target] = await db.select({ status: users.status, platformStaff: users.platformStaff, testAccount: users.testAccount }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target || ((target.platformStaff || target.testAccount) && !actor.platformStaff)) throw new ApiError(404, "El usuario no existe.");
  if (!actor.platformStaff) {
    const administered = actor.sites.filter((site) => site.roleKey === "administrator").map((site) => site.id);
    const [scope] = administered.length ? await db.select({ id: userRoleAssignments.id }).from(userRoleAssignments)
      .where(and(eq(userRoleAssignments.userId, userId), inArray(userRoleAssignments.siteId, administered))).limit(1) : [];
    if (!scope) throw new ApiError(404, "El usuario no existe.");
  }
  if (target.status !== "invited") throw new ApiError(409, "El usuario ya activó su cuenta; si olvidó la contraseña puede recuperarla desde el inicio de sesión.");
}
