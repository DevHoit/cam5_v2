ALTER TABLE "auth_identities" ADD COLUMN IF NOT EXISTS "failed_login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD COLUMN IF NOT EXISTS "last_failed_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;