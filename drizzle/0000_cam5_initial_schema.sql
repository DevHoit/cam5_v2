CREATE TYPE "public"."alarm_status" AS ENUM('open', 'acknowledged', 'closed');--> statement-breakpoint
CREATE TYPE "public"."asset_state" AS ENUM('normal', 'warning', 'critical', 'offline', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."audit_outcome" AS ENUM('success', 'denied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."channel_metric" AS ENUM('temperature', 'ambient_temperature', 'humidity', 'partial_discharge', 'surface_discharge', 'noise', 'event_count', 'alpha', 'beta', 'phi', 'system');--> statement-breakpoint
CREATE TYPE "public"."commissioning_status" AS ENUM('pending', 'passed', 'failed', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."configuration_kind" AS ENUM('baseline', 'manual', 'pre_deploy', 'backup', 'restore');--> statement-breakpoint
CREATE TYPE "public"."data_quality" AS ENUM('good', 'stale', 'bad', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."device_state" AS ENUM('draft', 'commissioning', 'active', 'offline', 'maintenance', 'decommissioned');--> statement-breakpoint
CREATE TYPE "public"."gateway_state" AS ENUM('pending', 'online', 'degraded', 'offline');--> statement-breakpoint
CREATE TYPE "public"."identity_provider" AS ENUM('local', 'chatgpt', 'oidc');--> statement-breakpoint
CREATE TYPE "public"."input_kind" AS ENUM('temperature_saw', 'uhf', 'humidity');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('webhook', 'rest_api', 'email', 'teams', 'cmms');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('email', 'teams', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."register_data_type" AS ENUM('int16', 'uint16');--> statement-breakpoint
CREATE TYPE "public"."report_run_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('normal', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."work_order_priority" AS ENUM('normal', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "alarm_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"alarm_id" uuid NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"actor_user_id" uuid,
	"note" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alarm_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"warning_threshold" numeric(18, 6),
	"critical_threshold" numeric(18, 6),
	"hysteresis" numeric(18, 6) DEFAULT '0' NOT NULL,
	"activation_samples" smallint DEFAULT 3 NOT NULL,
	"recovery_samples" smallint DEFAULT 3 NOT NULL,
	"stale_after_seconds" integer DEFAULT 30 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alarm_rules_threshold_order_chk" CHECK ("alarm_rules"."warning_threshold" IS NULL OR "alarm_rules"."critical_threshold" IS NULL OR "alarm_rules"."warning_threshold" < "alarm_rules"."critical_threshold"),
	CONSTRAINT "alarm_rules_hysteresis_chk" CHECK ("alarm_rules"."hysteresis" >= 0),
	CONSTRAINT "alarm_rules_samples_chk" CHECK ("alarm_rules"."activation_samples" > 0 AND "alarm_rules"."recovery_samples" > 0),
	CONSTRAINT "alarm_rules_stale_positive_chk" CHECK ("alarm_rules"."stale_after_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "alarms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"channel_id" uuid,
	"rule_id" uuid,
	"code" varchar(80) NOT NULL,
	"severity" "severity" NOT NULL,
	"status" "alarm_status" DEFAULT 'open' NOT NULL,
	"title" varchar(220) NOT NULL,
	"detail" text,
	"trigger_value" numeric(18, 6),
	"threshold_value" numeric(18, 6),
	"opened_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "alarms_occurrence_positive_chk" CHECK ("alarms"."occurrence_count" > 0),
	CONSTRAINT "alarms_observation_time_chk" CHECK ("alarms"."last_observed_at" >= "alarms"."opened_at")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"code" varchar(60) NOT NULL,
	"name" varchar(180) NOT NULL,
	"area" varchar(160),
	"asset_type" varchar(80) DEFAULT 'switchgear_cabinet' NOT NULL,
	"nominal_voltage_kv" numeric(8, 3),
	"state" "asset_state" DEFAULT 'offline' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site_id" uuid,
	"actor_user_id" uuid,
	"action" varchar(120) NOT NULL,
	"resource_type" varchar(80) NOT NULL,
	"resource_id" varchar(160),
	"outcome" "audit_outcome" DEFAULT 'success' NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"request_id" varchar(120),
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"provider_subject" varchar(320) NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_password_chk" CHECK (("auth_identities"."provider" = 'local' AND "auth_identities"."password_hash" IS NOT NULL) OR ("auth_identities"."provider" <> 'local' AND "auth_identities"."password_hash" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_expiry_chk" CHECK ("auth_sessions"."expires_at" > "auth_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"physical_input_id" uuid,
	"register_definition_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(180) NOT NULL,
	"zone" varchar(160),
	"metric" "channel_metric" NOT NULL,
	"unit" varchar(40) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_display_order_nonnegative_chk" CHECK ("channels"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commissioning_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"item_key" varchar(80) NOT NULL,
	"label" varchar(220) NOT NULL,
	"status" "commissioning_status" DEFAULT 'pending' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checked_by" uuid,
	"checked_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "configuration_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"kind" "configuration_kind" NOT NULL,
	"version" integer NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"storage_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "configuration_version_positive_chk" CHECK ("configuration_snapshots"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "device_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"manufacturer" varchar(100) DEFAULT 'IntelliSAW' NOT NULL,
	"name" varchar(160) NOT NULL,
	"register_map_version" varchar(40) NOT NULL,
	"capabilities" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"reading_profile_id" uuid,
	"code" varchar(60) NOT NULL,
	"name" varchar(160) NOT NULL,
	"serial_number" varchar(120),
	"firmware_version" varchar(80),
	"data_version" integer,
	"state" "device_state" DEFAULT 'draft' NOT NULL,
	"protocol" varchar(24) DEFAULT 'modbus_tcp' NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer DEFAULT 502 NOT NULL,
	"unit_id" smallint DEFAULT 1 NOT NULL,
	"timeout_ms" integer DEFAULT 1000 NOT NULL,
	"retries" smallint DEFAULT 2 NOT NULL,
	"register_convention" varchar(32) DEFAULT 'native_and_400xxx' NOT NULL,
	"last_read_at" timestamp with time zone,
	"clock_offset_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_port_chk" CHECK ("devices"."port" BETWEEN 1 AND 65535),
	CONSTRAINT "devices_unit_id_chk" CHECK ("devices"."unit_id" BETWEEN 0 AND 247),
	CONSTRAINT "devices_timeout_chk" CHECK ("devices"."timeout_ms" > 0),
	CONSTRAINT "devices_retries_chk" CHECK ("devices"."retries" BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE TABLE "gateways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"code" varchar(60) NOT NULL,
	"name" varchar(160) NOT NULL,
	"serial_number" varchar(120),
	"software_version" varchar(80),
	"state" "gateway_state" DEFAULT 'pending' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"ip_address" varchar(64),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"batch_key" varchar(160) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"expected_registers" integer NOT NULL,
	"received_registers" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"success" boolean DEFAULT false NOT NULL,
	"error_message" text,
	CONSTRAINT "ingestion_batches_counts_chk" CHECK ("ingestion_batches"."expected_registers" > 0 AND "ingestion_batches"."received_registers" >= 0 AND "ingestion_batches"."received_registers" <= "ingestion_batches"."expected_registers")
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"base_url" text,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_reference" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "latest_readings" (
	"channel_id" uuid PRIMARY KEY NOT NULL,
	"reading_id" bigint NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"raw_value" integer,
	"value" numeric(18, 6),
	"quality" "data_quality" NOT NULL,
	"quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sequence" bigint
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"alarm_id" uuid,
	"recipient" varchar(320),
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"attempt_count" smallint DEFAULT 0 NOT NULL,
	"provider_message_id" varchar(180),
	"error_message" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_deliveries_attempt_chk" CHECK ("notification_deliveries"."attempt_count" >= 0),
	CONSTRAINT "notification_deliveries_status_chk" CHECK ("notification_deliveries"."status" IN ('queued', 'sending', 'delivered', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "notification_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"configuration" jsonb NOT NULL,
	"secret_reference" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"minimum_severity" "severity" DEFAULT 'warning' NOT NULL,
	"escalation_delay_minutes" integer DEFAULT 0 NOT NULL,
	"repeat_interval_minutes" integer,
	"active" boolean DEFAULT true NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "notification_policy_delays_chk" CHECK ("notification_policies"."escalation_delay_minutes" >= 0 AND ("notification_policies"."repeat_interval_minutes" IS NULL OR "notification_policies"."repeat_interval_minutes" > 0))
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(100) NOT NULL,
	"module" varchar(60) NOT NULL,
	"action" varchar(40) NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "physical_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"kind" "input_kind" NOT NULL,
	"port_number" smallint NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"assignment" varchar(180),
	"zone" varchar(160),
	"calibration_code" varchar(120),
	"frequency_band" varchar(80),
	"antenna_port" varchar(80),
	"signal_strength" numeric(12, 3),
	"humidity_index" numeric(12, 3),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "physical_inputs_port_positive_chk" CHECK ("physical_inputs"."port_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "reading_aggregates" (
	"channel_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"bucket_seconds" integer NOT NULL,
	"sample_count" integer NOT NULL,
	"invalid_sample_count" integer DEFAULT 0 NOT NULL,
	"minimum_value" numeric(18, 6),
	"maximum_value" numeric(18, 6),
	"average_value" numeric(18, 6),
	"first_value" numeric(18, 6),
	"last_value" numeric(18, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_aggregates_channel_id_bucket_start_bucket_seconds_pk" PRIMARY KEY("channel_id","bucket_start","bucket_seconds"),
	CONSTRAINT "reading_aggregates_bucket_chk" CHECK ("reading_aggregates"."bucket_seconds" IN (60, 300, 3600, 86400)),
	CONSTRAINT "reading_aggregates_samples_chk" CHECK ("reading_aggregates"."sample_count" > 0 AND "reading_aggregates"."invalid_sample_count" >= 0 AND "reading_aggregates"."invalid_sample_count" <= "reading_aggregates"."sample_count")
);
--> statement-breakpoint
CREATE TABLE "reading_profile_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"start_register" integer NOT NULL,
	"end_register" integer NOT NULL,
	"function_code" smallint DEFAULT 3 NOT NULL,
	"interval_ms" integer NOT NULL,
	"priority" smallint DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "reading_profile_ranges_bounds_chk" CHECK ("reading_profile_ranges"."start_register" >= 0 AND "reading_profile_ranges"."end_register" >= "reading_profile_ranges"."start_register"),
	CONSTRAINT "reading_profile_ranges_interval_chk" CHECK ("reading_profile_ranges"."interval_ms" >= 500),
	CONSTRAINT "reading_profile_ranges_function_chk" CHECK ("reading_profile_ranges"."function_code" IN (3, 4))
);
--> statement-breakpoint
CREATE TABLE "reading_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"stale_after_seconds" integer DEFAULT 30 NOT NULL,
	"raw_retention_days" integer DEFAULT 30 NOT NULL,
	"aggregate_retention_days" integer DEFAULT 1825 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_profiles_stale_positive_chk" CHECK ("reading_profiles"."stale_after_seconds" > 0),
	CONSTRAINT "reading_profiles_retention_positive_chk" CHECK ("reading_profiles"."raw_retention_days" > 0 AND "reading_profiles"."aggregate_retention_days" >= "reading_profiles"."raw_retention_days")
);
--> statement-breakpoint
CREATE TABLE "readings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"batch_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_value" integer,
	"value" numeric(18, 6),
	"quality" "data_quality" NOT NULL,
	"quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sequence" bigint
);
--> statement-breakpoint
CREATE TABLE "register_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"native_register" integer NOT NULL,
	"human_reference" varchar(20) NOT NULL,
	"name" varchar(160) NOT NULL,
	"register_group" varchar(60) NOT NULL,
	"metric" "channel_metric" NOT NULL,
	"data_type" "register_data_type" NOT NULL,
	"scale_factor" numeric(16, 6) DEFAULT '1' NOT NULL,
	"scale_note" varchar(80),
	"unit" varchar(40) NOT NULL,
	"error_raw_value" integer,
	"minimum_value" numeric(18, 6),
	"maximum_value" numeric(18, 6),
	"writable" boolean DEFAULT false NOT NULL,
	CONSTRAINT "register_native_nonnegative_chk" CHECK ("register_definitions"."native_register" >= 0)
);
--> statement-breakpoint
CREATE TABLE "relay_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"relay_number" smallint NOT NULL,
	"name" varchar(120) NOT NULL,
	"source_expression" text NOT NULL,
	"severity" "severity" DEFAULT 'critical' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"failsafe" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relay_number_chk" CHECK ("relay_configurations"."relay_number" BETWEEN 1 AND 6)
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"asset_id" uuid,
	"requested_by" uuid,
	"status" "report_run_status" DEFAULT 'queued' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"storage_key" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "report_runs_period_chk" CHECK ("report_runs"."period_end" > "report_runs"."period_start")
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"asset_id" uuid,
	"cron_expression" varchar(120) NOT NULL,
	"timezone" varchar(80) DEFAULT 'America/Santiago' NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"key" varchar(80) NOT NULL,
	"name" varchar(180) NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_template_site_key_uidx" UNIQUE NULLS NOT DISTINCT("site_id","key")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(60) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(160) NOT NULL,
	"timezone" varchar(80) DEFAULT 'America/Santiago' NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_asset_scopes" (
	"user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_asset_scopes_user_id_asset_id_pk" PRIMARY KEY("user_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "user_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"site_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_invitations_expiry_chk" CHECK ("user_invitations"."expires_at" > "user_invitations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "user_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"site_id" uuid,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "user_role_scope_uidx" UNIQUE NULLS NOT DISTINCT("user_id","role_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"locale" varchar(16) DEFAULT 'es-CL' NOT NULL,
	"timezone" varchar(80) DEFAULT 'America/Santiago' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_alarms" (
	"work_order_id" uuid NOT NULL,
	"alarm_id" uuid NOT NULL,
	CONSTRAINT "work_order_alarms_work_order_id_alarm_id_pk" PRIMARY KEY("work_order_id","alarm_id")
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"code" varchar(80) NOT NULL,
	"title" varchar(220) NOT NULL,
	"description" text,
	"priority" "work_order_priority" DEFAULT 'normal' NOT NULL,
	"status" "work_order_status" DEFAULT 'pending' NOT NULL,
	"assigned_to" uuid,
	"created_by" uuid,
	"due_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_alarm_id_alarms_id_fk" FOREIGN KEY ("alarm_id") REFERENCES "public"."alarms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarm_rules" ADD CONSTRAINT "alarm_rules_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarm_rules" ADD CONSTRAINT "alarm_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_rule_id_alarm_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alarm_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_physical_input_id_physical_inputs_id_fk" FOREIGN KEY ("physical_input_id") REFERENCES "public"."physical_inputs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_register_definition_id_register_definitions_id_fk" FOREIGN KEY ("register_definition_id") REFERENCES "public"."register_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissioning_items" ADD CONSTRAINT "commissioning_items_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissioning_items" ADD CONSTRAINT "commissioning_items_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_snapshots" ADD CONSTRAINT "configuration_snapshots_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_snapshots" ADD CONSTRAINT "configuration_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_model_id_device_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."device_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_reading_profile_id_reading_profiles_id_fk" FOREIGN KEY ("reading_profile_id") REFERENCES "public"."reading_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateways" ADD CONSTRAINT "gateways_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_readings" ADD CONSTRAINT "latest_readings_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_readings" ADD CONSTRAINT "latest_readings_reading_id_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."readings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_endpoint_id_notification_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."notification_endpoints"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_alarm_id_alarms_id_fk" FOREIGN KEY ("alarm_id") REFERENCES "public"."alarms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_endpoints" ADD CONSTRAINT "notification_endpoints_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD CONSTRAINT "notification_policies_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD CONSTRAINT "notification_policies_endpoint_id_notification_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."notification_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_inputs" ADD CONSTRAINT "physical_inputs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_aggregates" ADD CONSTRAINT "reading_aggregates_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_profile_ranges" ADD CONSTRAINT "reading_profile_ranges_profile_id_reading_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."reading_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_batch_id_ingestion_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ingestion_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_definitions" ADD CONSTRAINT "register_definitions_model_id_device_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."device_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_configurations" ADD CONSTRAINT "relay_configurations_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_configurations" ADD CONSTRAINT "relay_configurations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_asset_scopes" ADD CONSTRAINT "user_asset_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_asset_scopes" ADD CONSTRAINT "user_asset_scopes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_alarms" ADD CONSTRAINT "work_order_alarms_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_alarms" ADD CONSTRAINT "work_order_alarms_alarm_id_alarms_id_fk" FOREIGN KEY ("alarm_id") REFERENCES "public"."alarms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alarm_events_alarm_created_idx" ON "alarm_events" USING btree ("alarm_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "alarm_rules_channel_uidx" ON "alarm_rules" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alarms_code_uidx" ON "alarms" USING btree ("code");--> statement-breakpoint
CREATE INDEX "alarms_site_status_severity_idx" ON "alarms" USING btree ("site_id","status","severity");--> statement-breakpoint
CREATE INDEX "alarms_asset_opened_idx" ON "alarms" USING btree ("asset_id","opened_at");--> statement-breakpoint
CREATE INDEX "alarms_channel_opened_idx" ON "alarms" USING btree ("channel_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_site_code_uidx" ON "assets" USING btree ("site_id","code");--> statement-breakpoint
CREATE INDEX "assets_site_state_idx" ON "assets" USING btree ("site_id","state");--> statement-breakpoint
CREATE INDEX "audit_site_created_idx" ON "audit_logs" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_actor_created_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_provider_subject_uidx" ON "auth_identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE INDEX "auth_identities_user_idx" ON "auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_uidx" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_expiry_idx" ON "auth_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_device_code_uidx" ON "channels" USING btree ("device_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_device_register_uidx" ON "channels" USING btree ("device_id","register_definition_id");--> statement-breakpoint
CREATE INDEX "channels_asset_enabled_idx" ON "channels" USING btree ("asset_id","enabled");--> statement-breakpoint
CREATE INDEX "channels_input_idx" ON "channels" USING btree ("physical_input_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commissioning_device_item_uidx" ON "commissioning_items" USING btree ("device_id","item_key");--> statement-breakpoint
CREATE INDEX "commissioning_device_status_idx" ON "commissioning_items" USING btree ("device_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "configuration_device_version_uidx" ON "configuration_snapshots" USING btree ("device_id","version");--> statement-breakpoint
CREATE INDEX "configuration_device_created_idx" ON "configuration_snapshots" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_models_code_uidx" ON "device_models" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_gateway_unit_uidx" ON "devices" USING btree ("gateway_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_asset_code_uidx" ON "devices" USING btree ("asset_id","code");--> statement-breakpoint
CREATE INDEX "devices_gateway_state_idx" ON "devices" USING btree ("gateway_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "gateways_site_code_uidx" ON "gateways" USING btree ("site_id","code");--> statement-breakpoint
CREATE INDEX "gateways_site_state_idx" ON "gateways" USING btree ("site_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_batches_gateway_key_uidx" ON "ingestion_batches" USING btree ("gateway_id","batch_key");--> statement-breakpoint
CREATE INDEX "ingestion_batches_device_started_idx" ON "ingestion_batches" USING btree ("device_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_site_name_uidx" ON "integrations" USING btree ("site_id","name");--> statement-breakpoint
CREATE INDEX "latest_readings_quality_idx" ON "latest_readings" USING btree ("quality");--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_queued_idx" ON "notification_deliveries" USING btree ("status","queued_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_alarm_idx" ON "notification_deliveries" USING btree ("alarm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_endpoint_site_name_uidx" ON "notification_endpoints" USING btree ("site_id","name");--> statement-breakpoint
CREATE INDEX "notification_policy_site_active_idx" ON "notification_policies" USING btree ("site_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_code_uidx" ON "permissions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "permissions_module_idx" ON "permissions" USING btree ("module");--> statement-breakpoint
CREATE UNIQUE INDEX "physical_inputs_device_code_uidx" ON "physical_inputs" USING btree ("device_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "physical_inputs_device_kind_port_uidx" ON "physical_inputs" USING btree ("device_id","kind","port_number");--> statement-breakpoint
CREATE INDEX "reading_aggregates_bucket_idx" ON "reading_aggregates" USING btree ("bucket_seconds","bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_profile_range_name_uidx" ON "reading_profile_ranges" USING btree ("profile_id","name");--> statement-breakpoint
CREATE INDEX "reading_profile_range_priority_idx" ON "reading_profile_ranges" USING btree ("profile_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_profiles_key_uidx" ON "reading_profiles" USING btree ("key");--> statement-breakpoint
CREATE INDEX "readings_channel_recorded_idx" ON "readings" USING btree ("channel_id","recorded_at");--> statement-breakpoint
CREATE INDEX "readings_recorded_idx" ON "readings" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "readings_quality_recorded_idx" ON "readings" USING btree ("quality","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "readings_channel_time_sequence_uidx" ON "readings" USING btree ("channel_id","recorded_at","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "readings_batch_channel_uidx" ON "readings" USING btree ("batch_id","channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "register_model_native_uidx" ON "register_definitions" USING btree ("model_id","native_register");--> statement-breakpoint
CREATE INDEX "register_model_group_idx" ON "register_definitions" USING btree ("model_id","register_group");--> statement-breakpoint
CREATE UNIQUE INDEX "relay_device_number_uidx" ON "relay_configurations" USING btree ("device_id","relay_number");--> statement-breakpoint
CREATE INDEX "report_runs_status_created_idx" ON "report_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "report_schedules_next_run_idx" ON "report_schedules" USING btree ("active","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_uidx" ON "roles" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_code_uidx" ON "sites" USING btree ("code");--> statement-breakpoint
CREATE INDEX "sites_active_idx" ON "sites" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "user_invitations_token_hash_uidx" ON "user_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_invitations_site_email_idx" ON "user_invitations" USING btree ("site_id","email");--> statement-breakpoint
CREATE INDEX "user_role_site_idx" ON "user_role_assignments" USING btree ("site_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uidx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_code_uidx" ON "work_orders" USING btree ("code");--> statement-breakpoint
CREATE INDEX "work_orders_site_status_idx" ON "work_orders" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "work_orders_assignee_status_idx" ON "work_orders" USING btree ("assigned_to","status");