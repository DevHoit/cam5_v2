import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { resolveUserAccessScopes } from "../db/access-scope";
import { ensurePlatformAdmin } from "../db/platform-admin";
import type { Cam5Database } from "../db/index";
import * as schema from "../db/schema";

const beforeScopeMigration = [
  "0000_cam5_initial_schema.sql",
  "0001_eager_blockbuster.sql",
  "0002_sparkling_wallow.sql",
  "0003_rich_charles_xavier.sql",
  "0004_windy_gauntlet.sql",
  "0005_milky_caretaker.sql",
  "0006_smiling_frightful_four.sql",
  "0007_big_frightful_four.sql",
  "0008_sloppy_mister_sinister.sql",
  "0009_cuddly_infant_terrible.sql",
  "0010_robust_wallop.sql",
  "0011_dear_prima.sql",
  "0012_hoit_core_foundation.sql",
  "0013_hoit_generic_telemetry.sql",
  "0014_generic_device_transport.sql",
  "0015_operational_condition_states.sql",
  "0016_cold_chain_report_template.sql",
  "0017_generic_metric_aggregates.sql",
  "0018_pm5560_metric_catalog.sql",
  "0019_nullable_device_gateway_site_guard.sql",
  "0020_electrical_report_template.sql",
  "0021_dse8660_metric_catalog.sql",
  "0022_ats_report_template.sql",
];

async function apply(client: PGlite, filename: string) {
  const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
  await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
}

test("access scope migration preserves site admins and only promotes bootstrap admin to platform", async () => {
  const client = new PGlite();
  try {
    for (const filename of beforeScopeMigration) await apply(client, filename);
    const db = drizzle(client, { schema }) as unknown as Cam5Database;

    const [customer] = await db.insert(schema.clients).values({ code: "CLIENT-A", name: "Cliente A" }).returning();
    const [siteA] = await db.insert(schema.sites).values({ clientId: customer.id, code: "A-1", name: "Sitio A1" }).returning();
    const [legacyRole] = await db.insert(schema.roles).values({ key: "administrator", name: "Administrador", isSystem: true }).returning();
    const [bootstrap] = await db.insert(schema.users).values({ email: "bootstrap@example.test", displayName: "Bootstrap", status: "active" }).returning();
    const [createdAdmin] = await db.insert(schema.users).values({ email: "siteadmin@example.test", displayName: "Site Admin", status: "active" }).returning();

    await db.insert(schema.userRoleAssignments).values([
      { userId: bootstrap.id, roleId: legacyRole.id, siteId: siteA.id, grantedBy: null },
      { userId: createdAdmin.id, roleId: legacyRole.id, siteId: siteA.id, grantedBy: bootstrap.id },
    ]);
    await db.insert(schema.userClientAssignments).values([
      { userId: bootstrap.id, clientId: customer.id, roleId: legacyRole.id },
      { userId: createdAdmin.id, clientId: customer.id, roleId: legacyRole.id, grantedBy: bootstrap.id },
    ]);

    await apply(client, "0023_access_scope_roles.sql");

    const [siteAdminRole] = await db.select().from(schema.roles).where(eq(schema.roles.key, "site_admin")).limit(1);
    const [platformRole] = await db.select().from(schema.roles).where(eq(schema.roles.key, "platform_admin")).limit(1);
    assert.ok(siteAdminRole);
    assert.ok(platformRole);

    const bootstrapSite = await db.select().from(schema.userRoleAssignments).where(and(
      eq(schema.userRoleAssignments.userId, bootstrap.id),
      eq(schema.userRoleAssignments.siteId, siteA.id),
      eq(schema.userRoleAssignments.roleId, siteAdminRole.id),
    ));
    assert.equal(bootstrapSite.length, 1);

    const createdSite = await db.select().from(schema.userRoleAssignments).where(and(
      eq(schema.userRoleAssignments.userId, createdAdmin.id),
      eq(schema.userRoleAssignments.siteId, siteA.id),
      eq(schema.userRoleAssignments.roleId, siteAdminRole.id),
    ));
    assert.equal(createdSite.length, 1);

    const bootstrapGlobal = await db.select().from(schema.userRoleAssignments).where(and(
      eq(schema.userRoleAssignments.userId, bootstrap.id),
      eq(schema.userRoleAssignments.roleId, platformRole.id),
      isNull(schema.userRoleAssignments.siteId),
    ));
    assert.equal(bootstrapGlobal.length, 1);

    const createdGlobal = await db.select().from(schema.userRoleAssignments).where(and(
      eq(schema.userRoleAssignments.userId, createdAdmin.id),
      eq(schema.userRoleAssignments.roleId, platformRole.id),
      isNull(schema.userRoleAssignments.siteId),
    ));
    assert.equal(createdGlobal.length, 0);

    const legacyClientScopes = await db.select().from(schema.userClientAssignments);
    assert.equal(legacyClientScopes.length, 0);
  } finally {
    await client.close();
  }
});

