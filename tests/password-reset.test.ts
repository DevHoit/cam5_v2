import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { invitationEmailHtml, passwordResetEmailHtml, sendInvitationEmail, sendPasswordResetEmail } from "../db/auth-email";
import {
  acceptInvitationToken,
  authenticateLocalUser,
  consumePasswordResetToken,
  createInvitationToken,
  hashPassword,
  createPasswordResetToken,
  createPortalSession,
  hashSessionToken,
  resolvePortalSession,
} from "../db/auth";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";


test("uses one-time password reset tokens and revokes existing sessions", async () => {
  const { client, db: database } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(database, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const [user] = await database.select().from(schema.users).where(eq(schema.users.email, "admin@example.test")).limit(1);
    await database.update(schema.authIdentities).set({ mustChangePassword: true }).where(eq(schema.authIdentities.userId, user.id));
    const session = await createPortalSession(database, user.id);
    assert.equal((await resolvePortalSession(database, session.token))?.mustChangePassword, true);

    const now = new Date();
    const reset = await createPasswordResetToken(database, "ADMIN@example.test", "127.0.0.1", now);
    assert.ok(reset);
    const [stored] = await database.select().from(schema.passwordResetTokens).where(eq(schema.passwordResetTokens.userId, user.id));
    assert.equal(stored.tokenHash, hashSessionToken(reset.token));
    assert.notEqual(stored.tokenHash, reset.token);
    assert.equal(await createPasswordResetToken(database, "admin@example.test", "127.0.0.1", new Date(now.getTime() + 30_000)), null);

    await assert.rejects(() => consumePasswordResetToken(database, reset.token, "Temporal-2026", new Date(now.getTime() + 60_000)), /diferente/);
    const consumed = await consumePasswordResetToken(database, reset.token, "Nueva-Clave-2026", new Date(now.getTime() + 60_000));
    assert.equal(consumed?.userId, user.id);
    assert.equal(await consumePasswordResetToken(database, reset.token, "Otra-Clave-2026", new Date(now.getTime() + 61_000)), null);
    assert.equal(await resolvePortalSession(database, session.token), null);
    assert.equal(await authenticateLocalUser(database, "admin@example.test", "Temporal-2026"), null);
    assert.equal(await authenticateLocalUser(database, "admin@example.test", "Nueva-Clave-2026"), user.id);
    const [identity] = await database.select().from(schema.authIdentities).where(eq(schema.authIdentities.userId, user.id));
    assert.equal(identity.mustChangePassword, false);
  } finally {
    await client.close();
  }
});

test("builds and sends a branded password recovery email", async () => {
  const input = { to: "usuario@example.test", displayName: "María <Admin>", resetUrl: "https://cam5v2.vercel.app/?action=reset-password#token=secret" };
  const html = passwordResetEmailHtml(input);
  assert.match(html, /HoitLive/);
  assert.match(html, /Crear una nueva contraseña/);
  assert.match(html, /María &lt;Admin&gt;/);
  let body: Record<string, unknown> = {};
  const result = await sendPasswordResetEmail(input, {
    environment: { NODE_ENV: "test", RESEND_API_KEY: "re_test", NOTIFICATION_FROM_EMAIL: "HoitLive Core <seguridad@example.test>" },
    fetchImpl: async (_request, init) => {
      body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return Response.json({ id: "reset-email-1" });
    },
  });
  assert.equal(result.providerMessageId, "reset-email-1");
  assert.equal((body.to as string[])[0], input.to);
  assert.match(String(body.text), /30 minutos/);
  assert.match(String(body.html), /Seguridad de la cuenta/);
});


test("invitations let an invited user create a password once and activate the account", async () => {
  const { client, db: database } = await createMigratedTestDatabase();
  try {
    const [user] = await database.insert(schema.users).values({ email: "invitado@example.test", displayName: "Invitado", status: "invited" }).returning();
    await database.insert(schema.authIdentities).values({ userId: user.id, provider: "local", providerSubject: "invitado@example.test", passwordHash: await hashPassword("Desconocida-Aleatoria-2026"), mustChangePassword: false });
    assert.equal(await authenticateLocalUser(database, "invitado@example.test", "Cualquier-2026"), null);

    const now = new Date();
    const invitation = await createInvitationToken(database, user.id, "127.0.0.1", now);
    assert.ok(invitation);
    assert.ok(invitation.expiresAt.getTime() - now.getTime() >= 6 * 86_400_000);
    // Un enlace de invitación no sirve para recuperar contraseña.
    assert.equal(await consumePasswordResetToken(database, invitation.token, "Nueva-Clave-2026", now), null);

    const accepted = await acceptInvitationToken(database, invitation.token, "Mi-Clave-Propia-2026", new Date(now.getTime() + 60_000));
    assert.equal(accepted?.userId, user.id);
    const [activated] = await database.select().from(schema.users).where(eq(schema.users.id, user.id));
    assert.equal(activated.status, "active");
    assert.ok(await authenticateLocalUser(database, "invitado@example.test", "Mi-Clave-Propia-2026"));
    assert.equal(await acceptInvitationToken(database, invitation.token, "Otra-Clave-2026", new Date(now.getTime() + 120_000)), null);
    // Una cuenta ya activa no recibe invitaciones.
    assert.equal(await createInvitationToken(database, user.id, null, new Date(now.getTime() + 180_000)), null);
  } finally {
    await client.close();
  }
});

test("invitation email escapes names and is sent through the provider", async () => {
  const input = { to: "ana@example.test", displayName: "Ana <Op>", inviteUrl: "https://core.example.test/?action=accept-invite#token=abc", invitedBy: "Soporte HOIT", clientName: "FALP" };
  const html = invitationEmailHtml(input);
  assert.match(html, /Crear mi contraseña/);
  assert.match(html, /Ana &lt;Op&gt;/);
  assert.match(html, /de FALP/);
  let body: Record<string, unknown> = {};
  const result = await sendInvitationEmail(input, {
    environment: { RESEND_API_KEY: "re_test", AUTH_FROM_EMAIL: "HoitLive <no-reply@example.test>" } as unknown as NodeJS.ProcessEnv,
    fetchImpl: (async (_url: unknown, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }); }) as typeof fetch,
  });
  assert.equal(result.providerMessageId, "msg_1");
  assert.equal(body.subject, "Tu acceso a HoitLive Core");
  assert.match(String(body.text), /7 días/);
});
