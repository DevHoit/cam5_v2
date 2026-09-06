ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_attempt_chk";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "policy_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "alarm_event_id" bigint;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "event_type" varchar(60) DEFAULT 'alarm' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "subject" varchar(240) DEFAULT 'Notificación HoitLive Core' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "max_attempts" smallint DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "scheduled_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "dedupe_key" varchar(220);--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_endpoints" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_policy_id_notification_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."notification_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_alarm_event_id_alarm_events_id_fk" FOREIGN KEY ("alarm_event_id") REFERENCES "public"."alarm_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_dedupe_uidx" ON "notification_deliveries" USING btree ("dedupe_key");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_attempt_chk" CHECK ("notification_deliveries"."attempt_count" >= 0 AND "notification_deliveries"."max_attempts" > 0 AND "notification_deliveries"."attempt_count" <= "notification_deliveries"."max_attempts");