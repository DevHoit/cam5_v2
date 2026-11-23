ALTER TABLE "user_client_assignments" ADD COLUMN "all_sites" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Rol "client_admin" creado a mano fuera del portal: pasa a administrador con acceso a todo el cliente.
UPDATE "user_client_assignments" SET "role_id" = (SELECT "id" FROM "roles" WHERE "key" = 'administrator'), "all_sites" = true
WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "key" = 'client_admin')
  AND EXISTS (SELECT 1 FROM "roles" WHERE "key" = 'administrator');--> statement-breakpoint
INSERT INTO "user_role_assignments" ("user_id", "role_id", "site_id", "granted_by")
SELECT ra."user_id", (SELECT "id" FROM "roles" WHERE "key" = 'administrator'), ra."site_id", ra."granted_by"
FROM "user_role_assignments" ra
WHERE ra."role_id" IN (SELECT "id" FROM "roles" WHERE "key" = 'client_admin')
  AND EXISTS (SELECT 1 FROM "roles" WHERE "key" = 'administrator')
ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM "user_role_assignments" WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "key" = 'client_admin')
  AND EXISTS (SELECT 1 FROM "roles" WHERE "key" = 'administrator');--> statement-breakpoint
-- Acceso a todo el cliente: rol del cliente en cada uno de sus sitios.
INSERT INTO "user_role_assignments" ("user_id", "role_id", "site_id", "granted_by")
SELECT uca."user_id", uca."role_id", s."id", uca."granted_by"
FROM "user_client_assignments" uca
JOIN "sites" s ON s."client_id" = uca."client_id"
WHERE uca."all_sites" = true
  AND NOT EXISTS (SELECT 1 FROM "user_role_assignments" ra WHERE ra."user_id" = uca."user_id" AND ra."site_id" = s."id")
ON CONFLICT DO NOTHING;
