ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "logo_data" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "logo_content_type" varchar(40);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "logo_updated_at" timestamp with time zone;