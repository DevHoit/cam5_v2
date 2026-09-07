import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { PORTAL_PERMISSIONS, PORTAL_ROLES } from "../db/access-control";
import { authenticateLocalUser, createPortalSession, resolvePortalSession, revokePortalSession, switchPortalSessionSite, verifyPassword } from "../db/auth";
import { resolvePortalAccess } from "../db/authorization";
import type { Cam5Database } from "../db/index";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";

test("seeds the initial CAM5 installation and remains idempotent", async () => {
  const client = new PGlite();
  try {
    for (const filename of ["0000_cam5_initial_schema.sql", "0001_eager_blockbuster.sql", "0002_sparkling_wallow.sql", "0003_rich_charles_xavier.sql", "0004_windy_gauntlet.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8");
      await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    }
    const db = drizzle(client, { schema });
    const seedDb = db as unknown as Cam5Database;

    const seedOptions = { adminEmail: "admin@example.test", adminName: "Administrador de prueba", adminPassword: "Cam5-Prueba-2026", log: false };
    await seedCam5Database(seedDb, seedOptions);

    const [seededClient] = await db.select().from(schema.clients).limit(1);
    const [seededSite] = await db.select().from(schema.sites).limit(1);
    const [seededProfile] = await db.select().from(schema.readingProfiles).limit(1);
    const [seededInput] = await db.select().from(schema.physicalInputs).where(eq(schema.physicalInputs.code, "T01")).limit(1);
    const [seededChannel] = await db.select().from(schema.channels).where(eq(schema.channels.code, "T01")).limit(1);
    const [seededRule] = await db.select().from(schema.alarmRules).where(eq(schema.alarmRules.channelId, seededChannel.id)).limit(1);
    const [seededRelay] = await db.select().from(schema.relayConfigurations).where(eq(schema.relayConfigurations.relayNumber, 1)).limit(1);
    await db.update(schema.clients).set({ name: "Cliente administrado" }).where(eq(schema.clients.id, seededClient.id));
    await db.update(schema.sites).set({ name: "Sitio administrado" }).where(eq(schema.sites.id, seededSite.id));
    await db.update(schema.readingProfiles).set({ staleAfterSeconds: 90 }).where(eq(schema.readingProfiles.id, seededProfile.id));
    await db.update(schema.physicalInputs).set({ enabled: false, assignment: "Asignación de terreno" }).where(eq(schema.physicalInputs.id, seededInput.id));
    await db.update(schema.channels).set({ enabled: false, name: "Canal administrado" }).where(eq(schema.channels.id, seededChannel.id));
    await db.update(schema.alarmRules).set({ warningThreshold: "61" }).where(eq(schema.alarmRules.id, seededRule.id));
    await db.update(schema.relayConfigurations).set({ name: "Relé administrado" }).where(eq(schema.relayConfigurations.id, seededRelay.id));

    await seedCam5Database(seedDb, { ...seedOptions, adminPassword: "Otra-Clave-Que-No-Debe-Aplicarse" });

    const [clientCount] = await db.select({ value: count() }).from(schema.clients);
    const [siteCount] = await db.select({ value: count() }).from(schema.sites);
    const [assetCount] = await db.select({ value: count() }).from(schema.assets);
    const [deviceCount] = await db.select({ value: count() }).from(schema.devices);
    const [inputCount] = await db.select({ value: count() }).from(schema.physicalInputs);
    const [channelCount] = await db.select({ value: count() }).from(schema.channels);
    const [registerCount] = await db.select({ value: count() }).from(schema.registerDefinitions);
    const [roleCount] = await db.select({ value: count() }).from(schema.roles);
    const [permissionCount] = await db.select({ value: count() }).from(schema.permissions);
    const [relayCount] = await db.select({ value: count() }).from(schema.relayConfigurations);
    const [checkCount] = await db.select({ value: count() }).from(schema.commissioningItems);
    const [profileRangeCount] = await db.select({ value: count() }).from(schema.readingProfileRanges);
    const [adminCount] = await db.select({ value: count() }).from(schema.users).where(eq(schema.users.email, "admin@example.test"));
    const [identityCount] = await db.select({ value: count() }).from(schema.authIdentities);
    const [clientAssignmentCount] = await db.select({ value: count() }).from(schema.userClientAssignments);

    assert.equal(clientCount.value, 1);
    assert.equal(siteCount.value, 1);
    assert.equal(assetCount.value, 1);
    assert.equal(deviceCount.value, 1);
    assert.equal(inputCount.value, 24);
    assert.equal(channelCount.value, 36);
    assert.equal(registerCount.value, 105);
    assert.equal(roleCount.value, PORTAL_ROLES.length);
    assert.equal(permissionCount.value, PORTAL_PERMISSIONS.length);
    assert.equal(relayCount.value, 6);
    assert.equal(checkCount.value, 8);
    assert.equal(profileRangeCount.value, 4);
    assert.equal(adminCount.value, 1);
    assert.equal(identityCount.value, 1);
    assert.equal(clientAssignmentCount.value, 1);

    const [preservedClient] = await db.select().from(schema.clients).where(eq(schema.clients.id, seededClient.id)).limit(1);
    const [preservedSite] = await db.select().from(schema.sites).where(eq(schema.sites.id, seededSite.id)).limit(1);
    const [preservedProfile] = await db.select().from(schema.readingProfiles).where(eq(schema.readingProfiles.id, seededProfile.id)).limit(1);
    const [preservedInput] = await db.select().from(schema.physicalInputs).where(eq(schema.physicalInputs.id, seededInput.id)).limit(1);
    const [preservedChannel] = await db.select().from(schema.channels).where(eq(schema.channels.id, seededChannel.id)).limit(1);
    const [preservedRule] = await db.select().from(schema.alarmRules).where(eq(schema.alarmRules.id, seededRule.id)).limit(1);
    const [preservedRelay] = await db.select().from(schema.relayConfigurations).where(eq(schema.relayConfigurations.id, seededRelay.id)).limit(1);
    assert.equal(preservedClient.name, "Cliente administrado");
    assert.equal(preservedSite.name, "Sitio administrado");
    assert.equal(preservedProfile.staleAfterSeconds, 90);
    assert.equal(preservedInput.enabled, false);
    assert.equal(preservedInput.assignment, "Asignación de terreno");
    assert.equal(preservedChannel.enabled, false);
    assert.equal(preservedChannel.name, "Canal administrado");
    assert.equal(preservedRule.warningThreshold, "61.000000");
    assert.equal(preservedRelay.name, "Relé administrado");

    const [storedIdentity] = await db.select().from(schema.authIdentities).limit(1);
    assert.ok(storedIdentity.passwordHash);
    assert.equal(await verifyPassword("Cam5-Prueba-2026", storedIdentity.passwordHash), true);
    assert.equal(await verifyPassword("clave-incorrecta", storedIdentity.passwordHash), false);
    const authenticatedUserId = await authenticateLocalUser(seedDb, "ADMIN@example.test", "Cam5-Prueba-2026");
    assert.ok(authenticatedUserId);
    const session = await createPortalSession(seedDb, authenticatedUserId);
    const resolvedSession = await resolvePortalSession(seedDb, session.token);
    assert.equal(resolvedSession?.email, "admin@example.test");
    assert.equal(resolvedSession?.roleKey, "administrator");
    assert.equal(resolvedSession?.clientName, "Cliente administrado");
    assert.equal(resolvedSession?.siteName, "Sitio administrado");
    assert.equal(resolvedSession?.sites.length, 1);
    assert.ok(resolvedSession?.permissions.includes("users.manage"));

    const [secondClient] = await db.insert(schema.clients).values({ code: "CLIENTE-02", name: "Segundo cliente" }).returning();
    const [secondSite] = await db.insert(schema.sites).values({ clientId: secondClient.id, code: "SITE-02", name: "Segundo sitio" }).returning();
    const [administratorRole] = await db.select().from(schema.roles).where(eq(schema.roles.key, "administrator")).limit(1);
    await db.insert(schema.userRoleAssignments).values({ userId: authenticatedUserId, roleId: administratorRole.id, siteId: secondSite.id });
    const switchedSession = await switchPortalSessionSite(seedDb, session.token, secondSite.id);
    assert.equal(switchedSession?.clientName, "Segundo cliente");
    assert.equal(switchedSession?.siteName, "Segundo sitio");
    assert.equal(switchedSession?.sites.length, 2);
    await db.update(schema.sites).set({ active: false }).where(eq(schema.sites.id, secondSite.id));
    const fallbackSession = await resolvePortalSession(seedDb, session.token);
    assert.equal(fallbackSession?.siteName, "Sitio administrado");
    assert.equal(fallbackSession?.sites.length, 1);
    await revokePortalSession(seedDb, session.token);
    assert.equal(await resolvePortalSession(seedDb, session.token), null);

    const [viewer] = await db.select().from(schema.roles).where(eq(schema.roles.key, "viewer")).limit(1);
    assert.ok(viewer);
    const viewerPermissionRows = await db
      .select({ action: schema.permissions.action })
      .from(schema.rolePermissions)
      .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
      .where(eq(schema.rolePermissions.roleId, viewer.id));
    assert.ok(viewerPermissionRows.length > 0);
    assert.ok(viewerPermissionRows.every((permission) => permission.action === "read"));

    const [site] = await db.select().from(schema.sites).limit(1);
    const [viewerUser] = await db.insert(schema.users).values({
      email: "viewer@example.test",
      displayName: "Usuario de lectura",
      status: "active",
    }).returning();
    await db.insert(schema.userRoleAssignments).values({ userId: viewerUser.id, roleId: viewer.id, siteId: site.id });

    const readAccess = await resolvePortalAccess(seedDb, viewerUser.id, site.id, "condition.read");
    const writeAccess = await resolvePortalAccess(seedDb, viewerUser.id, site.id, "alarms.acknowledge");
    assert.equal(readAccess.allowed, true);
    assert.equal(writeAccess.allowed, false);
  } finally {
    await client.close();
  }
});
