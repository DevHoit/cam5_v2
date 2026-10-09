ALTER TABLE "devices" ADD COLUMN "device_type" varchar(80) DEFAULT 'condition_monitor' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "driver" varchar(80) DEFAULT 'cam5' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

CREATE TABLE "metric_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" varchar(160) NOT NULL,
  "name" varchar(180) NOT NULL,
  "category" varchar(80) NOT NULL,
  "unit" varchar(40) NOT NULL,
  "data_type" varchar(24) DEFAULT 'float' NOT NULL,
  "aggregation" varchar(24) DEFAULT 'last' NOT NULL,
  "description" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "metric_definitions_data_type_chk" CHECK ("data_type" IN ('float', 'integer', 'boolean', 'string', 'enum')),
  CONSTRAINT "metric_definitions_aggregation_chk" CHECK ("aggregation" IN ('last', 'avg', 'min', 'max', 'sum', 'counter'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "metric_definitions_key_uidx" ON "metric_definitions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "metric_definitions_category_idx" ON "metric_definitions" USING btree ("category");--> statement-breakpoint

CREATE TABLE "gateway_device_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gateway_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "interface_type" varchar(32) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "gateway_device_bindings_interface_chk" CHECK ("interface_type" IN ('modbus_tcp', 'rs485', 'ble', 'ethernet', 'wifi', 'virtual'))
);--> statement-breakpoint
ALTER TABLE "gateway_device_bindings" ADD CONSTRAINT "gateway_device_bindings_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_device_bindings" ADD CONSTRAINT "gateway_device_bindings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_device_bindings_pair_uidx" ON "gateway_device_bindings" USING btree ("gateway_id","device_id");--> statement-breakpoint
CREATE INDEX "gateway_device_bindings_device_idx" ON "gateway_device_bindings" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "gateway_device_bindings_gateway_enabled_idx" ON "gateway_device_bindings" USING btree ("gateway_id","enabled");--> statement-breakpoint

CREATE TABLE "device_capabilities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" uuid NOT NULL,
  "capability_key" varchar(120) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "device_capabilities" ADD CONSTRAINT "device_capabilities_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_capabilities_device_key_uidx" ON "device_capabilities" USING btree ("device_id","capability_key");--> statement-breakpoint
CREATE INDEX "device_capabilities_key_idx" ON "device_capabilities" USING btree ("capability_key","enabled");--> statement-breakpoint

CREATE TABLE "device_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" uuid NOT NULL,
  "metric_definition_id" uuid NOT NULL,
  "code" varchar(100) NOT NULL,
  "name" varchar(180) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_metrics_display_order_chk" CHECK ("display_order" >= 0)
);--> statement-breakpoint
ALTER TABLE "device_metrics" ADD CONSTRAINT "device_metrics_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_metrics" ADD CONSTRAINT "device_metrics_metric_definition_id_metric_definitions_id_fk" FOREIGN KEY ("metric_definition_id") REFERENCES "public"."metric_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_metrics_device_code_uidx" ON "device_metrics" USING btree ("device_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "device_metrics_device_metric_uidx" ON "device_metrics" USING btree ("device_id","metric_definition_id");--> statement-breakpoint
CREATE INDEX "device_metrics_device_enabled_idx" ON "device_metrics" USING btree ("device_id","enabled");