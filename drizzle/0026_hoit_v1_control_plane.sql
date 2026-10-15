CREATE TABLE "areas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "parent_area_id" uuid,
  "code" varchar(60) NOT NULL,
  "name" varchar(160) NOT NULL,
  "type" varchar(80) DEFAULT 'operational' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "areas_client_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE restrict,
  CONSTRAINT "areas_site_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE cascade,
  CONSTRAINT "areas_parent_fk" FOREIGN KEY ("parent_area_id") REFERENCES "areas"("id") ON DELETE set null,
  CONSTRAINT "areas_parent_self_chk" CHECK ("parent_area_id" IS NULL OR "parent_area_id" <> "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "areas_site_code_uidx" ON "areas" ("site_id", "code");
--> statement-breakpoint
CREATE INDEX "areas_site_parent_idx" ON "areas" ("site_id", "parent_area_id");
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "area_id" uuid;
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_area_fk" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "assets_site_area_idx" ON "assets" ("site_id", "area_id");
--> statement-breakpoint

CREATE TABLE "escalation_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "escalation_policies_client_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_policies_client_name_uidx" ON "escalation_policies" ("client_id", "name");
--> statement-breakpoint
CREATE INDEX "escalation_policies_client_enabled_idx" ON "escalation_policies" ("client_id", "enabled");
--> statement-breakpoint
CREATE TABLE "escalation_levels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "policy_id" uuid NOT NULL,
  "level_number" smallint NOT NULL,
  "delay_seconds" integer DEFAULT 0 NOT NULL,
  "recipient_type" varchar(24) NOT NULL,
  "recipient_ref" varchar(160) NOT NULL,
  "channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "repeat_count" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "escalation_levels_policy_fk" FOREIGN KEY ("policy_id") REFERENCES "escalation_policies"("id") ON DELETE cascade,
  CONSTRAINT "escalation_levels_level_chk" CHECK ("level_number" > 0),
  CONSTRAINT "escalation_levels_delay_chk" CHECK ("delay_seconds" >= 0),
  CONSTRAINT "escalation_levels_recipient_type_chk" CHECK ("recipient_type" IN ('user', 'role', 'on_call_group')),
  CONSTRAINT "escalation_levels_repeat_chk" CHECK ("repeat_count" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_levels_policy_level_uidx" ON "escalation_levels" ("policy_id", "level_number");
--> statement-breakpoint

CREATE TABLE "shifts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "timezone" varchar(80) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  CONSTRAINT "shifts_client_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_client_name_uidx" ON "shifts" ("client_id", "name");
--> statement-breakpoint
CREATE INDEX "shifts_client_active_idx" ON "shifts" ("client_id", "active");
--> statement-breakpoint
CREATE TABLE "shift_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shift_id" uuid NOT NULL,
  "day_of_week" smallint NOT NULL,
  "start_time" time NOT NULL,
  "end_time" time NOT NULL,
  "valid_from" date,
  "valid_to" date,
  CONSTRAINT "shift_schedules_shift_fk" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE cascade,
  CONSTRAINT "shift_schedules_day_chk" CHECK ("day_of_week" BETWEEN 0 AND 6),
  CONSTRAINT "shift_schedules_time_chk" CHECK ("start_time" <> "end_time"),
  CONSTRAINT "shift_schedules_validity_chk" CHECK ("valid_from" IS NULL OR "valid_to" IS NULL OR "valid_to" >= "valid_from")
);
--> statement-breakpoint
CREATE INDEX "shift_schedules_shift_day_idx" ON "shift_schedules" ("shift_id", "day_of_week");
--> statement-breakpoint
CREATE TABLE "on_call_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shift_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "priority" smallint DEFAULT 0 NOT NULL,
  CONSTRAINT "on_call_assignments_shift_fk" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE cascade,
  CONSTRAINT "on_call_assignments_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade,
  CONSTRAINT "on_call_assignments_window_chk" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "on_call_assignments_priority_chk" CHECK ("priority" >= 0)
);
--> statement-breakpoint
CREATE INDEX "on_call_assignments_shift_window_idx" ON "on_call_assignments" ("shift_id", "starts_at", "ends_at");
--> statement-breakpoint
CREATE INDEX "on_call_assignments_user_window_idx" ON "on_call_assignments" ("user_id", "starts_at", "ends_at");
--> statement-breakpoint

CREATE TABLE "maintenance_windows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "scope_type" varchar(16) NOT NULL,
  "scope_id" uuid NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "reason" text NOT NULL,
  "created_by" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "maintenance_windows_client_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade,
  CONSTRAINT "maintenance_windows_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null,
  CONSTRAINT "maintenance_windows_cancelled_by_fk" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE set null,
  CONSTRAINT "maintenance_windows_scope_chk" CHECK ("scope_type" IN ('tenant', 'site', 'area', 'asset', 'device')),
  CONSTRAINT "maintenance_windows_time_chk" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE INDEX "maintenance_windows_client_window_idx" ON "maintenance_windows" ("client_id", "starts_at", "ends_at");
