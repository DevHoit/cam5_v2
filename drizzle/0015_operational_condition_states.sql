CREATE TABLE "operational_condition_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL,
  "device_id" uuid,
  "condition_key" varchar(180) NOT NULL,
  "active_alarm_id" uuid,
  "observed" boolean DEFAULT false NOT NULL,
  "first_observed_at" timestamp with time zone,
  "last_observed_at" timestamp with time zone,
  "last_value" numeric(18, 6),
  "severity" "severity" DEFAULT 'normal' NOT NULL,
  "context" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "operational_condition_states_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "operational_condition_states_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "operational_condition_states_active_alarm_id_alarms_id_fk" FOREIGN KEY ("active_alarm_id") REFERENCES "public"."alarms"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operational_condition_states_asset_key_uidx" ON "operational_condition_states" USING btree ("asset_id","condition_key");
--> statement-breakpoint
CREATE INDEX "operational_condition_states_device_idx" ON "operational_condition_states" USING btree ("device_id");
--> statement-breakpoint
CREATE INDEX "operational_condition_states_alarm_idx" ON "operational_condition_states" USING btree ("active_alarm_id");