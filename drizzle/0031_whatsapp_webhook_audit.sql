CREATE TABLE "alarm_transitions" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "alarm_id" uuid NOT NULL,
  "from_status" varchar(24) NOT NULL,
  "to_status" varchar(24) NOT NULL,
  "actor_user_id" uuid,
  "source" varchar(40) DEFAULT 'system' NOT NULL,
  "source_ref" varchar(220),
  "note" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "alarm_transitions_alarm_fk" FOREIGN KEY ("alarm_id") REFERENCES "alarms"("id") ON DELETE cascade,
  CONSTRAINT "alarm_transitions_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX "alarm_transitions_alarm_created_idx" ON "alarm_transitions" ("alarm_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "alarm_transitions_source_ref_uidx" ON "alarm_transitions" ("source", "source_ref") WHERE "source_ref" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE "notification_provider_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "provider" varchar(40) NOT NULL,
  "event_key" varchar(240) NOT NULL,
  "event_type" varchar(80) NOT NULL,
  "provider_message_id" varchar(180),
  "phone_e164" varchar(20),
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "outcome" varchar(40) DEFAULT 'received' NOT NULL,
  "error_message" text,
  "processed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_provider_events_provider_key_uidx" ON "notification_provider_events" ("provider", "event_key");
--> statement-breakpoint
CREATE INDEX "notification_provider_events_message_idx" ON "notification_provider_events" ("provider", "provider_message_id");
--> statement-breakpoint
CREATE INDEX "notification_provider_events_phone_created_idx" ON "notification_provider_events" ("phone_e164", "created_at");
