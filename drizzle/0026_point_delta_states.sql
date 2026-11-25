CREATE TABLE "point_delta_states" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"current_severity" varchar(16) DEFAULT 'normal' NOT NULL,
	"breach_count" integer DEFAULT 0 NOT NULL,
	"recovery_count" integer DEFAULT 0 NOT NULL,
	"last_delta" numeric(18, 6),
	"active_alarm_id" uuid,
	"last_evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "point_delta_states" ADD CONSTRAINT "point_delta_states_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_delta_states" ADD CONSTRAINT "point_delta_states_active_alarm_id_alarms_id_fk" FOREIGN KEY ("active_alarm_id") REFERENCES "public"."alarms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Humedad CAM5: advertencia > 65 %HR y crítica > 80 %HR (riesgo de condensación). Solo se cambian
-- las reglas que conservan los valores de fábrica anteriores (75/85); las ajustadas a mano se respetan.
UPDATE "alarm_rules" SET "warning_threshold" = 65, "critical_threshold" = 80, "updated_at" = now()
FROM "channels", "devices", "device_models"
WHERE "channels"."id" = "alarm_rules"."channel_id"
  AND "devices"."id" = "channels"."device_id"
  AND "device_models"."id" = "devices"."model_id"
  AND "device_models"."code" = 'CAM5-TPH-XDCW'
  AND "channels"."metric" = 'humidity'
  AND "alarm_rules"."warning_threshold" = 75
  AND "alarm_rules"."critical_threshold" = 85;
