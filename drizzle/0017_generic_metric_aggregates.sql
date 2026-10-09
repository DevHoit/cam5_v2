CREATE TABLE "metric_reading_aggregates" (
  "device_metric_id" uuid NOT NULL,
  "bucket_start" timestamp with time zone NOT NULL,
  "bucket_seconds" integer NOT NULL,
  "sample_count" integer NOT NULL,
  "invalid_sample_count" integer DEFAULT 0 NOT NULL,
  "minimum_value" numeric(24, 8),
  "maximum_value" numeric(24, 8),
  "average_value" numeric(24, 8),
  "first_value" numeric(24, 8),
  "last_value" numeric(24, 8),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "metric_reading_aggregates_device_metric_id_device_metrics_id_fk" FOREIGN KEY ("device_metric_id") REFERENCES "public"."device_metrics"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "metric_reading_aggregates_pkey" PRIMARY KEY ("device_metric_id","bucket_start","bucket_seconds"),
  CONSTRAINT "metric_reading_aggregates_bucket_chk" CHECK ("metric_reading_aggregates"."bucket_seconds" IN (60, 300, 3600, 86400)),
  CONSTRAINT "metric_reading_aggregates_samples_chk" CHECK ("metric_reading_aggregates"."sample_count" > 0 AND "metric_reading_aggregates"."invalid_sample_count" >= 0 AND "metric_reading_aggregates"."invalid_sample_count" <= "metric_reading_aggregates"."sample_count")
);
--> statement-breakpoint
CREATE INDEX "metric_reading_aggregates_bucket_idx" ON "metric_reading_aggregates" USING btree ("bucket_seconds","bucket_start");
--> statement-breakpoint
CREATE INDEX "metric_reading_aggregates_metric_bucket_idx" ON "metric_reading_aggregates" USING btree ("device_metric_id","bucket_start");