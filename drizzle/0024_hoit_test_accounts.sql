ALTER TABLE "users" ADD COLUMN "test_account" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "access_expires_at" timestamp with time zone;