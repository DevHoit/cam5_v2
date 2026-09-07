ALTER TABLE "ingestion_batches" ADD COLUMN "gateway_boot_id" varchar(80);--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD COLUMN "gateway_sequence" bigint;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD COLUMN "gateway_uptime_seconds" bigint;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD COLUMN "good_registers" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD COLUMN "stale_registers" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD COLUMN "bad_registers" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "ingestion_batches" AS batch
SET
  "good_registers" = quality."good_registers",
  "stale_registers" = quality."stale_registers",
  "bad_registers" = quality."bad_registers"
FROM (
  SELECT
    "batch_id",
    count(*) FILTER (WHERE "quality" = 'good')::integer AS "good_registers",
    count(*) FILTER (WHERE "quality" = 'stale')::integer AS "stale_registers",
    count(*) FILTER (WHERE "quality" = 'bad')::integer AS "bad_registers"
  FROM "device_register_samples"
  GROUP BY "batch_id"
) AS quality
WHERE batch."id" = quality."batch_id";--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_quality_counts_chk" CHECK ("ingestion_batches"."good_registers" >= 0 AND "ingestion_batches"."stale_registers" >= 0 AND "ingestion_batches"."bad_registers" >= 0 AND "ingestion_batches"."good_registers" + "ingestion_batches"."stale_registers" + "ingestion_batches"."bad_registers" <= "ingestion_batches"."received_registers");
