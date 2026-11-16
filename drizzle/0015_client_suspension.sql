ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "suspended_reason" varchar(300);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "suspended_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "platform_staff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Marca inicial del personal de plataforma: quienes hoy administran algún sitio. Revisar después del despliegue
-- y quitar la marca a administradores que pertenezcan a un cliente y no a HOIT:
--   UPDATE users SET platform_staff = false WHERE email = 'admin@cliente.cl';
UPDATE "users" SET "platform_staff" = true
WHERE "platform_staff" = false AND "id" IN (
  SELECT "ura"."user_id" FROM "user_role_assignments" "ura"
  INNER JOIN "roles" "r" ON "r"."id" = "ura"."role_id"
  WHERE "r"."key" = 'administrator'
);
