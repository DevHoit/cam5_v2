ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "user_license_limit" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "partner_name" varchar(180);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "partner_license_limit" integer;--> statement-breakpoint
ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_user_license_limit_chk";--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_license_limit_chk" CHECK ("clients"."user_license_limit" IS NULL OR "clients"."user_license_limit" >= 0);--> statement-breakpoint
ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_partner_license_limit_chk";--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_partner_license_limit_chk" CHECK ("clients"."partner_license_limit" IS NULL OR "clients"."partner_license_limit" >= 0);--> statement-breakpoint
ALTER TABLE "user_client_assignments" ADD COLUMN IF NOT EXISTS "license_kind" varchar(20) DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_client_assignments" DROP CONSTRAINT IF EXISTS "user_client_assignments_license_kind_chk";--> statement-breakpoint
ALTER TABLE "user_client_assignments" ADD CONSTRAINT "user_client_assignments_license_kind_chk" CHECK ("user_client_assignments"."license_kind" IN ('client', 'partner'));
