import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createPortalSession, hashPassword, resolvePortalSession } from "../db/auth";
import { seedCam5Database } from "../db/seed";
import * as schema from "../db/schema";
import { createMigratedTestDatabase } from "./helpers/database";

test("ignores permissions from expired role assignments on the active site", async () => {
  const { client, db } = await createMigratedTestDatabase();
  try {
    await seedCam5Database(db, { adminEmail: "admin@example.test", adminName: "Administrador", adminPassword: "Temporal-2026", log: false });
    const [admin] = await db.select().from(schema.users).where(eq(schema.users.email, "admin@example.test")).limit(1);
    const [adminAssignment] = await db.select().from(schema.userRoleAssignments).where(eq(schema.userRoleAssignments.userId, admin.id)).limit(1);
    const [viewerRole] = await db.select().from(schema.roles).where(eq(schema.roles.key, "viewer")).limit(1);
    const [administratorRole] = await db.select().from(schema.roles).where(eq(schema.roles.key, "administrator")).limit(1);

    const [contractor] = await db.insert(schema.users).values({ email: "contratista@example.test", displayName: "Contratista", status: "active" }).returning();
    await db.insert(schema.authIdentities).values({ userId: contractor.id, provider: "local", providerSubject: contractor.email, passwordHash: await hashPassword("Contratista-2026") });
    await db.insert(schema.userRoleAssignments).values([
      { userId: contractor.id, roleId: viewerRole.id, siteId: adminAssignment.siteId },
      { userId: contractor.id, roleId: administratorRole.id, siteId: adminAssignment.siteId, expiresAt: new Date(Date.now() - 60_000) },
    ]);

    const session = await createPortalSession(db, contractor.id);
    const resolved = await resolvePortalSession(db, session.token);
    assert.ok(resolved);
    assert.equal(resolved.roleKey, "viewer");

    const viewerPermissions = await db.select({ code: schema.permissions.code }).from(schema.rolePermissions)
      .innerJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
      .where(eq(schema.rolePermissions.roleId, viewerRole.id));
    assert.deepEqual([...resolved.permissions].sort(), viewerPermissions.map((row) => row.code).sort());
    assert.ok(!resolved.permissions.includes("users.manage"));

    await db.update(schema.userRoleAssignments).set({ expiresAt: null })
      .where(and(eq(schema.userRoleAssignments.userId, contractor.id), eq(schema.userRoleAssignments.roleId, administratorRole.id)));
    const promoted = await resolvePortalSession(db, session.token);
    assert.equal(promoted?.roleKey, "administrator");
  } finally {
    await client.close();
  }
});
