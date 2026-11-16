import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { attemptLocalLogin, createPortalSession, hashPassword, isBlockedBySuspendedClient, resolvePortalSession } from "../db/auth";
import { createGatewayToken, hashGatewayToken } from "../db/gateway-auth";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

test("a suspended client keeps its users out of the portal while platform staff and gateways keep working", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "staff@hoit.test", adminName: "HOIT", adminPassword: "Cam5-Prueba-2026", log: false });
    const [customer] = await db.select().from(schema.clients).limit(1);
    const [site] = await db.select().from(schema.sites).limit(1);
    const [viewer] = await db.select().from(schema.roles).where(eq(schema.roles.key, "viewer")).limit(1);
    const [staff] = await db.select().from(schema.users).where(eq(schema.users.email, "staff@hoit.test")).limit(1);
    assert.equal(staff.platformStaff, true, "the seeded administrator is platform staff");

    const [operator] = await db.insert(schema.users).values({ email: "operador@cliente.test", displayName: "Operador", status: "active" }).returning();
    await db.insert(schema.authIdentities).values({ userId: operator.id, provider: "local", providerSubject: "operador@cliente.test", passwordHash: await hashPassword("Cliente-2026-xyz") });
    await db.insert(schema.userRoleAssignments).values({ userId: operator.id, roleId: viewer.id, siteId: site.id });
    const operatorSession = await createPortalSession(db, operator.id);
    const staffSession = await createPortalSession(db, staff.id);
    assert.ok(await resolvePortalSession(db, operatorSession.token));

    const [gateway] = await db.select().from(schema.gateways).limit(1);
    const gatewayToken = createGatewayToken();
    await db.insert(schema.gatewayApiCredentials).values({ gatewayId: gateway.id, name: "Gateway", tokenPrefix: gatewayToken.slice(0, 12), tokenHash: hashGatewayToken(gatewayToken) });

    await db.update(schema.clients).set({ suspendedAt: new Date(), suspendedReason: "Factura impaga", suspendedBy: staff.id }).where(eq(schema.clients.id, customer.id));

    assert.equal(await resolvePortalSession(db, operatorSession.token), null, "an open session of the client's user loses access");
    assert.equal(await isBlockedBySuspendedClient(db, operator.id), true);
    assert.equal((await attemptLocalLogin(db, "operador@cliente.test", "Cliente-2026-xyz")).status, "authenticated", "the password is still valid; the login route rejects with the suspension message");
    const lateSession = await createPortalSession(db, operator.id);
    assert.equal(await resolvePortalSession(db, lateSession.token), null, "a new session cannot reach the suspended client either");

    const staffView = await resolvePortalSession(db, staffSession.token);
    assert.ok(staffView, "platform staff keeps access");
    assert.equal(staffView.clientSuspended, true);
    assert.equal(staffView.platformStaff, true);
    assert.equal(await isBlockedBySuspendedClient(db, staff.id), false);

    // El gateway se autentica solo con su credencial y el estado activo del cliente: la suspensión no lo detiene.
    const [credential] = await db.select().from(schema.gatewayApiCredentials).where(eq(schema.gatewayApiCredentials.tokenHash, hashGatewayToken(gatewayToken)));
    assert.ok(credential && !credential.revokedAt);
    const [clientRow] = await db.select().from(schema.clients).where(eq(schema.clients.id, customer.id));
    assert.equal(clientRow.active, true, "suspension does not deactivate the client");

    await db.update(schema.clients).set({ suspendedAt: null, suspendedReason: null, suspendedBy: null }).where(eq(schema.clients.id, customer.id));
    assert.ok(await resolvePortalSession(db, operatorSession.token), "reactivation restores the same session");
    assert.equal(await isBlockedBySuspendedClient(db, operator.id), false);
  } finally {
    await client.close();
  }
});
