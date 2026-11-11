import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createPortalSession, hashPassword, resolvePortalSession, switchPortalSessionSite } from "../db/auth";
import type { Cam5Database } from "../db/index";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import {
  requireAssetInScope,
  requireClientPermission,
  requireSitePermission,
  sitePermissionsFor,
  userHasAccessOutsideAdministration,
} from "../app/api/v1/_lib/auth";
import { createMigratedTestDatabase } from "./helpers/database";

async function roleId(db: Cam5Database, key: string) {
  const [role] = await db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.key, key)).limit(1);
  return role.id;
}

async function createUser(db: Cam5Database, email: string) {
  const [user] = await db.insert(schema.users).values({ email, displayName: email.split("@")[0], status: "active" }).returning();
  await db.insert(schema.authIdentities).values({ userId: user.id, provider: "local", providerSubject: email, passwordHash: await hashPassword("Temporal-2026") });
  return user;
}

async function sessionOn(db: Cam5Database, userId: string, siteId: string) {
  const session = await createPortalSession(db, userId);
  const switched = await switchPortalSessionSite(db, session.token, siteId);
  assert.ok(switched, "el usuario debe poder activar el sitio");
  const resolved = await resolvePortalSession(db, session.token);
  assert.ok(resolved);
  assert.equal(resolved.siteId, siteId);
  return resolved;
}

/** Dos clientes, cada uno con un sitio: A (del seed) y B (de otro cliente). */
async function twoTenantFixture() {
  const { client, db } = await createMigratedTestDatabase();
  await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
  const [admin] = await db.select().from(schema.users).where(eq(schema.users.email, "admin@example.test")).limit(1);
  const [adminAssignment] = await db.select().from(schema.userRoleAssignments).where(eq(schema.userRoleAssignments.userId, admin.id)).limit(1);
  const siteA = adminAssignment.siteId!;
  const [siteARow] = await db.select().from(schema.sites).where(eq(schema.sites.id, siteA)).limit(1);
  const [clientB] = await db.insert(schema.clients).values({ code: "OTRO", name: "Otro cliente" }).returning();
  const [siteB] = await db.insert(schema.sites).values({ clientId: clientB.id, code: "SITIO-B", name: "Sitio B" }).returning();
  return { client, db, admin, siteA, clientA: siteARow.clientId, siteB: siteB.id, clientB: clientB.id };
}

test("site permissions come from the target site, not from the active one", async () => {
  const { client, db, siteA, siteB } = await twoTenantFixture();
  try {
    const mixed = await createUser(db, "mixto@example.test");
    await db.insert(schema.userRoleAssignments).values([
      { userId: mixed.id, roleId: await roleId(db, "engineer"), siteId: siteA },
      { userId: mixed.id, roleId: await roleId(db, "viewer"), siteId: siteB },
    ]);
    const user = await sessionOn(db, mixed.id, siteA);

    // En el sitio activo es ingeniero: puede escribir.
    assert.ok(user.permissions.includes("assets.write"));
    await requireSitePermission(db, user, siteA, "assets.write");
    await requireSitePermission(db, user, siteA, "settings.write");

    // En el sitio B solo es lector: antes bastaba con tener cualquier rol allí.
    const siteBPermissions = await sitePermissionsFor(db, user, siteB);
    assert.ok(siteBPermissions.includes("assets.read"));
    assert.ok(!siteBPermissions.includes("assets.write"));
    await assert.rejects(requireSitePermission(db, user, siteB, "assets.write"), /sitio indicado/);
    await assert.rejects(requireSitePermission(db, user, siteB, "settings.write"), /sitio indicado/);
    await assert.rejects(requireSitePermission(db, user, siteB, "users.manage"), /sitio indicado/);

    // Sin ninguna asignación en el sitio no hay permisos.
    const [siteC] = await db.insert(schema.sites).values({ clientId: (await db.select().from(schema.sites).where(eq(schema.sites.id, siteB)))[0].clientId, code: "SITIO-C", name: "Sitio C" }).returning();
    assert.deepEqual(await sitePermissionsFor(db, user, siteC.id), []);
  } finally {
    await client.close();
  }
});

