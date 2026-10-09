CREATE TABLE "telemetry_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gateway_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "batch_key" varchar(160) NOT NULL,
  "schema_version" varchar(16) DEFAULT '2.0' NOT NULL,
  "gateway_boot_id" varchar(80) NOT NULL,
  "gateway_sequence" bigint NOT NULL,
  "sent_at" timestamp with time zone NOT NULL,
  "sampled_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "quality" "data_quality" DEFAULT 'good' NOT NULL,
  "time_quality" varchar(16) DEFAULT 'synced' NOT NULL,
  "metric_count" integer NOT NULL,
  "success" boolean DEFAULT true NOT NULL,
  "error_message" text,
  CONSTRAINT "telemetry_batches_metric_count_chk" CHECK ("metric_count" BETWEEN 0 AND 256),
  CONSTRAINT "telemetry_batches_time_quality_chk" CHECK ("time_quality" IN ('synced', 'estimated', 'unsynced'))
);--> statement-breakpoint
ALTER TABLE "telemetry_batches" ADD CONSTRAINT "telemetry_batches_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_batches" ADD CONSTRAINT "telemetry_batches_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telemetry_batches_gateway_key_uidx" ON "telemetry_batches" USING btree ("gateway_id","batch_key");--> statement-breakpoint
CREATE INDEX "telemetry_batches_device_sampled_idx" ON "telemetry_batches" USING btree ("device_id","sampled_at");--> statement-breakpoint

CREATE TABLE "metric_readings" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "batch_id" uuid NOT NULL,
  "device_metric_id" uuid NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "value_numeric" numeric(24,8),
  "value_boolean" boolean,
  "value_text" text,
  "quality" "data_quality" NOT NULL,
  "quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "time_quality" varchar(16) DEFAULT 'synced' NOT NULL,
  "sequence" bigint,
  CONSTRAINT "metric_readings_time_quality_chk" CHECK ("time_quality" IN ('synced', 'estimated', 'unsynced')),
  CONSTRAINT "metric_readings_value_chk" CHECK (
    (CASE WHEN "value_numeric" IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN "value_boolean" IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN "value_text" IS NULL THEN 0 ELSE 1 END) <= 1
  )
);--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_batch_id_telemetry_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."telemetry_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_device_metric_id_device_metrics_id_fk" FOREIGN KEY ("device_metric_id") REFERENCES "public"."device_metrics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "metric_readings_batch_metric_uidx" ON "metric_readings" USING btree ("batch_id","device_metric_id");--> statement-breakpoint
CREATE INDEX "metric_readings_metric_recorded_idx" ON "metric_readings" USING btree ("device_metric_id","recorded_at");--> statement-breakpoint
CREATE INDEX "metric_readings_recorded_idx" ON "metric_readings" USING btree ("recorded_at");--> statement-breakpoint

CREATE TABLE "latest_metric_readings" (
  "device_metric_id" uuid PRIMARY KEY NOT NULL,
  "reading_id" bigint NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "value_numeric" numeric(24,8),
  "value_boolean" boolean,
  "value_text" text,
  "quality" "data_quality" NOT NULL,
  "quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "time_quality" varchar(16) DEFAULT 'synced' NOT NULL,
  "sequence" bigint,
  CONSTRAINT "latest_metric_readings_time_quality_chk" CHECK ("time_quality" IN ('synced', 'estimated', 'unsynced'))
);--> statement-breakpoint
ALTER TABLE "latest_metric_readings" ADD CONSTRAINT "latest_metric_readings_device_metric_id_device_metrics_id_fk" FOREIGN KEY ("device_metric_id") REFERENCES "public"."device_metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_metric_readings" ADD CONSTRAINT "latest_metric_readings_reading_id_metric_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."metric_readings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "latest_metric_readings_quality_idx" ON "latest_metric_readings" USING btree ("quality");