ALTER TYPE "public"."alarm_status" ADD VALUE 'resolved' BEFORE 'closed';--> statement-breakpoint
CREATE TABLE "alarm_rule_states" (
	"rule_id" uuid PRIMARY KEY NOT NULL,
	"active_alarm_id" uuid,
	"current_severity" "severity" DEFAULT 'normal' NOT NULL,
	"current_kind" varchar(40) DEFAULT 'threshold' NOT NULL,
	"breach_count" integer DEFAULT 0 NOT NULL,
	"recovery_count" integer DEFAULT 0 NOT NULL,
	"last_value" numeric(18, 6),
	"last_quality" "data_quality",
	"last_evaluated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alarm_rule_states_counts_chk" CHECK ("alarm_rule_states"."breach_count" >= 0 AND "alarm_rule_states"."recovery_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "alarms" ADD COLUMN "kind" varchar(40) DEFAULT 'threshold' NOT NULL;--> statement-breakpoint
ALTER TABLE "alarms" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "alarms" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alarms" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "alarm_rule_states" ADD CONSTRAINT "alarm_rule_states_rule_id_alarm_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alarm_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarm_rule_states" ADD CONSTRAINT "alarm_rule_states_active_alarm_id_alarms_id_fk" FOREIGN KEY ("active_alarm_id") REFERENCES "public"."alarms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alarm_rule_states_active_alarm_uidx" ON "alarm_rule_states" USING btree ("active_alarm_id");--> statement-breakpoint
CREATE INDEX "alarm_rule_states_evaluated_idx" ON "alarm_rule_states" USING btree ("last_evaluated_at");--> statement-breakpoint
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alarms_assignee_status_idx" ON "alarms" USING btree ("assigned_to","status");--> statement-breakpoint
CREATE INDEX "alarms_kind_status_idx" ON "alarms" USING btree ("kind","status");