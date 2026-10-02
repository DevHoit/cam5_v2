-- Introduce explicit platform/client/site administration scopes without promoting legacy site admins.
INSERT INTO "permissions" ("code","module","action","description")
VALUES
  ('clients.manage','clients','manage','Crear y administrar clientes de la plataforma'),
  ('sites.manage','sites','manage','Crear y administrar sitios del cliente')
ON CONFLICT ("code") DO UPDATE SET
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "description" = EXCLUDED."description";

INSERT INTO "roles" ("key","name","description","is_system")
VALUES
  ('platform_admin','Administrador HOIT','Administración global de la plataforma, clientes, sitios, seguridad y operación.',true),
  ('client_admin','Administrador de cliente','Administración de usuarios, sitios y operación para todos los sitios de un cliente.',true),
  ('site_admin','Administrador de sitio','Administración completa de uno o varios sitios asignados.',true)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "is_system" = true;

-- Platform admins receive every permission.
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'platform_admin'
ON CONFLICT DO NOTHING;

-- Client admins receive everything except platform client creation/administration.
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'client_admin'
  AND p.code <> 'clients.manage'
ON CONFLICT DO NOTHING;

-- Site admins receive the previous administrator operational permissions,
-- but cannot create clients or sites.
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key = 'site_admin'
  AND p.code NOT IN ('clients.manage','sites.manage')
ON CONFLICT DO NOTHING;

-- Existing explicit administrator assignments were site-scoped in the old product,
-- so preserve their scope and rename them to site_admin.
UPDATE "user_role_assignments" ura
SET "role_id" = site_admin.id
FROM "roles" legacy, "roles" site_admin
WHERE ura.role_id = legacy.id
  AND legacy.key = 'administrator'
  AND site_admin.key = 'site_admin'
  AND ura.site_id IS NOT NULL;

-- The bootstrap administrator was the only legacy administrator created without
-- a grantor. Promote that installation bootstrap identity to platform_admin.
INSERT INTO "user_role_assignments" ("user_id","role_id","site_id","granted_by","granted_at")
SELECT DISTINCT ura.user_id, platform_admin.id, NULL::uuid, NULL::uuid, now()
FROM "user_role_assignments" ura
JOIN "roles" site_admin ON site_admin.id = ura.role_id AND site_admin.key = 'site_admin'
JOIN "roles" platform_admin ON platform_admin.key = 'platform_admin'
WHERE ura.granted_by IS NULL
ON CONFLICT DO NOTHING;

-- user_client_assignments used to mirror site assignments. They now represent
-- true client-level authority only, so remove the legacy mirrored rows.
DELETE FROM "user_client_assignments";