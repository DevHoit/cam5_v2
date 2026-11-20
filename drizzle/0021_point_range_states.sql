CREATE TABLE "point_range_states" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"out_since" timestamp with time zone,
	"peak_deviation" numeric(18, 6),
	"active_alarm_id" uuid,
	"last_evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "point_range_states" ADD CONSTRAINT "point_range_states_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_range_states" ADD CONSTRAINT "point_range_states_active_alarm_id_alarms_id_fk" FOREIGN KEY ("active_alarm_id") REFERENCES "public"."alarms"("id") ON DELETE set null ON UPDATE no action;