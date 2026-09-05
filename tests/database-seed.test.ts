import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { PORTAL_ROLES } from "../db/access-control";
import { resolvePortalAccess } from "../db/authorization";
import type { Cam5Database } from "../db/index";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";

test("seeds the initial CAM5 installation and remains idempotent", async () => {
  const client = new PGlite();
  try {
    const migration = await readFile(new URL("../drizzle/0000_cam5_initial_schema.sql", import.meta.url), "utf8");
    await client.exec(migration.replaceAll("--> statement-breakpoint", ""));
    const db = drizzle(client, { schema });
    const seedDb = db as unknown as Cam5Database;

    const seedOptions = { adminEmail: "admin@example.test", adminName: "Administrador de prueba", log: false };
    await seedCam5Database(seedDb, seedOptions);
    await seedCam5Database(seedDb, seedOptions);

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

    assert.equal(siteCount.value, 1);
    assert.equal(assetCount.value, 1);
    assert.equal(deviceCount.value, 1);
    assert.equal(inputCount.value, 24);
    assert.equal(channelCount.value, 36);
    assert.equal(registerCount.value, 105);
    assert.equal(roleCount.value, PORTAL_ROLES.length);
    assert.equal(permissionCount.value, 30);
    assert.equal(relayCount.value, 6);
    assert.equal(checkCount.value, 8);
    assert.equal(profileRangeCount.value, 4);
    assert.equal(adminCount.value, 1);

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