--> statement-breakpoint
CREATE INDEX "maintenance_windows_scope_window_idx" ON "maintenance_windows" ("scope_type", "scope_id", "starts_at", "ends_at");
--> statement-breakpoint

CREATE TABLE "rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "site_id" uuid,
  "name" varchar(180) NOT NULL,
  "description" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "scope_type" varchar(16) NOT NULL,
  "scope_id" uuid NOT NULL,
  "severity" varchar(16) NOT NULL,
  "expression" jsonb NOT NULL,
  "duration_seconds" integer DEFAULT 0 NOT NULL,
  "hysteresis" jsonb,
  "schedule_id" uuid,
  "escalation_policy_id" uuid,
  "created_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "rules_client_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade,
  CONSTRAINT "rules_site_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE cascade,
  CONSTRAINT "rules_escalation_policy_fk" FOREIGN KEY ("escalation_policy_id") REFERENCES "escalation_policies"("id") ON DELETE set null,
  CONSTRAINT "rules_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null,
  CONSTRAINT "rules_scope_chk" CHECK ("scope_type" IN ('tenant', 'site', 'area', 'asset', 'device')),
  CONSTRAINT "rules_severity_chk" CHECK ("severity" IN ('info', 'warning', 'critical')),
  CONSTRAINT "rules_duration_chk" CHECK ("duration_seconds" >= 0)
);
--> statement-breakpoint
CREATE INDEX "rules_client_enabled_idx" ON "rules" ("client_id", "enabled");
--> statement-breakpoint
CREATE INDEX "rules_site_enabled_idx" ON "rules" ("site_id", "enabled");
--> statement-breakpoint
CREATE INDEX "rules_scope_idx" ON "rules" ("scope_type", "scope_id");
--> statement-breakpoint
CREATE TABLE "rule_evaluation_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "rule_id" uuid NOT NULL,
  "scope_id" uuid NOT NULL,
  "condition_started_at" timestamptz,
  "last_true_at" timestamptz,
  "last_false_at" timestamptz,
  "current_state" varchar(16) DEFAULT 'false' NOT NULL,
  "last_value" jsonb,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "rule_evaluation_states_rule_fk" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE cascade,
  CONSTRAINT "rule_evaluation_states_state_chk" CHECK ("current_state" IN ('false', 'pending', 'firing', 'recovering'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rule_evaluation_states_rule_scope_uidx" ON "rule_evaluation_states" ("rule_id", "scope_id");
--> statement-breakpoint
CREATE INDEX "rule_evaluation_states_state_idx" ON "rule_evaluation_states" ("current_state", "updated_at");
--> statement-breakpoint

ALTER TABLE "alarms" ADD COLUMN "device_id" uuid;
--> statement-breakpoint
ALTER TABLE "alarms" ADD COLUMN "generic_rule_id" uuid;
--> statement-breakpoint
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_device_fk" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_generic_rule_fk" FOREIGN KEY ("generic_rule_id") REFERENCES "rules"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "alarms_device_opened_idx" ON "alarms" ("device_id", "opened_at");
--> statement-breakpoint
CREATE INDEX "alarms_generic_rule_idx" ON "alarms" ("generic_rule_id", "opened_at");
--> statement-breakpoint

CREATE TABLE "escalation_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "alarm_id" uuid NOT NULL,
  "policy_id" uuid NOT NULL,
  "level_id" uuid NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "due_at" timestamptz NOT NULL,
  "recipient_type" varchar(24) NOT NULL,
  "recipient_ref" varchar(160) NOT NULL,
  "resolved_recipient_user_id" uuid,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "escalation_jobs_alarm_fk" FOREIGN KEY ("alarm_id") REFERENCES "alarms"("id") ON DELETE cascade,
  CONSTRAINT "escalation_jobs_policy_fk" FOREIGN KEY ("policy_id") REFERENCES "escalation_policies"("id") ON DELETE cascade,
  CONSTRAINT "escalation_jobs_level_fk" FOREIGN KEY ("level_id") REFERENCES "escalation_levels"("id") ON DELETE cascade,
  CONSTRAINT "escalation_jobs_resolved_user_fk" FOREIGN KEY ("resolved_recipient_user_id") REFERENCES "users"("id") ON DELETE set null,
  CONSTRAINT "escalation_jobs_status_chk" CHECK ("status" IN ('pending', 'processing', 'completed', 'cancelled', 'failed')),
  CONSTRAINT "escalation_jobs_recipient_type_chk" CHECK ("recipient_type" IN ('user', 'role', 'on_call_group')),
  CONSTRAINT "escalation_jobs_attempt_chk" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_jobs_alarm_level_uidx" ON "escalation_jobs" ("alarm_id", "level_id");
--> statement-breakpoint
CREATE INDEX "escalation_jobs_due_idx" ON "escalation_jobs" ("status", "due_at");
