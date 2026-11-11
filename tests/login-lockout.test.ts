import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { attemptLocalLogin, consumePasswordResetToken, createPasswordResetToken, LOGIN_LOCKOUT_MINUTES, MAX_FAILED_LOGIN_ATTEMPTS } from "../db/auth";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

const minutes = (value: number) => value * 60_000;

test("locks a local account after repeated failures and unlocks after the lockout window", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const start = new Date("2026-11-05T12:00:00.000Z");

    for (let attempt = 1; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
      const result = await attemptLocalLogin(db, "admin@example.test", "incorrecta", new Date(start.getTime() + attempt * 1_000));
      assert.equal(result.status, "invalid");
      assert.equal(result.status === "invalid" && result.failedAttempts, attempt);
      assert.equal(result.status === "invalid" && result.lockedUntil, null);
    }
    const locking = await attemptLocalLogin(db, "admin@example.test", "incorrecta", new Date(start.getTime() + 10_000));
    assert.equal(locking.status, "invalid");
    assert.ok(locking.status === "invalid" && locking.lockedUntil);

    // Ni siquiera la contraseña correcta entra durante el bloqueo.
    const whileLocked = await attemptLocalLogin(db, "admin@example.test", "Temporal-2026", new Date(start.getTime() + minutes(5)));
    assert.equal(whileLocked.status, "locked");

    const afterLock = await attemptLocalLogin(db, "admin@example.test", "Temporal-2026", new Date(start.getTime() + 10_000 + minutes(LOGIN_LOCKOUT_MINUTES) + 1_000));
    assert.equal(afterLock.status, "authenticated");
    const [identity] = await db.select().from(schema.authIdentities).limit(1);
    assert.equal(identity.failedLoginCount, 0);
    assert.equal(identity.lockedUntil, null);
  } finally {
    await client.close();
  }
});

test("restarts the failure count outside the window and treats unknown accounts generically", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const start = new Date("2026-11-05T12:00:00.000Z");
    for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS - 1; attempt += 1) {
      await attemptLocalLogin(db, "admin@example.test", "incorrecta", new Date(start.getTime() + attempt * 1_000));
    }
    const later = await attemptLocalLogin(db, "admin@example.test", "incorrecta", new Date(start.getTime() + minutes(LOGIN_LOCKOUT_MINUTES + 1)));
    assert.equal(later.status === "invalid" && later.failedAttempts, 1);

    const unknown = await attemptLocalLogin(db, "nadie@example.test", "incorrecta", start);
    assert.deepEqual(unknown, { status: "invalid", userId: null, failedAttempts: 0, lockedUntil: null });
  } finally {
    await client.close();
  }
});

test("a successful password reset clears an active lockout", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const now = new Date();
    for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) await attemptLocalLogin(db, "admin@example.test", "incorrecta", now);
    assert.equal((await attemptLocalLogin(db, "admin@example.test", "Temporal-2026", now)).status, "locked");

    const reset = await createPasswordResetToken(db, "admin@example.test", null, now);
    assert.ok(reset);
    assert.ok(await consumePasswordResetToken(db, reset.token, "Nueva-Clave-2026", now));
    const [identity] = await db.select().from(schema.authIdentities).where(eq(schema.authIdentities.userId, reset.userId));
    assert.equal(identity.lockedUntil, null);
    assert.equal((await attemptLocalLogin(db, "admin@example.test", "Nueva-Clave-2026", now)).status, "authenticated");
  } finally {
    await client.close();
  }
});
