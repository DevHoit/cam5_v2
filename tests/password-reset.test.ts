import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { passwordResetEmailHtml, sendPasswordResetEmail } from "../db/auth-email";
import {
  authenticateLocalUser,
  consumePasswordResetToken,
  createPasswordResetToken,
  createPortalSession,
  hashSessionToken,
  resolvePortalSession,
} from "../db/auth";
import type { Cam5Database } from "../db/index";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";

const migrations = ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql", "0005_milky_caretaker.sql", "0006_smiling_frightful_four.sql", "0007_big_frightful_four.sql", "0008_sloppy_mister_sinister.sql", "0009_cuddly_infant_terrible.sql", "0010_robust_wallop.sql", "0011_dear_prima.sql"];

test("uses one-time password reset tokens and revokes existing sessions", async () => {
  const client = new PGlite();
  try {
    for (const filename of migrations) {
      const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
      await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    }
    const database = drizzle(client, { schema }) as unknown as Cam5Database;
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
