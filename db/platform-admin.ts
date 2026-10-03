import { and, eq, isNull, sql } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { roles, userRoleAssignments, users } from "./schema";
import { normalizeEmail } from "./auth";

export async function ensurePlatformAdmin(db: Cam5Database, email: string, grantedBy: string | null = null) {
  const normalizedEmail = normalizeEmail(email);
  const [user] = await db.select({ id: users.id, email: users.email, status: users.status })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`)
    .limit(1);
  if (!user) throw new Error(`No existe un usuario con correo ${normalizedEmail}.`);
  if (user.status !== "active") throw new Error(`El usuario ${normalizedEmail} no está activo.`);

  const [role] = await db.select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, "platform_admin"))
    .limit(1);
  if (!role) throw new Error("El rol platform_admin no existe. Ejecuta primero las migraciones.");

  const [existing] = await db.select({ id: userRoleAssignments.id })
    .from(userRoleAssignments)
    .where(and(
      eq(userRoleAssignments.userId, user.id),
      eq(userRoleAssignments.roleId, role.id),
      isNull(userRoleAssignments.siteId),
    ))
    .limit(1);

  if (!existing) {
    await db.insert(userRoleAssignments).values({
      userId: user.id,
      roleId: role.id,
      siteId: null,
      grantedBy,
    });
  }

  return { userId: user.id, email: user.email, created: !existing };
}
