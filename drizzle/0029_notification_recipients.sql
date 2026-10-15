ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'whatsapp_meta';
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_e164" varchar(20);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_e164_uidx" ON "users" ("phone_e164") WHERE "phone_e164" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_e164_chk" CHECK ("phone_e164" IS NULL OR "phone_e164" ~ '^\\+[1-9][0-9]{7,14}$');
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "recipient_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_user_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "provider" varchar(40);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "template_name" varchar(120);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "delivered_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "read_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "failed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "ack_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "error_code" varchar(120);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT IF EXISTS "notification_deliveries_status_chk";
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_status_chk" CHECK ("status" IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'cancelled', 'suppressed'));
--> statement-breakpoint
CREATE INDEX "notification_deliveries_recipient_user_idx" ON "notification_deliveries" ("recipient_user_id", "queued_at");
--> statement-breakpoint
CREATE INDEX "notification_deliveries_provider_message_idx" ON "notification_deliveries" ("provider", "provider_message_id");
