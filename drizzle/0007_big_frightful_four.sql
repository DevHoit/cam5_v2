ALTER TABLE "report_runs" ADD COLUMN "title" varchar(220);--> statement-breakpoint
UPDATE "report_runs" SET "title" = 'Informe histórico' WHERE "title" IS NULL;--> statement-breakpoint
ALTER TABLE "report_runs" ALTER COLUMN "title" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "format" varchar(12) DEFAULT 'pdf' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_format_chk" CHECK ("report_runs"."format" IN ('pdf', 'csv'));