test("platform client and site administrators inherit only their intended sites", async () => {
  const client = new PGlite();
  try {
    for (const filename of [...beforeScopeMigration, "0023_access_scope_roles.sql"]) await apply(client, filename);
    const db = drizzle(client, { schema }) as unknown as Cam5Database;

    const [clientA] = await db.insert(schema.clients).values({ code: "A", name: "Cliente A" }).returning();
    const [clientB] = await db.insert(schema.clients).values({ code: "B", name: "Cliente B" }).returning();
    const [a1] = await db.insert(schema.sites).values({ clientId: clientA.id, code: "A1", name: "A1" }).returning();
    const [a2] = await db.insert(schema.sites).values({ clientId: clientA.id, code: "A2", name: "A2" }).returning();
    const [b1] = await db.insert(schema.sites).values({ clientId: clientB.id, code: "B1", name: "B1" }).returning();

    const [platformRole] = await db.select().from(schema.roles).where(eq(schema.roles.key, "platform_admin")).limit(1);
    const [clientRole] = await db.select().from(schema.roles).where(eq(schema.roles.key, "client_admin")).limit(1);
    const [siteRole] = await db.select().from(schema.roles).where(eq(schema.roles.key, "site_admin")).limit(1);
    assert.ok(platformRole && clientRole && siteRole);

    const [platformUser] = await db.insert(schema.users).values({ email: "platform@example.test", displayName: "Platform", status: "active" }).returning();
    const [clientUser] = await db.insert(schema.users).values({ email: "client@example.test", displayName: "Client", status: "active" }).returning();
    const [siteUser] = await db.insert(schema.users).values({ email: "site@example.test", displayName: "Site", status: "active" }).returning();

    await db.insert(schema.userRoleAssignments).values({ userId: platformUser.id, roleId: platformRole.id, siteId: null });
    await db.insert(schema.userClientAssignments).values({ userId: clientUser.id, clientId: clientA.id, roleId: clientRole.id });
    await db.insert(schema.userRoleAssignments).values({ userId: siteUser.id, roleId: siteRole.id, siteId: a1.id });

    const platformScopes = await resolveUserAccessScopes(db, platformUser.id);
    assert.deepEqual(new Set(platformScopes.sites.map((scope) => scope.siteId)), new Set([a1.id, a2.id, b1.id]));
    assert.equal(platformScopes.platformAdmin, true);

    const clientScopes = await resolveUserAccessScopes(db, clientUser.id);
    assert.deepEqual(new Set(clientScopes.sites.map((scope) => scope.siteId)), new Set([a1.id, a2.id]));
    assert.ok(clientScopes.sites.every((scope) => scope.roleKey === "client_admin"));

    const [a3] = await db.insert(schema.sites).values({ clientId: clientA.id, code: "A3", name: "A3" }).returning();
    const inheritedAfterCreation = await resolveUserAccessScopes(db, clientUser.id);
    assert.deepEqual(new Set(inheritedAfterCreation.sites.map((scope) => scope.siteId)), new Set([a1.id, a2.id, a3.id]));
    assert.equal(inheritedAfterCreation.sites.some((scope) => scope.siteId === b1.id), false);

    const siteScopes = await resolveUserAccessScopes(db, siteUser.id);
    assert.deepEqual(siteScopes.sites.map((scope) => scope.siteId), [a1.id]);
    assert.equal(siteScopes.sites[0]?.roleKey, "site_admin");
  } finally {
    await client.close();
  }
});