test("client operations require the permission in that client's own role", async () => {
  const { client, db, siteA, clientA, clientB } = await twoTenantFixture();
  try {
    const user = await createUser(db, "cliente@example.test");
    await db.insert(schema.userRoleAssignments).values({ userId: user.id, roleId: await roleId(db, "administrator"), siteId: siteA });
    await db.insert(schema.userClientAssignments).values([
      { userId: user.id, clientId: clientA, roleId: await roleId(db, "administrator") },
      { userId: user.id, clientId: clientB, roleId: await roleId(db, "viewer") },
    ]);
    await requireClientPermission(db, user.id, clientA, "users.manage");
    await assert.rejects(requireClientPermission(db, user.id, clientB, "users.manage"), /cliente indicado/);
  } finally {
    await client.close();
  }
});

test("users limited to specific points cannot touch other points or create new ones", async () => {
  const { client, db, siteA } = await twoTenantFixture();
  try {
    const [allowed] = await db.insert(schema.assets).values({ siteId: siteA, code: "PERMITIDO", name: "Permitido" }).returning();
    const [other] = await db.insert(schema.assets).values({ siteId: siteA, code: "OTRO", name: "Otro" }).returning();
    const scoped = await createUser(db, "alcance@example.test");
    await db.insert(schema.userAssetScopes).values({ userId: scoped.id, assetId: allowed.id });

    await requireAssetInScope(db, scoped.id, allowed.id);
    await assert.rejects(requireAssetInScope(db, scoped.id, other.id), /puntos de medición específicos/);
    await assert.rejects(requireAssetInScope(db, scoped.id, null), /puntos de medición específicos/);

    const unrestricted = await createUser(db, "libre@example.test");
    await requireAssetInScope(db, unrestricted.id, other.id);
    await requireAssetInScope(db, unrestricted.id, null);
  } finally {
    await client.close();
  }
});

test("a site administrator cannot edit the global identity of users with access elsewhere", async () => {
  const { client, db, admin, siteA, clientA, siteB, clientB } = await twoTenantFixture();
  try {
    const actor = await sessionOn(db, admin.id, siteA);

    // Usuario que solo existe dentro del alcance del administrador: puede editarse completo.
    const local = await createUser(db, "local@example.test");
    await db.insert(schema.userRoleAssignments).values({ userId: local.id, roleId: await roleId(db, "operator"), siteId: siteA });
    await db.insert(schema.userClientAssignments).values({ userId: local.id, clientId: clientA, roleId: await roleId(db, "operator") });
    assert.equal(await userHasAccessOutsideAdministration(db, actor, local.id), false);

    // Administrador de otro cliente invitado como lector al sitio A: su correo y contraseña no son del actor.
    const foreign = await createUser(db, "externo@example.test");
    await db.insert(schema.userRoleAssignments).values([
      { userId: foreign.id, roleId: await roleId(db, "viewer"), siteId: siteA },
      { userId: foreign.id, roleId: await roleId(db, "administrator"), siteId: siteB },
    ]);
    await db.insert(schema.userClientAssignments).values([
      { userId: foreign.id, clientId: clientA, roleId: await roleId(db, "viewer") },
      { userId: foreign.id, clientId: clientB, roleId: await roleId(db, "administrator") },
    ]);
    assert.equal(await userHasAccessOutsideAdministration(db, actor, foreign.id), true);

    // Un rol global (sin sitio) también queda fuera del alcance del administrador de sitio.
    const global = await createUser(db, "global@example.test");
    await db.insert(schema.userRoleAssignments).values([
      { userId: global.id, roleId: await roleId(db, "viewer"), siteId: siteA },
      { userId: global.id, roleId: await roleId(db, "viewer"), siteId: null },
    ]);
    assert.equal(await userHasAccessOutsideAdministration(db, actor, global.id), true);
  } finally {
    await client.close();
  }
});
