CREATE TABLE "site_report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"hour" integer DEFAULT 8 NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attach_pdf" boolean DEFAULT true NOT NULL,
	"only_if_findings" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_status" varchar(20),
	"last_error" text,
	"last_report_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_report_schedules_kind_chk" CHECK ("site_report_schedules"."kind" IN ('weekly', 'monthly')),
	CONSTRAINT "site_report_schedules_hour_chk" CHECK ("site_report_schedules"."hour" BETWEEN 0 AND 23)
);
--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "kind" varchar(20);--> statement-breakpoint
ALTER TABLE "site_report_schedules" ADD CONSTRAINT "site_report_schedules_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_report_schedules" ADD CONSTRAINT "site_report_schedules_last_report_id_report_runs_id_fk" FOREIGN KEY ("last_report_id") REFERENCES "public"."report_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_report_schedules" ADD CONSTRAINT "site_report_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_report_schedules_due_idx" ON "site_report_schedules" USING btree ("active","next_run_at");--> statement-breakpoint
CREATE INDEX "site_report_schedules_site_idx" ON "site_report_schedules" USING btree ("site_id");--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "report_templates" ("site_id", "key", "name", "description", "definition", "active") VALUES
  (NULL, 'site_weekly', 'Informe semanal de operación', 'Estado de la subestación, alarmas de la semana, hallazgos con acción y disponibilidad del monitoreo.', '{"scope":"site","kind":"weekly"}'::jsonb, true),
  (NULL, 'site_monthly', 'Informe mensual de condición', 'Salud por punto, desbalance entre fases, temperatura sobre el ambiente, descarga parcial, humedad, alarmas, disponibilidad y recomendaciones.', '{"scope":"site","kind":"monthly"}'::jsonb, true)
ON CONFLICT DO NOTHING;