test("administrative roles expose only the intended management permissions", async () => {
  const client = new PGlite();
  try {
    for (const filename of beforeScopeMigration) await apply(client, filename);
    const db = drizzle(client, { schema }) as unknown as Cam5Database;
    await db.insert(schema.permissions).values({
      code: "users.manage",
      module: "users",
      action: "manage",
      description: "Administrar usuarios",
    }).onConflictDoNothing();
    await apply(client, "0023_access_scope_roles.sql");

    const rows = await db.select({
      roleKey: schema.roles.key,
      permissionCode: schema.permissions.code,
    }).from(schema.rolePermissions)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.rolePermissions.roleId))
      .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId));

    const permissionsFor = (roleKey: string) => new Set(rows.filter((row) => row.roleKey === roleKey).map((row) => row.permissionCode));

    const platform = permissionsFor("platform_admin");
    assert.equal(platform.has("clients.manage"), true);
    assert.equal(platform.has("sites.manage"), true);
    assert.equal(platform.has("users.manage"), true);

    const clientAdmin = permissionsFor("client_admin");
    assert.equal(clientAdmin.has("clients.manage"), false);
    assert.equal(clientAdmin.has("sites.manage"), true);
    assert.equal(clientAdmin.has("users.manage"), true);

    const siteAdmin = permissionsFor("site_admin");
    assert.equal(siteAdmin.has("clients.manage"), false);
    assert.equal(siteAdmin.has("sites.manage"), false);
    assert.equal(siteAdmin.has("users.manage"), true);

  } finally {
    await client.close();
  }
});


test("legacy administrator remains usable before migration 0023", async () => {
  const client = new PGlite();
  try {
    for (const filename of beforeScopeMigration) await apply(client, filename);
    const db = drizzle(client, { schema }) as unknown as Cam5Database;

    const [customer] = await db.insert(schema.clients).values({ code: "LEGACY", name: "Legacy Client" }).returning();
    const [site] = await db.insert(schema.sites).values({ clientId: customer.id, code: "LEGACY-S", name: "Legacy Site" }).returning();
    const [legacyRole] = await db.insert(schema.roles).values({ key: "administrator", name: "Administrador", isSystem: true }).returning();
    const [legacyUser] = await db.insert(schema.users).values({ email: "legacy@example.test", displayName: "Legacy Admin", status: "active" }).returning();
    await db.insert(schema.userRoleAssignments).values({ userId: legacyUser.id, roleId: legacyRole.id, siteId: site.id });

    const scopes = await resolveUserAccessScopes(db, legacyUser.id);
    assert.equal(scopes.sites.length, 1);
    assert.equal(scopes.sites[0]?.siteId, site.id);
    assert.equal(scopes.sites[0]?.roleKey, "site_admin");
  } finally {
    await client.close();
  }
});


test("explicit platform admin recovery grants global scope idempotently", async () => {
  const client = new PGlite();
  try {
    for (const filename of [...beforeScopeMigration, "0023_access_scope_roles.sql"]) await apply(client, filename);
    const db = drizzle(client, { schema }) as unknown as Cam5Database;

    const [customer] = await db.insert(schema.clients).values({ code: "RECOVERY", name: "Recovery" }).returning();
    await db.insert(schema.sites).values({ clientId: customer.id, code: "RECOVERY-S", name: "Recovery Site" });
    const [user] = await db.insert(schema.users).values({
      email: "owner@example.test",
      displayName: "Owner",
      status: "active",
    }).returning();

    const first = await ensurePlatformAdmin(db, "OWNER@example.test");
    assert.equal(first.created, true);
    const second = await ensurePlatformAdmin(db, "owner@example.test");
    assert.equal(second.created, false);

    const scopes = await resolveUserAccessScopes(db, user.id);
    assert.equal(scopes.platformAdmin, true);
    assert.equal(scopes.sites.length, 1);
    assert.equal(scopes.sites[0]?.roleKey, "platform_admin");
  } finally {
    await client.close();
  }
});
