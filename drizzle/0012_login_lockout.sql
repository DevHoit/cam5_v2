ALTER TABLE "auth_identities" ADD COLUMN "failed_login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD COLUMN "last_failed_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD COLUMN "locked_until" timestamp with time zone;