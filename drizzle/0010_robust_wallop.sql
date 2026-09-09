ALTER TABLE "reading_profiles" ALTER COLUMN "stale_after_seconds" SET DEFAULT 180;--> statement-breakpoint
ALTER TABLE "reading_profiles" ALTER COLUMN "raw_retention_days" SET DEFAULT 7;--> statement-breakpoint
ALTER TABLE "alarm_rules" ALTER COLUMN "stale_after_seconds" SET DEFAULT 180;--> statement-breakpoint
ALTER TABLE "reading_profiles" ADD COLUMN "storage_interval_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_profiles" ADD COLUMN "heartbeat_interval_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_profiles" ADD COLUMN "diagnostic_interval_seconds" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
UPDATE "reading_profiles"
SET "stale_after_seconds" = 180,
    "raw_retention_days" = 7,
    "updated_at" = now()
WHERE "stale_after_seconds" = 30
  AND "raw_retention_days" = 30;--> statement-breakpoint
UPDATE "alarm_rules" SET "stale_after_seconds" = 180 WHERE "stale_after_seconds" = 30;--> statement-breakpoint
ALTER TABLE "reading_profiles" ADD CONSTRAINT "reading_profiles_upload_intervals_chk" CHECK ("reading_profiles"."storage_interval_seconds" BETWEEN 10 AND 86400 AND "reading_profiles"."heartbeat_interval_seconds" BETWEEN 10 AND 3600 AND "reading_profiles"."diagnostic_interval_seconds" BETWEEN 60 AND 86400);
