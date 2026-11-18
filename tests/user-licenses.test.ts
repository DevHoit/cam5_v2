import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { assertLicensesAvailable, LicenseLimitError, loadClientLicenses } from "../db/licenses";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

test("client and partner licenses cap the users that can be added, ignoring suspended users and HOIT staff", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "staff@hoit.test", adminName: "HOIT", adminPassword: "Cam5-Prueba-2026", log: false });
    const [customer] = await db.select().from(schema.clients).limit(1);
    const [viewer] = await db.select().from(schema.roles).where(eq(schema.roles.key, "viewer")).limit(1);
    const addUser = async (email: string, status: "active" | "invited" | "suspended", licenseKind: "client" | "partner" = "client") => {
      const [user] = await db.insert(schema.users).values({ email, displayName: email, status }).returning();
      await db.insert(schema.userClientAssignments).values({ userId: user.id, clientId: customer.id, roleId: viewer.id, licenseKind });
      return user;
    };

    // Sin límite configurado: se puede agregar sin restricción.
    await db.transaction((tx) => assertLicensesAvailable(tx, [{ clientId: customer.id, kind: "client" }]));

    await db.update(schema.clients).set({ userLicenseLimit: 2, partnerName: "Integrador SpA", partnerLicenseLimit: 1 }).where(eq(schema.clients.id, customer.id));
    const first = await addUser("uno@cliente.test", "active");
    await addUser("dos@cliente.test", "invited");
    const suspended = await addUser("tres@cliente.test", "suspended");

    const [usage] = await loadClientLicenses(db, [customer.id]);
    assert.deepEqual({ used: usage.userUsed, limit: usage.userLimit, partnerUsed: usage.partnerUsed }, { used: 2, limit: 2, partnerUsed: 0 }, "HOIT staff and suspended users do not take a license");

    await assert.rejects(
      db.transaction((tx) => assertLicensesAvailable(tx, [{ clientId: customer.id, kind: "client" }])),
      (error: unknown) => error instanceof LicenseLimitError && /2 licencias de usuario/.test(error.message),
      "a third client user is rejected",
    );
    await assert.rejects(
      db.transaction((tx) => assertLicensesAvailable(tx, [{ clientId: customer.id, kind: "client" }], suspended.id)),
      LicenseLimitError,
      "reactivating a suspended user also needs a free license",
    );
    await db.transaction((tx) => assertLicensesAvailable(tx, [{ clientId: customer.id, kind: "client" }], first.id));

    // La licencia del integrador es un cupo aparte.
    await db.transaction((tx) => assertLicensesAvailable(tx, [{ clientId: customer.id, kind: "partner" }]));
    await addUser("admin@integrador.test", "active", "partner");
    await assert.rejects(
      db.transaction((tx) => assertLicensesAvailable(tx, [{ clientId: customer.id, kind: "partner" }])),
      (error: unknown) => error instanceof LicenseLimitError && /Integrador SpA ya usa su única licencia de integrador/.test(error.message),
    );

    // Suspender a un usuario libera su licencia.
    await db.update(schema.users).set({ status: "suspended" }).where(eq(schema.users.id, first.id));
    await db.transaction((tx) => assertLicensesAvailable(tx, [{ clientId: customer.id, kind: "client" }]));

    // Sin integrador configurado no se puede asignar una licencia de integrador.
    await db.update(schema.clients).set({ partnerName: null, partnerLicenseLimit: null }).where(eq(schema.clients.id, customer.id));
    await assert.rejects(db.transaction((tx) => assertLicensesAvailable(tx, [{ clientId: customer.id, kind: "partner" }])), /no tiene un integrador/);

    await assert.rejects(
      db.update(schema.clients).set({ userLicenseLimit: -1 }).where(eq(schema.clients.id, customer.id)),
      (error: unknown) => /clients_user_license_limit_chk/.test(String((error as { cause?: unknown }).cause ?? error)),
    );
  } finally {
    await client.close();
  }
});
